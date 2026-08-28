// 提示词模板与渲染（纯函数）。占位符 {target} = 目标语言，{host} = 单宿主骨架 HTML。
// 包装协议：renderPrompt 注入 {host} 时包一层 <html>…</html>，模型按模板示例回显同样包装，
// 写入 DOM 前由 stripHostWrapper 剥回来——包装给了模型一个明确的片段边界，
// 回显多余的前后言语因此落在包装外，可被整段丢弃。

// 剥离最外层 <html>…</html> 包装（renderPrompt 注入包装的逆操作）。
// 仅当整体（trim 后）恰为一层 html 包装时剥离；无包装或其他形态原样返回（trim 后）。
// 容忍属性（<html lang="zh-CN">）、大小写、首尾空白；纯空壳 <html></html> → ""。
function stripHostWrapper(text) {
  const s = String(text).trim();
  const m = /^<html[^>]*>([\s\S]*)<\/html>$/i.exec(s);
  return m ? m[1].trim() : s;
}

// 渲染：template 必含 "{host}"（缺失抛错，消费侧据此回退默认模板）；
// vars 为附加替换集（如 { target: "中文" }），键名对应 "{key}"。
// 宿主内换行原样保留；split/join 全量替换（不依赖正则转义）。
function renderPrompt(template, hostHtml, vars) {
  if (typeof template !== "string" || !template.includes("{host}")) {
    throw new Error("prompt template missing {host} placeholder");
  }
  let out = template
    .split("{host}")
    .join(`<html>${hostHtml == null ? "" : String(hostHtml)}</html>`);
  const varsObj = vars && typeof vars === "object" ? vars : {};
  for (const key of Object.keys(varsObj)) {
    out = out.split("{" + key + "}").join(String(varsObj[key]));
  }
  return out;
}

const DEFAULT_PROMPT_TEMPLATE = [
  "You are a web page translater. Translate natural-language text into {target}.",
  "Keep every HTML tag intact (<pre>, <code>, <a>, <b>, etc.). You can keep the original text for names, ids,URLs, email addresses or etc...",
  "Inside <pre> and <code>, translate only comments ; never translate others.",
  "Input a HTML fragment of a single page block.",
  "Output exactly one translated copy of that fragment.",
  "Example: Input: <html><p>Who are <span>you</span></p></html>",
  "Output: <html><p><span>你</span>是谁</p></html>",
  "Now translate the following HTML fragment.",
  "",
  "{host}",
].join("\n");

export { DEFAULT_PROMPT_TEMPLATE, renderPrompt, stripHostWrapper };
