// ============================================================
// lib/debug.js：三通道日志（cs = content script / bg = background / opt = 配置页）
// 双输出：
//   1) console —— debug 级默认被 DevTools 过滤（Verbose 可见），error 常显
//   2) chrome.storage.local 环形落盘 —— 键 log-cs / log-bg / log-opt，
//      各保留最近 MAX_ENTRIES 条，超出淘汰最旧
// 密钥脱敏：sk- 前缀长 token 一律替换为 sk-***
// 双环境：扩展全局 TranslateDebug + node module.exports（node 下仅 console）
// ============================================================

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.TranslateDebug = factory();
})(typeof self !== "undefined" ? self : this, () => {
  "use strict";

  const MAX_ENTRIES = 500; // 每通道保留条数（环形）
  const MAX_MSG_LEN = 500; // 单条消息截断长度

  const KEYS = { cs: "log-cs", bg: "log-bg", opt: "log-opt" };

  // 密钥脱敏：sk- 前缀的长 token 一律打码
  const maskSecret = (s) => String(s).replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***");

  function safeJson(v) {
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch {
      return String(v);
    }
  }

  // 参数序列化为单行消息：字符串原样、对象 JSON，超长截断，密钥打码
  const fmt = (args) =>
    maskSecret(
      args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ")
    ).slice(0, MAX_MSG_LEN);

  // 环形缓冲：追加后保留最近 max 条（纯函数，测试用）
  const appendRing = (entries, rec, max) => {
    const next = entries.concat(rec);
    return next.length > max ? next.slice(next.length - max) : next;
  };

  function makeChannel(scope, key, storage, con) {
    // 落盘：Promise 链 + 显式错误输出——任何一步失败都 console.error 可见，
    // 不再静默（原两段式 get(cb)->set 在 MV3 SW 下有多个静默断点）。
    async function persist(rec) {
      try {
        const res = await storage.local.get(key);
        const arr = Array.isArray(res?.[key]) ? res[key] : [];
        await storage.local.set({ [key]: appendRing(arr, rec, MAX_ENTRIES) });
      } catch (e) {
        con.error(`[${scope}] log persist failed:`, String(e?.message || e));
      }
    }
    const write = (level, args) => {
      const msg = fmt(args);
      const line = `[${scope}] ${msg}`;
      if (level === "error") con.error(line);
      else con.debug(line);
      if (!storage) return; // 无 chrome.storage 环境（node 测试）：仅 console
      const rec = { ts: new Date().toISOString(), level, scope, msg };
      persist(rec); // fire-and-forget，内部已兜错
    };
    return {
      debug: (...args) => write("debug", args),
      error: (...args) => write("error", args),
    };
  }

  // env: "cs" | "bg" | "opt"。
  // 无 chrome.storage（node 测试环境）自动退化为仅 console 输出。
  function getChannel(env) {
    const storage =
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
        ? chrome.storage
        : null;
    const con = typeof console !== "undefined" ? console : { debug() {}, error() {} };
    return makeChannel(`translate:${env}`, KEYS[env], storage, con);
  }

  return { getChannel, appendRing, maskSecret, fmt, KEYS, MAX_ENTRIES };
});
