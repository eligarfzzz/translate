// 提示词模板与渲染（纯函数）。占位符 {target} = 目标语言，{extra} = 追加提示词，
// {host} = 单宿主骨架 HTML。
// 包装协议：renderPrompt 注入 {host} 时包一层 <html>…</html>，模型按模板示例回显同样包装，
// 写入 DOM 前由 stripHostWrapper 剥回来——包装给了模型一个明确的片段边界，
// 回显多余的前后言语因此落在包装外，可被整段丢弃。

// 「恰一层 <html>…</html>」判定的唯一实现：整体（trim 后）恰为一层 html 包装时返回
// 内层文本，否则 null。容忍属性（<html lang="zh-CN">）、大小写、首尾空白。
// 包装的三件事（注入、判定、剥壳）全部以它为准——不存在第二套「什么是包装」的标准。
function matchHostWrapper(text) {
  return /^<html[^>]*>([\s\S]*)<\/html>$/i.exec(String(text).trim());
}

// 包装 helper（renderPrompt 注入 {host} 用它；会话链的 user 轮同形包装也用它，
// 见 spec D4「包装 helper 唯一来源 prompt.js」）。null/undefined → 空壳。
function wrapHost(text) {
  return `<html>${text == null ? "" : String(text)}</html>`;
}

// 是否恰为一层包装（background 的回显形态判定用）：空壳 <html></html> 为真。
function isHostWrapped(text) {
  return matchHostWrapper(text) !== null;
}

// 剥离最外层 <html>…</html> 包装（renderPrompt 注入包装的逆操作）。
// 仅当整体（trim 后）恰为一层 html 包装时剥离；无包装或其他形态原样返回（trim 后）。
// 纯空壳 <html></html> → ""。
function stripHostWrapper(text) {
  const m = matchHostWrapper(text);
  return m ? m[1].trim() : String(text).trim();
}

// 渲染：template 必含 "{host}"（缺失抛错，消费侧据此回退默认模板）；
// vars 为附加替换集（如 { target: "中文", extra: "…" }），键名对应 "{key}"。
// 单遍替换：只扫描模板一次，命中占位符就查表取值——任何替换结果都不再进入扫描，
// 注入的宿主 HTML、目标语言与追加提示词里的字面占位符因此原样保留。
// 查不到的占位符原样保留；宿主内换行原样保留；{host} 是特例：注入时包一层 <html>…</html>。
function renderPrompt(template, hostHtml, vars) {
  if (typeof template !== "string" || !template.includes("{host}")) {
    throw new Error("prompt template missing {host} placeholder");
  }
  const hostValue = wrapHost(hostHtml);
  const varsObj = vars && typeof vars === "object" ? vars : {};
  // 替换值用函数形式给出，避免 "$&" 之类替换串特殊语法被解释；只认自有键（原型成员不算）
  return template.replace(/\{([^{}]+)\}/g, (placeholder, key) => {
    if (key === "host") return hostValue;
    return Object.hasOwn(varsObj, key) ? String(varsObj[key]) : placeholder;
  });
}

const DEFAULT_PROMPT_TEMPLATE = [
  "You are a web page translater. Translate natural-language text into {target}.",
  "Keep every HTML tag intact (<pre>, <code>, <a>, <b>, etc.). You can keep the original text for names, ids,URLs, email addresses or etc...",
  "Inside <pre> and <code>, translate only comments ; never translate others.",
  "Input a HTML fragment of a single page block.",
  "Output exactly one translated copy of that fragment.",
  "{extra}",
  "Example: Input: <html><p>Who are <span>you</span></p></html>",
  "Output: <html><p><span>你</span>是谁</p></html>",
  "Now translate the following HTML fragment.",
  "",
  "{host}",
].join("\n");

export { DEFAULT_PROMPT_TEMPLATE, renderPrompt, stripHostWrapper, wrapHost, isHostWrapped };
