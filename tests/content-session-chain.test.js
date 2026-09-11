// ============================================================
// 会话重用（票 03）content 侧集成测试（content-sandbox 基建）
//
// 被测接缝：chrome 消息（translate）与端口消息（delta / restart / done / error）
// → 端口 posted（content → background 的 start：text + 可选 history）与 DOM 输出。
// 覆盖：每槽一条链（并发 3 的 abcdef 归属）、失败段不进链、restart 清空失败尝试
// 的流式文本、重试不增 settle、关（缺省 / false）时 start 不带 history。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createContentSandbox } from "./helpers/content-sandbox.js";

// 显式安全块（沿用 host-discovery 测试约定：不依赖 jsdom UA 样式表）
const B = 'style="display:block"';

const HOSTS = ["a", "b", "c", "d", "e", "f"].map((k) => `<p ${B}>host ${k} english text</p>`);

// ============================================================
// 关 = 不变：不持链、start 不带 history 字段
// ============================================================

test("关 = 不变: reuseSession 缺省或 false 时 start 消息没有 history 字段", async () => {
  for (const stored of [{ concurrency: 1 }, { concurrency: 1, reuseSession: false }]) {
    const env = createContentSandbox({
      bodyHtml: `<p ${B}>alpha english host</p><p ${B}>beta english host</p>`,
      config: stored,
    });
    await env.send({ type: "translate" });
    assert.equal(env.ports.length, 1);
    assert.equal(
      "history" in env.ports[0].posted[0],
      false,
      `${JSON.stringify(stored)}：首段不带 history`,
    );

    env.ports[0].deliver("[{甲}]");
    await env.clock.settle();
    assert.equal(env.ports.length, 2, "首个宿主落定 → 取下一个");
    assert.equal(
      "history" in env.ports[1].posted[0],
      false,
      "关时不持链：后续段仍是链首形态（逐字节同现状）",
    );
    env.ports[1].deliver("[{乙}]");
    await env.clock.settle();
  }
});

// ============================================================
// 每槽一条链（spec D3）：abcdef 并发 3 → 槽 1 链 a→d→g…
// ============================================================

test("每槽一条链: abcdef 并发 3 → 槽 1 的第二段只带本槽首段历史（[{a}]）", async () => {
  const env = createContentSandbox({
    bodyHtml: HOSTS.join(""),
    config: { reuseSession: true, concurrency: 3 },
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3, "并发 3：首波 3 个端口");

  const heads = env.ports.map((p) => p.posted[0]);
  for (const m of heads) assert.equal("history" in m, false, "每槽首段 = 链首（不带 history）");

  // 首波逐个落定（落定即取下一个）：槽 1→d、槽 2→e、槽 3→f
  env.ports[0].deliver("[{a}]");
  await env.clock.settle();
  env.ports[1].deliver("[{b}]");
  await env.clock.settle();
  env.ports[2].deliver("[{c}]");
  await env.clock.settle();
  assert.equal(env.ports.length, 6, "首波全部落定 → 第二波 d/e/f 各占一槽");

  const second = env.ports.slice(3).map((p) => p.posted[0]);
  assert.deepEqual(
    second.map((m) => m.history),
    [
      [{ html: heads[0].text, echo: "[{a}]" }],
      [{ html: heads[1].text, echo: "[{b}]" }],
      [{ html: heads[2].text, echo: "[{c}]" }],
    ],
    "槽间互不相干：每段只带本槽上一个成功段的历史（纯数据对）",
  );
  assert.equal(second[0].text.includes("host d"), true, "槽 1 第二段 = d 的骨架 HTML");
  assert.equal(
    second[0].text.includes("host a"),
    false,
    "新段只带最新文本（a 的原文不在 text 里）",
  );
});

test("失败段不进链: b 失败 → e 的历史无 b，其余槽照常", async () => {
  const env = createContentSandbox({
    bodyHtml: HOSTS.join(""),
    config: { reuseSession: true, concurrency: 3 },
  });
  await env.send({ type: "translate" });
  const heads = env.ports.map((p) => p.posted[0]);

  env.ports[0].deliver("[{a}]");
  await env.clock.settle();
  env.ports[1].emit({ type: "error", message: "HTTP 500 boom" });
  await env.clock.settle();
  env.ports[2].deliver("[{c}]");
  await env.clock.settle();
  assert.equal(env.ports.length, 6, "失败的段同样落定并释放槽位");

  assert.deepEqual(
    env.ports[3].posted[0].history,
    [{ html: heads[0].text, echo: "[{a}]" }],
    "b 的失败不影响槽 1 的链",
  );
  assert.equal(
    "history" in env.ports[4].posted[0],
    false,
    "b 失败段不进链 → e 的链为空，回到链首形态",
  );
  assert.deepEqual(env.ports[5].posted[0].history, [{ html: heads[2].text, echo: "[{c}]" }]);
});

test("失败段不进链: 同一槽 success → error → success，链只含成功段", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>slot x english text</p>` +
      `<p ${B}>slot y english text</p>` +
      `<p ${B}>slot z english text</p>`,
    config: { reuseSession: true, concurrency: 1 },
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);
  const xHtml = env.ports[0].posted[0].text;

  env.ports[0].deliver("[{x}]");
  await env.clock.settle();
  env.ports[1].emit({ type: "error", message: "boom" });
  await env.clock.settle();
  assert.equal(env.ports.length, 3, "三段同槽串行");

  assert.deepEqual(
    env.ports[2].posted[0].history,
    [{ html: xHtml, echo: "[{x}]" }],
    "y 失败不留历史：z 的历史里只有 x",
  );
});

// ============================================================
// restart（bg → content 的控制消息）：失败尝试的流式文本作废
// ============================================================

test("restart: 清空失败尝试的预览；定稿与入链回显只含重试那次；不增 settle", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>first english host</p><p ${B}>second english host</p>`,
    config: { reuseSession: true, concurrency: 1 },
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);
  const firstHtml = env.ports[0].posted[0].text;

  // 第一次尝试：模型吐了一堆包装外的废话（形态不符，background 会重试）
  env.ports[0].emit({ type: "delta", text: "Sure! Here is the translation: " });
  await env.clock.settle();
  const node = env.body.querySelector(".translate-node");
  assert.equal(
    node.textContent,
    "Sure! Here is the translation: ",
    "失败尝试的流式文本先上屏（宽容预览是纵深防御）",
  );

  // background 宣布本轮尝试作废、重开一轮
  env.ports[0].emit({ type: "restart" });
  await env.clock.settle();
  assert.equal(node.textContent, "", "restart 清空累积回显（失败尝试的文本不进最终渲染）");

  env.ports[0].emit({ type: "delta", text: "<html>甲段译文</html>" });
  env.ports[0].emit({ type: "done" });
  await env.clock.settle();
  assert.equal(node.textContent, "甲段译文", "定稿只含重试那次");
  assert.equal(node.textContent.includes("Sure"), false, "失败尝试的文本不残留");

  // 重试成功段进链：它是本槽的新链首，下一段的历史恰含它（且不含失败尝试的文本）
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "50% 1/2(2)", "重试不占额外 settle：分子 +1、无错误括号");
  assert.equal(env.ports.length, 2);
  assert.deepEqual(env.ports[1].posted[0].history, [
    { html: firstHtml, echo: "<html>甲段译文</html>" },
  ]);
});

