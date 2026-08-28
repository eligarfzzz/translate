// ============================================================
// 内容脚本集成测试基建（工单 04）
//
// 接缝（spec Testing Decisions）：消息与端口输入 → DOM 输出，
// 不断言 content.js 内部状态。四件套：
//   1) 直接 import 会话工厂 createContentSession，注入 jsdom 环境
//      （document / chrome 替身 / getComputedStyle）
//   2) 可控时序的 mock 单宿主请求端口（ADR-0005：每宿主一端口，
//      无标记协议）：可停在流式中途，再由测试放行完成；
//      另跟踪在途端口数峰值（并发上限的观测量）
//   3) 元素几何补丁：jsdom 的 getBoundingClientRect 恒为零，
//      不补丁则一切宿主被 host-discovery 判为不可见
//   4) 消息派发：沙箱扮演加载器的角色——会话不自注册 onMessage，
//      生产环境唯一入口是 src/content-loader.js（见 ADR-0006），
//      测试以 background 身份向会话的 handleMessage 发消息
// 另附手动时钟（注入文档所属 window 的 setTimeout/clearTimeout/
// setInterval/clearInterval 全部走 fake clock，测试零真实等待，
// 时序完全可控）。
// ============================================================

import { JSDOM } from "jsdom";

import { createContentSession } from "../../src/content.js";

// debug.js 的 console 直写：静音 debug 级，保留 error 透传（排查失败用例）
console.debug = () => {};

