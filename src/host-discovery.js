// 宿主发现：环境显式注入（文档 / 计算样式 / 已处理宿主登记表），jsdom 可测。

import * as TextUtils from "./text-utils.js";

// TreeWalker 常量的数值形式（避免对全局 NodeFilter 的环境依赖）
const SHOW_TEXT = 4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

// 可作译文宿主的普通块流 display 白名单
const SAFE_BLOCK_DISPLAYS = [
  "block",
  "flow-root",
  "list-item",
  "table-cell",
  "table-caption",
  "inline-block",
];
// flex/grid 不是宿主，也不是拦路者：下探其子项寻找叶子安全块
const FLEX_GRID_RE = /^(-webkit-)?(inline-)?(flex|grid)$/;

// 硬跳过区域：绝不成为宿主、绝不下探（其中内容也不会进入任何快照）。
// 注意 pre/code 不在其列——它们随所属叶子宿主的 innerHTML 原样投喂给 LLM。
const HARD_SKIP_SELECTOR =
  "script, style, noscript, template, iframe, svg, math, canvas, video, audio, head, " +
  "textarea, input, select, option, [contenteditable='true'], [role='textbox'], " +
  "[aria-hidden='true'], .translate-node";

// 区域标记表：决定宿主的翻译优先级档位（只影响请求发起顺序，不影响译文位置）。
// 标签与 role 等价——大量站点用 div role=navigation 而不写 <nav>，只认标签会漏掉一半。
const TOP_REGION_SELECTOR = "main, article, [role='main']";
const PERIPHERAL_REGION_SELECTOR =
  "header, footer, nav, aside, " +
  "[role='banner'], [role='contentinfo'], [role='navigation'], [role='complementary']";

const TIER_TOP = 0; // 正文区域内
const TIER_PLAIN = 1; // 无区域标记（与引入排序前的行为一致）
const TIER_PERIPHERAL = 2; // 边缘区域内

// 判档：自宿主自身起沿祖先链上行，逐级先试正文再试边缘，首个命中即返回——
// 这就是「最近祖先胜出」（main > nav 判边缘，aside > article 判正文）。
// 走链而非两次 closest 比深度，也使判档与传入的子树 root 无关（root 以上的标记不会丢）。
function regionTier(el) {
  let cur = el;
  while (cur && cur.nodeType === 1) {
    if (cur.matches(TOP_REGION_SELECTOR)) return TIER_TOP;
    if (cur.matches(PERIPHERAL_REGION_SELECTOR)) return TIER_PERIPHERAL;
    cur = cur.parentElement;
  }
  return TIER_PLAIN;
}

// 近似判断"内部还有更深的安全块"用的常见块级标签集。
// 命中则下探（宿主选更深、粒度更细）；漏判则宿主偏大（粒度粗），
// 误判代价仅为 payload 更小——偏保守的通用集合即可。
const COMMON_BLOCK_QUERY =
  "p, div, li, td, th, h1, h2, h3, h4, h5, h6, section, article, blockquote, " +
  "dd, dt, figcaption, figure, main, aside";

// 媒体占位清单：快照时替换为同名空元素（去属性去子树）——
// base64/路径数据不进 prompt、不计批次字符上限，模型仅感知"此处有媒体"的语序。
// 仅作用于投喂序列化的克隆子树；可翻性判定与回显净化不受此清单影响。
const MEDIA_PLACEHOLDER_SELECTOR = "img, svg, picture, source, video, audio, canvas, map";

// 表单控件换名清单：快照时 input/button 换为 span——
// 回显不再产生可交互元素；input 为纯占位（空 span，value/placeholder 一律不投喂）、
// button 子内容保留。
const CONTROL_RENAME_SELECTOR = "input, button";

// 剥离元素全部属性（骨架序列化：投喂只剩标签名与文本）。
// el.attributes 是活集合，删除会改动它——先物化成名字数组再逐个删。
function stripAllAttributes(el) {
  const names = Array.from(el.attributes, (attr) => attr.name);
  for (const name of names) el.removeAttribute(name);
}

