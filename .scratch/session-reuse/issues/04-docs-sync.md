# 04: 文档同步——CONTEXT.md 词条、ADR-0007、用例数

**What to build:** 新语义进领域文档：`CONTEXT.md` 新增「会话重用」词条，并给「空即未设置」补上布尔类型一句；新增 `docs/adr/0007-session-reuse.md` 记录决策；`AGENTS.md` 的用例数按实测更新。

**Blocked by:** 03

**Status:** resolved

- [x] `CONTEXT.md`：新增词条——可选、默认关；每并发槽位一条对话链，前段（原文 + 译文）作为历史，模型只翻最新文本；失败段不进链；回显不合包装或上下文超限时弃掉历史、以新会话重试一次；还原即丢弃。英文行文，沿用既有词汇写法。
- [x] `CONTEXT.md`：「空即未设置」词条补一句布尔规则（只有 `true` 落盘，未勾选 / 其他类型视为未设置）。
- [x] `docs/adr/0007-session-reuse.md`：动机（同区域术语与风格一致）；纯客户端 messages 累积、不用服务端 session id；每槽一条链（并发语义不变）；失败段不进链；两触发器重试语义；与 ADR-0005 的关系（成功路径计数口径 vs 失败恢复的额外地请求）。遵守 ADR 追加规则（不改写历史段落）。
- [x] `AGENTS.md`：用例数改成票 03 提交后 `npm test` 的**实测值**（不许推算）。
- [x] 与 spec 逐条核对 D1–D11，发现漂移就修正文档或如实记录。
- [x] 零痕迹（无真实端点、密钥、厂商模型名）；`npm test` 全绿（prettier 覆盖根 Markdown）。
- [x] 只动文档（`CONTEXT.md`、`docs/adr/`、`AGENTS.md`），不碰源码与测试。

## Comments

- 依赖票 03 的实测用例数，故 Blocked by 03。
- spec 的 D9 是本票 ADR 的点清单。
- 实施于 commit `1ed5264ca870bba5470ade7ad7d0742c1e7f581f`（`docs(session-reuse): CONTEXT.md 会话重用词条与布尔判空、ADR-0007、用例数按实测更新（sr-t04）`）；reviewer-verify 两轴审阅 **PASS / 0 blocker**，范围 `9d347f8..1ed5264`（3 文件，+22/−3）。7 项验收逐条通过。
- 实测：`npm test` 在票 03 提交 `9d347f8` 上 = **214/214 exit 0**（用例数取自该次实测，非推算）；文档改完复跑 **214/214 exit 0**；`npx prettier --check .` exit 0（`docs/adr/` 与 `.scratch/` 是仅有的两个例外，故新 ADR 不在格式检查范围）。
- **与 spec 逐条核对的 as-built 漂移（均如实写进文档、未改源码）**：
  - D5「协议只增一个可选字段」→ 实际还新增了 bg→content 的 `restart` 控制消息（流式预览撤不回）——写进 ADR-0007；
  - D6 的超限重试实际以"本请求**携带历史**"为门（链首不重试：无历史可弃，重试内容与首次逐字相同）——写进 ADR + `CONTEXT.md`；
  - 形态重试**两种模式都适用**，故「关 = 与现状逐字节一致」只对**请求形态**成立（关着也会有第二次请求）——两处文档都写明；
  - D8 精度：`reuseSession`/`concurrency` 在轮次开始时读取，而请求时配置仍逐请求读取（沿用 ADR-0003 的既有口径）。
- 评审的非阻断项（未修）：① `CONTEXT.md:27-29` 与 ADR-0007 行文高度重复（同一批事实几乎逐句重述；仓库有"词表 ↔ ADR 重叠"先例，但这一对的重复度偏高，长期有漂移风险——建议一边留稳定定义、一边留机制细节）；② `CONTEXT.md` 的「并发池」条目仍绝对化（"Every host travels alone — one request…"、"Requests are independent."），而形态触发器在**关闭**会话重用时正是例外，建议补一句限定或注明由 ADR-0007 拥有该例外；③ 本仓惯例是让拥有协议的 ADR 追加演进指针（ADR-0003/0004 均有 "Evolved:" 段），ADR-0004 拥有 `delta`/`done`/`error` 消息列表，如今协议多了可选 `history` 与 `restart`，只看 ADR-0004 会看到过期清单——建议追加指针（追加而非改写，符合 `.prettierignore` 的规则）；④ nits：`CONTEXT.md:27` "Both retries happen inside background" 缺冠词（仓库英文行文用 "the background service worker"）；词条里 "slot" 出现五次而未与词表术语「并发池」对齐，建议首次出现时写作 "a slot (one worker of the 并发池)"。
- 评审确认：上述 ③ 是选项而**非硬违规**；`docs/adr/` 被 prettier 排除，故 `npm test` 不校验新 ADR 排版（`CONTEXT.md`/`AGENTS.md` 在覆盖范围内且通过）。
