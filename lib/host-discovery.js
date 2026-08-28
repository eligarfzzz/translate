// ============================================================
// 宿主发现（可测形态：环境参数化，jsdom 可注入）
//
// 语义来源：v3 content script 内联实现原样迁移，行为零变化。
//   • createHostDiscovery({ document, getComputedStyle, hostState })
//     —— 三个环境依赖显式注入：文档（TreeWalker/body 默认值）、
//        计算样式（display 白名单判定）、已处理宿主登记表（防重复）
//   • nonCodeText：剥码文本提取——pre/code 子树剪除（整段纯码跳过的基石）
//   • qualifiesAsHost：可见、未处理、自身非 PRE/CODE（裸/嵌套代码段整段跳过）、
//       剥码+剔 URL 后有实质字母、非中文占优
//   • snapshotHtml：宿主骨架快照，剔除本扩展插入物（.translate-node），
//       媒体标签（img/svg/picture/source/video/audio/canvas/map）占位化为同名空元素，
//       input/button 换名 span（input 的 value 转文本、button 子内容保留），
//       最后剥离全部元素属性——投喂只剩标签名与文本
//   • discoverEntries(root?)：DFS 找叶子层安全块宿主——
//       安全块白名单命中且内部无更深常见块 → 该元素即宿主；
//       flex/grid 容器下探子项；硬跳过区剪枝；纯码包裹层剥码判空剪枝
// 依赖：TextUtils（text-utils.js，剥码判定的字母/URL/中文判定）。
// 双环境：扩展全局 createHostDiscovery + node 模块导出。
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./text-utils.js"));
  } else {
    root.HostDiscovery = factory(root.TextUtils);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (TextUtils) {
  "use strict";

  // TreeWalker 常量的数值形式（避免对全局 NodeFilter 的环境依赖）
  var SHOW_TEXT = 4;
  var FILTER_ACCEPT = 1;
  var FILTER_REJECT = 2;

  // 可作译文宿主的普通块流 display 白名单
  var SAFE_BLOCK_DISPLAYS = [
    "block", "flow-root", "list-item", "table-cell", "table-caption", "inline-block",
  ];
  // flex/grid 不是宿主，也不是拦路者：下探其子项寻找叶子安全块
  var FLEX_GRID_RE = /^(-webkit-)?(inline-)?(flex|grid)$/;

  // 硬跳过区域：绝不成为宿主、绝不下探（其中内容也不会进入任何快照）。
  // 注意 pre/code 不在其列——它们随所属叶子宿主的 innerHTML 原样投喂给 LLM。
  var HARD_SKIP_SELECTOR =
    "script, style, noscript, template, iframe, svg, math, canvas, video, audio, head, " +
    "textarea, input, select, option, [contenteditable='true'], [role='textbox'], " +
    "[aria-hidden='true'], .translate-node";

  // 近似判断"内部还有更深的安全块"用的常见块级标签集。
  // 命中则下探（宿主选更深、粒度更细）；漏判则宿主偏大（粒度粗），
  // 误判代价仅为 payload 更小——偏保守的通用集合即可。
  var COMMON_BLOCK_QUERY =
    "p, div, li, td, th, h1, h2, h3, h4, h5, h6, section, article, blockquote, " +
    "dd, dt, figcaption, figure, main, aside";

  // 媒体占位清单：快照时替换为同名空元素（去属性去子树）——
  // base64/路径数据不进 prompt、不计批次字符上限，模型仅感知"此处有媒体"的语序。
  // 仅作用于投喂序列化的克隆子树；可翻性判定与回显净化不受此清单影响。
  var MEDIA_PLACEHOLDER_SELECTOR =
    "img, svg, picture, source, video, audio, canvas, map";

  // 表单控件换名清单：快照时 input/button 换为 span——
  // 回显不再产生可交互元素；input 的 value 转文本、button 子内容保留。
  var CONTROL_RENAME_SELECTOR = "input, button";

  // 剥离元素全部属性（骨架序列化：投喂只剩标签名与文本）
  function stripAllAttributes(el) {
    var names = [];
    for (var a = 0; a < el.attributes.length; a++) names.push(el.attributes[a].name);
    for (var k = 0; k < names.length; k++) el.removeAttribute(names[k]);
  }

  function createHostDiscovery(env) {
    var doc = env.document;
    var computed = env.getComputedStyle;
    var hostState = env.hostState || new Set();

    function isVisible(el) {
      if (!el) return false;
      var style = computed(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    // 剥码文本：host 内除去 pre/code 子树后的自然语言候选。
    // 这是"整段落都是代码 → 直接跳过"规则的基石。
    function nonCodeText(host) {
      var out = "";
      var walker = doc.createTreeWalker(host, SHOW_TEXT, {
        acceptNode: function (node) {
          var el = node.parentElement;
          while (el && el !== host) {
            var tag = el.tagName;
            if (tag === "PRE" || tag === "CODE") return FILTER_REJECT;
            el = el.parentElement;
          }
          return FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) out += walker.currentNode.nodeValue;
      return out;
    }

    // 宿主资格：可见、尚未处理、自身非 PRE/CODE（裸放/嵌套代码段整段静默跳过，
    // 与纯码包裹层剥码判空剪枝语义统一）、剥离代码与 URL 后仍留有实质自然语言、
    // 且非中文占优
    function qualifiesAsHost(el) {
      if (hostState.has(el)) return false;
      if (!isVisible(el)) return false;
      var tag = el.tagName;
      if (tag === "PRE" || tag === "CODE") return false;   // 裸/嵌套 pre/code 段不投喂
      var text = nonCodeText(el).replace(/\s+/g, " ").trim();
      if (!text) return false;                       // 全码/空白 → 跳过
      if (!TextUtils.hasTranslatableText(text)) return false; // 剩 URL/数字/符号 → 跳过
      var stripped = TextUtils.stripUrlTokens(text);
      if (TextUtils.isChinese(stripped)) return false;        // 中文占优 → 跳过
      return true;
    }

    // 快照（骨架序列化，管线顺序固定）：克隆宿主 → 剔除本扩展插入物 →
    // 媒体标签占位化（去属性去子树，图形数据不进 prompt）→
    // input/button 换名 span（input 的 value 转文本、button 子内容保留）→
    // 剥离全部元素属性——投喂只剩标签名与文本，模型无从篡改 class/href
    function snapshotHtml(hostEl) {
      var clone = hostEl.cloneNode(true);
      var clones = clone.querySelectorAll(".translate-node");
      for (var i = 0; i < clones.length; i++) clones[i].remove();
      var media = clone.querySelectorAll(MEDIA_PLACEHOLDER_SELECTOR);
      for (var m = 0; m < media.length; m++) {
        var el = media[m];
        while (el.firstChild) el.removeChild(el.firstChild);
        stripAllAttributes(el);
      }
      var controls = clone.querySelectorAll(CONTROL_RENAME_SELECTOR);
      for (var c = 0; c < controls.length; c++) {
        var ctrl = controls[c];
        var span = doc.createElement("span");
        if (ctrl.tagName === "INPUT") {
          span.textContent = ctrl.getAttribute("value") || ""; // value 转文本（换名先于剥属性）
        } else {
          while (ctrl.firstChild) span.appendChild(ctrl.firstChild); // button 子内容保留
        }
        ctrl.parentNode.replaceChild(span, ctrl);
      }
      var all = clone.querySelectorAll("*");
      for (var s = 0; s < all.length; s++) stripAllAttributes(all[s]);
      return clone.innerHTML;
    }

    // DFS 发现叶子层安全块宿主：自身命中白名单且内部不再含有更深常见块元素。
    // flex/grid 容器继续下探子项；硬跳过区剪枝；纯码包裹层因剥码判空被剪枝。
    function discoverEntries(root) {
      var start = root || doc.body;
      var hosts = [];

      function visit(el) {
        if (!el || el.nodeType !== 1) return; // ELEMENT_NODE（数值判定，避免对全局 Element 的环境依赖）
        if (el.closest(HARD_SKIP_SELECTOR)) return;
        var display = computed(el).display;
        if (FLEX_GRID_RE.test(display)) {
          for (var fc = el.firstElementChild; fc; fc = fc.nextElementSibling) visit(fc);
          return;
        }
        if (SAFE_BLOCK_DISPLAYS.indexOf(display) !== -1) {
          if (hostState.has(el)) return;
          if (!qualifiesAsHost(el)) return;
          if (el.querySelector(COMMON_BLOCK_QUERY)) {
            // 更深的内容块存在 → 让子树自己产生宿主（粒度更细、payload 更准）
            for (var dc = el.firstElementChild; dc; dc = dc.nextElementSibling) visit(dc);
            return;
          }
          hosts.push(el);
          return;
        }
        // 行内或其他 display：不在本层做宿主，下探找隐藏其内的块
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) visit(c);
      }

      for (var c = start.firstElementChild; c; c = c.nextElementSibling) visit(c); // root/body 自身不作宿主
      return hosts.map(function (el) { return { el: el, html: snapshotHtml(el) }; });
    }

    return {
      isVisible: isVisible,
      nonCodeText: nonCodeText,
      qualifiesAsHost: qualifiesAsHost,
      snapshotHtml: snapshotHtml,
      discoverEntries: discoverEntries,
    };
  }

  return { createHostDiscovery: createHostDiscovery };
});
