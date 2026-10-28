// ============================================================
// background（service worker）集成测试
//
// 被测接缝：content → background 的 start 消息（text + 可选 history）→
// 上游 fetch 请求体（messages 组装）与 bg → content 的回发消息
// （delta / restart / done / error）；cleanup-cache 消息 → 缓存清理。
// 全部走 tests/helpers/background-sandbox.js 基建（chrome/fetch/端口/IDB 替身）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  createBackgroundSandbox,
  sseResponse,
  httpErrorResponse,
  ofType,
  DEFAULT_CONFIG,
} from "./helpers/background-sandbox.js";
import { DEFAULT_PROMPT_TEMPLATE, isHostWrapped, renderPrompt, wrapHost } from "../src/prompt.js";
import { createCacheStore, cacheFingerprint } from "../src/cache-store.js";
import { mergeConfig, TRANSLATE_CONFIG } from "../src/config.js";

const TEMPLATE_FIRST_LINE = DEFAULT_PROMPT_TEMPLATE.split("\n")[0];

// ============================================================
// 消息组装（spec D4）：链首 = 今日那条单 user；链中 = 历史对 + 裸新文本
// ============================================================

test("消息组装: 链首（无 history）= 今日那条单 user，内容为模板渲染 + {host} 同形包装", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>甲</p></html>"])],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>hello</p>" });

  assert.equal(env.fetchCalls.length, 1, "一宿主一次上游请求");
  assert.equal(env.fetchCalls[0].url, "https://example.com/v1/chat/completions");
  const body = env.fetchCalls[0].body;
  assert.equal(body.stream, true, "流式开关照旧");
  assert.equal(body.messages.length, 1, "链首 = 单条 user");
  assert.equal(body.messages[0].role, "user");
  assert.equal(
    body.messages[0].content,
    renderPrompt(DEFAULT_PROMPT_TEMPLATE, "<p>hello</p>", { target: "中文", extra: "" }),
    "内容与今日一字不差（模板渲染，{host} 注入包装）",
  );
  assert.ok(body.messages[0].content.includes(wrapHost("<p>hello</p>")), "包装与 {host} 注入同形");
  assert.equal(ofType(port, "done").length, 1, "收尾一条 done");
  assert.equal(ofType(port, "restart").length, 0, "形态合规不重试");
});

test("消息组装: 链中 = 历史对（链序最老在前）+ 只有新文本的裸 user（不带模板）", async () => {
  const env = await createBackgroundSandbox({
    config: { reuseSession: true },
    responses: [sseResponse(["<html><p>丁</p></html>"])],
  });
  const port = env.connect();
  // 第二段历史带首尾空白：包装前 trim，与 {host} 当初发出去的文本同形
  await env.start(port, {
    text: "<p>d</p>",
    history: [
      { html: "<p>a</p>", echo: "<html><p>甲</p></html>" },
      { html: " <p>b</p> ", echo: "<html><p>乙</p></html>" },
    ],
  });

  const messages = env.fetchCalls[0].body.messages;
  assert.deepEqual(messages, [
    { role: "user", content: wrapHost("<p>a</p>") },
    { role: "assistant", content: "<html><p>甲</p></html>" },
    { role: "user", content: wrapHost("<p>b</p>") },
    { role: "assistant", content: "<html><p>乙</p></html>" },
    { role: "user", content: wrapHost("<p>d</p>") },
  ]);
  assert.equal(messages.at(-1).content, wrapHost("<p>d</p>"), "最新一轮只带新文本");
  assert.equal(
    messages.at(-1).content.includes(TEMPLATE_FIRST_LINE),
    false,
    "最新一轮是裸 user（不带模板）",
  );
  assert.equal(messages[0].role, "user", "历史顺序：最老在前");
  assert.equal(messages[1].role, "assistant", "assistant = 原始回显（含包装、未剥壳、未净化）");
  for (const turn of [messages[0], messages[2], messages[4]]) {
    assert.equal(isHostWrapped(turn.content), true, "每轮 user 文本都是恰一层 <html> 包装");
  }
});

