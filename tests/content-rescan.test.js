// ============================================================
// 集成测试（content-rescan harness：重扫调度 + 宿主即请求协议）
//
// 被测接缝：chrome 消息与端口输入（translate/revert、流式 delta、done）
// → DOM 输出（译文容器出现与否、端口数=请求数、在途端口峰值、
// 沙箱时钟排队计时器数）。全部走 tests/helpers/content-sandbox.js 基建
// （jsdom 全量 content script + mock 单宿主请求端口 + 元素几何补丁
// + 手动时钟 + 可选存储配置覆盖）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createContentSandbox } from "./helpers/content-sandbox.js";

// 显式安全块（沿用 host-discovery 测试约定：不依赖 jsdom UA 样式表）
const B = 'style="display:block"';

// ============================================================
// 宿主即请求协议（ADR-0005）：一宿主一端口请求，无 [N] 标记
// ============================================================

test("协议: 一次 translate = N 个宿主各一次独立端口请求，载荷为单宿主文本", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>first english paragraph</p>` +
      `<p ${B}>second english paragraph</p>` +
      `<p ${B}>third english paragraph</p>`,
  });
  await env.send({ type: "translate" });

  assert.equal(env.ports.length, 3, "3 个宿主 = 3 个独立端口请求");
  const texts = ["first english paragraph", "second english paragraph", "third english paragraph"];
  for (let i = 0; i < env.ports.length; i++) {
    const starts = env.ports[i].posted.filter((m) => m.type === "start");
    assert.equal(starts.length, 1, `端口 ${i} 恰好一条 start 消息`);
    assert.equal(typeof starts[0].text, "string", "start 载荷为单宿主字符串（非数组）");
    assert.ok(!Array.isArray(starts[0].texts), "无条目数组协议残留");
    assert.ok(starts[0].text.includes(texts[i]), `端口 ${i} 载荷为宿主 ${i} 的骨架 HTML`);
  }

  // 无标记协议：回显全文即译文（deliver 不带 [N] 前缀）
  env.ports[0].deliver("第一段译文");
  env.ports[1].deliver("第二段译文");
  env.ports[2].deliver("第三段译文");
  await env.clock.settle();
  const paras = env.body.querySelectorAll("p");
  for (let i = 0; i < 3; i++) {
    assert.equal(
      paras[i].querySelector(".translate-node").textContent,
      `第${["一", "二", "三"][i]}段译文`,
    );
  }
});

test("协议: 流式 delta 直通剥标签纯文本预览，done 定稿净化写入；空回显报未返回译文", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>hello <b>world</b> english</p><p ${B}>quiet host english</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 2);

  // 流式中途：剥标签纯文本预览（无子元素）
  env.ports[0].emit({ type: "delta", text: "你好 <b>世界</b>" });
  await env.clock.settle();
  const node = env.body.querySelectorAll("p")[0].querySelector(".translate-node");
  assert.equal(node.textContent, "你好 世界", "流式预览为剥标签纯文本");
  assert.equal(node.firstElementChild, null, "预览期无子元素");

  // done 定稿：净化后含标签 HTML 写入
  env.ports[0].emit({ type: "done" });
  await env.clock.settle();
  assert.equal(node.innerHTML, "你好 <b>世界</b>", "done 定稿写入含标签 HTML");

  // 空回显（零 delta 直接 done）：标记未返回译文
  env.ports[1].emit({ type: "done" });
  await env.clock.settle();
  const empty = env.body.querySelectorAll("p")[1].querySelector(".translate-node");
  assert.equal(empty.textContent, "翻译失败: 未返回译文");
});

// ============================================================
// 净化空结果 → 译文节点移除（工单 01 渲染联动）
// ============================================================

test("净化空结果: 回显全被清空时译文节点整节点移除，不留空壳容器", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>empty echo english host one</p>` +
      `<p ${B}>kept echo english host two</p>` +
      `<p ${B}>empty echo english host three</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);

  // 首宿主：定稿回显为可整体清空的纯空白空壳链 → 净化后为空 → 节点移除
  env.ports[0].deliver("<p> </p>");
  env.ports[1].deliver("正常译文内容");
  // 尾宿主：回显只有空白块空壳（模型输出的空行结构）→ 净化后同样为空
  env.ports[2].deliver("<p>\n\n  \n</p><div> </div>");
  await env.clock.settle();

  const paras = env.body.querySelectorAll("p");
  assert.equal(paras.length, 3, "三个宿主原文原样保留");
  assert.equal(
    paras[0].querySelectorAll(".translate-node").length,
    0,
    "空壳回显宿主：译文容器被移除，不留空壳",
  );
  assert.equal(
    paras[1].querySelector(".translate-node").textContent,
    "正常译文内容",
    "正常回显宿主不受影响",
  );
  assert.equal(
    paras[2].querySelectorAll(".translate-node").length,
    0,
    "空白回显宿主：无可见内容，同样移除译文容器",
  );

  // 无残留：无孤立译文容器、调度收敛
  assert.equal(env.body.querySelectorAll(".translate-node").length, 1, "仅正常宿主有译文容器");
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "无在途计时器");
});

test("净化空结果: 宿主登记同步清除——页面内容更新后该宿主可被重新翻译", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>initial english host text</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);

  env.ports[0].deliver("<p></p>"); // 定稿净化为空 → 译文容器移除
  await env.clock.settle();
  assert.equal(env.body.querySelectorAll(".translate-node").length, 0, "空回显译文容器被移除");
  await env.clock.advance(600); // 容器移除触发的防抖到期收敛

  // 宿主内容更新（新增子节点）→ 该宿主仍可再次发起请求并正常落译文
  const host = env.body.querySelector("p");
  host.insertAdjacentHTML("beforeend", ` <span ${B}>updated english content</span>`);
  await env.clock.settle();
  await env.clock.advance(500);
  assert.equal(env.ports.length, 2, "登记清除后内容更新触发重新翻译（修复前红：登记残留则无请求）");

  env.ports[1].deliver("更新的译文");
  await env.clock.settle();
  assert.equal(
    env.body.querySelector(".translate-node").textContent,
    "更新的译文",
    "重新翻译的译文正常落容器",
  );
});

// ============================================================
// 流式预览不做空白处理（工单 02：防流式跳闪语义回归）
// ============================================================

test("工单02: 流式预览原样上屏不做空白处理，定稿净化才清首尾（不粘连、防跳闪）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>whitespace echo english host</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);

  // 流式途中：带前导/尾部换行的回显原样上屏——预览期不 trim、不折叠
  // （若预览就清理，文字会在流式期间跳闪，这正是 spec 禁止预览 trim 的原因）
  const raw = "\n\n第一段\n  第二行\n";
  env.ports[0].emit({ type: "delta", text: raw });
  await env.clock.settle();
  const node = env.body.querySelector(".translate-node");
  assert.equal(node.textContent, raw, "流式预览不做空白处理：首尾换行原样显示");

  // 定稿：stripHostWrapper 整体 trim + 净化闸门块边界清首尾 → 只剩正文，
  // 文本节点中部换行保留（不压缩）
  env.ports[0].emit({ type: "done" });
  await env.clock.settle();
  assert.equal(node.innerHTML, "第一段\n  第二行", "定稿清理首尾空白，中部换行保留");
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "无在途计时器");
});

test("并发池: 同时在途端口数不超过配置上限（超出的宿主排队等待）", async () => {
  const env = createContentSandbox({
    bodyHtml: [1, 2, 3, 4, 5].map((i) => `<p ${B}>english paragraph number ${i}</p>`).join(""),
    config: { concurrency: 2 },
  });
  await env.send({ type: "translate" });
  await env.clock.settle();

  assert.equal(env.ports.length, 2, "并发上限 2：前 2 宿主在途，第 3 个排队");
  assert.equal(env.inflightPorts(), 2, "恰好 2 个在途端口");
  assert.equal(env.body.querySelectorAll(".translate-node").length, 2, "排队宿主尚无译文容器");

  // 完成一个 → 排队宿主立即获得端口发起请求
  env.ports[0].deliver("译文一");
  await env.clock.settle();
  assert.equal(env.ports.length, 3, "首个完成后下一个宿主发起请求");
  assert.equal(env.inflightPorts(), 2, "在途仍不超过上限");

  env.ports[1].deliver("译文二");
  env.ports[2].deliver("译文三");
  await env.clock.settle();
  assert.equal(env.ports.length, 5, "剩余宿主逐个补位发起");
  env.ports[3].deliver("译文四");
  env.ports[4].deliver("译文五");
  await env.clock.settle();

  assert.equal(env.inflightPorts(), 0, "全部完成后无在途");
  assert.equal(env.peakInflightPorts(), 2, "在途端口峰值恰为并发上限 2，从未超出");
  assert.equal(env.body.querySelectorAll(".translate-node").length, 5, "5 个宿主全部获得译文");
});

test("失败粒度: 单请求失败只标记该宿主，其余宿主照常完成", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>alpha english text</p>` +
      `<p ${B}>beta english text</p>` +
      `<p ${B}>gamma english text</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);

  env.ports[1].emit({ type: "error", message: "HTTP 500 boom" });
  env.ports[0].deliver("甲的译文");
  env.ports[2].deliver("丙的译文");
  await env.clock.settle();

  const paras = env.body.querySelectorAll("p");
  assert.equal(
    paras[0].querySelector(".translate-node").textContent,
    "甲的译文",
    "宿主 0 照常完成",
  );
  assert.equal(
    paras[2].querySelector(".translate-node").textContent,
    "丙的译文",
    "宿主 2 照常完成",
  );

  const failed = paras[1].querySelector(".translate-node");
  assert.equal(failed.textContent, "翻译失败: HTTP 500 boom", "失败宿主显示斜体错误信息");
  assert.equal(failed.style.fontStyle, "italic");

  // 错误标记持久：不被仍在走动的加载动画覆盖
  await env.clock.advance(1000);
  assert.equal(
    paras[1].querySelector(".translate-node").textContent,
    "翻译失败: HTTP 500 boom",
    "错误信息不被动画覆盖",
  );
});

// ============================================================
// 重扫调度（既有回归：忙则重试、防抖合并、展开属性监听）
// ============================================================

test("回归: 翻译流式进行中注入新宿主节点 → 初请求结束后被补翻（修复前红）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>first english paragraph here</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1, "初始宿主恰一次请求");
  const first = env.ports[0];

  // 流式中途：部分 delta 已到，请求未完成（翻译进行中）
  first.emit({ type: "delta", text: "第一段的中文" });

  // 初请求仍在流式时，页面动态新增英文宿主（观察器微任务挂上防抖）
  env.body.insertAdjacentHTML("beforeend", `<p ${B}>second dynamic english paragraph</p>`);
  await env.clock.settle(); // 等观察器回调挂上防抖（此刻沙箱时间仍为 0）

  // 防抖到期，翻译仍在进行中：修复前静默丢弃，修复后重新排队
  await env.clock.advance(500);
  const p2 = env.body.querySelectorAll("p")[1];
  assert.equal(p2.querySelector(".translate-node"), null, "初请求未完，新宿主尚无译文容器");

  // 放行初请求完成 → 翻译结束，排队中的重扫应获得执行
  first.emit({ type: "delta", text: "译文" });
  first.emit({ type: "done" });
  await env.clock.settle(); // 初请求 Promise 链走完，translating 归位
  await env.clock.advance(1000);

  assert.equal(env.ports.length, 2, "初请求结束后应对新宿主发起补翻请求");
  env.ports[1].deliver("第二段的中文译文");
  await env.clock.settle();

  const nodes = p2.querySelectorAll(".translate-node");
  assert.equal(nodes.length, 1, "新宿主恰好一个译文容器");
  assert.equal(nodes[0].textContent, "第二段的中文译文");
});

test("收敛: 流式期间高频新增经防抖合并为一次重扫，页面静止后无空扫无请求风暴", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>alpha beta gamma text</p>`,
  });
  await env.send({ type: "translate" });
  const first = env.ports[0];
  first.emit({ type: "delta", text: "阿尔法" }); // 停在流式中途

  // 流式期间连续注入 5 个新宿主（每次间隔 50ms，均在 500ms 防抖窗口内）
  for (let i = 0; i < 5; i++) {
    env.body.insertAdjacentHTML("beforeend", `<p ${B}>extra english content number ${i}</p>`);
    await env.clock.advance(50);
  }
  await env.clock.advance(600); // 防抖到期：翻译进行中 → 忙则重试排队

  first.emit({ type: "done" }); // 初请求完成，翻译结束
  await env.clock.settle();
  await env.clock.advance(700); // 排队中的重扫执行

  assert.equal(env.ports.length, 6, "初请求 1 + 5 个新宿主各一次补翻请求（防抖合并为一轮重扫）");
  for (let k = 1; k <= 5; k++) env.ports[k].deliver(`第${k}条译文`);
  await env.clock.settle();

  // 每个新宿主恰好一个译文容器
  const paras = env.body.querySelectorAll("p");
  for (let i = 1; i < paras.length; i++) {
    assert.equal(
      paras[i].querySelectorAll(".translate-node").length,
      1,
      `宿主 ${i} 恰一个译文容器`,
    );
  }

  // 页面静止且翻译全部结束：长时间推进不再产生任何请求（无请求风暴、
  // 无持续空扫），调度队列清空（无在途防抖/动画计时器）
  const portCountAtRest = env.ports.length;
  await env.clock.advance(10000);
  assert.equal(env.ports.length, portCountAtRest, "静止后不再产生新请求端口");
  assert.equal(env.clock.pending(), 0, "调度收敛：无在途计时器");
});

