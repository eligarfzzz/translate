// 工单 01（empty-means-unset）：配置核心归一化——空即未设置。
// 核心测试形态：同一批「默认值 + 原始值」用例同时喂归一化入口、读路径（mergeConfig）
// 与写路径（pruneConfig），断言三者对「空 / 非空」的判断完全一致——判空不漂移的自动化保障。
// 工单 04：规则的解释（缺占位符判定、占位文字与示例清单）同处本模块，并加守门断言。
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PROMPT_TEMPLATE } from "../src/prompt.js";
import {
  TRANSLATE_CONFIG,
  EMPTY_DEFAULT_PLACEHOLDERS,
  sanitizeStored,
  mergeConfig,
  pruneConfig,
  readStored,
  loadConfig,
  loadStoredConfig,
  isMissingHostPlaceholder,
  placeholderText,
} from "../src/config.js";

const DEFAULTS_SNAPSHOT = () => ({
  apiBase: TRANSLATE_CONFIG.apiBase,
  apiKey: TRANSLATE_CONFIG.apiKey,
  model: TRANSLATE_CONFIG.model,
  targetLang: TRANSLATE_CONFIG.targetLang,
  reasoningEffort: "none",
  concurrency: TRANSLATE_CONFIG.concurrency,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  extra: "",
});

// [字段, 原始值, 期望]：期望 undefined = 空（不落盘、读取回退默认）；否则为归一化后的值。
// 原始值同时代表存储形态与表单形态（表单值恒为字符串，数字字段的字符串用例即来自表单）。
// 本表不放原型成员名（toString 之类）的数据：读路径断言是「取值后与默认值比较」，
// 而 merged["toString"] 与默认值表的 ["toString"] 都经原型链解析到同一个函数，比较必然通过、
// 断言变空洞，反而制造「已验证」的假象。该洞的守门数据放在 OTHER_FIELD_CASES（「其余字段」表）。
const CASES = [
  // ---- 字符串字段：必须是字符串且 trim 后非空 ----
  ["apiBase", null, undefined],
  ["apiBase", undefined, undefined],
  ["apiBase", "", undefined],
  ["apiBase", "   ", undefined],
  ["apiBase", "\n\t ", undefined],
  ["apiBase", 42, undefined],
  ["apiBase", {}, undefined],
  ["apiBase", [], undefined],
  ["apiBase", true, undefined],
  ["apiBase", " https://example.com/v1 ", "https://example.com/v1"],
  ["apiBase", "https://example.com/v1", "https://example.com/v1"],
  ["targetLang", null, undefined],
  ["targetLang", "   ", undefined],
  ["targetLang", 42, undefined],
  ["targetLang", " English ", "English"],
  ["targetLang", "中文", "中文"],
  // ---- 数字字段：有限、大于 0 的整数（数字串可接受） ----
  ["concurrency", 6, 6],
  ["concurrency", "6", 6],
  ["concurrency", " 6 ", 6],
  ["concurrency", 0, undefined],
  ["concurrency", "0", undefined],
  ["concurrency", -5, undefined],
  ["concurrency", 3.5, undefined],
  ["concurrency", "2.5", undefined],
  ["concurrency", NaN, undefined],
  ["concurrency", Infinity, undefined],
  ["concurrency", -Infinity, undefined],
  ["concurrency", "abc", undefined],
  ["concurrency", "", undefined],
  ["concurrency", "   ", undefined],
  ["concurrency", null, undefined],
  ["concurrency", undefined, undefined],
  ["concurrency", [], undefined],
  ["concurrency", {}, undefined],
  ["concurrency", [6], undefined],
  ["concurrency", "6abc", undefined],
  // ---- 提示词模板：字符串规则 + 必须包含 {host} ----
  ["promptTemplate", null, undefined],
  ["promptTemplate", "", undefined],
  ["promptTemplate", "   ", undefined],
  ["promptTemplate", 42, undefined],
  ["promptTemplate", "no placeholder here", undefined],
  ["promptTemplate", "rules only {target}", undefined],
  ["promptTemplate", "  custom rules\n{host}  ", "custom rules\n{host}"],
  ["promptTemplate", DEFAULT_PROMPT_TEMPLATE, DEFAULT_PROMPT_TEMPLATE],
  // ---- 追加提示词：普通字符串字段（无占位符要求），内部换行保留 ----
  ["extra", null, undefined],
  ["extra", undefined, undefined],
  ["extra", "", undefined],
  ["extra", "   ", undefined],
  ["extra", "\n\t ", undefined],
  ["extra", 42, undefined],
  ["extra", {}, undefined],
  ["extra", [], undefined],
  ["extra", true, undefined],
  ["extra", " 专有名词保留原文 ", "专有名词保留原文"],
  ["extra", "专有名词保留原文", "专有名词保留原文"],
  ["extra", "规则一\n规则二", "规则一\n规则二"],
  ["extra", "  规则一\n规则二  ", "规则一\n规则二"],
];

