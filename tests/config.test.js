// 工单 01：config 基础测试——mergeConfig 类型防御 + loadConfig
import { test } from "node:test";
import assert from "node:assert";

import { DEFAULT_PROMPT_TEMPLATE as DEFAULT_TEMPLATE } from "../src/prompt.js";
import { mergeConfig, mergeConfigRaw, loadConfig, TRANSLATE_CONFIG } from "../src/config.js";

const DEFAULTS_SNAPSHOT = () => ({
  apiBase: TRANSLATE_CONFIG.apiBase,
  apiKey: TRANSLATE_CONFIG.apiKey,
  model: TRANSLATE_CONFIG.model,
  targetLang: TRANSLATE_CONFIG.targetLang,
  reasoningEffort: "none",
  concurrency: TRANSLATE_CONFIG.concurrency,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE(),
});

function DEFAULT_PROMPT_TEMPLATE() {
  // src/prompt.js 导出的默认模板常量
  return DEFAULT_TEMPLATE;
}

test("mergeConfig(null) 返回全部默认值", () => {
  const cfg = mergeConfig(TRANSLATE_CONFIG, null);
  assert.deepStrictEqual(cfg, DEFAULTS_SNAPSHOT());
});

test("mergeConfig 对 undefined/字符串/数组存储一律回退默认", () => {
  for (const bad of [undefined, "garbage", 42, ["a"]]) {
    const cfg = mergeConfig(TRANSLATE_CONFIG, bad);
    assert.equal(cfg.model, TRANSLATE_CONFIG.model);
    assert.equal(cfg.promptTemplate, DEFAULT_PROMPT_TEMPLATE());
  }
});

test("mergeConfig 接受合法数字（含数字字符串）", () => {
  assert.equal(mergeConfig(TRANSLATE_CONFIG, { concurrency: 50 }).concurrency, 50);
  assert.equal(mergeConfig(TRANSLATE_CONFIG, { concurrency: "6" }).concurrency, 6);
});

test("并发池默认 20（宿主即请求：每宿主一次端点请求）", () => {
  assert.equal(TRANSLATE_CONFIG.concurrency, 20);
});

test("mergeConfig 拒绝坏数字（0/负数/非数字/非有限）并保留默认", () => {
  for (const bad of [0, -5, "abc", Infinity, NaN]) {
    const cfg = mergeConfig(TRANSLATE_CONFIG, { concurrency: bad });
    assert.equal(cfg.concurrency, TRANSLATE_CONFIG.concurrency, `bad=${String(bad)}`);
  }
});

test("批次配置全链路删除：默认值无 batchSize/maxCharsPerBatch，存储残留被丢弃", () => {
  assert.equal("batchSize" in TRANSLATE_CONFIG, false, "默认值无 batchSize");
  assert.equal("maxCharsPerBatch" in TRANSLATE_CONFIG, false, "默认值无 maxCharsPerBatch");
  const cfg = mergeConfig(TRANSLATE_CONFIG, { batchSize: 5, maxCharsPerBatch: 999 });
  assert.equal("batchSize" in cfg, false, "存储残留 batchSize 被丢弃");
  assert.equal("maxCharsPerBatch" in cfg, false, "存储残留 maxCharsPerBatch 被丢弃");
});

test("mergeConfig 判空：null/undefined/空串回退默认，非空字符串（含纯空白）原样透传", () => {
  const cfg = mergeConfig(TRANSLATE_CONFIG, {
    model: "",
    targetLang: "   ",
    apiBase: "https://example.com/v1",
  });
  assert.equal(cfg.model, TRANSLATE_CONFIG.model); // 空串 → 默认
  assert.equal(cfg.targetLang, "   "); // 纯空白 → 透传（非空）
  assert.equal(cfg.apiBase, "https://example.com/v1"); // 非空 → 透传
  const cfg2 = mergeConfig(TRANSLATE_CONFIG, { model: null, apiKey: undefined });
  assert.equal(cfg2.model, TRANSLATE_CONFIG.model); // null → 默认
  assert.equal(cfg2.apiKey, TRANSLATE_CONFIG.apiKey); // undefined → 默认
});