test("安全边界: 会话外页面变化绝不触发翻译（未开始 / 还原后），还原清理调度", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>session host english text</p>`,
  });

  // 会话从未开始：新增英文宿主 + 长时间推进 → 零请求、零译文容器
  env.body.insertAdjacentHTML("beforeend", `<p ${B}>outside session english host</p>`);
  await env.clock.advance(5000);
  assert.equal(env.ports.length, 0, "会话未开始：不发起任何请求");
  assert.equal(env.body.querySelectorAll(".translate-node").length, 0);

  // 会话中翻译两个既有宿主（各自独立请求）
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 2, "两个宿主各一次独立请求");
  env.ports[0].deliver("译文甲");
  env.ports[1].deliver("译文乙");
  await env.clock.settle();
  assert.equal(env.body.querySelectorAll(".translate-node").length, 2);

  // 会话活跃期内再新增节点（防抖挂起中），随后「还原」
  env.body.insertAdjacentHTML("beforeend", `<p ${B}>after revert english host</p>`);
  await env.send({ type: "revert" });

  // 还原后：监听与调度清理干净——长时间推进不触发翻译，页面无译文容器
  await env.clock.advance(5000);
  assert.equal(env.ports.length, 2, "还原后页面变化不产生新请求");
  assert.equal(env.body.querySelectorAll(".translate-node").length, 0, "还原后页面无任何译文容器");
  assert.equal(env.clock.pending(), 0, "还原后调度清理干净");

  // 再次翻译可正常重启会话（观察器随翻译重建）：3 个宿主 = 3 次独立请求
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 5, "还原后再翻译正常发起新请求（3 宿主）");
  env.ports[2].deliver("新译文甲");
  env.ports[3].deliver("新译文乙");
  env.ports[4].deliver("新译文丙");
  await env.clock.settle();
  assert.equal(env.body.querySelectorAll(".translate-node").length, 3);
});

// ============================================================
// 展开属性监听（display/class/details 切换式展开也触发翻译）
// ============================================================

test("回归: 对已存在但隐藏的英文块移除 hidden 属性（无节点新增）→ 触发翻译（修复前红）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>visible english paragraph one</p><p hidden>hidden english paragraph two</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1, "隐藏块初始不可见：仅可见宿主一次请求");
  env.ports[0].deliver("第一段译文");
  await env.clock.settle();

  const hidden = env.body.querySelectorAll("p")[1];
  assert.equal(hidden.querySelector(".translate-node"), null, "隐藏块初始无译文容器");

  // 翻译完成后展开折叠面板：移除 hidden 属性，页面无任何节点新增
  hidden.removeAttribute("hidden");
  await env.clock.settle(); // 观察器微任务挂上防抖（此刻沙箱时间仍为 0）
  await env.clock.advance(500); // 防抖到期 → 重扫

  assert.equal(env.ports.length, 2, "属性展开触发补翻请求（修复前红：仅 childList 监听不触发）");
  env.ports[1].deliver("第二段译文");
  await env.clock.settle();

  const nodes = hidden.querySelectorAll(".translate-node");
  assert.equal(nodes.length, 1, "展开宿主恰好一个译文容器");
  assert.equal(nodes[0].textContent, "第二段译文");
});

test("过滤: 译文容器子树内的属性变化被忽略，不触发重扫", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>english paragraph with <code>code bit</code> inside</p>`,
  });
  await env.send({ type: "translate" });
  env.ports[0].deliver("译文带 <code>代码片段</code> 标记");
  await env.clock.settle();

  const node = env.body.querySelector(".translate-node");
  assert.ok(node, "宿主有译文容器");
  assert.ok(node.querySelector("code"), "译文容器内含子元素");

  // 放空既有防抖队列（净化插入容器内子元素至多触发一次收敛的空扫，
  // 不产生新请求），拿到干净的计时器基线
  await env.clock.advance(600);
  assert.equal(env.ports.length, 1, "基线：译文容器内插入子元素不产生新请求");
  assert.equal(env.clock.pending(), 0, "基线：防抖收敛后无在途计时器");

  // 译文容器自身与其子树内的高频属性抖动（class/style 均在过滤器内）：
  // 未被忽略时防抖计时器会挂起（pending>0），被忽略则始终无排队
  for (let i = 0; i < 8; i++) {
    node.classList.toggle("jitter");
    node.style.opacity = i % 2 ? "0.9" : "1";
    node.firstElementChild.classList.toggle("hl");
    await env.clock.settle();
    assert.equal(env.clock.pending(), 0, `第 ${i} 次抖动后无防抖排队`);
  }

  // 过滤器之外的属性（title/data-* 等非展开类）不触发重扫
  env.body.firstElementChild.setAttribute("title", "hover tooltip text");
  env.body.firstElementChild.setAttribute("data-state", "x1");
  await env.clock.settle();
  assert.equal(env.clock.pending(), 0, "过滤器外属性不排队防抖");

  await env.clock.advance(2000); // 足够防抖多次到期的时间
  assert.equal(env.ports.length, 1, "译文容器子树属性变化不产生任何新请求");
  assert.equal(env.clock.pending(), 0, "调度收敛：无在途计时器");
});