// ---------------- 手动时钟 ----------------
// advance(ms)：逐步推进到目标时刻，途中到期的时间戳/间隔逐波执行，
// 每波后 flush 微任务与宏任务（setImmediate 轮），让会话内的
// async 续体（loadConfig / 端口 Promise 链 / MutationObserver 回调）
// 在下一波计时器执行前就位。
function createClock() {
  let now = 0;
  let seq = 1;
  const timeouts = new Map(); // id -> { fn, at }
  const intervals = new Map(); // id -> { fn, ms, next }

  async function settle(rounds = 8) {
    for (let i = 0; i < rounds; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const clock = {
    setTimeout(fn, ms) {
      const id = seq++;
      timeouts.set(id, { fn, at: now + (ms || 0) });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(fn, ms) {
      const id = seq++;
      const period = ms || 1;
      intervals.set(id, { fn, ms: period, next: now + period });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextAt = Infinity;
        for (const t of timeouts.values()) nextAt = Math.min(nextAt, t.at);
        for (const iv of intervals.values()) nextAt = Math.min(nextAt, iv.next);
        if (nextAt > target) break;
        now = nextAt;
        for (const [id, t] of [...timeouts]) {
          if (t.at <= now) {
            timeouts.delete(id);
            t.fn();
          }
        }
        for (const [id, iv] of [...intervals]) {
          while (intervals.has(id) && iv.next <= now) {
            iv.fn();
            iv.next += iv.ms;
          }
        }
        await settle();
      }
      now = target;
      await settle();
    },
    settle,
    // 仍在排队的计时器/间隔总数（调度是否收敛的观测量）
    pending() {
      return timeouts.size + intervals.size;
    },
    get now() {
      return now;
    },
  };
  return clock;
}

// ---------------- mock 单宿主请求端口 ----------------
// chrome.runtime.connect({ name: "translate-host" }) 的替身：
//   • posted：content → background 的消息（{type:"start", text}）
//   • emit(msg)：background → content 回发（delta/done/error），测试控制时序
//     ——可停在流式中途（只发部分 delta），再放行完成（补发 delta + done）
//   • deliver(text)：便捷放行——回显全文一次 delta + done（无 [N] 标记协议）
//   • disconnect() 只置标记，不回触发自身 onDisconnect（与真实端口一致）
//   • hub 另维护在途端口数（未断开）与历史峰值：并发上限的观测量
function createPortHub() {
  const ports = [];
  let active = 0;
  const hub = {
    ports,
    // 当前在途端口数（已连接未断开）
    inflight: () => ports.filter((p) => !p.disconnected).length,
    // 在途端口数历史峰值（同时在途请求数是否超上限的判据）
    peakInflight: 0,
    connect() {
      const msgListeners = [];
      const posted = [];
      active++;
      hub.peakInflight = Math.max(hub.peakInflight, active);
      const port = {
        name: "translate-host",
        disconnected: false,
        posted,
        onMessage: { addListener: (fn) => msgListeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        postMessage: (msg) => {
          posted.push(msg);
        },
        disconnect: () => {
          if (port.disconnected) return;
          port.disconnected = true;
          active--;
        },
        emit: (msg) => {
          if (port.disconnected) return;
          for (const fn of [...msgListeners]) fn(msg);
        },
        deliver: (text) => {
          port.emit({ type: "delta", text: String(text) });
          port.emit({ type: "done" });
        },
      };
      ports.push(port);
      return port;
    },
  };
  return hub;
}

// ---------------- 消息监听捕获 ----------------
// 消息总线：沙箱把会话的 handleMessage 注册进来（扮演加载器的派发角色），
// send(msg) 以 background 身份派发并等待 sendResponse（兼容同步回应
// 与 return true 的异步通道）。
function createMessageBus() {
  const listeners = [];
  const bus = {
    addListener: (fn) => {
      listeners.push(fn);
    },
    async send(msg) {
      let reply;
      const dispatches = listeners.map(
        (fn) =>
          new Promise((resolve) => {
            let done = false;
            const finish = (r) => {
              if (!done) {
                done = true;
                reply = r;
                resolve();
              }
            };
            const keepOpen = fn(msg, {}, finish);
            if (keepOpen !== true) finish();
          }),
      );
      await Promise.all(dispatches);
      return reply;
    },
  };
  return bus;
}

// ---------------- 环境组装 ----------------
// createContentSandbox({ bodyHtml, config }): 初始页面内容 + 可选存储配置覆盖
// （如 { concurrency: 2 }；经 mergeConfig 合并到默认值之上）。
// 返回 { dom, doc, body, clock, ports, inflightPorts, peakInflightPorts, send }：
//   ports 按创建顺序记录全部单宿主请求端口（请求数的观测量）；
//   inflightPorts()/peakInflightPorts() 为在途/峰值在途端口数
function createContentSandbox({ bodyHtml = "", config = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: "https://example.test/page",
  });

  // 元素几何补丁：jsdom 无布局，getBoundingClientRect 恒为零 → 宿主全不可见
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 320, height: 24, top: 0, left: 0, right: 320, bottom: 24, x: 0, y: 24 };
  };

  const clock = createClock();
  const hub = createPortHub();
  const bus = createMessageBus();
  // 会话若自注册 onMessage 只记录、不派发：非空即为「加载器 + 会话双份监听」回归
  const selfRegistered = [];

  // 手动时钟接入注入文档所属 window：会话的动画与防抖计时器全部经此排队
  dom.window.setTimeout = clock.setTimeout;
  dom.window.clearTimeout = clock.clearTimeout;
  dom.window.setInterval = clock.setInterval;
  dom.window.clearInterval = clock.clearInterval;

  const chromeStub = {
    runtime: {
      onMessage: { addListener: (fn) => selfRegistered.push(fn) },
      connect: hub.connect,
    },
    storage: {
      // debug.js 环形日志落盘：内存态即可
      local: {
        get: async () => ({}),
        set: async () => {},
      },
      // config.js loadConfig 的存储读取（可注入存储覆盖）
      sync: {
        get: async () => (config ? { config } : {}),
      },
    },
  };

  const session = createContentSession({
    document: dom.window.document,
    chrome: chromeStub,
    getComputedStyle: (el) => dom.window.getComputedStyle(el),
  });

  // 沙箱扮演加载器：会话的 handleMessage 是唯一派发目标
  bus.addListener(session.handleMessage);

  // send：派发消息并等回应；随后再 flush 一轮，让消息触发的异步流程
  // （translate 的 loadConfig → 单宿主请求端口建立）就位，测试拿到返回值
  // 即可安全访问 ports。
  const send = async (msg) => {
    const reply = await bus.send(msg);
    await clock.settle();
    return reply;
  };

  return {
    dom,
    doc: dom.window.document,
    body: dom.window.document.body,
    clock,
    ports: hub.ports,
    inflightPorts: hub.inflight,
    peakInflightPorts: () => hub.peakInflight,
    // 会话自注册的 onMessage 监听数（应恒为 0：派发权只属加载器）
    selfRegisteredListeners: () => selfRegistered.length,
    send,
  };
}

export { createContentSandbox };