const label = (key, raw) => `${key}=${String(raw)}`;

test("判空不漂移：同一批用例喂归一化入口、读路径与写路径，三者判断完全一致", () => {
  for (const [key, raw, expected] of CASES) {
    const normalized = sanitizeStored(TRANSLATE_CONFIG, { [key]: raw });
    const merged = mergeConfig(TRANSLATE_CONFIG, { [key]: raw });
    const pruned = pruneConfig(TRANSLATE_CONFIG, { [key]: raw });
    const what = label(key, raw);

    // 归一化入口 / 写路径：判空即删除该键，非空即保留归一化后的值。
    // 判空只查自有属性：键来自用例表变量，`in` 会沿原型链把继承来的成员当成「键还在」。
    for (const [path, out] of [
      ["sanitizeStored", normalized],
      ["pruneConfig", pruned],
    ]) {
      if (expected === undefined) {
        assert.equal(Object.hasOwn(out, key), false, `${path} 应判空删键：${what}`);
      } else {
        assert.deepEqual(out[key], expected, `${path} 归一化值：${what}`);
      }
    }

    // 读路径：判空回退默认，非空覆盖为归一化后的值（与另两条路径同源）
    assert.deepEqual(
      merged[key],
      expected === undefined ? TRANSLATE_CONFIG[key] : expected,
      `mergeConfig：${what}`,
    );
  }
});

test("非对象/数组/字符串原始值一律视为空（归一化、读、写三条路径同此）", () => {
  for (const bad of [null, undefined, "garbage", 42, ["a"], true, NaN]) {
    assert.deepEqual(sanitizeStored(TRANSLATE_CONFIG, bad), {}, `归一化入口：${String(bad)}`);
    assert.deepEqual(pruneConfig(TRANSLATE_CONFIG, bad), {}, `写路径：${String(bad)}`);
    assert.deepEqual(mergeConfig(TRANSLATE_CONFIG, bad), DEFAULTS_SNAPSHOT(), `读路径：${bad}`);
  }
});

test("未知键不进入归一化结果与存储载荷（含历史 batchSize/maxCharsPerBatch）", () => {
  const stored = { model: "m2", foo: 1, batchSize: 5, maxCharsPerBatch: 999 };
  assert.equal("batchSize" in TRANSLATE_CONFIG, false, "默认值无 batchSize");
  assert.equal("maxCharsPerBatch" in TRANSLATE_CONFIG, false, "默认值无 maxCharsPerBatch");
  assert.deepEqual(sanitizeStored(TRANSLATE_CONFIG, stored), { model: "m2" });

  const formValues = { model: " m2 ", foo: "1", batchSize: "5", maxCharsPerBatch: "999" };
  assert.deepEqual(pruneConfig(TRANSLATE_CONFIG, formValues), { model: "m2" });
});

test("reasoningEffort 永不可配：存储值与表单值都不进入归一化结果", () => {
  assert.equal(TRANSLATE_CONFIG.reasoningEffort, "none");
  assert.equal(
    "reasoningEffort" in sanitizeStored(TRANSLATE_CONFIG, { reasoningEffort: "high" }),
    false,
  );
  assert.equal(mergeConfig(TRANSLATE_CONFIG, { reasoningEffort: "high" }).reasoningEffort, "none");
  assert.equal(
    "reasoningEffort" in pruneConfig(TRANSLATE_CONFIG, { reasoningEffort: "high", model: "m" }),
    false,
  );
});

