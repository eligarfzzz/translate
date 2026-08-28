// 工单 04：text-utils 测试——中文占比 0.3 边界、URL 剔除、字母资格、实体剥标
const { test } = require("node:test");
const assert = require("node:assert");

const { isChinese, textOf, hasTranslatableText, stripUrlTokens } = require("../lib/text-utils.js");

// ---- isChinese：汉字占比 > 0.3 视为中文 ----

test("isChinese: 纯中文 → true", () => {
  assert.equal(isChinese("你好世界"), true);
});

test("isChinese: 0.3 边界——'aa中'（1/3≈0.33>0.3）→ true", () => {
  assert.equal(isChinese("aa中"), true);
});

test("isChinese: 0.3 边界——'aaa中'（1/4=0.25≤0.3）→ false", () => {
  assert.equal(isChinese("aaa中"), false);
});

test("isChinese: 纯英文 → false", () => {
  assert.equal(isChinese("hello world"), false);
});

test("isChinese: 空串 → false", () => {
  assert.equal(isChinese(""), false);
});

test("isChinese: 无汉字的数字串 → false", () => {
  assert.equal(isChinese("abc123"), false);
});

// ---- textOf：剥标签 + 常见实体解码 ----

test("textOf: 剥除标签并解码 &amp;", () => {
  assert.equal(textOf("<p>Hi &amp; <b>bye</b></p>"), "Hi & bye");
});

test("textOf: 解码 &lt; 与 &gt;", () => {
  assert.equal(textOf("&lt;div&gt;"), "<div>");
});

test("textOf: 纯文本原样返回", () => {
  assert.equal(textOf("plain text"), "plain text");
});

// ---- hasTranslatableText：剔除 URL 后须有字母/文字类字符 ----

test("hasTranslatableText: 纯 URL → false", () => {
  assert.equal(hasTranslatableText("https://example.com/a/b?x=1"), false);
});

test("hasTranslatableText: URL 夹在文字中 → true", () => {
  assert.equal(hasTranslatableText("see https://x.com today"), true);
});

test("hasTranslatableText: www. 前缀 URL → false", () => {
  assert.equal(hasTranslatableText("www.example.com"), false);
});

test("hasTranslatableText: 裸域名（apple.com）→ true（不剔除）", () => {
  assert.equal(hasTranslatableText("apple.com"), true);
});

test("hasTranslatableText: 纯数字/符号 → false", () => {
  assert.equal(hasTranslatableText("12345 ..."), false);
});

test("hasTranslatableText: 空串 → false", () => {
  assert.equal(hasTranslatableText(""), false);
});

// ---- stripUrlTokens ----

test("stripUrlTokens: 剔除 http(s) 与 www. 形态（不合并内部空格）", () => {
  assert.equal(stripUrlTokens("see https://a.com and www.b.com now"), "see  and  now");
});
