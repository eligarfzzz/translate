// ============================================================
// 内容脚本集成测试基建（工单 02）
//
// 接缝（spec Testing Decisions）：消息与端口输入 → DOM 输出，
// 不断言 content.js 内部状态。四件套：
//   1) jsdom 沙箱按 manifest.json 声明顺序加载全部 content script
//      （与真实注入一致；沿用 load-order 冒烟测试的沙箱模式）
//   2) 可控时序的 mock 单宿主请求端口（ADR-0005：每宿主一端口，
//      无标记协议）：可停在流式中途，再由测试放行完成；
//      另跟踪在途端口数峰值（并发上限的观测量）
//   3) 元素几何补丁：jsdom 的 getBoundingClientRect 恒为零，
//      不补丁则一切宿主被 host-discovery 判为不可见
//   4) 消息监听捕获：测试以 background 身份向 content script 发消息
// 另附手动时钟（sandbox 的 setTimeout/clearTimeout/setInterval/
// clearInterval 全部走 fake clock，测试零真实等待，时序完全可控）。
// ============================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..");

// ---------------- 手动时钟 ----------------
// advance(ms)：逐步推进到目标时刻，途中到期的时间戳/间隔逐波执行，
// 每波后 flush 微任务与宏任务（setImmediate 轮），让沙箱内的
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
// chrome.runtime.onMessage 替身：捕获 content script 注册的监听器，
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
          })
      );
      await Promise.all(dispatches);
      return reply;
    },
  };
  return bus;
}

// ---------------- 沙箱组装 ----------------
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

  const chromeStub = {
    runtime: {
      onMessage: { addListener: bus.addListener },
      connect: hub.connect,
    },
    storage: {
      // debug.js 环形日志落盘（回调风格）：内存态即可
      local: {
        get: (_key, cb) => cb && cb({}),
        set: (_obj, cb) => cb && cb(),
      },
      // config.js loadConfig 用的 promise 风格读取（可注入存储覆盖）
      sync: {
        get: async () => (config ? { config } : {}),
      },
    },
  };

  const sandbox = {
    document: dom.window.document,
    window: dom.window,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: (el) => dom.window.getComputedStyle(el),
    // 静音 debug 级日志，保留 error 透传（排查失败用例）
    console: { debug() {}, log() {}, warn() {}, error: console.error },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    chrome: chromeStub,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // 按 manifest 声明顺序加载全部 content script（与真实注入一致）
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  for (const file of manifest.content_scripts[0].js) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(code, sandbox, { filename: file });
  }

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
    send,
  };
}

module.exports = { createContentSandbox };