test("消息组装: 空/非法 history 一律按链首（纵深防御）", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["<html>甲</html>"]),
      sseResponse(["<html>乙</html>"]),
      sseResponse(["<html>丙</html>"]),
      sseResponse(["<html>丁</html>"]),
    ],
  });
  const histories = [[], "junk", [{ html: "<p>a</p>" }], [null]];
  for (let i = 0; i < histories.length; i++) {
    const port = env.connect();
    // 每轮换不同原文：同文重发会命中缓存而不再 fetch（短文本缓存特性），断言将落空
    await env.start(port, { text: `<p>x${i}</p>`, history: histories[i] });
    const messages = env.fetchCalls.at(-1).body.messages;
    assert.equal(messages.length, 1, `history=${JSON.stringify(histories[i])} → 链首形态`);
  }
  assert.equal(env.fetchCalls.length, histories.length, "每次 start 都真实走到上游");
});

// ============================================================
// 形态触发器：回显 trim 后整体不是恰一层包装 → 重试一次（以链首形态）
// ============================================================

test("形态重试（会话模式）: 重试前发 restart、第二次请求无历史、收尾恰一条消息", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["Sure! Here it is: ", "<html><p>甲</p></html> Hope it helps!"]),
      sseResponse(["<html><p>甲</p></html>"]),
    ],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>", history: [{ html: "<p>x</p>", echo: "[{x}]" }] });

  assert.equal(env.fetchCalls.length, 2, "形态触发器恰重试一次");
  assert.equal(env.fetchCalls[1].body.messages.length, 1, "重试以链首形态：无历史");
  assert.equal(env.fetchCalls[1].body.messages[0].role, "user");
  assert.ok(
    env.fetchCalls[1].body.messages[0].content.includes(wrapHost("<p>a</p>")),
    "重试仍翻本段",
  );
  assert.deepEqual(
    port.posted.map((m) => m.type),
    ["delta", "delta", "restart", "delta", "done"],
    "失败尝试的 delta → restart（作废）→ 重试的 delta → done",
  );
  assert.equal(ofType(port, "done").length + ofType(port, "error").length, 1, "落定消息恰一条");
  assert.equal(
    env.debugLines.filter((l) => l.includes("retry")).length,
    1,
    "重试经 debug 通道留痕",
  );
});

test("形态重试（非会话模式）: 同请求重发（两次请求体逐字相同）", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["没有包装的译文"]), sseResponse(["<html><p>甲</p></html>"])],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>" });

  assert.equal(env.fetchCalls.length, 2, "关着会话重用也重试（形态触发器两种模式都适用）");
  assert.deepEqual(env.fetchCalls[1].body, env.fetchCalls[0].body, "同请求重发");
  assert.deepEqual(
    port.posted.map((m) => m.type),
    ["delta", "restart", "delta", "done"],
  );
});

test("形态再败: 恰两次请求后走既有错误通道（一条 error、无 done）", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["junk one"]), sseResponse(["junk two"])],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>" });

  assert.equal(env.fetchCalls.length, 2, "形态触发器只重试一次，不无限重发");
  const errors = ofType(port, "error");
  assert.equal(errors.length, 1, "失败走既有错误通道");
  assert.equal(ofType(port, "done").length, 0, "不把不合形态的回显当译文交给 content");
  assert.ok(errors[0].message.includes("包装"), "错误消息点明形态问题");
});

// ============================================================
// 超限触发器：HTTP 错误文案命中保守清单 → 仅会话模式重试一次
// ============================================================

test("超限重试（会话模式）: 文案命中即弃历史重试，大小写不敏感", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      httpErrorResponse(
        400,
        "This model's MAXIMUM CONTEXT LENGTH is 8192 tokens. Please reduce the length of the messages.",
      ),
      sseResponse(["<html><p>甲</p></html>"]),
    ],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>", history: [{ html: "<p>x</p>", echo: "[{x}]" }] });

  assert.equal(env.fetchCalls.length, 2, "超限触发器恰重试一次");
  assert.equal(env.fetchCalls[1].body.messages.length, 1, "重试以链首形态（弃历史）");
  assert.deepEqual(
    port.posted.map((m) => m.type),
    ["restart", "delta", "done"],
    "超限路径没有失败尝试的 delta；restart 是统一恢复路径（弃掉本槽历史重开一局）",
  );
  assert.equal(ofType(port, "done").length, 1);
});