test("读路径合并：默认全量 + 非空覆盖；空/非法值一律回退默认，无空串透传", () => {
  const cfg = mergeConfig(TRANSLATE_CONFIG, {
    apiBase: " https://api.example.com/v1 ",
    apiKey: "sk-example-not-a-real-key",
    model: "   ",
    targetLang: "",
    concurrency: " 8 ",
    promptTemplate: "no placeholder here",
  });
  assert.deepEqual(cfg, {
    ...DEFAULTS_SNAPSHOT(),
    apiBase: "https://api.example.com/v1",
    apiKey: "sk-example-not-a-real-key",
    concurrency: 8,
  });
  assert.equal(cfg.model, "", "纯空白 ≠ 有效值，回退默认（空）");
  assert.equal(cfg.promptTemplate, DEFAULT_PROMPT_TEMPLATE, "缺 {host} 等同留空");
});

test("写路径剪枝：数字字段转 number、字符串字段 trim、空字段不落盘", () => {
  const payload = pruneConfig(TRANSLATE_CONFIG, {
    apiBase: " https://api.example.com/v1 ",
    apiKey: "",
    model: "example-model",
    concurrency: "6",
    targetLang: "   ",
    promptTemplate: "  custom rules\n{host}  ",
  });
  assert.deepEqual(payload, {
    apiBase: "https://api.example.com/v1",
    model: "example-model",
    concurrency: 6,
    promptTemplate: "custom rules\n{host}",
  });
  assert.equal(typeof payload.concurrency, "number");
  assert.equal("apiKey" in payload, false, "空字段不进入载荷");
});

test("写路径剪枝：全空表单值返回空对象（调用方据此删除 config 键）", () => {
  const emptyValues = {
    apiBase: "  ",
    apiKey: "",
    model: "\t",
    concurrency: "0",
    targetLang: "",
    promptTemplate: "no host placeholder",
  };
  assert.deepEqual(pruneConfig(TRANSLATE_CONFIG, emptyValues), {});
});

// ---------------- 工单 04：规则的解释权收回配置模块 ----------------
// 工单 05：用例的声明收窄到它真正断言的事实——双向等价（判定为真 ⟺ 归一化丢弃）只对
// 声明需要 {host} 的字段成立；其余字段判定恒假，归一化丢不丢弃由该字段自己的规则决定
// （数字规则、不可覆盖键、未知键都会丢弃，但那不是缺占位符）。

// 归一化是否丢弃该键（判空 = 结果里没有该键）。
// 只查自有属性：归一化结果按默认值表的自有键构建，键名若恰为原型成员（toString / constructor），
// `in` 会沿原型链谎报「该键还在」——判定与归一化实际行为就此撒谎。
const normalizationDrops = (key, raw) =>
  !Object.hasOwn(sanitizeStored(TRANSLATE_CONFIG, { [key]: raw }), key);

// 声明需要 {host} 的字段：非空字符串域上双向等价；空白/非字符串域上判定恒假
const PLACEHOLDER_FIELD_CASES = [
  ["promptTemplate", "no placeholder here"],
  ["promptTemplate", "rules only {target}"],
  ["promptTemplate", "\t缺占位符但非空\n"],
  ["promptTemplate", "  custom rules\n{host}  "],
  ["promptTemplate", DEFAULT_PROMPT_TEMPLATE],
  ["promptTemplate", ""],
  ["promptTemplate", "   "],
  ["promptTemplate", 42],
  ["promptTemplate", null],
];

// 其余字段：[字段, 原始值, 归一化是否丢弃]。判定恒假；丢弃由该字段自己的规则决定，
// 两者各说各话、不互相绑定——旧声明的反例输入（数字字段填非数字串、不可覆盖键、
// 未知键）都在这里：它们判定假而归一化仍丢弃，正是本表单独立于 PLACEHOLDER_FIELD_CASES 的理由。
const OTHER_FIELD_CASES = [
  ["apiBase", "{host} 只是普通文本", false],
  ["apiBase", "https://example.com/v1", false],
  ["apiBase", "", true],
  ["targetLang", " 中文 ", false],
  ["targetLang", "\n\t", true],
  ["extra", "专有名词保留原文", false],
  ["extra", "{host} 只是普通文本（追加提示词不要求占位符）", false],
  ["extra", "", true],
  ["concurrency", "6", false],
  ["concurrency", "abc", true],
  ["concurrency", "   ", true],
  ["reasoningEffort", "none", true],
  ["batchSize", "5", true],
  // 原型成员名的未知键：归一化只按默认值表的自有键遍历，照丢弃；判定也不为真。
  // 这条数据是「丢弃」判断只查自有属性的守门：用 `in` 会沿原型链查到这个继承来的成员，
  // 谎报「没丢弃」而转红。放在本表而非 CASES，是因为 CASES 的读路径断言两边都经原型链
  // 解析到同一个值、比较恒真（见 CASES 上方的说明），守不住这个洞。
  ["toString", "任意值", true],
];

