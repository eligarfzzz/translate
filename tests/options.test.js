// 工单 01（empty-means-unset）：配置页端到端——保存剪枝（空即未设置）与回填。
// 工单 02（empty-means-unset）：空框占位（默认值 / 假值示例）与「恢复默认」= 清空 + 保存 = 删键。
// 接缝：chrome.storage.sync 的存储形态 ↔ 配置页输入框的可见值（value/placeholder）与存储内容，
// 全部走 tests/helpers/options-sandbox.js（真实 options.html + 存储替身 + 干净模块实例）。
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PROMPT_TEMPLATE } from "../src/prompt.js";
import { TRANSLATE_CONFIG } from "../src/config.js";
import { createOptionsSandbox } from "./helpers/options-sandbox.js";

// 字段清单取自生产 markup（不另写副本，避免与 options.html 漂移）
const fieldNames = (env) => [...env.form.querySelectorAll("[name]")].map((el) => el.name);

// 占位契约：非空默认值 → 默认值本身（模板即默认模板全文，textarea 多行）；默认值为空串的
// 三个 API 字段 → 描述性假值示例（零痕迹：不出现真实端点、凭证或厂商模型名）
const PLACEHOLDER = {
  apiBase: "https://example.com/v1",
  apiKey: "sk-example-not-a-real-key",
  model: "example-model",
  concurrency: "20",
  targetLang: "中文",
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  // 追加提示词：空串默认值且不在示例清单里 → 空框无灰色提示
  extra: "",
};

// 全套非空存储：API 三项故意用与占位不同的假值，以区分「显示真实保存值」与「占位文字」
const STORED_ALL = {
  apiBase: "https://api.example.com/v1",
  apiKey: "sk-example-stored-key",
  model: "example-model-stored",
  concurrency: "6",
  targetLang: "English",
  promptTemplate: "custom rules\n{host}",
};
const STORED_MIXED = { concurrency: "6", promptTemplate: "custom rules\n{host}" };

// ---------------- 守门（工单 04） ----------------

// 保存反馈里的「本次删除了 N 项」以「表单字段 ⊆ 默认值表的键」为前提：
// 不在默认值表里的字段会被剪枝静默丢弃，却仍被算进空项数。
// 只查自有属性：字段名恰为原型成员（toString / constructor）时，`in` 会放行，
// 而真正消费默认值表的地方按自有键遍历会把它丢弃——那正是本守门要拦的漂移。
test("守门: 配置页表单里的字段都在默认值表的键里", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  const unknown = fieldNames(env).filter((name) => !Object.hasOwn(TRANSLATE_CONFIG, name));
  assert.deepEqual(unknown, [], "配置页表单字段必须都在默认值表的键里（只认自有键）");
});

// 反向守门（工单 02）：默认值表的每个键都必须有同名表单字段。保存反馈只报「存储里有、本次载荷里
// 没有」的键，而表单字段正是键重新进载荷的唯一途径——有键无框的字段一旦被存过，就会每次保存
// 都被报成「已删除设置」，正是本票要消灭的假话。例外的键名显式写死在这里、不从配置模块导出：
// 例外一旦扩大（或新增键漏配输入框），这条断言立刻转红。
test("守门: 默认值表的每个键都有同名表单字段（唯一例外是永不可配的 reasoningEffort）", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  const fields = new Set(fieldNames(env));
  const missing = Object.keys(TRANSLATE_CONFIG).filter(
    (key) => key !== "reasoningEffort" && !fields.has(key),
  );
  assert.deepEqual(missing, [], "除 reasoningEffort 外，每个键都必须有同名表单字段");
  assert.equal(fields.has("reasoningEffort"), false, "例外属实：reasoningEffort 无输入框");
});

// 占位文字的取值只在配置模块（默认值 / 空串默认值的示例）：DOM 属性值恒为字符串，
// 空串默认值字段漏配示例时不得退化成字面量 "undefined"
test("守门: 每个字段的 placeholder 都是字符串且不等于字面量 undefined", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  for (const name of fieldNames(env)) {
    const text = env.field(name).placeholder;
    assert.equal(typeof text, "string", `${name} 的占位文字恒为字符串`);
    assert.notEqual(text, "undefined", `${name} 的占位文字不得是字面量 undefined`);
  }
});

