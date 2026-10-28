// 工单 02（short-text-cache）：缓存存储内核——IndexedDB 封装（读 / 写 / 清理）与
// 两个纯 helper（配置指纹、UTF-8 字节门）。测试以内存假 IndexedDB 驱动
// （tests/helpers/fake-indexeddb.js），只断言外部可观察行为：
// 读回值、命中后的清理存活、各键的存废、日志记录——不断言模块内部状态。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCacheStore, cacheFingerprint, fitsCacheBytes, DAY_MS } from "../src/cache-store.js";
import { createFakeIndexedDB } from "./helpers/fake-indexeddb.js";

// 零痕迹夹具：假端点 / 假模型 / 假模板（含 {host}），不出现真实厂商信息
const CONFIG_A = {
  apiBase: "https://example.com/v1",
  apiKey: "sk-example-not-a-real-key",
  model: "example-model",
  targetLang: "中文",
  promptTemplate: "译成{targetLang}：\n{extra}\n{host}",
  extra: "",
};

const FP_A = cacheFingerprint(CONFIG_A);

// 每个用例一套独立环境：假 IndexedDB + 记录日志的 store
function makeEnv() {
  const fake = createFakeIndexedDB();
  const logs = [];
  const store = createCacheStore({
    indexedDB: fake.indexedDB,
    log: (...args) => logs.push(args.map(String).join(" ")),
  });
  return { fake, logs, store };
}

// ---------------- 纯 helper：配置指纹 ----------------

test("cacheFingerprint: 定长十六进制、同配置恒同指纹", () => {
  const a = cacheFingerprint(CONFIG_A);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(cacheFingerprint({ ...CONFIG_A }), a);
});

test("cacheFingerprint: 五项请求塑造值任一变化指纹即变", () => {
  for (const key of ["apiBase", "model", "targetLang", "promptTemplate", "extra"]) {
    const variant = { ...CONFIG_A, [key]: `${CONFIG_A[key]}#changed` };
    assert.notEqual(cacheFingerprint(variant), FP_A, `改变 ${key} 应变指纹`);
  }
});

test("cacheFingerprint: apiKey 不进指纹（密钥不塑造译文）", () => {
  const withKey = { ...CONFIG_A, apiKey: "sk-example-other-fake-key" };
  const withoutKey = { ...CONFIG_A, apiKey: "" };
  assert.equal(cacheFingerprint(withKey), FP_A);
  assert.equal(cacheFingerprint(withoutKey), FP_A);
});

test("cacheFingerprint: 值拼接无歧义（['ab','c'] 与 ['a','bc'] 不同指纹）", () => {
  const x = cacheFingerprint({ ...CONFIG_A, apiBase: "ab", model: "c" });
  const y = cacheFingerprint({ ...CONFIG_A, apiBase: "a", model: "bc" });
  assert.notEqual(x, y);
});

// ---------------- 纯 helper：UTF-8 字节门 ----------------

test("fitsCacheBytes: 恰好阈值通过、阈值 +1 拒绝（ASCII）", () => {
  assert.equal(fitsCacheBytes("a".repeat(30), 30), true);
  assert.equal(fitsCacheBytes("a".repeat(31), 30), false);
});

test("fitsCacheBytes: 按 UTF-8 字节计而非字符数（汉字 3 字节）", () => {
  const ten = "中".repeat(10); // 30 字节 / 10 字符
  assert.equal(fitsCacheBytes(ten, 30), true);
  assert.equal(fitsCacheBytes(ten, 29), false);
  assert.equal(fitsCacheBytes(ten, 10), false, "按字符数会误判通过");
});

// ---------------- 存储：读 / 写 ----------------

test("写后读命中：返回 { echo }", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "<b>Sign in</b>", "<html><b>登录</b></html>", 1000);
  assert.deepEqual(await store.get(FP_A, "<b>Sign in</b>", 2000), {
    echo: "<html><b>登录</b></html>",
  });
});

test("未命中返回 null", async () => {
  const { store } = makeEnv();
  assert.equal(await store.get(FP_A, "never-written", 1000), null);
});

test("写是 upsert：同键再写，读回最新 echo", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "k", "echo-v1", 1);
  await store.put(FP_A, "k", "echo-v2", 2);
  assert.deepEqual(await store.get(FP_A, "k", 3), { echo: "echo-v2" });
});