test("风暴: class/style 高频抖动夹一次展开，经防抖合并为一次补翻，静止后收敛", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>first english paragraph here</p><p hidden>panel english content hidden</p>`,
  });
  await env.send({ type: "translate" });
  env.ports[0].deliver("首段译文");
  await env.clock.settle();

  // 高频抖动（动画密集站点）：每 50ms 翻转已翻宿主的 class/style，
  // 中间夹一次展开（移除 hidden）；全部落在 500ms 防抖窗口内滚动
  const firstHost = env.body.firstElementChild;
  const panel = env.body.querySelectorAll("p")[1];
  for (let i = 0; i < 10; i++) {
    firstHost.classList.toggle("anim");
    firstHost.style.opacity = i % 2 ? "0.6" : "1";
    if (i === 5) panel.removeAttribute("hidden");
    await env.clock.advance(50);
  }
  await env.clock.advance(1000); // 抖动停止后防抖到期 → 执行重扫

  assert.equal(env.ports.length, 2, "高频抖动经防抖合并：展开宿主只产生一次补翻请求");
  env.ports[1].deliver("面板译文");
  await env.clock.settle();
  assert.equal(panel.querySelectorAll(".translate-node").length, 1, "展开宿主恰好一个译文容器");
  assert.equal(firstHost.querySelectorAll(".translate-node").length, 1, "已翻宿主译文容器不丢失");

  // 页面静止：长时间推进不产生请求风暴，调度队列清空
  const atRest = env.ports.length;
  await env.clock.advance(10000);
  assert.equal(env.ports.length, atRest, "静止后不再产生新请求端口");
  assert.equal(env.clock.pending(), 0, "调度收敛：无在途计时器");
});

// ============================================================
// 消息入口唯一性（工单 05 换轨回归）
// ============================================================

test("入口唯一: 会话不自注册 onMessage，派发权只属加载器（双份监听回归）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>single entry english host</p>`,
  });

  // 会话就绪即断言：加载器已注册监听并负责转发，会话不得再挂一份——
  // 否则就绪后每条消息被处理两次、sendResponse 调用两次（Chrome 只接受
  // 第一次，第二次在内容脚本控制台报错），且日志翻倍。
  assert.equal(env.selfRegisteredListeners(), 0, "会话不得自注册 onMessage 监听");

  // 唯一入口仍能正常工作：一条 translate 消息 = 一个宿主一次请求
  const reply = await env.send({ type: "translate" });
  assert.deepEqual(reply, { ok: true }, "加载器派发的消息得到唯一回应");
  assert.equal(env.ports.length, 1, "一个宿主恰好一次请求（无重复派发）");
});