function createHostDiscovery(env) {
  const doc = env.document;
  const computed = env.getComputedStyle;
  const hostState = env.hostState || new Set();

  function isVisible(el) {
    if (!el) return false;
    const style = computed(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // 剥码文本：host 内除去 pre/code 子树后的自然语言候选。
  // 这是"整段落都是代码 → 直接跳过"规则的基石。
  function nonCodeText(host) {
    let out = "";
    const walker = doc.createTreeWalker(host, SHOW_TEXT, {
      acceptNode: function (node) {
        let el = node.parentElement;
        while (el && el !== host) {
          const tag = el.tagName;
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
    const tag = el.tagName;
    if (tag === "PRE" || tag === "CODE") return false; // 裸/嵌套 pre/code 段不投喂
    const text = nonCodeText(el).replace(/\s+/g, " ").trim();
    if (!text) return false; // 全码/空白 → 跳过
    if (!TextUtils.hasTranslatableText(text)) return false; // 剩 URL/数字/符号 → 跳过
    const stripped = TextUtils.stripUrlTokens(text);
    if (TextUtils.isChinese(stripped)) return false; // 中文占优 → 跳过
    return true;
  }

  // 快照（骨架序列化，管线顺序固定）：克隆宿主 → 剔除本扩展插入物 →
  // 媒体标签占位化（去属性去子树，图形数据不进 prompt）→
  // input/button 换名 span（input 的 value 转文本、button 子内容保留）→
  // 剥离全部元素属性——投喂只剩标签名与文本，模型无从篡改 class/href
  function snapshotHtml(hostEl) {
    const clone = hostEl.cloneNode(true);
    // 就地删除/替换元素的三个循环：先物化成数组，避免遍历中改动集合
    for (const inserted of Array.from(clone.querySelectorAll(".translate-node"))) {
      inserted.remove();
    }
    for (const el of Array.from(clone.querySelectorAll(MEDIA_PLACEHOLDER_SELECTOR))) {
      while (el.firstChild) el.removeChild(el.firstChild);
      stripAllAttributes(el);
    }
    for (const ctrl of Array.from(clone.querySelectorAll(CONTROL_RENAME_SELECTOR))) {
      const span = doc.createElement("span");
      if (ctrl.tagName !== "INPUT") {
        while (ctrl.firstChild) span.appendChild(ctrl.firstChild); // button 子内容保留
      }
      ctrl.parentNode.replaceChild(span, ctrl);
    }
    for (const el of clone.querySelectorAll("*")) stripAllAttributes(el);
    return clone.innerHTML;
  }

  // DFS 发现叶子层安全块宿主：自身命中白名单且内部不再含有更深常见块元素。
  // flex/grid 容器继续下探子项；硬跳过区剪枝；纯码包裹层因剥码判空被剪枝。
  function discoverEntries(root) {
    const start = root || doc.body;
    const hosts = [];

    function visit(el) {
      if (!el || el.nodeType !== 1) return; // ELEMENT_NODE（数值判定，避免对全局 Element 的环境依赖）
      if (el.closest(HARD_SKIP_SELECTOR)) return;
      const display = computed(el).display;
      if (FLEX_GRID_RE.test(display)) {
        for (const child of el.children) visit(child);
        return;
      }
      if (SAFE_BLOCK_DISPLAYS.indexOf(display) !== -1) {
        if (hostState.has(el)) return;
        if (!qualifiesAsHost(el)) return;
        if (el.querySelector(COMMON_BLOCK_QUERY)) {
          // 更深的内容块存在 → 让子树自己产生宿主（粒度更细、payload 更准）
          for (const child of el.children) visit(child);
          return;
        }
        hosts.push(el);
        return;
      }
      // 行内或其他 display：不在本层做宿主，下探找隐藏其内的块
      for (const child of el.children) visit(child);
    }

    for (const child of start.children) visit(child); // root/body 自身不作宿主
    // 按档位稳定排序：正文先占满并发池，边缘区域排到队尾；档内保持文档序
    // （ES2019 起 sort 稳定，无需额外记下标）。排序只改请求次序，不改译文位置。
    return hosts
      .map((el) => ({ el: el, html: snapshotHtml(el), tier: regionTier(el) }))
      .sort((a, b) => a.tier - b.tier);
  }

  return { isVisible, nonCodeText, qualifiesAsHost, snapshotHtml, discoverEntries };
}

export { createHostDiscovery };
