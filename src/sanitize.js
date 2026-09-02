// 净化：模型回显的 HTML 写入页面前的唯一闸门（白名单清洗 + 空白规范 + 空壳去除）。
// doc 必须显式传入：用 doc.implementation.createHTMLDocument 建离线解析文档，
// 避开 DOMParser 构造器的环境差异（jsdom 与浏览器同一条路径）。

// —— 空白规范化与空壳去除（输出侧卫生层）——
// 译文容器是 pre-wrap：元素间换行/缩进原样上屏会变成视觉空行、错位缩进，
// <p></p> 之类空壳会留下空白块。净化在离线解析文档上进行，取不到页面样式，
// 只能按 HTML 默认展示语义判定块级/行内；集合外的元素（含未知/自定义标签）
// 一律按行内保守处理（宁可少删）。输入侧快照/骨架序列化不走本函数，不受影响。

// 块级标签集合（默认 display:block 的 HTML 元素，含表格结构）
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

// 表格结构豁免：空 td/th 常是排版占位，删除会错位塌陷，结构元素自身永不删
const TABLE_STRUCTURE_TAGS = new Set([
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
]);

// void 元素：按「无内容」判定天然为空，但语义上不可删（br 的换行、hr 的分隔线）。
// media/表单类已在 banned 阶段整体移除，这里只列可能存活的 void 标签。
const VOID_TAGS = new Set(["br", "col", "hr", "input", "param", "track", "wbr"]);

// 空白字符全集：\s（JS 已含 NBSP \u00A0、\u2000-\u200A、\u3000、BOM \uFEFF 等）
// + 零宽 \u200B-\u200D（不在 \s 内，显式补齐）。HTML 实体经 innerHTML 解析后
// 已归一为这些真实字符，无需实体层特判。
const LEADING_WS_RE = /^[\s\u200B-\u200D]+/;
const TRAILING_WS_RE = /[\s\u200B-\u200D]+$/;
const NON_WS_RE = /[^\s\u200B-\u200D]/;

const isElement = (n) => n.nodeType === 1;
const tagOf = (el) => el.tagName.toLowerCase();

// pre/code 子树整体豁免（与 prompt 模板「代码内部原样」约束同源）：自身或任一
// 祖先为 pre/code 的节点，其文本与空壳清理全部跳过，内部换行缩进原样保留。
function inPreOrCode(node) {
  for (let n = isElement(node) ? node : node.parentNode; n; n = n.parentNode) {
    if (!isElement(n)) continue;
    const tag = tagOf(n);
    if (tag === "pre" || tag === "code") return true;
  }
  return false;
}

// 文本节点一侧的邻接边界是否块级：邻接兄弟是块级元素，或文本落在块级容器自身的
// 首/尾边缘；行内容器边缘与文本兄弟一律按行内保守处理。
function blockSide(textNode, before) {
  const sib = before ? textNode.previousSibling : textNode.nextSibling;
  if (sib) return isElement(sib) && BLOCK_TAGS.has(tagOf(sib));
  const parent = textNode.parentNode;
  return isElement(parent) && BLOCK_TAGS.has(tagOf(parent));
}

// 单文本节点规范化：纯空白节点——邻接块边界则整段删除、位于行内内容之间则折叠为
// 单个普通空格；非纯空白节点只 trim 首尾（块边界侧删净、行内邻接侧保单空格），
// 节点中部空白序列不压缩（代码/诗歌类有意的内部换行不可猜测）。
function normalizeTextNode(textNode) {
  if (textNode.data === "") return;
  const leftBlock = blockSide(textNode, true);
  const rightBlock = blockSide(textNode, false);
  const data = textNode.data;
  if (!NON_WS_RE.test(data)) {
    textNode.data = leftBlock || rightBlock ? "" : " ";
    return;
  }
  let out = data;
  const lead = LEADING_WS_RE.exec(out);
  if (lead) {
    out = out.slice(lead[0].length);
    if (!leftBlock) out = " " + out;
  }
  const trail = TRAILING_WS_RE.exec(out);
  if (trail) {
    out = out.slice(0, trail.index);
    if (!rightBlock) out += " ";
  }
  textNode.data = out;
}

// 文本清理（跳过 pre/code 整棵子树）
function normalizeWhitespace(body) {
  const stack = [body];
  while (stack.length) {
    const el = stack.pop();
    for (const child of el.childNodes) {
      if (child.nodeType === 3) normalizeTextNode(child);
      else if (isElement(child)) {
        const tag = tagOf(child);
        if (tag !== "pre" && tag !== "code") stack.push(child);
      }
    }
  }
}

// 空壳去除（自底向上）：无元素子、无清理后非空文本子的元素删除。querySelectorAll
// 是前序，reverse 后子先于父，父的判空看到的是子树清理后的活树。
function removeEmptyElements(body) {
  for (const el of [...body.querySelectorAll("*")].reverse()) {
    if (inPreOrCode(el)) continue; // pre/code 整棵豁免（含空 pre 本身）
    const tag = tagOf(el);
    if (TABLE_STRUCTURE_TAGS.has(tag) || VOID_TAGS.has(tag)) continue;
    let nonEmpty = false;
    for (const child of el.childNodes) {
      if (isElement(child) || (child.nodeType === 3 && NON_WS_RE.test(child.data))) {
        nonEmpty = true;
        break;
      }
    }
    if (!nonEmpty) el.remove();
  }
}

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
  // 空白规范化与空壳去除：只作用在净化闸门内（输入侧快照序列化不走本函数）。
  // banned 元素在此前已整体移除，它们的残留兄弟空白随后被按块级边界规则清掉。
  normalizeWhitespace(parsed.body);
  removeEmptyElements(parsed.body);
  return parsed.body.innerHTML;
}

export { sanitizeHtml };