test("不同指纹同原文互不命中（键 = 指纹 + 原文）", async () => {
  const { store } = makeEnv();
  const fpOther = cacheFingerprint({ ...CONFIG_A, model: "other-model" });
  await store.put(FP_A, "Sign in", "echo-a", 1);
  assert.equal(await store.get(fpOther, "Sign in", 2), null, "异指纹查不到");
  assert.deepEqual(await store.get(FP_A, "Sign in", 2), { echo: "echo-a" }, "同指纹照常命中");
});

test("重复打开幂等：多次操作只 open/upgrade 一次", async () => {
  const { fake, store } = makeEnv();
  await store.put(FP_A, "a", "echo-a", 1);
  await store.get(FP_A, "a", 2);
  await store.get(FP_A, "b", 3);
  assert.equal(fake.openCalls, 1);
  assert.equal(fake.upgradeCalls, 1);
});

// ---------------- 存储：清理（过期删除 + LRU 淘到上限） ----------------

test("清理：过期条目被删、未过期保留（lastUsedAt 恰等于过期界不算过期）", async () => {
  const { store } = makeEnv();
  const now = 40 * DAY_MS;
  const cutoff = now - 30 * DAY_MS; // ttlDays = 30
  await store.put(FP_A, "expired", "echo-old", cutoff - 1);
  await store.put(FP_A, "on-edge", "echo-edge", cutoff);
  await store.put(FP_A, "fresh", "echo-fresh", now - 1);

  await store.cleanup({ now, ttlDays: 30, maxEntries: 100 });

  assert.equal(await store.get(FP_A, "expired", now), null, "早于过期界的被删");
  assert.deepEqual(await store.get(FP_A, "on-edge", now), { echo: "echo-edge" }, "恰在界上保留");
  assert.deepEqual(await store.get(FP_A, "fresh", now), { echo: "echo-fresh" }, "未过期保留");
});

test("命中刷新 lastUsedAt：后续清理按刷新后的时间计", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "hot", "echo-hot", 0); // 写入于 0 时刻
  await store.get(FP_A, "hot", 20 * DAY_MS); // 命中刷新到 20 天

  // 过期界 = 45d - 30d = 15d：未刷新的 0 会被删，刷新后的 20d 存活
  await store.cleanup({ now: 45 * DAY_MS, ttlDays: 30, maxEntries: 100 });
  assert.deepEqual(await store.get(FP_A, "hot", 45 * DAY_MS), { echo: "echo-hot" });
});

test("清理：超上限按最久未用淘汰到恰好上限", async () => {
  const { store } = makeEnv();
  for (let i = 1; i <= 5; i++) await store.put(FP_A, `k${i}`, `echo-${i}`, i);

  await store.cleanup({ now: 100, ttlDays: 30, maxEntries: 3 });

  assert.equal(await store.get(FP_A, "k1", 101), null, "最旧先淘");
  assert.equal(await store.get(FP_A, "k2", 101), null, "次旧也淘");
  for (const i of [3, 4, 5]) {
    assert.deepEqual(await store.get(FP_A, `k${i}`, 101), { echo: `echo-${i}` }, `k${i} 保留`);
  }
});

test("清理：未超上限时一条不淘", async () => {
  const { store } = makeEnv();
  for (let i = 1; i <= 3; i++) await store.put(FP_A, `k${i}`, `echo-${i}`, i);

  await store.cleanup({ now: 100, ttlDays: 30, maxEntries: 3 });

  for (const i of [1, 2, 3]) {
    assert.deepEqual(await store.get(FP_A, `k${i}`, 101), { echo: `echo-${i}` });
  }
});

// ---------------- 降级收口（D10）：IDB 故障绝不抛向调用方 ----------------

test("IDB 打开失败：读返 null、写与清理静默跳过且日志有记录，恢复后照常", async () => {
  const { fake, logs, store } = makeEnv();
  fake.failOpen(new Error("open boom"));

  assert.equal(await store.get(FP_A, "a", 1), null, "读按未命中处理");
  await store.put(FP_A, "a", "echo-a", 1); // 不抛
  await store.cleanup({ now: 1, ttlDays: 30, maxEntries: 100 }); // 不抛
  assert.equal(logs.length, 3, "三次操作各记一条日志");
  assert.ok(logs.every((line) => line.includes("open boom")));

  fake.clearFailures();
  await store.put(FP_A, "a", "echo-a", 2);
  assert.deepEqual(await store.get(FP_A, "a", 3), { echo: "echo-a" }, "故障恢复后照常读写");
});