test("超限（非会话模式）: 不重试，一次请求后直接报错", async () => {
  const env = await createBackgroundSandbox({
    responses: [httpErrorResponse(400, "maximum context length exceeded")],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>" });

  assert.equal(env.fetchCalls.length, 1, "内容没变长，重试无意义");
  assert.equal(ofType(port, "restart").length, 0, "不重试就不发 restart");
  const errors = ofType(port, "error");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes("HTTP 400"), "既有错误通道保留状态码与详情");
});

test("超限文案保守列举: 未命中的 HTTP 错误不重试（会话模式也不重试）", async () => {
  const env = await createBackgroundSandbox({
    responses: [httpErrorResponse(429, "rate limit exceeded")],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>", history: [{ html: "<p>x</p>", echo: "[{x}]" }] });

  assert.equal(env.fetchCalls.length, 1, "文案未命中 → 不是超限触发器");
  assert.equal(ofType(port, "restart").length, 0);
  assert.equal(ofType(port, "error").length, 1);
});

// ============================================================
// 空回显："" / <html></html> 都不重试（维持既有「未返回译文」口径）
// ============================================================

test("空回显不重试: 零 delta 与 <html></html> 都直接 done（不涉形态判定）", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse([]), sseResponse(["<html></html>"]), sseResponse(["   "])],
  });
  const ports = [env.connect(), env.connect(), env.connect()];
  await env.start(ports[0], { text: "<p>a</p>" });
  await env.start(ports[1], { text: "<p>b</p>" });
  await env.start(ports[2], { text: "<p>c</p>" });

  assert.equal(env.fetchCalls.length, 3, "三种空回显各一次请求，都不重试");
  assert.deepEqual(
    ports[0].posted.map((m) => m.type),
    ["done"],
  );
  assert.deepEqual(
    ports[1].posted.map((m) => m.type),
    ["delta", "done"],
  );
  assert.deepEqual(
    ports[2].posted.map((m) => m.type),
    ["delta", "done"],
  );
  assert.equal(
    ports.reduce((n, p) => n + ofType(p, "restart").length, 0),
    0,
    "空回显不触发任何重试",
  );
});

// ============================================================
// 落定收口与配置守卫：每端口恰一条落定消息；未配置不发请求
// ============================================================

test("落定收口: 每端口恰一条 done/error，重试不产生额外的落定消息", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["junk"]),
      sseResponse(["<html>甲</html>"]),
      sseResponse(["junk again"]),
      sseResponse(["junk still"]),
    ],
  });
  const ok = env.connect();
  await env.start(ok, { text: "<p>a</p>" });
  const failed = env.connect();
  await env.start(failed, { text: "<p>b</p>" });

  for (const port of [ok, failed]) {
    const settled = port.posted.filter((m) => m.type === "done" || m.type === "error");
    assert.equal(settled.length, 1, "每宿主恰好一次落定");
  }
});

test("配置守卫: 未配置端点/密钥/模型时经既有错误通道回告，不发起上游请求", async () => {
  const env = await createBackgroundSandbox({
    config: { apiBase: "", apiKey: "", model: "" },
    responses: [],
  });
  const port = env.connect();
  await env.start(port, { text: "<p>a</p>", history: [{ html: "<p>x</p>", echo: "[{x}]" }] });

  assert.equal(env.fetchCalls.length, 0, "未配置不发请求（历史字段不改变守卫）");
  assert.equal(ofType(port, "error").length, 1);
  assert.equal(ofType(port, "restart").length, 0);
});

// ============================================================
// 短文本缓存（ADR-0008；spec D2/D3/D4/D5/D7/D10/D11）：
// 查询门槛 → 命中回放 → 成功写入 → 清理消息 → 降级 → 同轮不合并
// ============================================================

// 与 background 当次 loadConfig 同源的指纹（直种/直查缓存用）：
// 沙箱配置只叠在 DEFAULT_CONFIG 上，指纹五项之外的键不影响结果
function testFingerprint() {
  return cacheFingerprint(mergeConfig(TRANSLATE_CONFIG, DEFAULT_CONFIG));
}

// 与 background 共用同一假 IndexedDB 的种子存储：测试直接写库/验库，
// 与 background 模块内的 store 单例读写同一份数据
function seedStore(env) {
  return createCacheStore({ indexedDB: env.fakeIdb.indexedDB });
}

test("缓存: 未命中成功后写入；下一同键 start 回放 delta 全文 + done{cached:true}（零 fetch）", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>你好</p></html>"])],
  });

  const first = env.connect();
  await env.start(first, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1, "首诊未命中：走上游");
  assert.deepEqual(
    ofType(first, "done"),
    [{ type: "done" }],
    "真翻落定的 done 不带 cached 字段（协议只新增可选标志）",
  );

  const second = env.connect();
  await env.start(second, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1, "命中回放：不再发上游请求");
  assert.deepEqual(
    second.posted,
    [
      { type: "delta", text: "<html><p>你好</p></html>" },
      { type: "done", cached: true },
    ],
    "恰好一条 delta（缓存原始回显全文，含包装）+ 一条 done{cached:true}，无 restart/error",
  );
});