// ============================================================
// 进度徽标（工单 01：模块与会话生命周期）——消息/端口输入 → 徽标 DOM 输出；
// 断言只落在文档里的徽标元素上（文本/样式/挂载位置），不断言模块内部计数器
// ============================================================

test("徽标: 翻译消息路径会话开启成功后上屏，初始进度 0% 0/1(1)，样式内联硬编码", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>progress badge english host</p>`,
  });
  await env.send({ type: "translate" });

  const badge = env.body.querySelector(".translate-progress");
  assert.ok(badge, "会话开启成功后徽标上屏（修复前红：无徽标元素）");
  assert.equal(env.body.querySelectorAll(".translate-progress").length, 1, "恰好一枚徽标");
  assert.equal(badge.parentElement, env.body, "徽标挂在 document.body 下");
  assert.equal(
    badge.textContent,
    "0% 0/1(1)",
    "宿主进分母后的初始进度：发现出口按档计分母，1 宿主 → 0/1（total=0 的零态由空页面用例覆盖）",
  );

  // 样式内联硬编码（不看外部样式表、不用 Shadow DOM）：fixed 右下角、半透明深底
  // 浅字、小号等宽、圆角、pointer-events: none、最高档 z-index
  assert.equal(badge.style.position, "fixed", "fixed 定位");
  assert.equal(badge.style.right, "12px", "贴视口右下角");
  assert.equal(badge.style.bottom, "12px", "贴视口右下角");
  assert.equal(badge.style.zIndex, "2147483647", "最高档 z-index");
  assert.equal(badge.style.backgroundColor, "rgba(20, 20, 20, 0.75)", "半透明深底");
  assert.equal(badge.style.color, "rgb(238, 238, 238)", "浅字");
  assert.equal(badge.style.fontSize, "12px", "小号字");
  assert.ok(badge.style.fontFamily.includes("monospace"), "等宽数字字体");
  assert.notEqual(badge.style.borderRadius, "", "圆角");
  assert.equal(badge.style.pointerEvents, "none", "不拦截鼠标");
  assert.equal(badge.shadowRoot, null, "不用 Shadow DOM");

  env.ports[0].deliver("徽标测试译文");
  await env.clock.settle();
});

test("徽标: 还原后随译文一起移除；再次翻译可重新挂载并回到零态", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>badge lifecycle english host</p>`,
  });
  await env.send({ type: "translate" });
  assert.ok(env.body.querySelector(".translate-progress"), "翻译后徽标上屏");

  env.ports[0].deliver("还原前译文");
  await env.clock.settle();
  await env.send({ type: "revert" });
  assert.equal(env.body.querySelector(".translate-progress"), null, "还原后徽标从文档移除");
  assert.equal(env.body.querySelectorAll(".translate-node").length, 0, "译文节点一并清除");
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "还原后调度清理干净");

  // 再次翻译：徽标重新挂载（新元素、计数已清零的初始进度文案）
  await env.send({ type: "translate" });
  assert.equal(env.body.querySelectorAll(".translate-progress").length, 1, "再次翻译重新挂载");
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "0% 0/1(1)",
    "重挂载回到初始进度（计数已清零：不残留上次的分子/分母/错误）",
  );
  env.ports[1].deliver("重挂载译文");
  await env.clock.settle();
});