test("mergeConfig 透传非空 promptTemplate（含不含 {host} 的），空串/缺失回退默认", () => {
  const good = "My rules...\n{host}";
  assert.equal(mergeConfig(TRANSLATE_CONFIG, { promptTemplate: good }).promptTemplate, good);
  // 不含 {host} 的非空模板：原样透传（运行时由 background 兜底回退默认）
  const noHost = mergeConfig(TRANSLATE_CONFIG, { promptTemplate: "no placeholder here" });
  assert.equal(noHost.promptTemplate, "no placeholder here");
  // 空串/缺失 → 默认模板
  assert.equal(
    mergeConfig(TRANSLATE_CONFIG, { promptTemplate: "" }).promptTemplate,
    DEFAULT_PROMPT_TEMPLATE(),
  );
  assert.equal(
    mergeConfig(TRANSLATE_CONFIG, { promptTemplate: null }).promptTemplate,
    DEFAULT_PROMPT_TEMPLATE(),
  );
  assert.equal(mergeConfig(TRANSLATE_CONFIG, {}).promptTemplate, DEFAULT_PROMPT_TEMPLATE());
});

test("mergeConfigRaw UI 语义：保存什么读什么，空值透传为空串", () => {
  const raw = mergeConfigRaw(TRANSLATE_CONFIG, { model: "", promptTemplate: "" });
  assert.equal(raw.model, "", "空串透传为空串（UI 显示空）");
  assert.equal(raw.promptTemplate, "", "空模板透传为空串（UI 显示空）");
  assert.equal(raw.apiBase, TRANSLATE_CONFIG.apiBase, "未存键 → 默认");
  assert.equal(raw.reasoningEffort, "none", "reasoningEffort 永不可配");
  const filled = mergeConfigRaw(TRANSLATE_CONFIG, {
    model: "m1",
    promptTemplate: "no host",
    targetLang: "",
  });
  assert.equal(filled.model, "m1", "非空透传");
  assert.equal(filled.promptTemplate, "no host", "非空模板透传（不要求 {host}）");
  assert.equal(filled.targetLang, "", "空串透传为空串");
});

test("mergeConfig 忽略 reasoningEffort（永远关闭，不可配置）", () => {
  const cfg = mergeConfig(TRANSLATE_CONFIG, { reasoningEffort: "high" });
  assert.equal(cfg.reasoningEffort, "none");
});

test("mergeConfig 丢弃未知键", () => {
  const cfg = mergeConfig(TRANSLATE_CONFIG, { foo: 1, model: "m2" });
  assert.equal(cfg.model, "m2");
  assert.equal("foo" in cfg, false);
});

test("loadConfig 在 node 环境（无 chrome）返回默认合并", async () => {
  const cfg = await loadConfig(); // 未注入 storage
  assert.deepStrictEqual(cfg, DEFAULTS_SNAPSHOT());
});

test("零痕迹默认：端点/密钥/模型默认值为空字符串，非空覆盖照常生效", () => {
  assert.equal(TRANSLATE_CONFIG.apiBase, "");
  assert.equal(TRANSLATE_CONFIG.apiKey, "");
  assert.equal(TRANSLATE_CONFIG.model, "");
  // 克隆即无凭证：无存储覆盖时三项仍为空
  const cfg = mergeConfig(TRANSLATE_CONFIG, null);
  assert.equal(cfg.apiBase, "");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.model, "");
  // 配置页填写后（非空字符串覆盖空默认）翻译可用
  const filled = mergeConfig(TRANSLATE_CONFIG, {
    apiBase: "https://api.example.com/v1",
    apiKey: "sk-example-not-a-real-key",
    model: "example-model",
  });
  assert.equal(filled.apiBase, "https://api.example.com/v1");
  assert.equal(filled.apiKey, "sk-example-not-a-real-key");
  assert.equal(filled.model, "example-model");
});

test("loadConfig 经 chrome.storage.sync 合并存储覆盖", async () => {
  const storage = {
    sync: {
      get: async (key) =>
        key === "config" ? { config: { model: "stored-model", concurrency: -1 } } : {},
    },
  };
  const cfg = await loadConfig(storage);
  assert.equal(cfg.model, "stored-model"); // 合法覆盖生效
  assert.equal(cfg.concurrency, TRANSLATE_CONFIG.concurrency); // 坏值回退默认
  assert.equal(cfg.reasoningEffort, "none"); // 思考开关永不可配
});
