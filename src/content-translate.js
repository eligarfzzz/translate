// 单宿主端口流程与并发池（ADR-0005）：一宿主一次端点请求，无标记协议，
// 回显全文即译文；单请求失败只标记该宿主。
// 端口协议：content → background 的 start（text = 本段骨架 HTML；history = 可选会话链，
// 纯数据对 [{ html, echo }]，仅会话重用且链非空时携带）；background → content 的
// delta（增量文本）/ done（定稿）/ error（失败）/ restart（本轮尝试作废、重开一轮）。
// restart 是重试的配套信号：失败尝试已流式送出的预览无法撤回，background 重试前发它让
// 这里清空累积回显、弃掉本槽已累积的链——content 不感知「重试」本身，只看到一次 done
// 或一次 error。
// 落定（定稿 / error 消息 / 连接意外中断 / 空回显）统一收口在 finish：
// 并发池调度与进度计数共用这一唯一收口（每宿主恰好一次，无第二条计数路径）。

import { stripHostWrapper } from "./prompt.js";

// 翻译器工厂：ext / session / renderer / DBG 注入；onSettled(entry, errored) 为
// 落定计数回调（spec 决策：挂在端口流程 settle 的唯一收口，每宿主恰好一次）——
// entry 带档位供调用方拆分计数口径，errored 覆盖三条失败路径
// （error 消息 / 空回显「未返回译文」/ 连接意外中断）
function createTranslator({ ext, session, renderer, DBG, onSettled }) {
  // entry: { el, html }；chain: 本槽位的会话链（reuse 开启时的数组，否则 null）。
  // Promise 在该宿主定稿/失败/中断后 resolve（并发池凭此调度）
  function translateHost(entry, chain) {
    const gen = session.generation();
    if (!session.inSession(gen)) return Promise.resolve();

    const { div, timer } = renderer.createNode(entry.el);
    session.trackHost(entry.el, { div, timer });

    return new Promise((resolve) => {
      const port = ext.runtime.connect({ name: "translate-host" });
      session.addPort(port);
      let settled = false;
      let errored = false; // 落定时是否走了失败路径（error 消息 / 空回显 / 连接中断）
      let raw = ""; // 回显全文累积（无 [N] 标记协议）
      let done = false; // 已定稿

      const fail = (message) => {
        errored = true;
        renderer.stopSpin(timer);
        renderer.markError(div, message, gen);
      };

      // 落定的唯一收口（settled 守卫 → 每宿主恰好一次，不存在第二条计数路径）：
      // 清理端口 → 计数回调 → 放行并发池。三条收尾路径（done / error /
      // onDisconnect）全部经此汇合；还原后（代号作废）的迟到收尾跳过计数——
      // 徽标已随还原移除，且旧代号不得计入下一会话的新徽标。
      const finish = () => {
        if (settled) return;
        settled = true;
        session.removePort(port);
        try {
          port.disconnect();
        } catch {}
        if (session.inSession(gen) && onSettled) onSettled(entry, errored);
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
              if (body) {
                renderer.renderFinal(div, body, gen);
                // 成功段落进链：纯数据对（本段原文、原始回显）——包装由 background 组装
                // 链中消息时经 prompt.js 的 helper 补上。失败 / 中断 / 空回显不进链。
                if (chain) chain.push({ html: entry.html, echo: raw });
              } else {
                errored = true; // 空回显「未返回译文」：失败路径（净化空的静默移除不算）
                renderer.markError(div, "未返回译文", gen);
              }
            }
            finish();
            break;
          }
          case "restart": {
            // 上游本轮尝试作废、重开一局（background 重试前发）：清空累积回显与预览，
            // 并弃掉本槽已累积的链——重试以链首形态发起，成功后该段就是本槽的新链首，
            // 之后的段以它为链首继续累积（触发超限或漂移的那段历史不再带回后续请求）。
            // 不改会话/落定状态——落定收口仍是每宿主恰好一次。
            if (done) break;
            raw = "";
            if (chain) chain.length = 0;
            renderer.renderPreview(div, "", gen);
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

      // 链的纯数据快照随消息送出（slice 一份）：落定后 push 本段不会回头改已发出的历史
      const history = chain && chain.length ? chain.slice() : null;
      port.postMessage(
        history
          ? { type: "start", text: entry.html, history }
          : { type: "start", text: entry.html },
      );
    });
  }

  // 并发池：同时在途请求数不超过 limit；会话结束即停止取新任务。
  // reuse（会话重用）开启时每个 worker 持一条链（该槽位成功段的有序序列）——
  // 每段随 start 消息把本槽历史发给 background 组装链中消息；关时不持链。
  async function runPool(tasks, limit, reuse) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      const chain = reuse ? [] : null;
      while (next < tasks.length && session.isActive()) {
        const task = tasks[next++];
        await task(chain);
      }
    });
    await Promise.all(workers);
  }

  // 一批宿主：每宿主一个任务，池内调度；reuse 透传给每个 worker（slot 级开关）
  function translateEntries(entries, limit, reuse) {
    return runPool(
      entries.map((e) => (chain) => translateHost(e, chain)),
      limit,
      reuse,
    );
  }

  return { translateEntries };
}

export { createTranslator };