test("重试成功段成新链首: restart 弃掉本槽已累积的链，其后段以它为链首继续", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>first slot english text</p>` +
      `<p ${B}>second slot english text</p>` +
      `<p ${B}>third slot english text</p>`,
    config: { reuseSession: true, concurrency: 1 },
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);
  const firstHtml = env.ports[0].posted[0].text;

  env.ports[0].deliver("[{一}]");
  await env.clock.settle();

  // 第二段：带着第一段的历史出发，第一次尝试漂移（background 会重试）
  const second = env.ports[1].posted[0];
  assert.deepEqual(second.history, [{ html: firstHtml, echo: "[{一}]" }], "前提：第二段带旧链");
  env.ports[1].emit({ type: "delta", text: "drifted reply " });
  env.ports[1].emit({ type: "restart" });
  env.ports[1].emit({ type: "delta", text: "<html>第二段译文</html>" });
  env.ports[1].emit({ type: "done" });
  await env.clock.settle();

  // 第三段：以重试成功段为链首（漂移前的旧链不再带回）
  assert.equal(env.ports.length, 3);
  assert.deepEqual(
    env.ports[2].posted[0].history,
    [{ html: second.text, echo: "<html>第二段译文</html>" }],
    "重试成功段成为新链首：它之后的段以它为链首继续累积",
  );
  assert.equal(
    env.body.querySelectorAll(".translate-node")[1].textContent,
    "第二段译文",
    "失败尝试的漂移文本不入 DOM",
  );
});

test("restart: 落定之后到达不改变 DOM（迟到控制消息无副作用）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>late control english host</p>`,
    config: { reuseSession: true, concurrency: 1 },
  });
  await env.send({ type: "translate" });
  env.ports[0].deliver("<html>甲</html>");
  await env.clock.settle();
  const node = env.body.querySelector(".translate-node");
  assert.equal(node.textContent, "甲");

  env.ports[0].emit({ type: "restart" });
  env.ports[0].emit({ type: "delta", text: "迟到文本" });
  await env.clock.settle();
  assert.equal(node.textContent, "甲", "落定后的迟到控制消息与增量都不上屏");
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "100% 1/1(1) 0(0)s",
    "落定计数不变",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

// ============================================================
// 空回显：不进链（维持既有「未返回译文」口径）
// ============================================================

test("空回显不进链: 零 delta 与 <html></html> 都不留历史", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>empty echo english one</p>` +
      `<p ${B}>empty echo english two</p>` +
      `<p ${B}>empty echo english three</p>`,
    config: { reuseSession: true, concurrency: 1 },
  });
  await env.send({ type: "translate" });

  env.ports[0].emit({ type: "done" }); // 零 delta：空回显
  await env.clock.settle();
  assert.equal("history" in env.ports[1].posted[0], false, "空回显不进链");
  env.ports[1].deliver("<html></html>"); // 空壳包装：剥壳后同样为空
  await env.clock.settle();
  assert.equal("history" in env.ports[2].posted[0], false, "空壳包装回显也不进链");

  const paras = env.body.querySelectorAll("p");
  for (let i = 0; i < 2; i++) {
    assert.equal(
      paras[i].querySelector(".translate-node").textContent,
      "翻译失败: 未返回译文",
      `宿主 ${i} 走既有未返回译文口径`,
    );
  }
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "66% 2/3(3)(2)",
    "两段空回显各计一次失败落定（无额外计数）",
  );
});
