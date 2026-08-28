// ============================================================
// content script：页面翻译核心（v4：宿主即请求）
// 纯逻辑已抽至 lib/（工单 03/04）：宿主发现 lib/host-discovery.js、
// 文本判定 lib/text-utils.js、净化 lib/sanitize.js。
// 本文件只保留：会话状态、DOM 写入、动画、端口流程、还原与观察器。
// 一次翻译 = 每个宿主独立一次端点请求（ADR-0005）：prompt 为翻译
// 指令 + 单宿主骨架 HTML，无标记协议，回显全文即译文——流式 delta
// 直通（剥标签纯文本预览），done 定稿（净化后写入）；并发池控制
// 同时在途请求数，失败粒度细化到单宿主。
// ============================================================

(() => {
  "use strict";

  const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const SPINNER_INTERVAL = 100;

  // 全局动画定时器登记表（还原/页面卸载时统一清理）
  const SPIN_TIMERS = new Set();

  // 日志通道（lib/debug.js）：console 双级 + storage.local 环形落盘（log-cs）
  const DBG = TranslateDebug.getChannel("cs");

  // ---------------- 会话状态 ----------------
  // 会话：点击「翻译」开始，点击「还原」结束。
  // 会话外禁止一切 DOM 写入与请求（防止幽灵译文 / 还原竞态）。
  let sessionActive = false;
  let translating = false;
  let generation = 0; // 每次还原自增；旧回调凭代号作废
  const activePorts = new Set(); // 在途单宿主请求端口，还原时逐一中止
  const hostState = new Map(); // hostEl -> { div, timer }（含在途与已完成）

  // 宿主发现（lib/host-discovery.js）：注入真实浏览器环境
  const hostDiscovery = HostDiscovery.createHostDiscovery({
    document,
    getComputedStyle: (el) => getComputedStyle(el),
    hostState,
  });
  let observer = null;
  let debounceTimer = null;

  // ---------------- 动画（并入译文容器，无独立 spinner 元素） ----------------

  function startCellSpinner(div) {
    let i = 0;
    div.textContent = SPINNER_CHARS[0];
    const timer = setInterval(() => {
      i = (i + 1) % SPINNER_CHARS.length;
      if (div.isConnected) div.textContent = SPINNER_CHARS[i];
    }, SPINNER_INTERVAL);
    SPIN_TIMERS.add(timer);
    return timer;
  }

  function stopSpin(timer) {
    if (timer == null) return;
    clearInterval(timer);
    SPIN_TIMERS.delete(timer);
  }

  // ---------------- 错误标记（写在既有译文容器内） ----------------

  function markCellError(div, message, gen) {
    if (!(sessionActive && gen === generation) || !div.isConnected) return;
    div.style.fontStyle = "italic";
    div.style.color = "#b33";
    div.style.fontSize = "0.9em";
    div.textContent = `翻译失败: ${message}`;
  }

  // ---------------- 安全 HTML（lib/sanitize.js，此处仅调用） ----------------

  // ---------------- 译文容器样式 ----------------

  const NODE_STYLE =
    "color: #2d6da3; margin: 2px 0; padding: 1px 0; " +
    "font-size: 0.95em; line-height: 1.4; white-space: pre-wrap; word-break: break-word; " +
    "text-decoration: underline dashed #4a90d9; text-underline-offset: 3px;";

  // ---------------- 单宿主翻译（每宿主一次端点请求，经 background 端口代理） ----------------

  // entry: { el, html } —— 每宿主唯一译文容器；无标记协议：回显全文
  // 即该宿主译文，流式 delta 直通（剥标签纯文本预览），done 定稿
  // （净化后 innerHTML 写入）。单请求失败只标记该宿主。
  function translateHost(entry) {
    const gen = generation;
    if (!sessionActive || gen !== generation) return Promise.resolve();

    const inSession = () => sessionActive && gen === generation;
    const live = (div) => inSession() && div.isConnected;

    // 建容器：append 到宿主末尾，初始内容即 ⠋⠼ 动画
    const div = document.createElement("div");
    div.className = "translate-node";
    div.style.cssText = NODE_STYLE;
    entry.el.appendChild(div);
    const timer = startCellSpinner(div);
    hostState.set(entry.el, { div, timer });

    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: "translate-host" });
      activePorts.add(port);
      let settled = false;
      let raw = ""; // 回显全文累积（无 [N] 标记协议）
      let done = false; // 已定稿

      const fail = (message) => {
        stopSpin(timer);
        markCellError(div, message, gen);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        activePorts.delete(port);
        try { port.disconnect(); } catch {}
        resolve();
      };

      port.onMessage.addListener((msg) => {
        if (settled || !inSession()) { finish(); return; }
        switch (msg?.type) {
          case "delta": {
            if (done) break;
            raw += msg.text || "";
            stopSpin(timer);
            // 流式预览：剥标签纯文本直通上屏
            if (live(div)) div.textContent = TextUtils.textOf(raw);
            break;
          }
          case "done": {
            if (!done) {
              done = true;
              stopSpin(timer);
              // 定稿：剥离 renderPrompt 注入的最外层 <html> 包装后净化写入
              const body = stripHostWrapper(raw);
              if (body) {
                // 净化后写入（回显全文即译文）
                if (live(div)) div.innerHTML = Sanitize.sanitizeHtml(body, document);
              } else {
                markCellError(div, "未返回译文", gen);
              }
            }
            finish();
            break;
          }
          case "error": {
            DBG.error("host request error:", msg.message || "未知错误");
            fail(msg.message || "未知错误");
            finish();
            break;
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          DBG.error("port disconnected unexpectedly");
          fail("连接中断");
          finish();
        }
      });

      port.postMessage({ type: "start", text: entry.html });
    });
  }

  // ---------------- 并发池 ----------------

  async function runPool(tasks, limit) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length && sessionActive) {
        const task = tasks[next++];
        await task();
      }
    });
    await Promise.all(workers);
  }

  // ---------------- 主流程 ----------------

  async function translatePage() {
    if (sessionActive || translating) return;
    sessionActive = true;
    translating = true;
    try {
      const cfg = await loadConfig();
      const entries = hostDiscovery.discoverEntries();
      DBG.debug(
        "session start:", entries.length, "hosts /",
        entries.reduce((n, e) => n + e.html.length, 0), "chars, concurrency", cfg.concurrency || 20
      );
      await runPool(
        entries.map((e) => () => translateHost(e)),
        cfg.concurrency || 20
      );
    } finally {
      translating = false;
    }
  }

  // 还原：中止全部在途请求 → 作废旧回调 → 清 DOM；
  // 监听与调度一并清理（观察器摘除，下次「翻译」时重建）
  function revertPage() {
    generation++;
    sessionActive = false;
    translating = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const port of [...activePorts]) {
      try { port.disconnect(); } catch {} // 触发 background AbortController 中止
    }
    activePorts.clear();
    DBG.debug("revert: cleaned", hostState.size, "hosts");

    for (const [, st] of hostState) {
      if (st.timer != null) stopSpin(st.timer);
      if (st.div && st.div.isConnected) st.div.remove();
    }
    SPIN_TIMERS.forEach((t) => clearInterval(t));
    SPIN_TIMERS.clear();
    document.querySelectorAll(".translate-node").forEach((el) => el.remove());
    hostState.clear();
  }

  // ---------------- MutationObserver（会话期内持续翻译新内容） ----------------
  // 子节点新增 + 展开/显隐属性切换（class/style/hidden/open）都触发重扫；
  // 全部触发共用下方同一防抖入口，高频抖动页面不会产生请求风暴。

  const RESCAN_DEBOUNCE_MS = 500;

  // 重扫执行体：发现新宿主 → 并发池内逐宿主翻译（请求独立，失败只影响该宿主）。
  // 空结果自然结束；页面静止且翻译全部结束后无任何在途定时器，调度收敛。
  async function runRescan() {
    translating = true;
    try {
      const cfg = await loadConfig();
      const entries = hostDiscovery.discoverEntries();
      DBG.debug("rescan:", entries.length, "new hosts");
      await runPool(entries.map((e) => () => translateHost(e)), cfg.concurrency || 20);
    } finally {
      translating = false;
    }
  }

  // 防抖入口：到期时会话已结束 → 丢弃；翻译进行中 → 忙则重试，
  // 重新排队同样时长而非静默丢弃（流式期间出现的新内容不再漏翻）。
  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (!sessionActive) return;
      if (translating) {
        scheduleScan(); // 忙则重试：等下一轮空闲再扫
        return;
      }
      await runRescan();
    }, RESCAN_DEBOUNCE_MS);
  }

  // 属性过滤器：只关注展开/显隐类切换——display（style）、class 折叠、
  // hidden 属性、details 的 open。未来发现更多展开型属性扩充此表即可。
  const RESCAN_ATTR_FILTER = ["class", "style", "hidden", "open"];

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (!sessionActive) return;
      for (const m of mutations) {
        if (m.type === "attributes") {
          // 目标位于本扩展译文容器子树内（含容器自身）→ 忽略：
          // 自身注入物的样式/类名调整不触发重扫
          const t = m.target;
          if (t.nodeType === Node.ELEMENT_NODE && t.closest(".translate-node")) continue;
          scheduleScan();
          return;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.classList?.contains("translate-node")) continue; // 自身注入物
            scheduleScan();
            return;
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: RESCAN_ATTR_FILTER,
    });
  }

  // ---------------- 消息监听 ----------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "get-session") {
      sendResponse({ active: sessionActive });
    } else if (msg.type === "translate") {
      startObserver();
      translatePage();
      sendResponse({ ok: true });
    } else if (msg.type === "revert") {
      revertPage();
      sendResponse({ ok: true });
    }
    return true;
  });

  // 页面卸载清理定时器
  window.addEventListener("beforeunload", () => {
    SPIN_TIMERS.forEach((t) => clearInterval(t));
    SPIN_TIMERS.clear();
  });
})();
