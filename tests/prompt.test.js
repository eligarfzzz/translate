// 宿主即请求（ADR-0005）：renderPrompt 渲染测试——{host} 注入、换行保留、占位符校验；
// HTML 包装协议（输入包 <html>，输出剥最外层）
import { test } from "node:test";
import assert from "node:assert";

import { DEFAULT_PROMPT_TEMPLATE, renderPrompt, stripHostWrapper } from "../src/prompt.js";

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
