# 02: 宿主即请求——单宿主单请求、并发池默认 20、批次协议删除

**What to build:** 一次翻译 = 每个宿主独立发起一次端点请求：prompt 为翻译指令 + 单宿主骨架 HTML，无标记协议，回显全文即译文（流式预览 + done 定稿净化写入）。并发池上限默认 20、配置页可调。批次构造（batching.js）与条目装配切分逻辑、`batchSize`/`maxCharsPerBatch` 配置全链路删除。新 ADR-0005 记录决策并标注取代 ADR-0001 的分批部分。失败粒度细化到单宿主；还原/会话外安全边界不变。

**Blocked by:** 无（与票 01 正交；按序在其后实施）

**Status:** ready-for-human（已实施 58f3bfd：红先集成用例绿、97/97 全绿；待人工验收）

- [x] 请求协议改造：单宿主单请求，流式 delta 直通（剥标签预览），done 定稿净化写入，无 [N] 标记
- [x] 并发池：runPool limit=concurrency，默认值 4→20，配置页可调
- [x] 删除：batching.js 及其测试、条目装配切分逻辑、config 的 batchSize/maxCharsPerBatch、options 页对应字段、提示词模板标记协议条款（第 5 条改写为单段指令）
- [x] 集成用例（content-rescan harness）：一次 translate = N 个独立端口请求；同时在途 ≤ 并发上限；单请求失败只标记该宿主；会话外安全边界回归
- [x] ADR-0005 新增（取代 0001 分批部分、流式延续）；README 配置表同步；CONTEXT.md「翻译批次」词条改写为「并发池」、「宿主」词条补 pre/code 排除
- [x] 既有+改写测试全绿
