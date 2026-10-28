# 03: 文档校准——按实际实现核对与更新实测数量

**What to build:** 对照 spec 和实际实现逐项核对缓存查看与命中统计，校准根上下文、ADR-0008、两份旧 spec 的范围标注，以及仓库代理说明中的实测数量；只修改文档。

**Blocked by:** 02（需要最终实现和实测结果）

**Status:** ready-for-agent

- [ ] 逐条核对 spec 的实现决策与测试决策，发现实现漂移时修正文档或记录已知偏差。
- [ ] 根上下文保持词表定位，ADR-0008 只校准演进段，不改写既有历史决策。
- [ ] 两份旧 spec 的范围说明与最终功能一致。
- [ ] 代理说明中的源文件数、测试用例数和 ADR 范围按实测更新，不推算。
- [ ] 运行完整测试与 lint 并记录实测结果；本票不修改源代码或测试。

## Comments

- 本轮设计阶段已经同步根上下文、ADR-0008 与旧 spec 的范围说明；本票负责按 as-built 复核，一致则记录核对结论，不一致才修订。
- ADR-0004 无需纳入新消息清单：其管辖的是 content 与 background 的翻译端口协议，本功能新增的是设置页与 background 的 runtime 请求—响应消息，由 ADR-0008 承载。

### 实施记录（基线 9638e93）

- **D1–D16 逐条核对 as-built，结论：无实现漂移。** D1 表格在 `options.html` 的 `#panel-general` 内、无任何带 `name` 的控件（`tests/options.test.js` 守门断言 `[name]` 数为 0）；D2 整库不分指纹（`src/cache-store.js` 的 `list()` 只按 `lastUsedAt` 索引扫描，`src/background.js:222` 的 `list-cache` 分支不 `loadConfig`、不看 `cacheEnabled`）；D3 四列为原文/回显/次数/时间、全部 `textContent` 注入；D4 每页 20（`src/options.js:141` 的 `CACHE_PAGE_SIZE`）倒序（`openCursor(null, "prev")`），页码文案为 `第 N / M 页 · 共 T 条`；D5 页码归一（`Math.min(wanted, pages)`，空库 `pages` 归 1）；D6 进入「通用」TAB 读第 1 页、清空成功回第 1 页（`src/options.js:121`、`:242`）；D7 复用索引 + `originalOfKey(cursor.primaryKey)` 还原原文、值只存 `{ echo, hitCount, lastUsedAt }`；D8 `list-cache` 独立消息、契约 `{ ok, page, pageSize, total, entries }`；D9 故障返回 `{ ok: false }` 且设置页显示「缓存读取失败，请重试」；D10 命中在同一次读写事务里 `hitCount + 1` 并刷新 `lastUsedAt`；D11 `put()` 同事务先读旧值、`rec?.hitCount ?? 0` 保留次数；D12 `DB_VERSION` 仍为 1（`2eeb62a` 与本基线同为 1），无新仓库/索引；D13 清空/过期/淘汰都删整条、同键重建归零；D14 无全局命中率/未命中统计；D15 内容脚本零改动（`git diff a257833..HEAD --name-only` 无任何 `content*.js`）；D16 无真实端点/密钥/厂商模型名。
- **测试决策核对**：三层接缝与 spec 一致（存储工厂注入内存 IndexedDB、background 沙箱的 runtime 消息、jsdom 设置页）。内存替身实际补了三处而非两处——`prev` 游标方向、`dump()` 全库转储、`seedValue()` 直写旧值形态——spec 原文只写了「游标方向与分页能力」，已在 `.scratch/cache-inspection/spec.md` 的 Testing Decisions 按 as-built 补全（本票唯一一处 spec 修订，属描述不全而非实现漂移）。
- **关键变异实测**（在仓库外的副本上执行，仓库内源码与测试一字未动）：移除命中递增 → 存储侧 5 条转红；覆盖写改成次数归零 → 存储侧 1 条 + background 侧 1 条转红；列表加「只列某指纹」的过滤 → 存储侧「展示整库」与 background 侧「整库——异指纹条目也在回应里」双双转红；`list-cache` 加 `cacheEnabled` 守卫 → background 侧「开关关闭时照样可读」转红。四处变异均被杀，与 spec 的关键变异清单相符。
- **根上下文（CONTEXT.md）**：保持词表定位，只修两处与 as-built 不符的措辞——①「This is **the one** cache action that answers back」已不成立（列表读取失败同样回报用户，D9），改为「one of the two」；②表格一句补上「读取失败如实上报、不伪装成空库」。未新增词条、未改其它词条。
- **ADR-0008**：只复核 Evolved 演进段，**未改动**——该段逐句与 as-built 相符（整库不分指纹、开关无关、`lastUsedAt` 反向索引 + 主键还原原文、越界归一、空库空首页、进 TAB 与清空后重读、不提供跨标签刷新与快照隔离、次数按缓存键、覆盖写保留、删除即丢统计、旧条目零、DB 版本不变、失败可见 vs 翻译期静默、纯文本渲染）。历史段落一字未动。
- **ADR-0004 裁决（沿用上一轮先例）：不追加指针。** `list-cache` 与 `clear-cache` 同为 options → background 的 runtime 请求—响应消息，不在 ADR-0004 的管辖面（其消息清单是 content ↔ background 的端口协议）；契约由 ADR-0008 的 Evolved 段承载，ADR-0004 的核心决策未被触动。
- **两份旧 spec 的范围标注**：`.scratch/short-text-cache/spec.md`（统计面板→部分搬进范围）与 `.scratch/cache-manual-clear/spec.md`（条目浏览→部分搬进范围）的标注已与最终功能一致，**未改动**；两处历史决策段一字未动。
- **AGENTS.md 按实测更新**：用例数 294 → **334**（`npm test` 实测 pass 334 / fail 0）；`src/` 文件数 **17** 未变（`ls src | wc -l`，本轮无新增源文件）；ADR 清单 **0001–0008** 未变（`ls docs/adr | wc -l` = 8，本轮无新增 ADR）。
- **实测**：`npm test`（eslint + prettier --check + node --test）退出码 0、**334/334** 全绿；`npm run lint` 单独再跑一次，退出码 0。
- **范围自律**：本票只改文档——`git diff --stat` 仅 `AGENTS.md`、`CONTEXT.md`、`.scratch/cache-inspection/spec.md` 与本文件；`src/`、`tests/`、`options.html` 一字未动。
