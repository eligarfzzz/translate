// ============================================================
// 净化（白名单清洗：模型回显的 HTML 写入页面前的唯一闸门）
//
// sanitizeHtml(html, doc)：
//   • doc 显式参数（Document 实例，浏览器或 jsdom 皆可注入）——
//     用 doc.implementation.createHTMLDocument 建立离线解析文档，
//     避免 DOMParser 构造器的环境差异
//   • 删除：script / style / iframe / object / embed / link / meta / base / form；
//     媒体元素（img / svg / picture / source / video / audio / canvas / map，
//     与输入侧快照占位清单一致）整个移除（含子树）
//   • 剥离：on* 事件属性；href/src/xlink:href 上的 javascript: 与 data:text/html
// 语义来源：v3 content script 内联实现原样迁移，行为零变化。
// 双环境：扩展全局 Sanitize + node 模块导出。
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.Sanitize = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function sanitizeHtml(html, doc) {
    var work = doc || (typeof document !== "undefined" ? document : null);
    if (!work) throw new Error("sanitizeHtml: no Document provided");
    var parsed = work.implementation.createHTMLDocument("sanitize");
    parsed.body.innerHTML = String(html);

    var banned = parsed.body.querySelectorAll(
      "script, style, iframe, object, embed, link, meta, base, form, " +
      "img, svg, picture, source, video, audio, canvas, map"
    );
    for (var i = 0; i < banned.length; i++) banned[i].remove();

    var all = parsed.body.querySelectorAll("*");
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      var attrs = [];
      for (var k = 0; k < el.attributes.length; k++) attrs.push(el.attributes[k]);
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name.toLowerCase();
        var val = String(attrs[a].value).trim().toLowerCase();
        var dangerousUrl =
          (name === "href" || name === "src" || name === "xlink:href") &&
          (val.indexOf("javascript:") === 0 || val.indexOf("data:text/html") === 0);
        if (name.indexOf("on") === 0 || dangerousUrl) el.removeAttribute(attrs[a].name);
      }
    }
    return parsed.body.innerHTML;
  }

  return { sanitizeHtml: sanitizeHtml };
});
