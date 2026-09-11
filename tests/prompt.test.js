// 宿主即请求（ADR-0005）：renderPrompt 渲染测试——{host} 注入、换行保留、占位符校验；
// HTML 包装协议（输入包 <html>，输出剥最外层）；
// 追加提示词 {extra} 接缝：按行定位的插入点、字面保留、单遍替换（注入值不再被二次扫描）
import { test } from "node:test";
import assert from "node:assert";

import {
  DEFAULT_PROMPT_TEMPLATE,
  renderPrompt,
  stripHostWrapper,
  wrapHost,
  isHostWrapped,
} from "../src/prompt.js";

test("默认模板渲染：注入单宿主骨架并替换 {target}", () => {
  const out = renderPrompt(DEFAULT_PROMPT_TEMPLATE, "<p>a</p>", { target: "中文" });
  assert.ok(out.includes("<p>a</p>"), "host skeleton rendered");
  assert.ok(out.includes("中文"), "{target} replaced");
  assert.equal(out.includes("{host}"), false, "no {host} residue");
  assert.equal(out.includes("{target}"), false, "no {target} residue");
});

test("宿主内换行原样保留（不折叠、不转义）", () => {
  const out = renderPrompt("T\n{host}", "line1\nline2\n<pre>x</pre>");
  assert.ok(out.includes("line1\nline2\n<pre>x</pre>"));
});

test("模板缺 {host} 占位符时抛错（含旧 {entries} 占位符不再接受）", () => {
  assert.throws(() => renderPrompt("no placeholder here", "x"), /missing \{host\}/);
  assert.throws(() => renderPrompt("", "x"), /missing \{host\}/);
  assert.throws(() => renderPrompt("{entries}\nlegacy", "x"), /missing \{host\}/);
});

test("不传 vars 时 {target} 保留原文（文档化行为：由调用方决定替换集）", () => {
  const out = renderPrompt("Translate into {target}.\n{host}", "x");
  assert.ok(out.includes("{target}"), "{target} left intact without vars");
  assert.ok(out.includes("x"));
});

test("未知占位符原样保留（vars 里没有对应键，如 {entries}）", () => {
  const out = renderPrompt("Translate {entries} into {target}.\n{host}", "x", { target: "中文" });
  assert.ok(out.includes("{entries}"), "无对应值的占位符原样保留");
  assert.ok(out.includes("中文"), "{target} 照常替换");
  assert.ok(out.includes("<html>x</html>"), "{host} 照常包装注入");
});

// ---------------- 追加提示词 {extra} 接缝：插入点、字面保留、单遍替换 ----------------

const templateLines = () => DEFAULT_PROMPT_TEMPLATE.split("\n");
const lineStartingWith = (prefix) => templateLines().findIndex((line) => line.startsWith(prefix));

// 按行定位：默认模板的 {extra} 独占一行，紧接「Output exactly one …」之后、「Example: …」之前
// （断言的是位置关系，不写死整篇模板文本）
test("默认模板: {extra} 裸占位符独占一行，位于 Output… 行与 Example… 行之间", () => {
  const lines = templateLines();
  const extraLine = lines.indexOf("{extra}");
  const outputLine = lineStartingWith("Output exactly one translated copy of that fragment.");
  const exampleLine = lineStartingWith("Example: Input:");
  assert.notEqual(outputLine, -1, "前提：模板含「Output exactly one …」行");
  assert.notEqual(exampleLine, -1, "前提：模板含「Example: …」行");
  assert.notEqual(extraLine, -1, "模板含 {extra} 占位符");
  assert.equal(extraLine, outputLine + 1, "{extra} 紧接在「Output exactly one …」之后");
  assert.equal(exampleLine, extraLine + 1, "「Example: …」紧随 {extra} 行");
  assert.equal(lines[extraLine], "{extra}", "裸占位符独占一行（前后无其他文字）");
});

test("默认模板渲染: 那一行变成追加提示词；不填时该行渲染为空行", () => {
  const extraLine = templateLines().indexOf("{extra}");
  const extra = "专有名词保留原文";

  const filled = renderPrompt(DEFAULT_PROMPT_TEMPLATE, "<p>a</p>", { target: "中文", extra });
  assert.equal(filled.split("\n")[extraLine], extra, "追加提示词渲染在 {extra} 所在行");
  assert.equal(filled.includes("{extra}"), false, "无 {extra} 残留");

  const blank = renderPrompt(DEFAULT_PROMPT_TEMPLATE, "<p>a</p>", { target: "中文", extra: "" });
  assert.equal(blank.split("\n")[extraLine], "", "不填 → 该行渲染为空行（模板结构不变）");
});