test("徽标: 会话已活跃时重复「翻译」不重复挂载（拒绝重入）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>reentrant translate english host</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.body.querySelectorAll(".translate-progress").length, 1);

  // 翻译进行中重复「翻译」：会话拒绝重入，徽标不重复挂载、不产生新请求
  await env.send({ type: "translate" });
  assert.equal(
    env.body.querySelectorAll(".translate-progress").length,
    1,
    "在途重复翻译不重复挂载",
  );
  assert.equal(env.ports.length, 1, "在途重复翻译不产生新请求");

  env.ports[0].deliver("重入测试译文");
  await env.clock.settle();

  // 会话已开启（翻译已结束但会话仍活跃）时重复「翻译」同样被拒
  await env.send({ type: "translate" });
  assert.equal(
    env.body.querySelectorAll(".translate-progress").length,
    1,
    "会话活跃期重复翻译不重复挂载",
  );
  assert.equal(env.ports.length, 1, "会话活跃期重复翻译不产生新请求");
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0);
});

test("徽标: 页面只剩徽标可扫也不产生端口请求，挂载自身不排防抖", async () => {
  const env = createContentSandbox({ bodyHtml: "" }); // 空页面：唯一可扫对象就是徽标自身
  await env.send({ type: "translate" });

  const badge = env.body.querySelector(".translate-progress");
  assert.ok(badge, "空页面翻译：徽标仍上屏");
  await env.clock.settle();
  // 徽标挂载是自身注入物：不排防抖（修复前红：挂载被当成页面新内容排一轮防抖）
  assert.equal(env.clock.pending(), 0, "徽标上屏不排防抖");

  // 页面只剩徽标（body 无其他元素）：长时间推进不产生任何端口请求、调度收敛
  await env.clock.advance(10000);
  assert.equal(env.ports.length, 0, "徽标永不成为宿主（硬跳过），无请求端口");
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标: 自身 DOM 变化不触发重扫——文本/属性抖动不排防抖、不产生端口", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>badge jitter english host</p>`,
  });
  await env.send({ type: "translate" });
  env.ports[0].deliver("抖动测试译文");
  await env.clock.settle();
  await env.clock.advance(600); // 放空既有防抖队列，拿干净基线

  const badge = env.body.querySelector(".translate-progress");
  assert.ok(badge, "徽标在屏");
  assert.equal(env.ports.length, 1, "基线：无新请求");
  assert.equal(env.clock.pending(), 0, "基线：无在途计时器");

  // 徽标自身高频抖动（进度重渲染的文本替换 + class/style 属性变化）
  // 均在扩展注入物忽略范围内：不排防抖（修复前红：属性变化被当页面变化排队）
  for (let i = 0; i < 8; i++) {
    badge.textContent = `0% 0/0(${i})`; // 模拟模块重渲染
    badge.classList.toggle("jitter");
    badge.style.opacity = i % 2 ? "0.9" : "1";
    await env.clock.settle();
    assert.equal(env.clock.pending(), 0, `第 ${i} 次徽标抖动后无防抖排队`);
  }

  await env.clock.advance(2000);
  assert.equal(env.ports.length, 1, "徽标自身变化不产生任何新请求");
  assert.equal(env.clock.pending(), 0, "调度收敛：无在途计时器");
});