test('缓存写入: 失败与空回显（"" / <html></html>）一律不写', async () => {
  const env = await createBackgroundSandbox({
    responses: [
      httpErrorResponse(500, "server boom"), // <p>a</p> 失败
      sseResponse([]), // <p>b</p> 零 delta（空回显）
      sseResponse(["<html></html>"]), // <p>c</p> 空壳回显
      sseResponse(["<html><p>甲</p></html>"]),
      sseResponse(["<html><p>乙</p></html>"]),
      sseResponse(["<html><p>丙</p></html>"]),
    ],
  });
  const texts = ["<p>a</p>", "<p>b</p>", "<p>c</p>"];

  const first = texts.map(() => env.connect());
  for (let i = 0; i < texts.length; i++) await env.start(first[i], { text: texts[i] });
  assert.equal(env.fetchCalls.length, 3, "失败/空回显各走一次上游");
  assert.equal(ofType(first[0], "error").length, 1, "失败走既有错误通道");

  // 同键再来：若曾写入，这里会命中回放而不再 fetch
  const second = texts.map(() => env.connect());
  for (let i = 0; i < texts.length; i++) await env.start(second[i], { text: texts[i] });
  assert.equal(env.fetchCalls.length, 6, "三者都没写缓存：同键再来仍走上游");
  for (const port of second) {
    assert.deepEqual(ofType(port, "done"), [{ type: "done" }], "真翻落定，非缓存回放");
  }
});

test("缓存隔离: 改配置（指纹五项之一）后旧条目不再命中，改回即恢复", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["<html><p>你好</p></html>"]),
      sseResponse(["<html><p>您好</p></html>"]),
    ],
  });
  await env.start(env.connect(), { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1);

  env.setConfig({ model: "other-model" }); // 指纹五项之一
  await env.start(env.connect(), { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 2, "指纹变化：旧条目不再命中，重走上游");

  env.setConfig({ model: DEFAULT_CONFIG.model }); // 改回
  const port = env.connect();
  await env.start(port, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 2, "改回后旧条目又命中");
  assert.deepEqual(
    port.posted,
    [
      { type: "delta", text: "<html><p>你好</p></html>" },
      { type: "done", cached: true },
    ],
    "命中的是原配置写入的旧条目",
  );
});

test("缓存阈值: 骨架超 cacheMaxBytes 的原文不查也不写", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["<html><p>长文甲</p></html>"]),
      sseResponse(["<html><p>长文乙</p></html>"]),
    ],
  });
  const longText = `<p>${"x".repeat(40)}</p>`; // 47 UTF-8 字节 > 默认阈值 30
  // 直接向库里种一条同键条目：查询若发生必命中——用它看住「不查」
  await seedStore(env).put(testFingerprint(), longText, "<html><p>预置回声</p></html>", Date.now());

  const first = env.connect();
  await env.start(first, { text: longText });
  assert.equal(env.fetchCalls.length, 1, "超阈值：库里有同键条目也不查");
  assert.deepEqual(ofType(first, "done"), [{ type: "done" }]);

  const second = env.connect();
  await env.start(second, { text: longText });
  assert.equal(env.fetchCalls.length, 2, "超阈值：成功回显也不写，同键再来仍走上游");
  assert.deepEqual(ofType(second, "done"), [{ type: "done" }]);
});

test("缓存开关: cacheEnabled 关闭时不查、不写", async () => {
  const env = await createBackgroundSandbox({
    config: { cacheEnabled: false },
    responses: [
      sseResponse(["<html><p>你好</p></html>"]),
      sseResponse(["<html><p>您好</p></html>"]),
    ],
  });
  // 库里先种同键条目：开关关时即使能命中也不得查
  await seedStore(env).put(
    testFingerprint(),
    "<p>hi</p>",
    "<html><p>预置回声</p></html>",
    Date.now(),
  );

  const first = env.connect();
  await env.start(first, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1, "开关关：不查");
  assert.deepEqual(ofType(first, "done"), [{ type: "done" }]);

  const second = env.connect();
  await env.start(second, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 2, "开关关：不写，同键再来仍走上游");
  assert.deepEqual(ofType(second, "done"), [{ type: "done" }]);
});

