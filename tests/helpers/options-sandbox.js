// ============================================================
// 配置页测试基建（工单 01：空即未设置）
//
// 被测接缝：chrome.storage.sync 的存储形态 → 配置页 DOM 的可见结果
// （输入框 value、status 文案）与保存后的存储内容。做法：
//   1) 解析真实的 options.html（字段名与表单结构取自生产 markup，不另写副本）
//   2) 注入 chrome 替身：storage 内存键值表（保存后可直接读回断言）+
//      runtime.sendMessage（可注入本次回应，发出的消息按序记入可观测列表）
//   3) 以查询串破 ESM 缓存，每个用例拿到一个干净的模块实例——options.js
//      在 import 时即读 DOM 并触发一次异步回填，模块级状态不可跨用例复用
//      （见工单 01 Comments）
//   4) 假计时器：flash 用 setTimeout 清状态，测试零真实等待
//   5) settle()：冲刷微任务，等 import 触发的异步回填 Promise 链跑完
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// debug.js 的 console 直写：静音 debug 级（与内容脚本沙箱同约定）
console.debug = () => {};

const OPTIONS_HTML = readFileSync(
  fileURLToPath(new URL("../../options.html", import.meta.url)),
  "utf8",
);

let instanceSeq = 0;

// chrome.storage 单个存储区域的内存替身：get 缺键不出现（与真实 API 一致）；
// writes 记下每次写操作——「只点恢复默认不写存储」这类断言需要可观测的写入证据
function createStorageArea() {
  const data = {};
  const writes = [];
  return {
    data,
    writes,
    get: async (keys) => {
      const out = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    set: async (items) => {
      writes.push({ op: "set", keys: Object.keys(items) });
      Object.assign(data, items);
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      writes.push({ op: "remove", keys: list });
      for (const k of list) delete data[k];
    },
  };
}

// 冲刷微任务与宏任务轮：options.js 的 import 期回填与保存都是 async 链，
// 断言前先跑完（setImmediate 不受假计时器影响）
async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

// createOptionsSandbox({ stored, clearCacheResult, listCacheResult }): stored 为 sync 存储里
// config 的原始值，null 表示存储里没有 config 键；clearCacheResult 为「清空缓存」按钮发出
// runtime 消息后收到的回应（缺省 = 空库成功）；listCacheResult 为缓存列表消息的回应——
// 值或 (msg) => 回应 的函数（需要按请求页码给不同回应的用例用它）。返回：
//   dom/doc/form/status、field(name)（输入框元素）、submit()（提交表单并等写完存储）、
//   restore(group)（点该组的「恢复默认」，等 click 处理器跑完）、
//   clearCache()（点「清空缓存」，等 click 处理器跑完）、
//   selectTab(name)（点 TAB 并等异步流程跑完）、
//   cacheRows()（缓存表格的正文：每行是各单元格的文本）、cacheStatus/pageInfo（缓存视图的
//   状态文案与页码文案）、prevPage()/nextPage()（点翻页按钮并等异步流程跑完）、
//   syncWrites（sync 区域的写操作记录，未写过 = 空数组）、
//   sentMessages（runtime.sendMessage 发出的消息，按序记录）、
//   storedConfig()（存储里 config 的当前值，键被删除 = null）、dispose()（还原全局注入）
async function createOptionsSandbox({
  stored = null,
  clearCacheResult = { ok: true, removed: 0 },
  listCacheResult = { ok: true, page: 1, pageSize: 20, total: 0, entries: [] },
} = {}) {
  const dom = new JSDOM(OPTIONS_HTML, { url: "https://example.test/options.html" });
  const doc = dom.window.document;

  const sync = createStorageArea();
  if (stored !== null) sync.data.config = stored;
  const local = createStorageArea(); // 日志落盘内存态（debug.js 通道）
  const sentMessages = [];
  const chrome = {
    storage: { sync, local },
    runtime: {
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        if (msg?.type === "list-cache") {
          return typeof listCacheResult === "function" ? listCacheResult(msg) : listCacheResult;
        }
        return clearCacheResult;
      },
    },
  };

  // 模块代码在 Node 里执行：document/chrome 取自全局注入。
  // options.js 的 flash 用全局 setTimeout——换成只登记的假计时器，断言即刻可读。
  const saved = {
    document: globalThis.document,
    chrome: globalThis.chrome,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.document = doc;
  globalThis.chrome = chrome;
  const timers = [];
  globalThis.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  globalThis.clearTimeout = (id) => {
    if (id) timers[id - 1] = null;
  };

  await import(`../../src/options.js?case=${++instanceSeq}`);
  await settle();

  const form = doc.getElementById("form");
  return {
    dom,
    doc,
    form,
    status: doc.getElementById("status"),
    field: (name) => form.elements[name],
    async submit() {
      form.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
      await settle();
    },
    async restore(group) {
      doc.querySelector(`[data-restore="${group}"]`).click();
      await settle();
    },
    async clearCache() {
      doc.getElementById("clear-cache").click();
      await settle();
    },
    // TAB 切换（缓存表格的加载时机就在这个动作上）
    async selectTab(name) {
      doc.getElementById(`tab-${name}`).click();
      await settle();
    },
    // 缓存表格正文：每行是各单元格的纯文本
    cacheRows() {
      return [...doc.querySelectorAll("#cache-rows tr")].map((tr) =>
        [...tr.children].map((td) => td.textContent),
      );
    },
    cacheTable: doc.getElementById("cache-table"),
    cacheStatus: doc.getElementById("cache-status"),
    pageInfo: doc.getElementById("cache-page-info"),
    prevPage: doc.getElementById("cache-prev"),
    nextPage: doc.getElementById("cache-next"),
    async clickPrev() {
      doc.getElementById("cache-prev").click();
      await settle();
    },
    async clickNext() {
      doc.getElementById("cache-next").click();
      await settle();
    },
    syncWrites: sync.writes,
    sentMessages,
    storedConfig: () => ("config" in sync.data ? sync.data.config : null),
    dispose() {
      globalThis.document = saved.document;
      globalThis.chrome = saved.chrome;
      globalThis.setTimeout = saved.setTimeout;
      globalThis.clearTimeout = saved.clearTimeout;
    },
  };
}

export { createOptionsSandbox };