test("IDB 请求失败：读返 null、写与清理静默跳过且日志有记录", async () => {
  const { fake, logs, store } = makeEnv();
  await store.put(FP_A, "a", "echo-a", 1); // 先正常写入

  fake.failRequests(new Error("tx boom"));
  assert.equal(await store.get(FP_A, "a", 2), null);
  await store.put(FP_A, "b", "echo-b", 2);
  await store.cleanup({ now: 2, ttlDays: 30, maxEntries: 100 });
  assert.equal(logs.length, 3, "三次操作各记一条日志");
  assert.ok(logs.every((line) => line.includes("tx boom")));

  fake.clearFailures();
  assert.deepEqual(await store.get(FP_A, "a", 3), { echo: "echo-a" }, "旧数据未丢");
});

// ---------------- 存储：清空（整库手动清空原语，cache-manual-clear 票 01） ----------------

test("清空：多条条目清空后逐键 get 全部未命中，返回清空前的条数", async () => {
  const { store } = makeEnv();
  const fpOther = cacheFingerprint({ ...CONFIG_A, model: "other-model" });
  await store.put(FP_A, "a", "echo-a", 1);
  await store.put(FP_A, "b", "echo-b", 2);
  await store.put(fpOther, "c", "echo-c", 3); // 异指纹条目同属整库清空范围

  assert.deepEqual(await store.clear(), { ok: true, removed: 3 }, "返回清空前的条数");

  assert.equal(await store.get(FP_A, "a", 4), null, "a 已清空");
  assert.equal(await store.get(FP_A, "b", 4), null, "b 已清空");
  assert.equal(await store.get(fpOther, "c", 4), null, "不按指纹筛选：异指纹条目同样清空");
});

test("清空：空库返回 { ok: true, removed: 0 }", async () => {
  const { store } = makeEnv();
  assert.deepEqual(await store.clear(), { ok: true, removed: 0 }, "空库视为成功、条数为 0");
});

test("清空：IDB 故障返回 { ok: false, removed: 0 }、日志有记录且不抛", async () => {
  const { fake, logs, store } = makeEnv();
  await store.put(FP_A, "a", "echo-a", 1);

  fake.failRequests(new Error("clear boom"));
  assert.deepEqual(await store.clear(), { ok: false, removed: 0 }, "故障按失败态回报，不抛");
  assert.equal(logs.length, 1, "记一条日志（D10 收口在本模块）");
  assert.ok(logs[0].includes("cache clear failed") && logs[0].includes("clear boom"));

  fake.clearFailures();
  assert.deepEqual(await store.get(FP_A, "a", 2), { echo: "echo-a" }, "失败的清空不损数据");
});

// ---------------- 存储：整库分页列表（cache-inspection 票 01 / spec D2/D4/D5/D7/D9） ----------------
// 接缝：库里实际写入了什么 ↔ list() 返回的页内容与页码。断言只看外部可观察结果：
// 条目顺序、每页条数、total、归一后的页码、失败态与日志；原文必须从主键还原，
// 值里不重复保存原文（fake.dump() 直接观察写入形态）。

const PAGE_SIZE = 20;

test("列表: 按 lastUsedAt 倒序（最新用在前），每页 20 条，翻到第二页是余下的条目", async () => {
  const { store } = makeEnv();
  for (let i = 1; i <= 25; i++) await store.put(FP_A, `k${i}`, `echo-${i}`, i);

  const first = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(first.ok, true);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, PAGE_SIZE);
  assert.equal(first.total, 25, "总条数由存储统计返回");
  assert.equal(first.entries.length, PAGE_SIZE, "满页恰好 20 条");
  assert.deepEqual(
    first.entries.map((e) => e.original),
    Array.from({ length: 20 }, (_, i) => `k${25 - i}`),
    "倒序：k25 最新用在前，k6 收尾",
  );
  assert.deepEqual(first.entries[0], {
    original: "k25",
    echo: "echo-25",
    hitCount: 0,
    lastUsedAt: 25,
  });

  const second = await store.list({ page: 2, pageSize: PAGE_SIZE });
  assert.equal(second.page, 2);
  assert.equal(second.total, 25);
  assert.deepEqual(
    second.entries.map((e) => e.original),
    ["k5", "k4", "k3", "k2", "k1"],
    "第二页是余下的 5 条，倒序继续",
  );
});