// ============================================================
// 进度徽标计数接线（工单 02）——宿主发现出口按档计数进分母/括号，
// 端口流程 settle 唯一收口计数落定与错误（每宿主恰好一次，无第二条路径）
// ============================================================

test("徽标计数: 混合档位页分母排除边缘档、括号内为全部宿主数（正文 2 + 边缘 1 → 0/2(3)）", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<main ${B}><p ${B}>main prose english one</p><p ${B}>main prose english two</p></main>` +
      `<footer ${B}><p ${B}>footer english line</p></footer>`,
  });
  await env.send({ type: "translate" });

  // 3 个宿主全部发起请求（边缘档只排到队尾，仍会被翻译）
  assert.equal(env.ports.length, 3, "正文 2 + 边缘 1 = 3 个端口请求");
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/2(3)", "分母排除边缘档（档 2）宿主；括号内为全部宿主数");

  env.ports[0].deliver("正文一译文");
  env.ports[1].deliver("正文二译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3)",
    "正文两宿主全部落定 → 100%（边缘档未落定不拖累，也不计入分子）",
  );

  // 边缘档宿主落定：不计分子、不显示错误（决策：错误括号口径为全部档位）
  env.ports[2].deliver("页脚译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3) 0(0)s",
    "边缘档落定不动分子——100% 是完成确认，不因队尾宿主上冲；此刻全部落定 → 追加耗时读数（时钟未推进 → 0(0)s）",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: 每宿主流落定分子 +1，百分比向下取整（1/3 → 33%，全落定才 100%）", async () => {
  const env = createContentSandbox({
    bodyHtml: [1, 2, 3].map((i) => `<p ${B}>progress english paragraph ${i}</p>`).join(""),
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/3(3)", "零态：分母 3");

  env.ports[0].deliver("第一段译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "33% 1/3(3)", "1/3 向下取整 → 33%");

  env.ports[1].deliver("第二段译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "66% 2/3(3)", "2/3 向下取整 → 66%");

  env.ports[2].deliver("第三段译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "100% 3/3(3) 0(0)s", "全部落定 → 100% 且追加耗时读数");

  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: error 消息路径分子 +1、错误括号出现且计数正确；无错误时错误括号不显示", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>error path english host alpha</p>` +
      `<p ${B}>error path english host beta</p>` +
      `<p ${B}>error path english host gamma</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/3(3)", "无错误：无错误括号");

  // error 消息路径：失败宿主也算落定（分子 +1），错误数 +1
  env.ports[1].emit({ type: "error", message: "HTTP 500 boom" });
  env.ports[0].deliver("甲译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "66% 2/3(3)(1)",
    "error 路径计入分子与错误数：错误括号出现且计数正确",
  );

  env.ports[2].deliver("丙译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 3/3(3)(1) 0(0)s",
    "含错误时进度仍可达 100%（出错的流也计入分子），错误数保持 1；全部落定后追加耗时读数",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: 连接意外中断计错误；正常定稿落定无错误（无第二条计数路径）", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>disconnect english host alpha</p>` +
      `<p ${B}>disconnect english host beta</p>` +
      `<p ${B}>disconnect english host gamma</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);
  const badge = env.body.querySelector(".translate-progress");

  env.ports[0].deliver("甲译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "33% 1/3(3)", "正常定稿落定：分子 +1、无错误括号");

  // 连接意外中断（远端断开，非本方 disconnect）：计错误、分子 +1
  env.ports[1].disconnectUnexpectedly();
  await env.clock.settle();
  assert.equal(badge.textContent, "66% 2/3(3)(1)", "连接中断算落定 + 错误（分子 +1、错误括号 +1）");

  env.ports[2].deliver("丙译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 3/3(3)(1) 0(0)s",
    "中断宿主计入分子：全部落定仍达 100%，错误数保持 1；追加耗时读数",
  );

  // 落定收口唯一性：settle 后再来消息/断开不重复计数
  env.ports[0].emit({ type: "error", message: "late error" });
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 3/3(3)(1) 0(0)s",
    "已落定端口的迟到消息不再计数（读数保持定格）",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: 空回显未返回译文算错误落定；净化空静默移除算落定不算错误、分子不回退", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<p ${B}>empty echo english host alpha</p>` +
      `<p ${B}>empty echo english host beta</p>` +
      `<p ${B}>empty echo english host gamma</p>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3);
  const badge = env.body.querySelector(".translate-progress");

  // 空回显（零 delta 直接 done）：未返回译文 → 算落定（分子 +1）+ 错误 +1
  env.ports[0].emit({ type: "done" });
  await env.clock.settle();
  assert.equal(badge.textContent, "33% 1/3(3)(1)", "空回显路径：分子 +1、错误括号出现");
  assert.equal(
    env.body.querySelectorAll("p")[0].querySelector(".translate-node").textContent,
    "翻译失败: 未返回译文",
  );

  // 净化空结果（有回显但净化为空壳）：译文节点静默移除——算落定、不算错误
  env.ports[1].deliver("<p> </p>");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "66% 2/3(3)(1)",
    "净化空静默移除：算落定（分子 +1）、错误数不增（错误括号仍为 1）",
  );
  assert.equal(
    env.body.querySelectorAll("p")[1].querySelectorAll(".translate-node").length,
    0,
    "净化空宿主译文容器被移除",
  );

  env.ports[2].deliver("丙译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 3/3(3)(1) 0(0)s",
    "净化空宿主也计入分子：进度可达 100%；错误数保持 1；追加耗时读数",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: 边缘档宿主失败只进错误括号（全档位口径），不进分子分母", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<main ${B}><p ${B}>main prose english one</p><p ${B}>main prose english two</p></main>` +
      `<nav ${B}><p ${B}>nav english link line</p></nav>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3, "正文 2 + 边缘 1 = 3 个端口请求");
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/2(3)", "分母 2、括号 3");

  // 边缘档宿主（ports[2]，排序在队尾）error：只进错误括号，分子分母不动
  env.ports[2].emit({ type: "error", message: "nav boom" });
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "0% 0/2(3)(1)",
    "边缘档失败只使错误括号 +1，不进分子（错误口径含全部档位）",
  );

  env.ports[0].deliver("正文一译文");
  env.ports[1].deliver("正文二译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3)(1) 0(0)s",
    "全落定且边缘失败：100% 仍可达，终态错误括号为 1；追加耗时读数",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计数: 重扫新增宿主后分母与括号同步增长（百分比可下降）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<main ${B}><p ${B}>first wave english prose</p></main>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 1);
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/1(1)", "首轮：分母 1");

  env.ports[0].deliver("首轮译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "100% 1/1(1) 0(0)s", "首轮全部落定并追加耗时读数（时钟未推进）");

  // 页面动态新增宿主（正文 1 + 边缘 1）→ 防抖后重扫：分母与括号同步增长
  env.body.insertAdjacentHTML(
    "beforeend",
    `<p ${B}>second wave english prose</p>` +
      `<footer ${B}><p ${B}>second wave footer english</p></footer>`,
  );
  await env.clock.settle();
  await env.clock.advance(500); // 防抖到期 → 重扫
  assert.equal(env.ports.length, 3, "重扫新增 2 宿主 → 2 个新请求");

  assert.equal(
    badge.textContent,
    "50% 1/2(3)",
    "重扫后分母 1→2、括号 1→3（同步增长）；1/2 → 50%（百分比下降属预期）",
  );

  env.ports[1].deliver("二波正文译文");
  env.ports[2].deliver("二波页脚译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3) 0(0)s",
    "重扫新增宿主全部落定后回到 100%（边缘档不计分子）；读数按同一沙箱时钟算（0.5s → 0s）",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

// ============================================================
// 进度徽标计时（工单 bt-01）——全部已发现宿主（含边缘档）落定后，文案末尾追加
// ` <主内容秒数>(<全内容秒数>)s`；时间源由沙箱以手动时钟注入（now: () => clock.now），
// 推进沙箱时钟即推进读数。断言只落在徽标文案（可见结果）与调度观测（pending）上
// ============================================================

test("徽标计时: 括号外定格在正文落定时刻、括号内定格在全落定时刻（12s / 60s）", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<main ${B}><p ${B}>main prose english one</p><p ${B}>main prose english two</p></main>` +
      `<nav ${B}><p ${B}>nav english link line</p></nav>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 3, "正文 2 + 边缘 1 = 3 个端口请求");
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/2(3)", "在途：不显示时间后缀");

  await env.clock.advance(12000); // 12s：正文两宿主落定
  env.ports[0].deliver("正文一译文");
  env.ports[1].deliver("正文二译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3)",
    "正文全部落定但边缘档仍在途：仍不显示时间（时间只在全部落定后出现）",
  );

  await env.clock.advance(48000); // 60s：边缘档落定
  env.ports[2].deliver("导航译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(3) 12(60)s",
    "括号外是正文落定时刻（12s）、括号内是全落定时刻（60s）——两个数各自定格",
  );
  assert.equal(env.clock.pending(), 0, "调度收敛：无在途计时器");
});

test("徽标计时: 全部落定后再推进时钟，文案逐字不变且无在途计时器（定格值不是秒表）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>steady reading english host</p>`,
  });
  await env.send({ type: "translate" });
  await env.clock.advance(3000);
  env.ports[0].deliver("稳定读数译文");
  await env.clock.settle();

  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "100% 1/1(1) 3(3)s", "落定即定格 3 秒");
  assert.equal(env.clock.pending(), 0, "落定后无在途计时器（徽标不装定时器）");

  await env.clock.advance(5000);
  assert.equal(badge.textContent, "100% 1/1(1) 3(3)s", "时钟走了 5 秒，读数逐字不变");
  assert.equal(env.clock.pending(), 0, "推进 5 秒后仍无在途计时器");
});