// ---------------- 回填（读路径） ----------------

test("回填: 有值字段显示存储值（经归一化），未设置字段为空", async (t) => {
  const env = await createOptionsSandbox({
    stored: {
      model: "example-model",
      concurrency: "6",
      targetLang: " English ",
      promptTemplate: "  custom rules\n{host}  ",
    },
  });
  t.after(() => env.dispose());

  assert.equal(env.field("model").value, "example-model");
  assert.equal(env.field("concurrency").value, "6", "数字字段回填进 number 输入框（值恒为字符串）");
  assert.equal(env.field("targetLang").value, "English", "回填走归一化：trim");
  assert.equal(env.field("promptTemplate").value, "custom rules\n{host}");
  for (const name of ["apiBase", "apiKey"]) {
    assert.equal(env.field(name).value, "", `未设置的字段（${name}）为空`);
  }
});

test("回填: 存储里的空/非法值（纯空白、小数、缺 {host} 的模板）一律显示为空", async (t) => {
  const env = await createOptionsSandbox({
    stored: { apiBase: "   ", model: "  ", concurrency: 2.5, promptTemplate: "no placeholder" },
  });
  t.after(() => env.dispose());

  for (const name of ["apiBase", "model", "concurrency", "promptTemplate"]) {
    assert.equal(env.field(name).value, "", `${name} 判空 → 显示为空（未设置）`);
  }
});

test("回填: 存储里没有 config 键时每个输入框都为空", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  for (const name of fieldNames(env)) {
    assert.equal(env.field(name).value, "", `${name} 未设置 → 空`);
  }
});

test("回填: 存储里有追加提示词 → 显示其值（多行原样）", async (t) => {
  const env = await createOptionsSandbox({ stored: { extra: "规则一\n规则二" } });
  t.after(() => env.dispose());

  assert.equal(env.field("extra").value, "规则一\n规则二");
});

test("回填: 存储里没有追加提示词 → 空框且无灰色提示", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  assert.equal(env.field("extra").value, "", "未设置 → 空框");
  assert.equal(env.field("extra").placeholder, "", "空串默认值且不在示例清单 → 空框无灰色提示");
});

// ---------------- 空框占位（空 / 有值 / 混合三种存储形态） ----------------

// 三种存储形态共用同一组断言：value 只由存储（归一化后）决定，
// placeholder 恒为默认值 / 假值示例，与是否已设置无关
const PLACEHOLDER_SHAPES = [
  { label: "空", stored: null, values: {} },
  { label: "有值", stored: STORED_ALL, values: STORED_ALL },
  { label: "混合", stored: STORED_MIXED, values: STORED_MIXED },
];

for (const shape of PLACEHOLDER_SHAPES) {
  test(`占位: ${shape.label}存储下每个字段的 value 与 placeholder 各归其位`, async (t) => {
    const env = await createOptionsSandbox({ stored: shape.stored });
    t.after(() => env.dispose());

    for (const name of fieldNames(env)) {
      assert.equal(
        env.field(name).value,
        shape.values[name] ?? "",
        `${name} value（${shape.label}存储）`,
      );
      assert.equal(
        env.field(name).placeholder,
        PLACEHOLDER[name],
        `${name} placeholder（${shape.label}存储）`,
      );
    }
  });
}

test("占位: 提示词模板占位是默认模板全文（多行，含 {host}）", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  const placeholder = env.field("promptTemplate").placeholder;
  assert.equal(placeholder, DEFAULT_PROMPT_TEMPLATE);
  assert.match(placeholder, /\{host\}/);
  assert.ok(placeholder.includes("\n"), "模板多行，textarea 占位按行显示");
});

// ---------------- 保存（写路径） ----------------

