# 02: 缓存存储模块——IndexedDB 封装、指纹与字节判定、清理

**What to build:** 短文本缓存的存储内核，一个纯 ESM 新模块：工厂注入 IndexedDB 句柄（与 debug.js 注入 storage 同构，node 测试用内存假实现驱动）。对外提供四件事——**读**（按键取，命中即刷新 `lastUsedAt`）、**写**（upsert `{ echo, lastUsedAt }`）、**清理**（删过期 + LRU 淘到上限）、两个纯 helper（配置指纹散列、UTF-8 字节门）。键 = `指纹 + 分隔符 + 骨架原文`；指纹只含 apiBase / model / targetLang / promptTemplate / extra 五项（apiKey 不进），不可逆散列。所有 IndexedDB 错误在模块内消化：经注入的日志回调记录后按「未命中 / 跳过」处理，绝不向调用方抛未捕获异常（D10 的降级集中在本模块收口）。

**Blocked by:** 01

**Status:** resolved

- [x] 新模块（`src/` 扁平放置，零依赖注入 chrome API；IndexedDB 句柄与日志回调由工厂注入）。
- [x] open/upgrade：单 object store；`lastUsedAt` 上建索引供清理扫描；重复打开幂等。
- [x] 读：按键取记录；命中即把 `lastUsedAt` 刷新为调用方给定的 now 并返回 `{ echo }`；未命中返回 `null`。
- [x] 写：upsert `{ echo, lastUsedAt: now }`。
- [x] 清理：先删 `lastUsedAt` 早于 `now - cacheTtlDays * 86400000` 的全部条目；再统计条数，超出 `cacheMaxEntries` 时按 `lastUsedAt` 从最旧淘汰到上限。now、天数、上限由调用方传入。
- [x] 指纹 helper：五项配置值拼接后的不可逆散列（如 FNV-1a / djb2 一类，不引入新依赖）；任一值变化指纹即变。
- [x] 字节门 helper：输入骨架原文与阈值，返回 UTF-8 字节数 ≤ 阈值的布尔（TextEncoder 计量）。
- [x] 单测（内存假 IndexedDB 驱动）：写后读命中；命中刷新 `lastUsedAt`（后续清理按新时间计）；未命中返回 `null`；过期条目被删、未过期保留；超上限按最旧未用淘汰到恰好上限；不同指纹同原文互不命中；字节门边界（恰好阈值通过、阈值 +1 拒绝）；IDB 操作抛错时读返回 `null` / 写与清理静默跳过且日志有记录。
- [x] `npm test` 全绿；不碰 background / content / 配置页。
- [x] 零痕迹。

## Comments

- 决策来源：spec 的 D1 / D2 / D6 / D10 / D12。
- 「IDB 错误模块内收口」是 D10 的落点裁决：background/content 因此不需要每处调用都 try/catch，降级路径只有一条。
- 本票只交付模块与单测；接进翻译流程是票 03 的事。
- 实施于 commit `b18c410dddb539334ef0d4f490ebdb582e168061`（`feat(short-text-cache): 缓存存储内核（ticket 02）`，3 新文件 +578）；reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `bbb8a2c..b18c410`）；`npm test` 实测 **242/242**（+17）。评审非阻断观察项：fake-indexeddb 故障注入块两处同形（轻微重复，判断项）、`DAY_MS` 为测试支撑导出（琐碎）。实施者备注：`get` 同事务内「await 后再 put」依赖 Chrome ≥93 微任务时序（manifest 最低 106，成立）。状态由主代理在出口统一标记。
