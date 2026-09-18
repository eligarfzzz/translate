// 工单 04：text-utils 测试——中文占比 0.3 边界、URL 剔除、字母资格、实体剥标
// 票 01（feed-strip-non-rendering）：空白判定纯函数（与输出侧净化同口径）
import { test } from "node:test";
import assert from "node:assert";

import {
  isChinese,
  textOf,
  hasTranslatableText,
  stripUrlTokens,
  isWhitespaceOnly,
} from "../src/text-utils.js";

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

// ---- isWhitespaceOnly：整串只由空白（含零宽字符）构成 ----
// 口径与输出侧净化同源：\s 加零宽 U+200B-U+200D

test("isWhitespaceOnly: 各类空白与零宽字符 → true", () => {
  const blanks = [
    "",
    " ",
    "\t",
    "\n",
    "\r\n",
    " \t\n ",
    "\u00A0", // &nbsp; 解码后
    "\u2002", // &ensp; 解码后
    "\u2000\u200A",
    "\u202F",
    "\u3000",
    "\uFEFF",
    "\u200B",
    "\u200C",
    "\u200D",
    "\u200B\u200C\u200D \u00A0",
  ];
  for (const blank of blanks) assert.equal(isWhitespaceOnly(blank), true, JSON.stringify(blank));
});

test("isWhitespaceOnly: 含任一实质字符 → false", () => {
  const substantial = ["a", " a ", "中", "1", ".", "-", "a\u00A0b", "\u200Bx", "\u200B中"];
  for (const text of substantial) {
    assert.equal(isWhitespaceOnly(text), false, JSON.stringify(text));
  }
});