test("列表: 展示整库——异指纹条目同样在列表里（不按当前指纹过滤）", async () => {
  const { store } = makeEnv();
  const fpOther = cacheFingerprint({ ...CONFIG_A, model: "other-model" });
  await store.put(FP_A, "<b>A</b>", "echo-a", 1);
  await store.put(fpOther, "<b>B</b>", "echo-b", 2);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });

  assert.equal(page.total, 2);
  assert.deepEqual(
    page.entries.map((e) => e.original),
    ["<b>B</b>", "<b>A</b>"],
    "两个指纹的条目都在，仍按 lastUsedAt 倒序",
  );
});

test("列表: 空库 → ok、第 1 页、total 0、空条目", async () => {
  const { store } = makeEnv();

  assert.deepEqual(await store.list({ page: 1, pageSize: PAGE_SIZE }), {
    ok: true,
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    entries: [],
  });
});

test("列表: 越界页归一到有效页（超出取末页，小于 1 取首页）", async () => {
  const { store } = makeEnv();
  for (let i = 1; i <= 3; i++) await store.put(FP_A, `k${i}`, `echo-${i}`, i);

  const beyond = await store.list({ page: 99, pageSize: PAGE_SIZE });
  assert.equal(beyond.page, 1, "只有一页时超出页码归一为第 1 页");
  assert.equal(beyond.entries.length, 3, "归一的页码带着该页内容");

  const multi = makeEnv().store;
  for (let i = 1; i <= 21; i++) await multi.put(FP_A, `k${i}`, `echo-${i}`, i);
  const last = await multi.list({ page: 5, pageSize: PAGE_SIZE });
  assert.equal(last.page, 2, "两页库里请求第 5 页 → 归一到末页");
  assert.deepEqual(
    last.entries.map((e) => e.original),
    ["k1"],
    "末页内容是最后那一条",
  );

  const below = await multi.list({ page: 0, pageSize: PAGE_SIZE });
  assert.equal(below.page, 1, "页码小于 1 → 归一为第 1 页");
  assert.equal(below.entries.length, PAGE_SIZE);
});

test("列表: 原文从主键还原（含键分隔符的原文无损），值里不重复保存原文", async () => {
  const { fake, store } = makeEnv();
  const tricky = "<b>a</b>\x1f<b>b</b>"; // 原文自身含键分隔符
  await store.put(FP_A, tricky, "echo-tricky", 7);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });

  assert.equal(page.entries[0].original, tricky, "按定长指纹切掉键前缀即得原文");
  assert.equal(page.entries[0].echo, "echo-tricky");
  const [record] = fake.dump();
  assert.deepEqual(
    Object.keys(record.value).sort(),
    ["echo", "hitCount", "lastUsedAt"],
    "值只存 { echo, hitCount, lastUsedAt }：原文不重复保存",
  );
  assert.ok(record.key.endsWith(tricky), "原文只在主键里出现一次");
});

test("列表: IDB 故障返回 { ok: false }（不伪装成空库）并记日志，恢复后照常", async () => {
  const { fake, logs, store } = makeEnv();
  await store.put(FP_A, "a", "echo-a", 1);

  fake.failRequests(new Error("list boom"));
  assert.deepEqual(await store.list({ page: 1, pageSize: PAGE_SIZE }), { ok: false });
  assert.equal(logs.length, 1, "记一条日志");
  assert.ok(logs[0].includes("cache list failed") && logs[0].includes("list boom"));

  fake.clearFailures();
  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.ok, true, "故障恢复后照常返回列表");
  assert.equal(page.total, 1);
});

test("列表: 打开失败同样返回 { ok: false }，不抛", async () => {
  const { fake, logs, store } = makeEnv();
  fake.failOpen(new Error("open boom"));

  assert.deepEqual(await store.list({ page: 1, pageSize: PAGE_SIZE }), { ok: false });
  assert.ok(logs[0].includes("cache list failed") && logs[0].includes("open boom"));
});

// ---------------- 存储：命中次数（cache-inspection 票 02 / spec D10–D13） ----------------
// 接缝：put / get / list 的外部可观察结果——新键为零、真实命中加一、未命中不动、
// 旧记录缺字段读作零、覆盖写保留、删除后重建归零。次数与 lastUsedAt 同属一次命中
// 事务：命中一次后从 list() 同时看到新次数与新时间（两者各自都是「这次命中」的值）。