test("声明需要占位符的字段：非空字符串上「判定为真 ⟺ 归一化丢弃」，空白/非字符串上判定恒假", () => {
  for (const [key, raw] of PLACEHOLDER_FIELD_CASES) {
    const dropped = normalizationDrops(key, raw);
    const judged = isMissingHostPlaceholder(key, raw);
    const what = label(key, raw);
    if (typeof raw === "string" && raw.trim() !== "") {
      assert.equal(judged, dropped, `非空字符串：判定为真 ⟺ 归一化判空：${what}`);
    } else {
      assert.equal(judged, false, `空白/非字符串不因缺占位符判空，但归一化自有其判空理由：${what}`);
    }
  }
});

test("其余字段：缺占位符判定恒假，归一化丢弃与否由该字段自己的规则决定（与判定不绑定）", () => {
  for (const [key, raw, dropped] of OTHER_FIELD_CASES) {
    const what = label(key, raw);
    assert.equal(
      isMissingHostPlaceholder(key, raw),
      false,
      `未声明需要 {host} 的字段判定恒假：${what}`,
    );
    assert.equal(
      normalizationDrops(key, raw),
      dropped,
      `归一化丢弃与否（按字段自己的规则）：${what}`,
    );
  }
  assert.ok(
    OTHER_FIELD_CASES.some(([, , dropped]) => dropped),
    "前提：表里保留「判定假而归一化仍丢弃」的反例输入（它们是本表单独立存在的理由）",
  );
});

test("单向蕴含：缺占位符判定为真 ⟹ 归一化丢弃该键（两张用例表全网格）", () => {
  const rows = [
    ...PLACEHOLDER_FIELD_CASES.map(([key, raw]) => [key, raw]),
    ...OTHER_FIELD_CASES.map(([key, raw]) => [key, raw]),
  ];
  for (const [key, raw] of rows) {
    if (!isMissingHostPlaceholder(key, raw)) continue;
    assert.equal(normalizationDrops(key, raw), true, `判定为真必须归一化丢弃：${label(key, raw)}`);
  }
});

test("缺占位符判定只对声明需要占位符的字段为真：其他字段即使不含 {host} 也不为真", () => {
  const raw = "整段规则里没有那个占位符";
  for (const key of Object.keys(TRANSLATE_CONFIG)) {
    assert.equal(
      isMissingHostPlaceholder(key, raw),
      key === "promptTemplate",
      `${key}：只有提示词模板声明需要 {host}`,
    );
  }
});

test("占位文字取值：默认值非空 → 默认值本身；空串默认值 → 该字段示例；无默认值 → 空串", () => {
  for (const [key, example] of Object.entries(EMPTY_DEFAULT_PLACEHOLDERS)) {
    assert.equal(TRANSLATE_CONFIG[key], "", `前提：${key} 的默认值是空串`);
    assert.equal(placeholderText(key), example, `${key} 默认值为空串 → 示例`);
  }
  assert.equal(
    placeholderText("extra"),
    "",
    "extra：空串默认值且不在示例清单 → 空串（空框无灰色提示）",
  );
  assert.equal(placeholderText("noSuchField"), "", "未知键（无默认值也无示例）→ 空串");

  for (const key of [...Object.keys(TRANSLATE_CONFIG), "noSuchField"]) {
    const text = placeholderText(key);
    assert.equal(typeof text, "string", `${key}：占位文字恒为字符串`);
    assert.notEqual(text, "undefined", `${key}：占位文字永不是字面量 undefined`);
  }
});

// 守门断言（占位规则的正向面）：默认值非空的字段，占位文字恒为默认值本身（字符串形式）。
// 这条是通用的：不点名具体字段，新增字段漏接占位文字就转红。
// 空串默认值的字段没有默认值可显示——示例是可选字段知识，不是空默认字段的必配项
// （只要求「示例清单里的键，其默认值必须为空串」，见下一条）。
test("守门：默认值非空的字段，占位文字恒等于默认值本身", () => {
  const nonEmptyDefaultKeys = Object.keys(TRANSLATE_CONFIG).filter(
    (key) => TRANSLATE_CONFIG[key] !== "",
  );
  assert.ok(nonEmptyDefaultKeys.length > 0, "前提：默认值表里存在默认值非空的字段");
  for (const key of nonEmptyDefaultKeys) {
    assert.equal(
      placeholderText(key),
      String(TRANSLATE_CONFIG[key]),
      `${key} 的默认值非空 → 占位文字即默认值本身`,
    );
  }
});

