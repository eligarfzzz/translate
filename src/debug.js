// 三通道日志（cs = content script / bg = background / opt = 配置页）：console 双级
// （debug 默认被 DevTools 过滤为 Verbose，error 常显）+ chrome.storage.local 环形落盘。
// 密钥脱敏：sk- 前缀长 token 一律打码，落盘日志可直接发给开发者。

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
  maskSecret(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ")).slice(
    0,
    MAX_MSG_LEN,
  );

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
    if (!storage) return; // 未注入存储：仅 console
    const rec = { ts: new Date().toISOString(), level, scope, msg };
    persist(rec); // fire-and-forget，内部已兜错
  };
  return {
    debug: (...args) => write("debug", args),
    error: (...args) => write("error", args),
  };
}

// env: "cs" | "bg" | "opt"；storage 为注入的 chrome.storage（缺省时仅 console 输出）。
function getChannel(env, storage) {
  return makeChannel(`translate:${env}`, KEYS[env], storage, console);
}

export { getChannel, appendRing, maskSecret, fmt, KEYS, MAX_ENTRIES };
