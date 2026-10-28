// 内存假 IndexedDB（cache-store 测试基建，node 无 IndexedDB）。
// 只实现 src/cache-store.js 用到的最小面：
//   open(name, version)：新库或版本升高时先派 onupgradeneeded 再派 onsuccess；
//   db.objectStoreNames.contains / db.createObjectStore().createIndex / db.transaction()；
//   store.get / put / count / clear，store.index().openCursor(query, direction)
//     （按索引键升序，次键为主键字典序；direction 为 "prev" 时整个次序反转，
//     与真实 IndexedDB 的 prev 游标一致——倒序分页读的是最新用在前）；
//   cursor.value / primaryKey / delete() / continue()；
//   tx.oncomplete / onerror（请求全部落定后派 complete）；
//   dump()：全库转储，供「值里不重复保存原文」这类存储形态断言直接观察写入结果。
// 请求与事务回调一律经 queueMicrotask 派发，保持与真实 IndexedDB 一致的
// 「先注册回调、后异步触发」时序；cursor.delete() 同步生效（模块不等待其结果，
// 与真实游标删除不扰动既有迭代位置的语义一致——游标遍历的是打开时刻的快照）。
// 故障注入：failOpen(err) 令后续 open 出错；failRequests(err) 令后续 store 请求出错；
// clearFailures() 恢复。另暴露 openCalls / upgradeCalls 供「重复打开幂等」断言。
// seedValue(key, value)：直接改写一条已存在记录的值（不经被测 store 的写入路径），
// 用于复现旧版本落下的值形态——例如本功能上线前没有 hitCount 字段的记录。
// reset() 供用例间隔离：records 原地清空——调用方缓存的连接闭包（如 background 的
// 模块级 store 单例 memoized dbPromise）引用同一 db/store 对象，换库或换 Map 会让
// 在途连接继续看到旧数据；原地清空则新旧连接看到同一份空库。故障标志与计数一并复位。

