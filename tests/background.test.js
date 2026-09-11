// ============================================================
// background（service worker）集成测试（票 03：会话链与双触发器重试）
//
// 被测接缝：content → background 的 start 消息（text + 可选 history）→
// 上游 fetch 请求体（messages 组装）与 bg → content 的回发消息
// （delta / restart / done / error）。
// 全部走 tests/helpers/background-sandbox.js 基建（chrome/fetch/端口替身）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  createBackgroundSandbox,
  sseResponse,
  httpErrorResponse,
  ofType,
} from "./helpers/background-sandbox.js";
import { DEFAULT_PROMPT_TEMPLATE, isHostWrapped, renderPrompt, wrapHost } from "../src/prompt.js";

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
    responses: [sseResponse(["<html>甲</html>"]), sseResponse(["<html>乙</html>"])],
  });
  for (const history of [[], "junk", [{ html: "<p>a</p>" }], [null]]) {
    const port = env.connect();
    await env.start(port, { text: "<p>x</p>", history });
    const messages = env.fetchCalls.at(-1).body.messages;
    assert.equal(messages.length, 1, `history=${JSON.stringify(history)} → 链首形态`);
  }
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
