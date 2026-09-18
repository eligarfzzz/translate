// 短文本缓存的存储内核（ADR-0008）：IndexedDB 单库单 store，键 = 指纹 + 分隔符 + 骨架原文，
// 值 = { echo, lastUsedAt }；lastUsedAt 上建索引，过期删除与 LRU 淘汰都经索引游标
// 按时间升序扫描。工厂注入 IndexedDB 句柄与日志回调（node 无 IndexedDB，测试以内存假
// 实现驱动，与 debug.js 注入 storage 同构），模块自身零依赖 chrome API。
// 降级收口（D10）：所有 IndexedDB 错误只在本模块消化——经注入的日志回调记录后按
// 「未命中 / 跳过」处理，绝不向调用方抛未捕获异常；调用方因此不需要每处都 try/catch。

const DAY_MS = 86400000; // 一天的毫秒数：过期界 = now - cacheTtlDays * DAY_MS

const encoder = new TextEncoder(); // UTF-8 字节计量（指纹散列与字节门共用）

// 指纹输入的五项请求塑造值以记录分隔符拼接——防 ["ab","c"] 与 ["a","bc"] 的拼接歧义
const FIELD_SEPARATOR = "\x1e";

// 配置指纹（D1）：apiBase / model / targetLang / promptTemplate / extra 五项拼接后的
// FNV-1a（32 位）散列，定长十六进制输出。apiKey 不进指纹——密钥不塑造译文；
// 散列不可逆，缓存键不泄露可读配置（D12 零痕迹姿势不受影响）。任一值变化指纹即变，
// 旧条目自然过期，无需显式失效。
function cacheFingerprint({ apiBase, model, targetLang, promptTemplate, extra }) {
  const joined = [apiBase, model, targetLang, promptTemplate, extra]
    .map((v) => String(v))
    .join(FIELD_SEPARATOR);
  let hash = 0x811c9dc5; // FNV offset basis
  for (const byte of encoder.encode(joined)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// 字节门（D2）：骨架原文的 UTF-8 字节数 ≤ 阈值才可查可写；更长的宿主永远直走上游
function fitsCacheBytes(original, maxBytes) {
  return encoder.encode(String(original)).length <= maxBytes;
}

const DB_NAME = "short-text-cache";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const INDEX_NAME = "lastUsedAt";

// 键形（D1）：指纹（定长十六进制）+ 单元分隔符 + 骨架原文。指纹定长，原文任意字符
// 都不产生歧义；分隔符只是可读性间隔
const KEY_SEPARATOR = "\x1f";

function keyOf(fingerprint, original) {
  return fingerprint + KEY_SEPARATOR + original;
}

// 单请求 Promise 化
function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 事务落定 Promise 化（oncomplete 才算写入落定；onerror/onabort 为失败）
function settledOf(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 沿 lastUsedAt 索引升序扫描（最久未用在前）。onEntry 在游标事件里同步执行，
// 只可派同事务的请求（cursor.delete()），不得 await 他物——事务在事件落幕后无
// 在途请求即提交。onEntry 返回 false 提前收尾（不再 continue）。
function scanByIndex(store, onEntry) {
  return new Promise((resolve, reject) => {
    const request = store.index(INDEX_NAME).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || onEntry(cursor) === false) {
        resolve();
        return;
      }
      cursor.continue();
    };
  });
}

// 缓存存储工厂：indexedDB 为浏览器全局 indexedDB 同形的工厂句柄（缺省则一切操作降级），
// log 为日志回调（缺省静默）。
function createCacheStore({ indexedDB: idb, log = () => {} } = {}) {
  let dbPromise = null; // 打开幂等：成功后复用同一连接；失败后复位，下次操作重试

  function open() {
    if (!idb) return Promise.reject(new Error("indexedDB unavailable"));
    if (!dbPromise) {
      const p = new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME).createIndex(INDEX_NAME, "lastUsedAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      dbPromise = p;
      p.catch(() => {
        if (dbPromise === p) dbPromise = null; // 失败不缓存连接
      });
    }
    return dbPromise;
  }

  // 读：按键取记录；命中即把 lastUsedAt 刷新为调用方给定的 now（同一事务内读改写），
  // 返回 { echo }；未命中返回 null；任何 IDB 故障记日志后按未命中处理（D10）
  async function get(fingerprint, original, now) {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const rec = await resultOf(store.get(keyOf(fingerprint, original)));
      if (rec === undefined) {
        await settledOf(tx);
        return null;
      }
      store.put({ echo: rec.echo, lastUsedAt: now }, keyOf(fingerprint, original));
      await settledOf(tx);
      return { echo: rec.echo };
    } catch (e) {
      log("cache get failed:", e);
      return null;
    }
  }

  // 写：upsert { echo, lastUsedAt: now }；IDB 故障记日志后静默跳过（D10）
  async function put(fingerprint, original, echo, now) {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ echo, lastUsedAt: now }, keyOf(fingerprint, original));
      await settledOf(tx);
    } catch (e) {
      log("cache put failed:", e);
    }
  }

  // 清理（D6）：先删 lastUsedAt 早于过期界的全部条目，再统计条数，超出上限时按
  // lastUsedAt 从最旧淘汰到恰好上限。now、天数、上限由调用方传入；三段各一个事务
  // 顺序执行（事务在事件落幕后自动提交，无法跨 await 复用）。IDB 故障记日志后
  // 静默跳过（D10）——本轮不清，下轮清理再试。
  async function cleanup({ now, ttlDays, maxEntries }) {
    try {
      const db = await open();
      const cutoff = now - ttlDays * DAY_MS;

      const expiredTx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all([
        scanByIndex(expiredTx.objectStore(STORE_NAME), (cursor) => {
          if (cursor.value.lastUsedAt >= cutoff) return false; // 索引升序：其后皆未过期
          cursor.delete();
          return true;
        }),
        settledOf(expiredTx),
      ]);

      const total = await resultOf(
        db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count(),
      );
      let remaining = total - maxEntries;
      if (remaining <= 0) return;

      const evictTx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all([
        scanByIndex(evictTx.objectStore(STORE_NAME), (cursor) => {
          cursor.delete();
          remaining -= 1;
          return remaining > 0; // 淘够即停
        }),
        settledOf(evictTx),
      ]);
    } catch (e) {
      log("cache cleanup failed:", e);
    }
  }

  // 清空（手动清库原语，cache-manual-clear D1/D5）：整库清空——不按指纹筛选、不读配置，
  // 本方法不接受任何配置参数。单一读写事务内先取清空前的条数、再清空全部条目（两个事务
  // 之间可能被并发写入把数字搞歪）。空库视为成功：{ ok: true, removed: 0 }。
  // 与 cleanup 是两条独立路径：cleanup 按配置删过期 + 淘超限，clear 按用户意图清空一切；
  // 两者共用同一份 schema 常量，不共用逻辑。IDB 故障记日志后返回 { ok: false, removed: 0 }，
  // 不抛（D10 收口，与其它方法同形）；清空不是屏障——在途请求成功后仍会写回条目（D8）。
  async function clear() {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const removed = await resultOf(store.count());
      store.clear();
      await settledOf(tx);
      return { ok: true, removed };
    } catch (e) {
      log("cache clear failed:", e);
      return { ok: false, removed: 0 };
    }
  }

  return { get, put, cleanup, clear };
}

export { createCacheStore, cacheFingerprint, fitsCacheBytes, DAY_MS };