test("徽标计时: 重扫发现新段落时读数撤下，新宿主落定后回来并继续累计", async () => {
  const env = createContentSandbox({
    bodyHtml: `<main ${B}><p ${B}>first wave main prose</p></main>`,
  });
  await env.send({ type: "translate" });
  await env.clock.advance(2000);
  env.ports[0].deliver("首轮译文");
  await env.clock.settle();
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "100% 1/1(1) 2(2)s", "首轮全落定 → 定格 2 秒");

  // 动态插入新段落 → 重扫发现：读数先撤下（不把过时旧值当当前耗时）
  const main = env.body.querySelector("main");
  main.insertAdjacentHTML("beforeend", `<p ${B}>second wave main prose</p>`);
  await env.clock.settle();
  await env.clock.advance(500); // 防抖到期 → 重扫
  assert.equal(env.ports.length, 2, "重扫为新宿主发起请求");
  assert.equal(badge.textContent, "50% 1/2(2)", "新宿主进分母即撤下时间读数");

  await env.clock.advance(3000); // 5.5s：新宿主落定
  env.ports[1].deliver("二轮译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 2/2(2) 5(5)s",
    "读数回来且从同一起点继续累计（5s > 2s：隐藏期照常计时）",
  );
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计时: 只新增边缘档宿主时括号外保持旧定格值，括号内更新为更大的秒数", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<main ${B}><p ${B}>main prose english host</p></main>` +
      `<footer ${B}><p ${B}>footer english line</p></footer>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 2, "正文 1 + 边缘 1 = 2 个端口请求");
  await env.clock.advance(4000);
  env.ports[0].deliver("正文译文");
  env.ports[1].deliver("页脚译文");
  await env.clock.settle();
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "100% 1/1(2) 4(4)s", "首轮全落定 → 4(4)s");

  // 只新增边缘档宿主（footer 内新段落）：正文时间不解冻，全量落定时间解冻
  const footer = env.body.querySelector("footer");
  footer.insertAdjacentHTML("beforeend", `<p ${B}>late footer english line</p>`);
  await env.clock.settle();
  await env.clock.advance(500); // 防抖到期 → 重扫
  assert.equal(env.ports.length, 3, "重扫为新宿主发起请求");
  assert.equal(badge.textContent, "100% 1/1(3)", "括号增长、读数撤下（主内容分母不动）");

  await env.clock.advance(5000); // 9.5s：新边缘宿主落定
  env.ports[2].deliver("迟到页脚译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "100% 1/1(3) 4(9)s",
    "括号外保持正文落定时的定格值 4s，括号内更新为全落定时刻 9s",
  );
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计时: 还原后再翻译时间从 0 重新起算（不残留上一次的读数）", async () => {
  const env = createContentSandbox({
    bodyHtml: `<p ${B}>restart timing english host</p>`,
  });
  await env.send({ type: "translate" });
  await env.clock.advance(7000);
  env.ports[0].deliver("首轮译文");
  await env.clock.settle();
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "100% 1/1(1) 7(7)s",
    "首轮全落定 → 定格 7 秒",
  );

  await env.send({ type: "revert" });
  await env.clock.advance(20000); // 还原后时钟继续走：不是暂停，而是重新起算

  await env.send({ type: "translate" });
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "0% 0/1(1)",
    "重挂载回到零态：先没有读数",
  );
  env.ports[1].deliver("二轮译文");
  await env.clock.settle();
  assert.equal(
    env.body.querySelector(".translate-progress").textContent,
    "100% 1/1(1) 0(0)s",
    "耗时从本次 show() 起算：不残留上一会话的 7s",
  );
  await env.clock.advance(1000);
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计时: 只有边缘档宿主的页面全落定后括号外为 0（空主内容集合视为起点即完成）", async () => {
  const env = createContentSandbox({
    bodyHtml:
      `<header ${B}><p ${B}>header english tagline</p></header>` +
      `<nav ${B}><p ${B}>nav english link line</p></nav>`,
  });
  await env.send({ type: "translate" });
  assert.equal(env.ports.length, 2, "两个边缘档宿主各一次请求");
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/0(2)", "主内容分母为 0；括号为全部宿主数");

  await env.clock.advance(3000);
  env.ports[0].deliver("页眉译文");
  await env.clock.settle();
  assert.equal(badge.textContent, "0% 0/0(2)", "边缘档仍在途 → 无时间后缀");

  env.ports[1].deliver("导航译文");
  await env.clock.settle();
  assert.equal(
    badge.textContent,
    "0% 0/0(2) 0(3)s",
    "全落定：括号外按 0 显示（不引入第三态），括号内为全落定时刻 3s",
  );
  assert.equal(env.clock.pending(), 0, "调度收敛");
});

test("徽标计时: 零宿主页面文案保持 0% 0/0(0)，永不出现时间后缀", async () => {
  const env = createContentSandbox({ bodyHtml: "" }); // 零宿主：没有任何翻译发生过
  await env.send({ type: "translate" });
  const badge = env.body.querySelector(".translate-progress");
  assert.equal(badge.textContent, "0% 0/0(0)", "零宿主：无时间后缀");

  await env.clock.advance(10000);
  assert.equal(badge.textContent, "0% 0/0(0)", "时间流逝也不出现时间后缀（没有翻译发生过）");
  assert.equal(env.ports.length, 0, "零宿主页面无请求");
  assert.equal(env.clock.pending(), 0, "调度收敛");
});
