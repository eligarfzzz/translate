# 03: 会话重用——每槽会话链、对话形态、双触发器重试

**What to build:** 开启 `reuseSession` 后，每个并发槽位自成一条对话链：该槽位**成功段**的（原文、译文）作为历史，新段只带最新文本。background 组装链中消息并**自行**处理两种失败（回显不合包装 / 上下文超限）——各重试一次、以链首形态（无历史）重试，content 侧完全不感知；失败段不进链，重试成功段成为新链首。开关关闭时，一切与现状逐字节一致。

**Blocked by:** 01

**Status:** resolved

- [x] `prompt.js` 导出共用的「恰一层 `<html>…</html>`」判定与包装 helper；`stripHostWrapper` 改为复用同一判定（行为逐字不变，禁止第二套"什么是包装"的标准）。
- [x] `content-translate.js`：`runPool` 每个 worker 持一条链数组；成功落定后 push `{ html, echo: raw }`（原文，原始回显）；失败 / 中断不 push；`reuse` 关闭时不持链、`start` 消息不带 `history` 字段。
- [x] `content.js`：把 `cfg.reuseSession` 透传给 `translateEntries(entries, limit, reuse)`。
- [x] `background.js`：`start` 消息接受可选 `history: [{html, echo}]`；按 spec D4 组装——链首 = 今日那条单 user；链中 = 历史对（`user: <html>原文</html>`、`assistant: 原始回显`，链序最老在前）+ 只有新文本的裸 user（不带模板）。
- [x] `background.js`：流式过程中累积全文；收尾时先判超限错误（文案保守列举，大小写不敏感），再判形态（trim 后整体不是恰一层包装）；两种触发器各重试一次、以链首形态；再败走既有错误通道；每次重试经 debug 通道留痕。
- [x] 空回显（`""` 或 `<html></html>`）不重试，维持既有「未返回译文」口径。
- [x] 落定收口不变：每宿主恰好一次 settle，重试不占额外计数；失败段（含重试失败）不进链。
- [x] 测试：消息组装（链首 / 链中 / 历史顺序 / 包装与 `{host}` 注入同形）；abcdef 并发 3 的链归属（槽 1 的第二段带 `[{a}]`）；失败段不进链；形态重试两种模式（会话 = 第二次请求无历史；非会话 = 同请求重发）；超限重试（仅会话模式）；再败报错；空回显不重试；重试不增 settle。
- [x] **关 = 不变**：`reuseSession` 缺省或 false 时，既有全部测试逐字绿、上游请求计数不变。
- [x] 先红后绿：新断言在旧实现下实际转红（旧实现无 `history` 字段、无重试），记录失败原文；改后绿。
- [x] `npm test` 全绿（lint + node:test）。

## Comments

- 决策来源：spec 的 D3–D8。
- 与 ADR-0005 的关系：其「一宿主一次端点请求」是成功路径的计数口径；失败恢复的重试是额外地请求，不破坏落定收口。ADR 正文由票 04 落笔。
- content 侧的宽容渲染路径保留为纵深防御（background 已挡住不合形态的回显，正常不再命中）。
- 实施于 commit `9d347f8da5a8cf4f8d0288b4a1bf7c1019abcd51`（`feat(session-reuse): 每槽会话链、对话形态与双触发器重试（sr-t03）`）；reviewer-verify 两轴审阅 **PASS / 0 blocker**，范围 `23c5ea0..9d347f8`（8 文件，+980/−37）。11 项验收逐条通过。
- **协议扩展裁决（主代理在实施中下达）**：背景是 worker 发现的票面漏洞——delta 是增量追加、`done` 时才剥壳，失败尝试的全文已经进了 content 的 `raw`；形态重试成功后会把"废话 + 译文"渲染出来，并把 `(原文, 污染回显)` push 进链、污染沿链传播。裁决新增 bg→content 控制消息 `{type:"restart"}`（否掉了"接受污染"与"background 全缓冲（杀流式预览）"两个替代）。它不是顺带的第二职责，而是让恢复机制成立的一半：形态触发器不清链 → 重试成功段入链后，后续段仍带漂移掉的历史；超限触发器不清链 → 下一段继续带超限历史，**每段必然再触顶一次**。故 `restart` = ① 清空本段累积 `raw` 与预览；② 作废本槽已累积的链（`chain.length = 0`）。
- 红证据原文（实施者实测，随后复原）：关 `chain.length = 0` → `AssertionError: 重试成功段成为新链首…`，`actual` = `[ { echo: '[{一}]', html: 'first slot english text' }, { echo: '<html>第二段译文</html>', html: 'second slot english text' } ]`（旧段 `[{一}]` 被带回），EXIT=1 / fail 1；关 `raw = ""` → `AssertionError: 定稿只含重试那次`，`actual` = `'Sure! Here is the translation: 甲段译文'`、`expected` = `'甲段译文'`，EXIT=1 / fail 2。
- 两触发器都发 `restart` 的断言位置：`tests/background.test.js:120`（形态/会话 `["delta","delta","restart","delta","done"]`）、`:142`（形态/非会话 `["delta","restart","delta","done"]`）、`:181`（超限/会话 `["restart","delta","done"]`）；反向守门 `:47`、`:196`、`:281`。
- debug 留痕原文（探针实测）：`retry attempt 2: 回显不合包装 -> drifted junk`、`retry attempt 2: 上下文超限 -> HTTP 400 maximum context length exceeded`。
- **主代理独立探针**（直接驱动 `src/background.js`，不采信子代理结论）**25/25 通过**：关=1 次请求/单条 user/带模板/宿主带包装/无 restart；开=`user,assistant,user` 且最新一轮不带模板；形态=2 次请求、序列 `delta,delta,restart,delta,done`、重试=链首形态；超限+历史=2 次请求+restart+最终 done；超限+链首=1 次请求、无 restart、走 error；空回显=1 次请求不重试；形态两次不合=2 次请求后报错（文案点明包装）。
- 全量：`npm test` **exit 0（214/214，基线 191 → +23）**；lint 通过（prettier 首次报 6 文件，`--write` 后绿）。
- 评审的非阻断项（未修）：① 两段重试序言同形重复（`background.js:155-176` 的 `limitRetries--`/`attemptNo++`/debug/`restart`/`attempt = head` 四步），可抽 `retryAfter(reason, detail)`；② 该文件职责开始发散（菜单接线 + 代理 + 会话组装 + 重试策略），再长就该拆 `background-translate.js`；③ 测试用生产 helper（`renderPrompt`/`wrapHost`）构造期望，链首/链中那两条断言对 helper 存在部分自证（已由 `tests/prompt.test.js` 的字面量断言兜住，且"同形"本就是要求）；④ `restart` 分支的 `if (done) break;` 不可达（`done` 后同步 `finish()` 已先被顶部守卫拦下），与既有 `delta` 分支同形，属一致性而非缺陷。
- 评审确认的正面项：diff 内没有新增任何 `chrome.runtime.onMessage.addListener`（ADR-0006 保持）；新 helper 是纯 ESM；零痕迹；`restart` 清空失败预览**加强**了 `CONTEXT.md` 的「no temporary streaming residue」。
- 评审对 ADR-0005 的观察（由票 04 承接）：ADR-0005 与 `CONTEXT.md` 的「并发池」条目仍写着"一宿主一次请求"，而形态触发器在**关闭**会话重用时也会产生第二次上游请求——票 04 已在 ADR-0007 的「Relationship to ADR-0005」里写明（成功路径计数口径 vs 失败恢复的额外地请求）。
