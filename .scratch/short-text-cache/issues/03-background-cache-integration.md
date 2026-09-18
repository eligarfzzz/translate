# 03: background 集成——命中回放、成功写入、清理消息

**What to build:** 把缓存接进翻译主链路。`start` 处理器在未配置守卫之后、fetch 之前查缓存（开关开且字节门过才查）：命中则刷新时间戳、回发一条 delta（缓存原始回显全文）加 `done{cached:true}`，不发上游请求——content 看到一次普通的快速应答。未命中照常走 `requestWithRetry`；它改为**返回获胜尝试的累积全文**（纯内部重构，端口协议不变），成功收尾（回显非空、恰一层 `<html>` 包装，含重试获胜）后写入缓存；错误 / 空回显 / 中止一律不写。新增 `cleanup-cache` 消息处理：缓存开启时执行一次清理（过期 + 淘汰）。任何缓存环节故障记日志后按无缓存继续，页面永远看不到缓存错误。同轮相同原文不合并（D11，无代码，回归测试兜底）。

**Blocked by:** 02

**Status:** resolved

- [x] `start` 处理器接入查询：`cacheEnabled` 开 且 骨架字节数 ≤ `cacheMaxBytes` 才查；指纹按当次 `loadConfig` 结果现算。
- [x] 命中回放：恰好一条 delta（缓存 `echo` 全文）+ 一条 `done` 且带 `cached: true`；无 restart、无 error、无上游 fetch。
- [x] 未命中：`requestWithRetry` 返回获胜尝试全文；仅在成功收尾时写入 `{ echo: 原始回显 }`；失败 / 空回显（`""` / `<html></html>`）/ 中止不写。
- [x] `cleanup-cache` 消息监听：缓存开 → 以当前配置执行清理一次；缓存关 → 不执行。
- [x] 降级：缓存模块抛出的任何异常（含 open 失败）记日志并走原有上游路径，行为与无缓存逐字节一致。
- [x] `tests/background.test.js`（background-sandbox）新用例：命中时的消息次序与载荷（delta 全文 → done.cached，无 fetch 调用）；未命中成功后写入（下一同键 start 直接命中）；失败与空回显不写；改配置（指纹五项之一）后旧条目不再命中；阈值之上（> cacheMaxBytes）不查不写；开关关时不查不写；清理消息触发删过期/淘超限；IDB 抛错时翻译照常（delta/done 次序与无缓存一致）。
- [x] `npm test` 全绿；不碰 content*.js 与配置页。
- [x] 零痕迹。

## Comments

- 决策来源：spec 的 D3 / D4 / D5（background 半）/ D7（background 半）/ D10 / D11。
- `done.cached` 是协议唯一新增；`restart`/`delta`/`error` 语义不变。ADR-0004 持有的消息清单是否追加 Evolved 指针，留待票 05 文档校准时裁决。
- 会话重用叠加：命中段照常结束，是否入链由 content 侧票 04 决定；本票只负责把 `cached` 标志送到。
- 实施于 commit `a4da3ee6a49f921c059b1e43922c12792abd4c17`（`feat(short-text-cache): background 缓存集成（ticket 03）`，4 文件）；reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `b18c410..a4da3ee`）；`npm test` 实测 **252/252**（+10）；两次定向变异（cacheableEcho 恒真、去字节门）均被守卫用例杀死。注意：既有「空/非法 history」用例改为每轮不同原文——同文重发如今会命中缓存，这是缓存生效的行为信号。评审非阻断观察项：双重门 `cacheable ? … : null` + `if (cacheable)` 可合一（判断项）；顶部注释「不再设第二条 try/catch」与 cleanup 监听器的 `.catch` 措辞张力（该 catch 守 loadConfig 意外路径而非 IDB）；「中止不写」结构性成立但无专属测试（票面未要求）。状态由主代理在出口统一标记。