test("保存: 清空的字段不落盘，其余字段整包写入（数字转 number、字符串 trim）", async (t) => {
  const env = await createOptionsSandbox({
    stored: { model: "old-model", concurrency: "6", targetLang: " English ", batchSize: "5" },
  });
  t.after(() => env.dispose());
  assert.equal(env.field("model").value, "old-model", "前置：旧值已回填");

  env.field("model").value = ""; // 清空 → 判空删除
  env.field("apiBase").value = " https://example.com/v1 ";
  env.field("concurrency").value = "8";
  env.field("targetLang").value = " 中文 ";
  await env.submit();

  assert.deepEqual(env.storedConfig(), {
    apiBase: "https://example.com/v1",
    concurrency: 8,
    targetLang: "中文",
  });
  assert.equal(typeof env.storedConfig().concurrency, "number", "数字字段以 number 落盘");
  assert.equal("model" in env.storedConfig(), false, "清空的字段在存储里不存在");
  assert.equal("batchSize" in env.storedConfig(), false, "旧键随整包重写被清掉");
});

test("保存: 全空时删除 config 键本身（不写入空对象）", async (t) => {
  const env = await createOptionsSandbox({ stored: { model: "old-model", concurrency: "6" } });
  t.after(() => env.dispose());

  env.field("model").value = "";
  env.field("concurrency").value = "";
  await env.submit();

  assert.equal(env.storedConfig(), null, "config 键被删除");
});

test("保存: 存储里的旧键与 reasoningEffort 不进入载荷（整包重写清除）", async (t) => {
  const env = await createOptionsSandbox({
    stored: { model: "example-model", batchSize: "5", reasoningEffort: "high" },
  });
  t.after(() => env.dispose());

  await env.submit(); // 表单未被改动：写回的只有回填出来的非空字段
  assert.deepEqual(env.storedConfig(), { model: "example-model" });
});

test("保存: 追加提示词填入 → 落盘（trim，内部换行保留），与自定义模板共存", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  env.field("promptTemplate").value = "custom rules\n{host}";
  env.field("extra").value = " 专有名词保留原文\n缩写不展开 ";
  await env.submit();

  assert.deepEqual(
    env.storedConfig(),
    { promptTemplate: "custom rules\n{host}", extra: "专有名词保留原文\n缩写不展开" },
    "自定义模板与追加提示词两个键都在载荷里",
  );
});

test("保存: 追加提示词清空 → 键从存储里消失（空即未设置）", async (t) => {
  const env = await createOptionsSandbox({
    stored: { extra: "专有名词保留原文", targetLang: "English" },
  });
  t.after(() => env.dispose());
  assert.equal(env.field("extra").value, "专有名词保留原文", "前置：旧值已回填");

  env.field("extra").value = "";
  await env.submit();

  assert.equal("extra" in env.storedConfig(), false, "清空的追加提示词在存储里不存在");
  assert.equal(env.storedConfig().targetLang, "English", "其他字段照常保存");
});

// 保存反馈的口径（工单 02）：计数只算「存储里原本存在、本次没被写进去」的旧键。
// 旧口径数的是「表单里的空框」，新增一个默认空的字段就会让从未设置过它的用户
// 每次保存都多看到一项「已删除设置」——什么都没被删。

test("保存反馈: 清空存储里已有的旧值 → 报出真正被删除的项数", async (t) => {
  const env = await createOptionsSandbox({
    stored: { model: "example-model", concurrency: "6", extra: "专有名词保留原文" },
  });
  t.after(() => env.dispose());

  env.field("model").value = "";
  env.field("extra").value = "";
  // concurrency 原样写回：存储里有、本次也在载荷里 → 不算删除
  await env.submit();

  assert.equal(
    env.status.textContent,
    "已保存 ✓ 下一次翻译生效；其中 2 项为空，已删除设置、回退默认",
    "计数只含真正被清掉的旧键（model 与 extra）",
  );
});

// 用户故事：只改 API 设置、其余从未设置过 → 反馈干净，不再对从未设置过的字段说「已删除设置」
test("保存反馈: 存储为空、本次只填 API 四项 → 干净文案；补填其余字段仍不提删除", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  env.field("apiBase").value = "https://example.com/v1";
  env.field("apiKey").value = "sk-example-not-a-real-key";
  env.field("model").value = "example-model";
  env.field("concurrency").value = "6";
  await env.submit();

  assert.equal(env.status.textContent, "已保存 ✓ 下一次翻译生效");

  // 再把其余字段也填上（存储里从未设过任何键）：仍不提删除
  env.field("targetLang").value = "中文";
  env.field("promptTemplate").value = "rules {host}";
  env.field("extra").value = "专有名词保留原文";
  await env.submit();

  assert.equal(env.status.textContent, "已保存 ✓ 下一次翻译生效");
});

