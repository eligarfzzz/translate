// 单宿主端口流程与并发池（ADR-0005）：一宿主一次端点请求，无标记协议，
// 回显全文即译文；单请求失败只标记该宿主。

import { stripHostWrapper } from "./prompt.js";

// 翻译器工厂：ext / session / renderer / DBG 注入
function createTranslator({ ext, session, renderer, DBG }) {
  // entry: { el, html }；Promise 在该宿主定稿/失败/中断后 resolve（并发池凭此调度）
  function translateHost(entry) {
    const gen = session.generation();
    if (!session.inSession(gen)) return Promise.resolve();

    const { div, timer } = renderer.createNode(entry.el);
    session.trackHost(entry.el, { div, timer });

    return new Promise((resolve) => {
      const port = ext.runtime.connect({ name: "translate-host" });
      session.addPort(port);
      let settled = false;
      let raw = ""; // 回显全文累积（无 [N] 标记协议）
      let done = false; // 已定稿

      const fail = (message) => {
        renderer.stopSpin(timer);
        renderer.markError(div, message, gen);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        session.removePort(port);
        try {
          port.disconnect();
        } catch {}
        resolve();
      };

      port.onMessage.addListener((msg) => {
        if (settled || !session.inSession(gen)) {
          finish();
          return;
        }
        switch (msg?.type) {
          case "delta": {
            if (done) break;
            raw += msg.text || "";
            renderer.stopSpin(timer);
            renderer.renderPreview(div, raw, gen);
            break;
          }
          case "done": {
            if (!done) {
              done = true;
              renderer.stopSpin(timer);
              // 剥离 renderPrompt 注入的最外层 <html> 包装后净化写入
              const body = stripHostWrapper(raw);
              if (body) renderer.renderFinal(div, body, gen);
              else renderer.markError(div, "未返回译文", gen);
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

  // 并发池：同时在途请求数不超过 limit；会话结束即停止取新任务
  async function runPool(tasks, limit) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length && session.isActive()) {
        const task = tasks[next++];
        await task();
      }
    });
    await Promise.all(workers);
  }

  // 一批宿主：每宿主一个任务，池内调度
  function translateEntries(entries, limit) {
    return runPool(
      entries.map((e) => () => translateHost(e)),
      limit,
    );
  }

  return { translateEntries };
}

export { createTranslator };
