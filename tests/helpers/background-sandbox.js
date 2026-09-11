// ============================================================
// background（service worker）测试基建（票 03：会话链与双触发器重试）
//
// 被测接缝：content → background 的端口消息（start：text + 可选 history）→
// 上游 fetch 请求体 + background → content 的回发消息
// （delta / restart / done / error 的次序与载荷）。
//
// 三件套：
//   1) globalThis.chrome 替身。src/background.js 模块顶层就读 chrome.storage 并注册
//      onConnect，替身必须在 import 之前装好；模块只求值一次，故替身为模块级单例
//      （每个测试文件是独立进程，替身不会跨文件串台）。
//   2) globalThis.fetch 替身：记录每次请求的 url / body / headers，按队列回放预设响应
//      （sseResponse 流式块 / httpErrorResponse 错误）。
//   3) 端口替身：测试扮演 content 侧——connect() 建端口、start() 发 start 消息、
//      posted 观察回发消息。
// ============================================================

const DEFAULT_CONFIG = {
  apiBase: "https://example.com/v1",
  apiKey: "sk-example-not-a-real-key",
  model: "example-model",
};

let env = null;

function ensureEnv() {
  if (env) return env;
  const state = {
    config: null,
    responses: [],
    fetchCalls: [],
    debugLines: [],
    ports: [],
    onConnect: [],
    localStore: {},
  };

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: { addListener: (fn) => state.onConnect.push(fn) },
      openOptionsPage() {},
      lastError: null,
    },
    action: { onClicked: { addListener() {} } },
    contextMenus: {
      removeAll() {},
      create() {},
      update() {},
      onClicked: { addListener() {} },
    },
    tabs: { sendMessage: async () => {}, onActivated: { addListener() {} } },
    storage: {
      // debug.js 环形日志落盘：内存态即可
      local: {
        get: async (key) => ({ [key]: state.localStore[key] }),
        set: async (obj) => Object.assign(state.localStore, obj),
      },
      // config.js loadConfig 的存储读取（缺省 → 空对象 → 全默认值）
      sync: { get: async () => (state.config ? { config: state.config } : {}) },
    },
  };

  // debug 通道的 console 直写：静音并留痕（重试留痕的观测量），error 级照常透传
  console.debug = (...args) => {
    state.debugLines.push(args.map((a) => String(a)).join(" "));
  };

  globalThis.fetch = async (url, init) => {
    state.fetchCalls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : null,
      headers: init?.headers,
    });
    const next = state.responses.shift();
    if (!next) throw new Error("TEST: 上游响应队列已空（请求数超出用例预设）");
    return next;
  };

  env = { state };
  return env;
}

// flush 微任务/宏任务若干轮：端口流程是 async 链（配置读取 → 上游 fetch → 流式读取 → 回发）
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

// SSE 响应：每个文本块一条 data: 行、按块分次 read()（增量到达的确定性替身），末尾 [DONE]
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const parts = chunks.map(
    (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`,
  );
  parts.push("data: [DONE]\n");
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < parts.length
            ? { done: false, value: encoder.encode(parts[i++]) }
            : { done: true, value: undefined },
      }),
    },
  };
}

// HTTP 错误响应：ok=false + 状态码 + 文本详情（streamTranslate 读 text() 拼进错误消息）
function httpErrorResponse(status, detail) {
  return { ok: false, status, text: async () => detail };
}

// 某类回发消息（delta / restart / done / error）的有序切片
function ofType(port, type) {
  return port.posted.filter((m) => m.type === type);
}

// 建一个用例环境：注入配置与上游响应队列，导入 background 模块（幂等），
// 返回 { fetchCalls, debugLines, ports, connect, start, settle }
async function createBackgroundSandbox({ config = {}, responses = [] } = {}) {
  const { state } = ensureEnv();
  state.config = { ...DEFAULT_CONFIG, ...config };
  state.responses = responses.slice();
  state.fetchCalls = [];
  state.debugLines = [];
  state.ports = [];
  state.localStore = {};
  await import("../../src/background.js");

  // 建端口并把 onConnect 派发给 background 的监听器（测试扮演 content 侧）
  function connect() {
    const msgListeners = [];
    const disconnectListeners = [];
    const posted = [];
    const port = {
      name: "translate-host",
      posted,
      onMessage: { addListener: (fn) => msgListeners.push(fn) },
      onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
      postMessage: (msg) => {
        posted.push(msg);
      },
      disconnect: () => {},
      emit: (msg) => {
        for (const fn of [...msgListeners]) fn(msg);
      },
    };
    state.ports.push(port);
    for (const fn of state.onConnect) fn(port);
    return port;
  }

  return {
    fetchCalls: state.fetchCalls,
    debugLines: state.debugLines,
    ports: state.ports,
    connect,
    settle,
    // 发一条 start 消息并等整条端口流程走完
    async start(port, payload) {
      port.emit({ type: "start", ...payload });
      await settle();
    },
  };
}

export { createBackgroundSandbox, sseResponse, httpErrorResponse, ofType, DEFAULT_CONFIG };