test("保存反馈: 存储里有值、本次原样写回 → 不提删除（没有被清掉的旧键）", async (t) => {
  const env = await createOptionsSandbox({ stored: STORED_ALL });
  t.after(() => env.dispose());

  await env.submit(); // 表单未改动：回填出来的非空字段原样写回；空框的 extra 本就没存过

  assert.equal(env.status.textContent, "已保存 ✓ 下一次翻译生效");
});

// 工单 02 的红→绿证据：新口径下 cleared 可以为 0（存储里本没有模板），
// 写死减 1 会让提示语出现「另有 -1 项为空」——专门文案后面不得再挂任何计数。
test("保存反馈: 存储为空 + 模板缺 {host} → 专门文案且不含「另有 N 项为空」", async (t) => {
  const env = await createOptionsSandbox();
  t.after(() => env.dispose());

  env.field("promptTemplate").value = "只按 {target} 翻译，别动标签"; // 非空但缺 {host}
  await env.submit();

  assert.equal(
    env.status.textContent,
    "已保存 ✓ 提示词模板缺 {host}，视为留空未保存，将使用内置默认模板",
  );
  assert.doesNotMatch(
    env.status.textContent,
    /另有/,
    "存储里本没有模板，它不算被清掉的旧键，其余空项数为 0",
  );
  assert.equal(env.storedConfig(), null, "全空：config 键本身被删除");
});

test("保存反馈: 模板缺 {host} 且无其他被清空的旧键 → 专门文案且不落盘，区别于「模板为空」", async (t) => {
  const env = await createOptionsSandbox({ stored: STORED_ALL });
  t.after(() => env.dispose());

  env.field("promptTemplate").value = "只按 {target} 翻译，别动标签";
  await env.submit();

  // 存储里其余键都照常写回：被清掉的旧键只有模板本身，而它已由专门文案报过 → 无「另有 N 项」
  assert.equal(
    env.status.textContent,
    "已保存 ✓ 提示词模板缺 {host}，视为留空未保存，将使用内置默认模板",
  );
  assert.equal("promptTemplate" in env.storedConfig(), false, "缺 {host} 的模板不落盘");
  assert.equal(env.storedConfig().targetLang, "English", "其他字段照常保存");
});

test("保存反馈: 模板缺 {host} 与被清空的旧键叠加 → 专门文案与计数都在，不吞掉被删项数", async (t) => {
  const env = await createOptionsSandbox({ stored: STORED_ALL });
  t.after(() => env.dispose());

  await env.restore("api"); // 清空一整组：存储里的 4 个 API 键被删
  env.field("promptTemplate").value = "只按 {target} 翻译，别动标签";
  await env.submit();

  // 被清掉的旧键 5 个（4 个 API 键 + 模板）；模板由专门文案交代，减掉它才是「其余」
  assert.equal(
    env.status.textContent,
    "已保存 ✓ 提示词模板缺 {host}，视为留空未保存，将使用内置默认模板；另有 4 项为空，已删除设置、回退默认",
  );
  assert.deepEqual(
    env.storedConfig(),
    { targetLang: "English" },
    "被清空的项与缺占位的模板都不落盘",
  );
});

test("保存反馈: 清空模板（空，而非非空缺 {host}）走通用文案，计数按被删的旧键", async (t) => {
  const env = await createOptionsSandbox({
    stored: { targetLang: "English", promptTemplate: "custom rules\n{host}" },
  });
  t.after(() => env.dispose());

  env.field("promptTemplate").value = ""; // 存储里存过模板，本次清空 → 通用文案报 1 项
  await env.submit();

  assert.equal(
    env.status.textContent,
    "已保存 ✓ 下一次翻译生效；其中 1 项为空，已删除设置、回退默认",
  );
  assert.equal("promptTemplate" in env.storedConfig(), false, "清空的模板键从存储中消失");
});