test("字面保留: 追加提示词里的 {target}/{host}/{extra} 原样出现，与 vars 键序无关", () => {
  const extra = "规则：{target} 保持原文；别把 {host} 当宿主；{extra} 也别展开";
  // 两种键序都断言：字面保留必须由单遍替换保证，而不是「哪个键先替换」这种隐式顺序
  for (const vars of [
    { target: "中文", extra },
    { extra, target: "中文" },
  ]) {
    const out = renderPrompt(DEFAULT_PROMPT_TEMPLATE, "<p>a</p>", vars);
    assert.ok(out.includes(extra), "整段追加提示词原样出现（内部占位符一个都没被展开）");
    assert.ok(out.includes("{target} 保持原文"), "{target} 字面保留");
    assert.ok(out.includes("{host} 当宿主"), "{host} 字面保留");
    assert.ok(out.includes("{extra} 也别展开"), "{extra} 字面保留");
    assert.ok(out.includes("<html><p>a</p></html>"), "模板自身的 {host} 照常包装注入");
  }
});

test("不再二次扫描: 宿主 HTML 里的字面 {target} 原样保留（单遍替换修掉的真问题）", () => {
  const host = "<p>写 {target} 而不是中文</p>";
  const out = renderPrompt(DEFAULT_PROMPT_TEMPLATE, host, { target: "中文", extra: "e" });
  assert.ok(out.includes("<html>" + host + "</html>"), "宿主 HTML 原样注入（含字面 {target}）");
  // 模板自身的 {target} 仍被替换：留下的是「注入值里的」那一个
  assert.equal(out.split("{target}").length - 1, 1, "全文只剩宿主里那一个 {target}");
  assert.ok(out.includes("into 中文."), "模板里的 {target} 照常替换");
});

// ---- HTML 包装协议：输入带 <html> 包装，输出剥最外层 ----

test("包装协议: 渲染输出到端点的文本带 html 包装", () => {
  const out = renderPrompt("T\n{host}", "<p>x</p>");
  assert.ok(out.includes("<html><p>x</p></html>"), "host wrapped in <html>");
});

test("包装协议: 剥离最外层 html——<html>text</html> → text", () => {
  assert.equal(stripHostWrapper("<html>text</html>"), "text");
});

test("包装协议: 文本本身含 html 时只剥最外侧一层", () => {
  assert.equal(stripHostWrapper("<html><p>a<b>b</b></p></html>"), "<p>a<b>b</b></p>");
  // 双重包装只剥一层，内层 <html> 保留
  assert.equal(stripHostWrapper("<html><html>x</html></html>"), "<html>x</html>");
});

// ---- 共用包装 helper 与「恰一层包装」判定（票 03：会话链组装与回显形态判定同源） ----

test("包装 helper: 恰一层 <html>…</html>；null/undefined 得空壳", () => {
  assert.equal(wrapHost("<p>a</p>"), "<html><p>a</p></html>");
  assert.equal(wrapHost(""), "<html></html>");
  assert.equal(wrapHost(null), "<html></html>");
  assert.equal(wrapHost(undefined), "<html></html>");
});

test("包装判定: 恰一层包装为真（容忍属性/大小写/首尾空白），其余形态为假", () => {
  assert.equal(isHostWrapped("<html>x</html>"), true);
  assert.equal(isHostWrapped('<html lang="zh-CN">x</html>'), true);
  assert.equal(isHostWrapped("  <HTML>x</HTML>\n"), true);
  assert.equal(isHostWrapped("<html></html>"), true, "空壳也是合规包装（空回显另行判定）");
  assert.equal(isHostWrapped(""), false);
  assert.equal(isHostWrapped("x"), false);
  assert.equal(isHostWrapped("<html>x"), false);
  assert.equal(isHostWrapped("x</html>"), false);
  assert.equal(isHostWrapped("Sure! <html>x</html>"), false, "包装前带废话 = 不合形态");
  assert.equal(isHostWrapped("<html>x</html> Hope it helps!"), false, "包装后带废话 = 不合形态");
});

test("判定与剥壳同源: 判定为真 → 剥出内层；判定为假 → 原样（trim 后）返回", () => {
  for (const [text, inner] of [
    ["<html><p>a<b>b</b></p></html>", "<p>a<b>b</b></p>"],
    ['<html lang="zh">x</html>', "x"],
    ["<html></html>", ""],
    ["  <html> x </html>  ", "x"],
  ]) {
    assert.equal(isHostWrapped(text), true, `判定为真: ${text}`);
    assert.equal(stripHostWrapper(text), inner, `剥出内层: ${text}`);
  }
  for (const text of ["plain text", "<p>a</p>", "<html>half", "x</html>"]) {
    assert.equal(isHostWrapped(text), false, `判定为假: ${text}`);
    assert.equal(stripHostWrapper(text), text.trim(), `原样返回: ${text}`);
  }
});