test("清理消息: cleanup-cache 删除过期条目、保留新鲜条目", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>旧文新译</p></html>"])],
  });
  const seed = seedStore(env);
  const fp = testFingerprint();
  await seed.put(fp, "<p>old</p>", "<html><p>旧回声</p></html>", 0); // 1970：必过期
  await seed.put(fp, "<p>new</p>", "<html><p>新回声</p></html>", Date.now());

  await env.sendRuntimeMessage({ type: "cleanup-cache" });

  const stale = env.connect();
  await env.start(stale, { text: "<p>old</p>" });
  assert.equal(env.fetchCalls.length, 1, "过期条目已删：同键 miss 走上游");
  assert.deepEqual(ofType(stale, "done"), [{ type: "done" }]);

  const fresh = env.connect();
  await env.start(fresh, { text: "<p>new</p>" });
  assert.equal(env.fetchCalls.length, 1, "新鲜条目存活：命中不发请求");
  assert.deepEqual(fresh.posted, [
    { type: "delta", text: "<html><p>新回声</p></html>" },
    { type: "done", cached: true },
  ]);
});

test("清理消息: cleanup-cache 超上限按最久未用淘到上限", async () => {
  const env = await createBackgroundSandbox({
    config: { cacheMaxEntries: 1 },
    responses: [sseResponse(["<html><p>补译</p></html>"])],
  });
  const seed = seedStore(env);
  const fp = testFingerprint();
  const now = Date.now();
  await seed.put(fp, "<p>a</p>", "<html><p>回声甲</p></html>", now - 1000); // 较旧
  await seed.put(fp, "<p>b</p>", "<html><p>回声乙</p></html>", now);

  await env.sendRuntimeMessage({ type: "cleanup-cache" });

  const evicted = env.connect();
  await env.start(evicted, { text: "<p>a</p>" });
  assert.equal(env.fetchCalls.length, 1, "最久未用的被淘汰");
  assert.deepEqual(ofType(evicted, "done"), [{ type: "done" }]);

  const kept = env.connect();
  await env.start(kept, { text: "<p>b</p>" });
  assert.equal(env.fetchCalls.length, 1, "较新的保留并命中");
  assert.deepEqual(kept.posted, [
    { type: "delta", text: "<html><p>回声乙</p></html>" },
    { type: "done", cached: true },
  ]);
});

test("清理消息: 缓存关闭时不执行清理", async () => {
  const env = await createBackgroundSandbox({ config: { cacheEnabled: false }, responses: [] });
  const seed = seedStore(env);
  await seed.put(testFingerprint(), "<p>old</p>", "<html><p>旧回声</p></html>", 0); // 必过期

  await env.sendRuntimeMessage({ type: "cleanup-cache" });

  assert.deepEqual(
    await seed.get(testFingerprint(), "<p>old</p>", Date.now()),
    { echo: "<html><p>旧回声</p></html>" },
    "过期条目仍在：缓存关时清理不执行",
  );
  assert.equal(env.fetchCalls.length, 0);
});

test("缓存降级: IndexedDB 故障记日志，翻译消息次序与无缓存逐字节一致", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>你好", "</p></html>"])],
  });
  // 请求级故障：background 的 store 单例复用已打开的连接（生产姿势），failOpen 只对
  // 首次打开生效、随用例顺序漂移；open 失败的降级由 cache-store 单测覆盖
  env.fakeIdb.failRequests(new Error("idb boom"));

  const port = env.connect();
  await env.start(port, { text: "<p>hi</p>" });

  assert.deepEqual(
    port.posted,
    [
      { type: "delta", text: "<html><p>你好" },
      { type: "delta", text: "</p></html>" },
      { type: "done" },
    ],
    "delta/done 次序与载荷与无缓存逐字节一致（无 cached、无 error）",
  );
  assert.equal(env.fetchCalls.length, 1, "缓存故障不阻断上游请求");
  assert.ok(
    env.errorLines.some((line) => line.includes("cache get failed") && line.includes("idb boom")),
    "读故障已记日志",
  );
  assert.ok(
    env.errorLines.some((line) => line.includes("cache put failed") && line.includes("idb boom")),
    "写故障已记日志",
  );
});