function createFakeIndexedDB() {
  const databases = new Map(); // name -> { version, stores: Map<storeName, storeData> }
  // storeData = { records: Map<key, value>, indexes: Map<indexName, keyPath> }
  const state = {
    failOpenWith: null,
    failRequestsWith: null,
  };

  const later = (fn) => queueMicrotask(fn);

  function makeRequest() {
    return { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null };
  }

  // ---- 事务 ----
  // scheduled 计数在途单元；单元归零后再等一拍（微任务续体可能又派生新请求），
  // 仍为零才派 oncomplete——覆盖「get 的 await 续体里再发 put」的真实时序。
  function makeTx(store) {
    const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
    let scheduled = 0;
    let completed = false;

    const unit = (fn) => {
      scheduled += 1;
      later(() => {
        fn();
        scheduled -= 1;
        if (scheduled === 0 && !completed) {
          later(() => {
            if (scheduled === 0 && !completed) {
              completed = true;
              tx.oncomplete?.();
            }
          });
        }
      });
    };

    const failTx = (err) => {
      if (completed) return;
      completed = true;
      tx.error = err;
      tx.onerror?.();
    };

    // 普通请求（get / put / count / clear）：失败时先坏事务再派 onerror（真实 IDB 的错误冒泡语义）
    function request(compute) {
      const req = makeRequest();
      unit(() => {
        if (state.failRequestsWith) {
          req.error = state.failRequestsWith;
          failTx(state.failRequestsWith);
          req.onerror?.();
          return;
        }
        req.result = compute();
        req.onsuccess?.();
      });
      return req;
    }

    // 索引游标：打开时取快照按索引键升序（direction = "prev" 时整序反转）；
    // continue() 推进一格再派同一请求的 onsuccess；末尾（或空库）派 result = null
    function openCursor(indexName, direction) {
      const keyPath = store.indexes.get(indexName);
      const req = makeRequest();
      if (state.failRequestsWith) {
        unit(() => {
          req.error = state.failRequestsWith;
          failTx(state.failRequestsWith);
          req.onerror?.();
        });
        return req;
      }
      const entries = [...store.records.entries()]
        .map(([key, value]) => ({ key, indexKey: value[keyPath], value }))
        .sort((a, b) => a.indexKey - b.indexKey || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (direction === "prev") entries.reverse();
      let pos = 0;
      const step = () =>
        unit(() => {
          if (pos >= entries.length) {
            req.result = null;
            req.onsuccess?.();
            return;
          }
          const entry = entries[pos];
          req.result = {
            value: { ...entry.value },
            primaryKey: entry.key,
            delete() {
              store.records.delete(entry.key);
            },
            continue() {
              pos += 1;
              step();
            },
          };
          req.onsuccess?.();
        });
      step();
      return req;
    }

    tx.objectStore = () => ({
      get: (key) =>
        request(() => {
          const rec = store.records.get(key);
          return rec === undefined ? undefined : { ...rec };
        }),
      put: (value, key) =>
        request(() => {
          store.records.set(key, { ...value });
        }),
      count: () => request(() => store.records.size),
      clear: () =>
        request(() => {
          store.records.clear();
        }),
      index: (indexName) => ({
        openCursor: (query, direction) => openCursor(indexName, direction),
      }),
    });
    return tx;
  }

  // ---- 库句柄 ----
  function dbHandle(db) {
    return {
      objectStoreNames: { contains: (name) => db.stores.has(name) },
      createObjectStore(name) {
        const store = { records: new Map(), indexes: new Map() };
        db.stores.set(name, store);
        return {
          createIndex(indexName, keyPath) {
            store.indexes.set(indexName, keyPath);
          },
        };
      },
      transaction(storeName) {
        const store = db.stores.get(storeName);
        if (!store) throw new Error(`object store not found: ${storeName}`);
        return makeTx(store);
      },
    };
  }

  const fake = {
    openCalls: 0,
    upgradeCalls: 0,
    indexedDB: {
      open(name, version) {
        fake.openCalls += 1;
        const req = makeRequest();
        later(() => {
          if (state.failOpenWith) {
            req.error = state.failOpenWith;
            req.onerror?.();
            return;
          }
          let db = databases.get(name);
          if (!db || version > db.version) {
            db = db ?? { version, stores: new Map() };
            db.version = version;
            databases.set(name, db);
            req.result = dbHandle(db);
            fake.upgradeCalls += 1;
            req.onupgradeneeded?.();
          }
          req.result = dbHandle(db);
          req.onsuccess?.();
        });
        return req;
      },
    },
    failOpen(err) {
      state.failOpenWith = err;
    },
    failRequests(err) {
      state.failRequestsWith = err;
    },
    clearFailures() {
      state.failOpenWith = null;
      state.failRequestsWith = null;
    },
    // 直接改写一条已存在记录的值（不经被测 store 的写入路径）：复现旧版本落下的值形态，
    // 例如本功能上线前没有 hitCount 字段的记录。键必须已存在——旧记录正是「旧版写过、
    // 新版读到」；库/store 由被测 store 的首次操作建立。
    seedValue(key, value) {
      for (const db of databases.values()) {
        for (const store of db.stores.values()) {
          if (!store.records.has(key)) continue;
          store.records.set(key, { ...value });
          return;
        }
      }
      throw new Error(`seedValue: key not found: ${key}`);
    },
    // 全库转储：[{ database, store, key, value }]。真实 IndexedDB 在 devtools 里同样
    // 可逐条查看；这里给测试一个只读观察口，用于断言值的存储形态（如值里不重复保存原文）
    dump() {
      const out = [];
      for (const [database, db] of databases) {
        for (const [storeName, store] of db.stores) {
          for (const [key, value] of store.records) {
            out.push({ database, store: storeName, key, value: { ...value } });
          }
        }
      }
      return out;
    },
    reset() {
      for (const db of databases.values()) {
        for (const store of db.stores.values()) store.records.clear();
      }
      state.failOpenWith = null;
      state.failRequestsWith = null;
      fake.openCalls = 0;
      fake.upgradeCalls = 0;
    },
  };
  return fake;
}

export { createFakeIndexedDB };
