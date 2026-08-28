// 净化：模型回显的 HTML 写入页面前的唯一闸门（白名单清洗）。
// doc 必须显式传入：用 doc.implementation.createHTMLDocument 建离线解析文档，
// 避开 DOMParser 构造器的环境差异（jsdom 与浏览器同一条路径）。
function sanitizeHtml(html, doc) {
  if (!doc) throw new Error("sanitizeHtml: no Document provided");
  const parsed = doc.implementation.createHTMLDocument("sanitize");
  parsed.body.innerHTML = String(html);

  const banned = parsed.body.querySelectorAll(
    "script, style, iframe, object, embed, link, meta, base, form, " +
      "img, svg, picture, source, video, audio, canvas, map",
  );
  // 就地删除元素：先物化成数组，避免遍历中改动活集合
  for (const el of Array.from(banned)) el.remove();

  for (const el of parsed.body.querySelectorAll("*")) {
    // el.attributes 是活集合，removeAttribute 会改动它——先物化
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const val = String(attr.value).trim().toLowerCase();
      const dangerousUrl =
        (name === "href" || name === "src" || name === "xlink:href") &&
        (val.indexOf("javascript:") === 0 || val.indexOf("data:text/html") === 0);
      if (name.indexOf("on") === 0 || dangerousUrl) el.removeAttribute(attr.name);
    }
  }
  return parsed.body.innerHTML;
}

export { sanitizeHtml };