test("次数: 新键写入为零，列表里读到的也是零（写入不算命中）", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "fresh", "echo-fresh", 1);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 0, "写入只建立条目，不增加次数");
});

test("次数: 真实命中加一，连续命中逐次累加；未命中不增加任何条目", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "hot", "echo-hot", 1);

  await store.get(FP_A, "hot", 2);
  let page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 1, "第一次命中 → 1");

  await store.get(FP_A, "hot", 3);
  await store.get(FP_A, "hot", 4);
  page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 3, "连续命中逐次累加");

  assert.equal(await store.get(FP_A, "never-written", 5), null, "未命中照旧返回 null");
  page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.total, 1, "未命中不新建条目");
  assert.equal(page.entries[0].hitCount, 3, "未命中不改变已有条目的次数");
});

test("次数: 命中同时刷新 lastUsedAt——两者在同一次命中里一起更新", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "hot", "echo-hot", 1000);
  await store.get(FP_A, "hot", 2000);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 1, "次数来自这次命中");
  assert.equal(page.entries[0].lastUsedAt, 2000, "时间同样来自这次命中");
});

test("次数: 旧记录缺 hitCount 字段 → 列表按零显示，首次命中后变 1（不追溯历史）", async () => {
  const { fake, store } = makeEnv();
  await store.put(FP_A, "legacy", "echo-legacy", 10);
  // 旧版本落下的值形态：只有 { echo, lastUsedAt }（键从转储里取，不在这里重建键形）
  const legacyKey = fake.dump().find((record) => record.key.endsWith("legacy")).key;
  fake.seedValue(legacyKey, { echo: "echo-legacy", lastUsedAt: 10 });

  let page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 0, "缺字段读作零，不报错");

  assert.deepEqual(await store.get(FP_A, "legacy", 20), { echo: "echo-legacy" });
  page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 1, "旧条目首次命中后变 1，此前历史无从恢复");
  assert.equal(page.entries[0].lastUsedAt, 20);
});

test("次数: 覆盖写保留已有次数（只换回显与时间）", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "k", "echo-v1", 1);
  await store.get(FP_A, "k", 2);
  await store.get(FP_A, "k", 3); // 两次命中 → 2

  await store.put(FP_A, "k", "echo-v2", 4); // 同轮重复请求的上游结果覆盖写

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].echo, "echo-v2", "回显更新");
  assert.equal(page.entries[0].lastUsedAt, 4, "时间更新");
  assert.equal(page.entries[0].hitCount, 2, "覆盖写不清零已有次数");

  assert.deepEqual(await store.get(FP_A, "k", 5), { echo: "echo-v2" }, "命中回放用新回显");
  const after = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(after.entries[0].hitCount, 3, "覆盖写之后继续累加");
});

test("次数: 手动清空后同键重建从零开始", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "k", "echo-a", 1);
  await store.get(FP_A, "k", 2);
  assert.equal((await store.list({ page: 1, pageSize: PAGE_SIZE })).entries[0].hitCount, 1);

  await store.clear();
  await store.put(FP_A, "k", "echo-b", 3);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].echo, "echo-b");
  assert.equal(page.entries[0].hitCount, 0, "被删条目的统计不转移到新条目");
});

test("次数: 过期删除后同键重建从零开始", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "k", "echo-old", 0);
  await store.get(FP_A, "k", 1);

  await store.cleanup({ now: 100 * DAY_MS, ttlDays: 30, maxEntries: 100 }); // 过期删除
  await store.put(FP_A, "k", "echo-new", 100 * DAY_MS);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  assert.equal(page.entries[0].hitCount, 0, "过期删除即丢统计");
});

test("次数: 容量淘汰后同键重建从零开始", async () => {
  const { store } = makeEnv();
  await store.put(FP_A, "old", "echo-old", 1);
  await store.get(FP_A, "old", 2);
  await store.put(FP_A, "new", "echo-new", 3);

  await store.cleanup({ now: 10, ttlDays: 30, maxEntries: 1 }); // 淘汰最久未用的 old
  await store.put(FP_A, "old", "echo-reborn", 4);

  const page = await store.list({ page: 1, pageSize: PAGE_SIZE });
  const reborn = page.entries.find((e) => e.original === "old");
  assert.equal(reborn.hitCount, 0, "淘汰即丢统计");
});