test("同轮相同原文不合并（D11）: 并发同文各发一次请求，写入落定后下一轮命中", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>甲</p></html>"]), sseResponse(["<html><p>乙</p></html>"])],
  });
  const p1 = env.connect();
  const p2 = env.connect();
  // 并发发出（不等各自落定）：两个查询都发生在任何写入之前
  p1.emit({ type: "start", text: "<p>go</p>" });
  p2.emit({ type: "start", text: "<p>go</p>" });
  await env.settle();

  assert.equal(env.fetchCalls.length, 2, "同轮相同原文不在途合并：各付一次上游请求");
  for (const p of [p1, p2]) {
    assert.deepEqual(ofType(p, "done"), [{ type: "done" }], "两轮都是真翻落定");
  }

  const p3 = env.connect();
  await env.start(p3, { text: "<p>go</p>" });
  assert.equal(env.fetchCalls.length, 2, "写入落定后的下一轮直接命中");
  assert.deepEqual(ofType(p3, "done"), [{ type: "done", cached: true }]);
});

// ============================================================
// 清空消息（clear-cache，cache-manual-clear 票 01 / spec D1/D4/D5/D6/D7）：
// 整库清空 + 异步回应 { ok, removed }；与 cacheEnabled 无关（不读配置）
// ============================================================

test("清空消息: clear-cache 清空整库（含异指纹条目）并回应 { ok: true, removed: 清空前条数 }", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  const seed = seedStore(env);
  const fp = testFingerprint();
  const fpOther = cacheFingerprint(
    mergeConfig(TRANSLATE_CONFIG, { ...DEFAULT_CONFIG, model: "other-model" }),
  );
  const now = Date.now();
  await seed.put(fp, "<p>a</p>", "<html><p>回声甲</p></html>", now);
  await seed.put(fp, "<p>b</p>", "<html><p>回声乙</p></html>", now);
  await seed.put(fpOther, "<p>c</p>", "<html><p>回声丙</p></html>", now); // 异指纹同属整库清空范围

  const response = await env.sendRuntimeMessage({ type: "clear-cache" });

  assert.deepEqual(response, { ok: true, removed: 3 }, "回应清空前的条数");
  assert.equal(await seed.get(fp, "<p>a</p>", now), null, "a 已清空");
  assert.equal(await seed.get(fp, "<p>b</p>", now), null, "b 已清空");
  assert.equal(await seed.get(fpOther, "<p>c</p>", now), null, "不按指纹筛选");
});

test("清空消息: cacheEnabled 关闭时照样清空（D6：手动清空不读开关）", async () => {
  const env = await createBackgroundSandbox({ config: { cacheEnabled: false }, responses: [] });
  const seed = seedStore(env);
  await seed.put(testFingerprint(), "<p>a</p>", "<html><p>回声甲</p></html>", Date.now());

  const response = await env.sendRuntimeMessage({ type: "clear-cache" });

  assert.deepEqual(response, { ok: true, removed: 1 }, "开关关着照清并回报条数");
  assert.equal(await seed.get(testFingerprint(), "<p>a</p>", Date.now()), null, "库已清空");
});

test("清空消息: IndexedDB 故障时回应 { ok: false, removed: 0 } 而不是抛错", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  const seed = seedStore(env);
  const now = Date.now();
  await seed.put(testFingerprint(), "<p>a</p>", "<html><p>回声甲</p></html>", now);

  env.fakeIdb.failRequests(new Error("idb boom"));
  const response = await env.sendRuntimeMessage({ type: "clear-cache" });

  assert.deepEqual(response, { ok: false, removed: 0 }, "故障如实回报失败态");
  assert.equal(
    env.errorLines.filter(
      (line) => line.includes("cache clear failed") && line.includes("idb boom"),
    ).length,
    1,
    "失败留痕恰一条：store 经注入的日志回调（DBG.error 通道）记录，background 不重复记",
  );
  env.fakeIdb.clearFailures();
  assert.deepEqual(
    await seed.get(testFingerprint(), "<p>a</p>", now),
    { echo: "<html><p>回声甲</p></html>" },
    "失败的清空不损数据",
  );
});

test("清空消息: 清空后同一原文重走上游，落定形态与未命中路径逐字节一致（不再有 done{cached:true}）", async () => {
  const env = await createBackgroundSandbox({
    responses: [
      sseResponse(["<html><p>你好</p></html>"]),
      sseResponse(["<html><p>您好</p></html>"]),
    ],
  });

  const first = env.connect();
  await env.start(first, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1, "首诊未命中走上游并写入缓存");
  assert.deepEqual(ofType(first, "done"), [{ type: "done" }]);

  const cached = env.connect();
  await env.start(cached, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 1, "清空前同键命中缓存，不再发请求");
  assert.deepEqual(ofType(cached, "done"), [{ type: "done", cached: true }]);

  const response = await env.sendRuntimeMessage({ type: "clear-cache" });
  assert.deepEqual(response, { ok: true, removed: 1 });

  const after = env.connect();
  await env.start(after, { text: "<p>hi</p>" });
  assert.equal(env.fetchCalls.length, 2, "清空后同一原文重新走上游请求");
  assert.deepEqual(
    after.posted,
    [{ type: "delta", text: "<html><p>您好</p></html>" }, { type: "done" }],
    "落定形态与未命中路径逐字节一致：无 cached 标志、无 restart/error",
  );
});

