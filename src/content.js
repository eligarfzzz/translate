// 会话装配：把五块职责接成一个会话；环境依赖显式注入，由加载器启动。
// content-session（状态与生命周期）/ content-render（译文节点与动画）/
// content-translate（端口流程与并发池，ADR-0005）/ content-observer（观察器与防抖）/
// content-progress（进度徽标）。
// 依赖单向：session ← render / translate / observer / progress，无环。
import { getChannel } from "./debug.js";
import { createHostDiscovery } from "./host-discovery.js";
import { loadConfig } from "./config.js";
import { createSessionState } from "./content-session.js";
import { createRenderer } from "./content-render.js";
import { createTranslator } from "./content-translate.js";
import { createScheduler } from "./content-observer.js";
import { createProgressBadge } from "./content-progress.js";

// 翻译优先级档位（与 host-discovery 判档常量同值）：档 0 正文 / 档 1 未标记 /
// 档 2 边缘区域。进度计数口径按此拆分（档 0+1 计入分子分母，档 2 只进括号）。
const TIER_PERIPHERAL = 2;

// 会话工厂：注入 document（页面文档）、chrome（扩展 API）、getComputedStyle（display 判定）、
// now（时间源，返回毫秒：徽标耗时读数用）
function createContentSession(env) {
  const doc = env.document;
  const ext = env.chrome;
  const computeStyle = env.getComputedStyle;
  // 日志通道（src/debug.js）：console 双级 + storage.local 环形落盘（log-cs）
  const DBG = getChannel("cs", ext.storage);
  // 窗口取自注入文档；content script 隔离世界中 document.defaultView 即本世界的 window
  const win = doc.defaultView;

  const session = createSessionState();
  const renderer = createRenderer({ doc, win, session });

  // hostState 兼作「已处理宿主」登记表，重扫据此跳过已翻宿主
  const hostDiscovery = createHostDiscovery({
    document: doc,
    getComputedStyle: (el) => computeStyle(el),
    hostState: session.hostState,
  });

  // 进度徽标：会话装配第五块，与 render/translate/observer 平级；计数收在模块内，
  // 时间源透传 env.now（真实环境 Date.now、测试沙箱手动时钟）
  const badge = createProgressBadge({ doc, now: env.now });

  // 落定计数的唯一收口（端口流程 settle 每宿主恰好一次）：按档拆分口径——
  // 档 0+1（正文/未标记）计入进度分子与分母；档 2（边缘区域）落定不计分子，
  // 但失败仍进错误括号（错误括号为全档位口径）。errored 由端口流程给出：
  // error 消息 / 空回显「未返回译文」/ 连接意外中断；净化为空的静默移除不算。
  function settleHost(entry, errored) {
    badge.settled(entry.tier < TIER_PERIPHERAL, errored);
  }

  const translator = createTranslator({ ext, session, renderer, DBG, onSettled: settleHost });

  // 一轮翻译：发现宿主 → 按档计分母与括号 → 并发池内逐宿主独立请求（失败只影响该宿主）。
  // 空结果自然结束；页面静止且翻译全部结束后无在途计时器，调度收敛。
  async function runRound(initial) {
    session.beginTranslating();
    try {
      const cfg = await loadConfig(ext.storage);
      const entries = hostDiscovery.discoverEntries();
      // 宿主发现出口按档计数（首轮与重扫共享同一出口，无第二条计数路径）：
      // 档 0+1 累加进度分母 translatable；全部宿主数（含档 2 边缘）累加括号 totalAll
      badge.addHosts(entries.filter((e) => e.tier < TIER_PERIPHERAL).length, entries.length);
      // 读路径已归一化：该字段恒为默认值表给出的正整数（空/非法值一律回退默认），无需再兜底
      const limit = cfg.concurrency;
      if (initial) {
        // 分档统计：排序是纯时序行为，页面上看不出——没这行无法确认排序真的生效
        const tiers = [0, 0, 0];
        for (const e of entries) tiers[e.tier]++;
        DBG.debug(
          "session start:",
          entries.length,
          "hosts /",
          entries.reduce((n, e) => n + e.html.length, 0),
          "chars, concurrency",
          limit,
          ", tiers",
          tiers.join("/"),
        );
      } else {
        DBG.debug("rescan:", entries.length, "new hosts");
      }
      await translator.translateEntries(entries, limit);
    } finally {
      session.endTranslating();
    }
  }

  const scheduler = createScheduler({
    doc,
    win,
    session,
    runRescan: () => runRound(false),
  });

  async function translatePage() {
    if (!session.open()) return; // 会话已开启或翻译进行中：拒绝重入（徽标也不重复挂载）
    badge.show(); // 会话开启成功才上屏；计数接线在工单 02
    await runRound(true);
  }

  // 还原：作废旧回调 + 中止全部在途请求 → 停调度 → 清译文节点；
  // 观察器摘除，下次「翻译」时重建。
  function revertPage() {
    DBG.debug("revert: cleaned", session.hostState.size, "hosts");
    session.close(); // 代号自增作废旧回调 + 会话关闭 + 在途端口逐一断开
    scheduler.stop(); // 摘观察器 + 清挂起的防抖
    renderer.clearRendered(); // 停动画 + 移除译文节点 + 清 hostState
    badge.remove(); // 摘进度徽标（与译文节点同等待遇：还原移除一切注入物）
  }

  // 只导出不自注册：注册与派发权归加载器（同步注册消竞态）；此处再注册会造成双份监听

  function handleMessage(msg, sender, sendResponse) {
    if (msg.type === "get-session") {
      sendResponse({ active: session.isActive() });
    } else if (msg.type === "translate") {
      scheduler.start();
      translatePage();
      sendResponse({ ok: true });
    } else if (msg.type === "revert") {
      revertPage();
      sendResponse({ ok: true });
    }
    return true;
  }

  // 页面卸载清理定时器
  win.addEventListener("beforeunload", renderer.clearAllSpinTimers);

  return { handleMessage };
}

export { createContentSession };