// ---------------- 端到端：清空 → 保存 → 重开 ----------------

test("端到端: 清空字段保存后重开配置页，该字段仍为空（交还默认）", async (t) => {
  const first = await createOptionsSandbox({
    stored: { model: "example-model", concurrency: "6" },
  });
  t.after(() => first.dispose());

  first.field("model").value = "";
  await first.submit();
  const persisted = first.storedConfig();
  assert.equal("model" in persisted, false, "清空的字段在存储里不存在");
  first.dispose(); // 重开配置页 = 旧文档与旧模块实例一起丢弃

  const second = await createOptionsSandbox({ stored: persisted });
  t.after(() => second.dispose());
  assert.equal(second.field("model").value, "", "清空保存后重开仍为空");
  assert.equal(second.field("concurrency").value, "6", "未清空的字段照常回填");
});

// ---------------- 「恢复默认」= 清空 + 保存 = 删键 ----------------

test("恢复默认: 单击只清空该组输入框（占位随即出现），不写存储、不碰其他组字段", async (t) => {
  const env = await createOptionsSandbox({ stored: STORED_ALL });
  t.after(() => env.dispose());

  await env.restore("api");

  for (const name of ["apiBase", "apiKey", "model", "concurrency"]) {
    assert.equal(env.field(name).value, "", `${name} 被清空`);
    assert.equal(env.field(name).placeholder, PLACEHOLDER[name], `${name} 占位显示将生效的默认值`);
  }
  assert.equal(env.field("targetLang").value, "English", "其他组字段不受影响");
  assert.equal(env.field("promptTemplate").value, "custom rules\n{host}", "其他组字段不受影响");
  assert.equal(env.status.textContent, "已清空「API」，将使用默认值，点保存生效");
  assert.deepEqual(env.syncWrites, [], "不写存储");
  assert.deepEqual(env.storedConfig(), STORED_ALL, "存储内容原样");
});

test("恢复默认 + 保存: 该组键从存储中删除，其他组保留；重开配置页仍是空框 + 默认占位", async (t) => {
  const first = await createOptionsSandbox({ stored: STORED_ALL });
  t.after(() => first.dispose());

  await first.restore("api");
  await first.submit();
  const persisted = first.storedConfig();
  assert.deepEqual(persisted, {
    targetLang: "English",
    promptTemplate: "custom rules\n{host}",
  });
  first.dispose(); // 重开配置页 = 旧文档与旧模块实例一起丢弃

  const second = await createOptionsSandbox({ stored: persisted });
  t.after(() => second.dispose());
  for (const name of ["apiBase", "apiKey", "model", "concurrency"]) {
    assert.equal(second.field(name).value, "", `${name} 重开仍是空框`);
    assert.equal(second.field(name).placeholder, PLACEHOLDER[name], `${name} 重开仍有默认占位`);
  }
});

test("恢复默认 + 保存: 提示词组清空后模板与追加提示词两个键从存储中删除，重开显示默认模板占位", async (t) => {
  const first = await createOptionsSandbox({
    stored: { ...STORED_ALL, extra: "专有名词保留原文" },
  });
  t.after(() => first.dispose());

  await first.restore("prompt");
  assert.equal(first.field("promptTemplate").value, "");
  assert.equal(first.field("extra").value, "", "追加提示词随该组一起被清空");
  assert.equal(first.status.textContent, "已清空「提示词」，将使用默认值，点保存生效");
  await first.submit();
  const persisted = first.storedConfig();
  for (const name of ["promptTemplate", "extra"]) {
    assert.equal(name in persisted, false, `${name} 键从存储中删除（而不是写入默认值字面量）`);
  }
  assert.equal(persisted.targetLang, "English", "其他组键保留");
  first.dispose();

  const second = await createOptionsSandbox({ stored: persisted });
  t.after(() => second.dispose());
  assert.equal(second.field("promptTemplate").value, "", "重开仍是空框");
  assert.equal(
    second.field("promptTemplate").placeholder,
    DEFAULT_PROMPT_TEMPLATE,
    "占位即默认模板全文",
  );
});
