// ============================================================
// 集成测试（content-rescan harness：重扫调度 + 宿主即请求协议）
//
// 被测接缝：chrome 消息与端口输入（translate/revert、流式 delta、done）
// → DOM 输出（译文容器出现与否、端口数=请求数、在途端口峰值、
// 沙箱时钟排队计时器数）。全部走 tests/helpers/content-sandbox.js 基建
// （jsdom 全量 content script + mock 单宿主请求端口 + 元素几何补丁
// + 手动时钟 + 可选存储配置覆盖）。
// ============================================================

const test = require("node:test");
const assert = require("node:assert/strict");
const { createContentSandbox } = require("./helpers/content-sandbox.js");

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
    assert.ok(
      starts[0].text.includes(texts[i]),
      `端口 ${i} 载荷为宿主 ${i} 的骨架 HTML`
    );
  }

  // 无标记协议：回显全文即译文（deliver 不带 [N] 前缀）
  env.ports[0].deliver("第一段译文");
  env.ports[1].deliver("第二段译文");
  env.ports[2].deliver("第三段译文");
  await env.clock.settle();
  const paras = env.body.querySelectorAll("p");
  for (let i = 0; i < 3; i++) {
    assert.equal(paras[i].querySelector(".translate-node").textContent, `第${["一", "二", "三"][i]}段译文`);
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
  assert.equal(paras[0].querySelector(".translate-node").textContent, "甲的译文", "宿主 0 照常完成");
  assert.equal(paras[2].querySelector(".translate-node").textContent, "丙的译文", "宿主 2 照常完成");

  const failed = paras[1].querySelector(".translate-node");
  assert.equal(failed.textContent, "翻译失败: HTTP 500 boom", "失败宿主显示斜体错误信息");
  assert.equal(failed.style.fontStyle, "italic");

  // 错误标记持久：不被仍在走动的加载动画覆盖
  await env.clock.advance(1000);
  assert.equal(
    paras[1].querySelector(".translate-node").textContent,
    "翻译失败: HTTP 500 boom",
    "错误信息不被动画覆盖"
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
    assert.equal(paras[i].querySelectorAll(".translate-node").length, 1, `宿主 ${i} 恰一个译文容器`);
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
