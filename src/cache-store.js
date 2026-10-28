// 短文本缓存的存储内核（ADR-0008）：IndexedDB 单库单 store，键 = 指纹 + 分隔符 + 骨架原文，
// 值 = { echo, hitCount, lastUsedAt }；lastUsedAt 上建索引，过期删除与 LRU 淘汰都经索引游标
// 按时间升序扫描。工厂注入 IndexedDB 句柄与日志回调（node 无 IndexedDB，测试以内存假
// 实现驱动，与 debug.js 注入 storage 同构），模块自身零依赖 chrome API。
// 降级收口（D10）：所有 IndexedDB 错误只在本模块消化——经注入的日志回调记录后按
// 「未命中 / 跳过」处理，绝不向调用方抛未捕获异常；调用方因此不需要每处都 try/catch。
// hitCount 是普通值字段（cache-inspection D12）：不新增仓库 / 索引，数据库版本不变，
// 旧记录缺字段即零——无全库迁移，读到或命中时自然采用新字段。

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

// 原文还原（D7）：键 = 指纹 + 分隔符 + 原文，指纹只含十六进制字符（定长输出）、
// 不会命中分隔符——首个分隔符之后即原文，值里因此不必再存一份原文
function keyOf(fingerprint, original) {
  return fingerprint + KEY_SEPARATOR + original;
}

function originalOfKey(key) {
  const text = String(key);
  return text.slice(text.indexOf(KEY_SEPARATOR) + 1);
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

  // 读：按键取记录；命中即在同一读写事务里把 hitCount 加一、lastUsedAt 刷新为调用方给定的
  // now（D10：次数与时间同一次命中事务），返回 { echo }；未命中返回 null（不加次数）；
  // 任何 IDB 故障记日志后按未命中处理（D10）。旧记录缺 hitCount 读作零，首次命中变一。
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
      store.put(
        { echo: rec.echo, hitCount: (rec.hitCount ?? 0) + 1, lastUsedAt: now },
        keyOf(fingerprint, original),
      );
      await settledOf(tx);
      return { echo: rec.echo };
    } catch (e) {
      log("cache get failed:", e);
      return null;
    }
  }

  // 写：upsert { echo, hitCount, lastUsedAt: now }（D11）。同一事务先读旧值：已存在的键保留其
  // 现有次数（同轮重复请求的回写不得清零已有统计），新键从零开始；旧记录缺字段同样读作零。
  // IDB 故障记日志后静默跳过（D10）
  async function put(fingerprint, original, echo, now) {
    try {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const key = keyOf(fingerprint, original);
      const rec = await resultOf(store.get(key));
      store.put({ echo, hitCount: rec?.hitCount ?? 0, lastUsedAt: now }, key);
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

  // 整库分页列表（D7/D8）：复用 lastUsedAt 索引的反向游标——最新用在前；原文从游标
  // 主键还原（值里不重复保存原文），总条数由 store.count() 给出。页码边界（D5）：
  // 请求页码归一为 [1, 总页数]，空库归一为第 1 页的空结果；归一后的页码随内容一起
  // 返回，调用方不必自己算。返回 { ok: true, page, pageSize, total, entries }，
  // entries = [{ original, echo, hitCount, lastUsedAt }]（次数随条目带给设置页，D8；
  // 旧记录缺 hitCount 按零显示，D11）。与翻译路径的降级口径不同：用户主动
  // 查看时的 IDB 故障记日志并返回 { ok: false }（D9）——设置页据此显示失败提示，
  // 不得伪装成空库；故障不抛给调用方（与其余方法同形）。
  async function list({ page, pageSize }) {
    try {
      const db = await open();
      const size = Math.max(1, Math.trunc(pageSize) || 1);
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const total = await resultOf(store.count());
      const pages = Math.max(1, Math.ceil(total / size));
      const wanted = Math.max(1, Math.trunc(page) || 1);
      const effectivePage = Math.min(wanted, pages);
      const skip = (effectivePage - 1) * size;

      const entries = await new Promise((resolve, reject) => {
        const request = store.index(INDEX_NAME).openCursor(null, "prev");
        request.onerror = () => reject(request.error);
        let skipped = 0;
        const collected = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || collected.length >= size) {
            resolve(collected);
            return;
          }
          if (skipped < skip) {
            skipped += 1;
            cursor.continue();
            return;
          }
          collected.push({
            original: originalOfKey(cursor.primaryKey),
            echo: cursor.value.echo,
            hitCount: cursor.value.hitCount ?? 0,
            lastUsedAt: cursor.value.lastUsedAt,
          });
          cursor.continue();
        };
      });

      return { ok: true, page: effectivePage, pageSize: size, total, entries };
    } catch (e) {
      log("cache list failed:", e);
      return { ok: false };
    }
  }

  return { get, put, cleanup, clear, list };
}

export { createCacheStore, cacheFingerprint, fitsCacheBytes, DAY_MS };
