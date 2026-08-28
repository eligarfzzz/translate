const { appendRing, maskSecret, fmt, getChannel, MAX_ENTRIES } = require("../lib/debug.js");
const test = require("node:test");
const assert = require("node:assert");

test("appendRing: 未超限时全部保留", () => {
  const out = appendRing([{ i: 1 }], { i: 2 }, 500);
  assert.equal(out.length, 2);
  assert.equal(out[1].i, 2);
});

test("appendRing: 超限淘汰最旧（环形）", () => {
  let list = [];
  for (let i = 0; i < MAX_ENTRIES + 10; i++) list = appendRing(list, { i }, MAX_ENTRIES);
  assert.equal(list.length, MAX_ENTRIES);
  assert.equal(list[0].i, 10); // 前 10 条被淘汰
  assert.equal(list.at(-1).i, MAX_ENTRIES + 9);
});

test("appendRing: 不修改原数组（纯函数）", () => {
  const original = [{ i: 1 }];
  appendRing(original, { i: 2 }, 500);
  assert.equal(original.length, 1);
});

test("maskSecret: sk- 长 token 打码", () => {
  assert.equal(maskSecret("key=sk-ExampleKey1234567890"), "key=sk-***");
  assert.equal(maskSecret("Bearer sk-abc-123_X"), "Bearer sk-***");
});

test("maskSecret: 短 sk- 或普通文本不受影响", () => {
  assert.equal(maskSecret("sk-1"), "sk-1"); // 太短，非密钥形态
  assert.equal(maskSecret("no secrets here"), "no secrets here");
});

test("fmt: 对象序列化 + 超长截断 + 脱敏", () => {
  const long = "x".repeat(600);
  const out = fmt([{ apiKey: "sk-abcdefghijklmnop" }, long]);
  assert.ok(out.includes("sk-***"));
  assert.ok(out.length <= 500);
});

test("fmt: undefined / 循环引用安全", () => {
  assert.doesNotThrow(() => fmt([undefined, Symbol("x")]));
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => fmt([circular]));
});

test("getChannel: node 环境（无 chrome.storage）仅 console 且不抛", () => {
  const ch = getChannel("cs");
  assert.doesNotThrow(() => {
    ch.debug("debug message", { a: 1 });
    ch.error("error message");
  });
});