// 守门断言：示例与默认值错位时转红（占位文字的字段知识只有配置模块这一处）。
// 示例是可选字段知识，不再是空默认字段的必配项；但清单里的键其默认值必须是空串，
// 否则那条示例永远显示不出来（死代码）。
test("守门：占位示例清单里的每个键，其默认值必须是空串", () => {
  for (const key of Object.keys(EMPTY_DEFAULT_PLACEHOLDERS)) {
    assert.equal(
      TRANSLATE_CONFIG[key],
      "",
      `${key} 的示例只服务于空串默认值字段（默认值非空时该示例是死代码）`,
    );
  }
});

test("并发池默认 20（宿主即请求：每宿主一次端点请求）", () => {
  assert.equal(TRANSLATE_CONFIG.concurrency, 20);
});

test("readStored：取 sync 存储里 config 的原始对象，缺失返回 null", async () => {
  assert.equal(await readStored(), null, "未注入 storage");
  assert.equal(await readStored({}), null, "无 sync 区域");
  assert.equal(await readStored({ sync: { get: async () => ({}) } }), null, "存储里没有 config 键");

  const raw = { model: 42, batchSize: 5 };
  const storage = { sync: { get: async () => ({ config: raw }) } };
  assert.deepEqual(await readStored(storage), raw, "原始对象原样返回（判空在归一化层）");
});

test("loadConfig 在 node 环境（无 chrome）返回默认合并", async () => {
  assert.deepEqual(await loadConfig(), DEFAULTS_SNAPSHOT());
});

test("loadConfig 经 chrome.storage.sync 合并存储覆盖（坏值回退默认）", async () => {
  const storage = {
    sync: {
      get: async () => ({ config: { model: "stored-model", concurrency: -1 } }),
    },
  };
  const cfg = await loadConfig(storage);
  assert.equal(cfg.model, "stored-model");
  assert.equal(cfg.concurrency, TRANSLATE_CONFIG.concurrency);
  assert.equal(cfg.reasoningEffort, "none");
});

test("运行时读取：纯空白的端点/密钥/模型回退空默认——未配置守卫据此拦下请求", async () => {
  const storage = {
    sync: {
      get: async () => ({ config: { apiBase: "   ", apiKey: "\t", model: " " } }),
    },
  };
  const cfg = await loadConfig(storage);
  assert.equal(cfg.apiBase, "");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.model, "");
});

test("loadStoredConfig：只返回存储中真实存在的非空配置（不合并默认值）", async () => {
  const storage = {
    sync: {
      get: async () => ({
        config: {
          model: "stored-model",
          targetLang: "  English  ",
          concurrency: -1,
          promptTemplate: "",
        },
      }),
    },
  };
  assert.deepEqual(await loadStoredConfig(storage), {
    model: "stored-model",
    targetLang: "English",
  });
  assert.deepEqual(
    await loadStoredConfig({ sync: { get: async () => ({}) } }),
    {},
    "存储里没有 config 键：没有任何键被设置过",
  );
});

test("零痕迹默认：端点/密钥/模型默认值为空字符串，非空覆盖照常生效", () => {
  assert.equal(TRANSLATE_CONFIG.apiBase, "");
  assert.equal(TRANSLATE_CONFIG.apiKey, "");
  assert.equal(TRANSLATE_CONFIG.model, "");
  const cfg = mergeConfig(TRANSLATE_CONFIG, null);
  assert.equal(cfg.apiBase, "");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.model, "");
  const filled = mergeConfig(TRANSLATE_CONFIG, {
    apiBase: "https://api.example.com/v1",
    apiKey: "sk-example-not-a-real-key",
    model: "example-model",
  });
  assert.equal(filled.apiBase, "https://api.example.com/v1");
  assert.equal(filled.apiKey, "sk-example-not-a-real-key");
  assert.equal(filled.model, "example-model");
});