// ============================================================
// 缓存列表消息（list-cache，cache-inspection 票 01 / spec D2/D8/D9）：
// 独立的请求—响应消息，整库分页读取；与 clear-cache / cleanup-cache 各自契约，
// 不合并成带模式参数的消息。开关关闭与指纹无关地照常可读（D2）。
// ============================================================

// 直种条目：与 background 模块内的 store 单例读写同一份假库
async function seedEntries(env, rows) {
  const seed = seedStore(env);
  const fp = testFingerprint();
  for (const { original, echo, lastUsedAt } of rows) {
    await seed.put(fp, original, echo, lastUsedAt);
  }
}

test("列表消息: 请求 { type, page, pageSize } → 回应 { ok, page, pageSize, total, entries }", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  await seedEntries(env, [
    { original: "<b>a</b>", echo: "<html><b>甲</b></html>", lastUsedAt: 10 },
    { original: "<b>b</b>", echo: "<html><b>乙</b></html>", lastUsedAt: 20 },
  ]);

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });

  assert.deepEqual(response, {
    ok: true,
    page: 1,
    pageSize: 20,
    total: 2,
    entries: [
      { original: "<b>b</b>", echo: "<html><b>乙</b></html>", hitCount: 0, lastUsedAt: 20 },
      { original: "<b>a</b>", echo: "<html><b>甲</b></html>", hitCount: 0, lastUsedAt: 10 },
    ],
  });
});

test("列表消息: cacheEnabled 关闭时照样可读（开关只管自动链路）", async () => {
  const env = await createBackgroundSandbox({ config: { cacheEnabled: false }, responses: [] });
  await seedEntries(env, [{ original: "<b>a</b>", echo: "echo-a", lastUsedAt: 1 }]);

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });

  assert.equal(response.ok, true, "开关关着仍能读取");
  assert.equal(response.total, 1);
  assert.deepEqual(
    response.entries.map((e) => e.original),
    ["<b>a</b>"],
  );
});

test("列表消息: 整库——异指纹条目也在回应里（不按当前指纹过滤）", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  const seed = seedStore(env);
  const fpOther = cacheFingerprint(
    mergeConfig(TRANSLATE_CONFIG, { ...DEFAULT_CONFIG, model: "other-model" }),
  );
  await seed.put(testFingerprint(), "<b>now</b>", "echo-now", 2);
  await seed.put(fpOther, "<b>old</b>", "echo-old", 1);

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });

  assert.deepEqual(
    response.entries.map((e) => e.original),
    ["<b>now</b>", "<b>old</b>"],
    "两个指纹的条目都在，仍按 lastUsedAt 倒序",
  );
});

test("列表消息: 越界页回应归一后的页码与该页内容；空库回应第 1 页的空列表", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  await seedEntries(env, [
    { original: "<b>a</b>", echo: "echo-a", lastUsedAt: 1 },
    { original: "<b>b</b>", echo: "echo-b", lastUsedAt: 2 },
  ]);

  const beyond = await env.sendRuntimeMessage({ type: "list-cache", page: 7, pageSize: 1 });
  assert.equal(beyond.page, 2, "两页库请求第 7 页 → 归一到末页");
  assert.deepEqual(
    beyond.entries.map((e) => e.original),
    ["<b>a</b>"],
  );

  const empty = await createBackgroundSandbox({ responses: [] });
  const blank = await empty.sendRuntimeMessage({ type: "list-cache", page: 3, pageSize: 20 });
  assert.deepEqual(blank, { ok: true, page: 1, pageSize: 20, total: 0, entries: [] });
});

test("列表消息: IDB 故障回应 { ok: false }（不伪装成空库）且留痕", async () => {
  const env = await createBackgroundSandbox({ responses: [] });
  await seedEntries(env, [{ original: "<b>a</b>", echo: "echo-a", lastUsedAt: 1 }]);

  env.fakeIdb.failRequests(new Error("idb boom"));
  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });

  assert.deepEqual(response, { ok: false }, "失败态与空库可区分");
  assert.ok(
    env.errorLines.some((line) => line.includes("cache list failed") && line.includes("idb boom")),
    "故障经既有日志通道留痕",
  );
});

