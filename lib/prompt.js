// ============================================================
// 默认提示词模板（唯一默认值来源）
//
// 占位符约定（由渲染方替换）：
//   {target} —— 目标语言
//   {host}   —— 单宿主骨架 HTML（只有标签名与文本，见 host-discovery
//               的 snapshotHtml 序列化管线）
// 模板可被用户在配置页覆盖；存储值仅在包含 {host} 时被接受。
//
// 包装协议：renderPrompt 注入 {host} 时包一层 <html>…</html>（模型按
// 模板示例回显同样包装）；写入 DOM 前由 stripHostWrapper 剥离该包装。
// ============================================================

// 渲染器：纯函数，双环境可用。
// renderPrompt(template, hostHtml, vars)
//   template —— 必含 "{host}" 占位符，缺失抛错
//   hostHtml —— 单宿主骨架 HTML 片段；回显全文即该宿主译文
//               （无标记协议、无条目拼接）
//   vars     —— 可选附加替换集（如 { target: "中文" }），键名对应 "{key}"
// 宿主内换行原样保留；split/join 全量替换（不依赖正则转义）。
// 剥离最外层 <html>…</html> 包装（renderPrompt 为 {host} 注入的包装之逆操作）。
// 仅当整体（trim 后）恰为一层 html 包装时剥离；无包装或其他形态原样返回（trim 后）。
// 容忍属性（<html lang="zh-CN">）、大小写、首尾空白；纯空壳 <html></html> → ""。
function stripHostWrapper(text) {
  const s = String(text).trim();
  const m = /^<html[^>]*>([\s\S]*)<\/html>$/i.exec(s);
  return m ? m[1].trim() : s;
}

function renderPrompt(template, hostHtml, vars) {
  if (typeof template !== "string" || !template.includes("{host}")) {
    throw new Error("prompt template missing {host} placeholder");
  }
  let out = template.split("{host}").join(`<html>${hostHtml == null ? "" : String(hostHtml)}</html>`);
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

if (typeof globalThis !== "undefined") {
  globalThis.DEFAULT_PROMPT_TEMPLATE = DEFAULT_PROMPT_TEMPLATE;
  globalThis.renderPrompt = renderPrompt;
  globalThis.stripHostWrapper = stripHostWrapper;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DEFAULT_PROMPT_TEMPLATE, renderPrompt, stripHostWrapper };
}
