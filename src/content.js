// 会话装配：把四块职责接成一个会话；环境依赖显式注入，由加载器启动。
// content-session（状态与生命周期）/ content-render（译文节点与动画）/
// content-translate（端口流程与并发池，ADR-0005）/ content-observer（观察器与防抖）。
// 依赖单向：session ← render / translate / observer，无环。
import { getChannel } from "./debug.js";
import { createHostDiscovery } from "./host-discovery.js";
import { loadConfig } from "./config.js";
import { createSessionState } from "./content-session.js";
import { createRenderer } from "./content-render.js";
import { createTranslator } from "./content-translate.js";
import { createScheduler } from "./content-observer.js";

// 会话工厂：注入 document（页面文档）、chrome（扩展 API）、getComputedStyle（display 判定）
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

  const translator = createTranslator({ ext, session, renderer, DBG });

  // 一轮翻译：发现宿主 → 并发池内逐宿主独立请求（失败只影响该宿主）。
  // 空结果自然结束；页面静止且翻译全部结束后无在途计时器，调度收敛。
  async function runRound(initial) {
    session.beginTranslating();
    try {
      const cfg = await loadConfig(ext.storage);
      const entries = hostDiscovery.discoverEntries();
      const limit = cfg.concurrency || 20;
      if (initial) {
        DBG.debug(
          "session start:",
          entries.length,
          "hosts /",
          entries.reduce((n, e) => n + e.html.length, 0),
          "chars, concurrency",
          limit,
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
    if (!session.open()) return; // 会话已开启或翻译进行中：拒绝重入
    await runRound(true);
  }

  // 还原：作废旧回调 + 中止全部在途请求 → 停调度 → 清译文节点；
  // 观察器摘除，下次「翻译」时重建。
  function revertPage() {
    DBG.debug("revert: cleaned", session.hostState.size, "hosts");
    session.close(); // 代号自增作废旧回调 + 会话关闭 + 在途端口逐一断开
    scheduler.stop(); // 摘观察器 + 清挂起的防抖
    renderer.clearRendered(); // 停动画 + 移除译文节点 + 清 hostState
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