test("列表消息: 超大 pageSize 被截到 100，回应里的 pageSize 是实际生效值", async () => {
  const env = await createBackgroundSandbox();
  const rows = Array.from({ length: 120 }, (_, i) => ({
    original: `<b>k${i + 1}</b>`,
    echo: `echo-${i + 1}`,
    lastUsedAt: i + 1,
  }));
  await seedEntries(env, rows);

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 100000 });

  assert.equal(response.ok, true);
  assert.equal(response.pageSize, 100, "上界 100：异常调用不会一次取走整库");
  assert.equal(response.total, 120);
  assert.equal(response.entries.length, 100, "回应条数等于生效的每页条数");
  assert.equal(response.page, 1);
  assert.equal(response.entries[0].original, "<b>k120</b>", "截断只影响条数，倒序不变");
});

test("列表消息: 真实命中后再次查询能看到该条目（与翻译命中路径同一份库）", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>你好</p></html>"])],
  });
  await env.start(env.connect(), { text: "<p>hi</p>" }); // 未命中 → 上游 → 写入

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });

  assert.equal(response.ok, true);
  assert.equal(response.total, 1, "成功翻译写入的条目出现在列表里");
  assert.equal(response.entries[0].original, "<p>hi</p>", "原文即骨架 HTML（不含 <html> 包装）");
  assert.equal(response.entries[0].echo, "<html><p>你好</p></html>", "回显即原始回显（含包装）");
});

// ============================================================
// 命中次数（cache-inspection 票 02 / spec D8/D10–D13）：
// 真实命中在库内累加，列表消息把每条累计次数带给设置页。
// 接缝仍是「端口 start 消息 → 回发」与「runtime list-cache → 回应」，两者读同一份库。
// ============================================================

test("列表消息: 新写入条目次数为零，真实命中一次后回应里的次数为 1", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>你好</p></html>"])],
  });
  await env.start(env.connect(), { text: "<p>hi</p>" }); // 未命中 → 上游 → 写入

  const before = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });
  assert.equal(before.entries[0].hitCount, 0, "写入不算命中：新条目从零开始");

  const hit = env.connect();
  await env.start(hit, { text: "<p>hi</p>" }); // 真实命中回放
  assert.equal(env.fetchCalls.length, 1, "命中不发上游请求");
  assert.deepEqual(ofType(hit, "done"), [{ type: "done", cached: true }], "命中回放形态不变");

  const after = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });
  assert.equal(after.entries[0].hitCount, 1, "命中一次 → 次数 1（与回放同一份库）");
  assert.equal(after.entries[0].original, "<p>hi</p>");
});

test("列表消息: 未命中（走上游的真翻）不增加已有条目的次数", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>甲</p></html>"]), sseResponse(["<html><p>乙</p></html>"])],
  });
  await env.start(env.connect(), { text: "<p>a</p>" }); // 写入条目 a
  await env.start(env.connect(), { text: "<p>b</p>" }); // 未命中：新条目 b，不走 a

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });
  assert.deepEqual(
    response.entries.map((e) => [e.original, e.hitCount]),
    [
      ["<p>b</p>", 0],
      ["<p>a</p>", 0],
    ],
    "两条都是未命中写入：次数皆零，真翻不虚增统计",
  );
});

test("列表消息: 两次真实命中累计为 2，覆盖写（同轮重复请求回写）不清零", async () => {
  const env = await createBackgroundSandbox({
    responses: [sseResponse(["<html><p>初译</p></html>"])],
  });
  await env.start(env.connect(), { text: "<p>hi</p>" }); // 写入
  await env.start(env.connect(), { text: "<p>hi</p>" }); // 命中 → 1
  await env.start(env.connect(), { text: "<p>hi</p>" }); // 命中 → 2

  // 直接覆盖写同一键（同轮并发请求各自的回写）：次数保留，回显与时间更新
  await seedStore(env).put(testFingerprint(), "<p>hi</p>", "<html><p>覆盖译</p></html>", 99);

  const response = await env.sendRuntimeMessage({ type: "list-cache", page: 1, pageSize: 20 });
  assert.equal(response.entries[0].hitCount, 2, "覆盖写保留已有次数");
  assert.equal(response.entries[0].echo, "<html><p>覆盖译</p></html>", "回显被覆盖");
  assert.equal(response.entries[0].lastUsedAt, 99, "时间被覆盖");
});
