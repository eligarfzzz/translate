# 05: 文档校准——as-built 核对与用例数

**What to build:** 对照 spec `.scratch/short-text-cache/spec.md` 逐条核对 D1–D12 与实际实现的漂移：漂移处修订 `CONTEXT.md`「短文本缓存」词条与「空即未设置」布尔条款、`docs/adr/0008-short-text-cache.md`（追加段，不改写历史段落），或如实记录为已知偏差；裁决 ADR-0004（端口协议清单的持有者）是否追加 `done.cached` 的 Evolved 指针；`AGENTS.md` 用例数按票 04 提交后的**实测值**更新（不许推算）。

**Blocked by:** 04

**Status:** resolved

- [x] D1–D12 逐条核对，漂移修订进文档或如实记录（含评审发现的非阻断项处置结论）。
- [x] `CONTEXT.md` / `docs/adr/0008-short-text-cache.md`：按 as-built 校准；行文遵守词表术语（译文节点 / 宿主 / 并发池 / 会话 / 会话重用 / 进度徽标 / 空即未设置 / 短文本缓存）。
- [x] ADR-0004 追加 `done.cached` 指针（追加而非改写），或记录不追加的理由。
- [x] `AGENTS.md` 用例数改成实测值；`src/` 文件数若有变化一并更新。
- [x] 零痕迹；`npm test` 全绿（prettier 覆盖 `CONTEXT.md` / `AGENTS.md`；`docs/adr/` 与 `.scratch/` 在 `.prettierignore` 豁免内）。
- [x] 只动文档，不碰源码与测试。

## Comments

- 屋内 docs-sync 票惯例（session-reuse 票 04）：依赖前一票的实测用例数，故 Blocked by 04。
- spec 的 D 清单是本票的点清单；发现 spec 本身写错的，改 spec 并在 Comments 记录。
- 票 05 实施记录（基线 2c6216e）：D1–D12 逐条核对 as-built（src/cache-store.js、background.js、content.js、content-translate.js、config.js、options.html/options.js）——「短文本缓存」词条、「空即未设置」布尔条款、docs/adr/0008 与实现逐条相符，无漂移，未改动。唯一实质漂移在「会话重用」词条：原句「a chain is exactly its slot's successful segments in order」未排除缓存命中段（D5/Q12：done.cached 段是成功落定但永不入链），已按 as-built 修订该句（增补「缓存命中段同样不入链，链恰为成功且未命中的段」）。
- ADR-0004 裁决：追加 Evolved 指针。其消息清单（delta/done/error）已两次向后兼容演进——restart（ADR-0007）与 done.cached（ADR-0008）——作为协议清单持有者如实追加一段，不改写历史段落。ADR-0007 不追加指针：缓存×链的交互语义由 ADR-0008 自带段落承载并回链 ADR-0007，会话重用核心决策未被推翻。
- AGENTS.md 按实测更新：用例数 214 → 259（npm run test:unit 实测 pass 259 / fail 0）、src 文件数 16 → 17（票 02 新增 cache-store.js）、ADR 清单 0001–0007 → 0001–0008（本特性新增 0008）。
- 评审非阻断项处置：票 01–04 无遗留待处置的非阻断项记录；本票核对亦未发现新的文档漂移或 spec 错误，故 spec 未改。
- 出口标记（主代理）：reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `2c6216e..e67ffe8`），评审在树 == `e67ffe8` 上实测 `node --test` 259/259 与 AGENTS.md 一致。评审非阻断观察项：ADR-0004 既有措辞 "No new message types" 与 restart 的历史张力（ADR-0007 时代行文，未修）。实施者遗留说明：「会话重用」词条首句未逐词排除命中段，语义已由成员资格句闭合（未加注，归遗留 Low）。
