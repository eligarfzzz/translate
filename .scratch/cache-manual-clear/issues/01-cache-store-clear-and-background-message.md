# 01: 清空内核与 background 消息

**What to build:** 「清空缓存」从消息到数据库的完整通路：存储模块获得一个清空原语，background 的缓存消息监听器获得 `clear-cache` 分支。做完这一个切片，用户在 Service Worker 控制台发一条 `chrome.runtime.sendMessage({ type: "clear-cache" })` 就能清空整个缓存库并拿回清空前的条数——不依赖配置页，也不依赖任何翻译会话。清空与 `cacheEnabled` 无关（刚关掉缓存的用户仍能清掉残留），失败会如实回报而不是静默。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `src/cache-store.js` 新增 `clear()`：单一读写事务内先取清空前的条数、再清空全部条目；返回 `{ ok: true, removed: N }`，空库 `removed: 0` 且 `ok` 为真。任何 IndexedDB 失败记日志后返回 `{ ok: false, removed: 0 }`，**不抛**——与既有 D10 收口（错误只在本模块消化）一致，也与其它方法同形。
- [x] 清空是**整库**清空：不按指纹筛选、不读配置，`clear()` 不接受任何配置参数。
- [x] `tests/helpers/fake-indexeddb.js` 的假实现补 `objectStore.clear()`：按既有 `request()` 时序派发（`failRequests` 注入时与其它请求一样先坏事务再派 onerror），供模块与 background 两侧用例共用。
- [x] `tests/cache-store.test.js` 新用例：多条条目清空后逐键 `get` 全部未命中；返回值等于清空前的条数；空库返回 `{ ok: true, removed: 0 }`；IndexedDB 故障时返回 `{ ok: false, removed: 0 }`、日志有记录且不抛异常。
- [x] `src/background.js` 既有的缓存 runtime 消息监听器新增 `clear-cache` 分支（与 `cleanup-cache` 同处，同一主题聚在一起）：调 `cache.clear()`、以 `{ ok, removed }` 异步回应（该分支需要保持回应通道打开）。**不加载配置**——`clear-cache` 不读 `cacheEnabled`，开关关着照清。失败留痕由 store 经注入的日志回调完成（即 background 的 `DBG.error` 通道），background 不重复记第二条，也不另设 try/catch 路径。
- [x] `cleanup-cache` 的既有契约逐字节不变：仍不读回应通道、仍只在 `cacheEnabled` 为真时清理、仍 fire-and-forget。两分支各自独立，不合并成一条带模式参数的消息。
- [x] `tests/background.test.js` 新用例：发 `clear-cache` → 库被清空且回应 `{ ok: true, removed: N }`（N 等于清空前条数）；`cacheEnabled: false` 时**照样**清空（D6 的承力用例）；IndexedDB 故障时回应 `{ ok: false, removed: 0 }` 而不是抛错；清空后同一段原文的翻译重新走上游请求，落定形态与未命中路径逐字节一致（不再有 `done{cached:true}`）。
- [x] 变异验证：给 `clear-cache` 分支加一条「缓存关闭就不清」的守卫 → D6 用例必须转红；把 `removed` 写死为 0 → 条数用例必须转红。
- [x] `npm test` 全绿；不碰 `options.html` / `src/options.js` / `content*.js`（配置页按钮是票 02）。
- [x] 零痕迹：代码与测试不出现真实端点、密钥、厂商模型名；库内测试数据一律假值。

## Comments

- 决策来源：spec `.scratch/cache-manual-clear/spec.md` 的 D1 / D3 / D4 / D5 / D6 / D7 / D8 / D9 / D12，以及 Testing Decisions 的「存储模块」与「background 集成」两条。
- 清空与自动清理是两条独立路径：`clear()` 按用户意图清空一切，`cleanup()` 按配置删过期 + 淘超限；两者共用同一份 schema 常量（库名 / 版本 / store 名只在存储模块一处出现），不共用逻辑。
- 「清空不是屏障」是本票的已知语义：执行那一刻已在飞的请求成功返回后仍会写回条目而复活。不要为此加跨标签页广播或生成代数计数（spec 的 Out of Scope）。
- 本票交付的是一个可独立验证的纵切片（消息 → 存储 → 测试），存储方法与它的唯一消费方同票落地，不留无消费者的死方法。
- 实施于 commit `f769b093fce90b3106ba31043d487cca8a8712cd`（`feat(cache-manual-clear): 票 01 清空内核与 background 消息`，6 文件 +180/−9）；reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `a4d265c..f769b09`）；`npm test` 实测 **266/266**（基线 259，+7）；两次定向变异（加「缓存关闭就不清」守卫、`removed` 写死 0）均实测转红后回滚，回滚后全套件复绿。评审非阻断观察项：① `tests/helpers/background-sandbox.js` 与 `tests/background.test.js` 的文件头「被测接缝」清单未纳入 `clear-cache`（方法级注释已更新，仅文件头漏同步）；② `store.clear()` 请求本体未 await，成败由 `settledOf(tx)` 观察——与 `put()` 既有写法同形，有意为之；③ 沙箱 `sendResponse` 只取首条回应，与真实通道语义一致、无测试依赖多次回应。状态由主代理在出口统一标记。
