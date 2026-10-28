# 04: 评审后续修正——TAB 重入、表头术语与分页上界

**What to build:** 修复票 01–03 两轴评审确认的高风险问题：点击当前已选中的「通用」TAB 不应把用户翻到的页码打回第一页；缓存列表的表头使用领域词表里的「骨架原文」；列表消息的每页条数在存储边界有上界，避免异常调用一次取走整库。顺带消除命中计数注释里的 D 号歧义，并清理评审指出的无用测试夹具。

**Blocked by:** 03（已完成；修正基于当前 as-built）

**Status:** resolved

- [x] 点击当前已选中的「通用」TAB 不重新读取、不改变当前页；离开后重新进入仍读取第 1 页。
- [x] 新增设置页用例覆盖「点击已选中 TAB 不丢页码」，并保留既有进入/离开重读用例。
- [x] 缓存表格第一列表头改为「骨架原文」，与根上下文词表和 spec 一致；相应用例同步。
- [x] 存储分页查询把每页条数限制在 1–100；超界请求按 100 返回，回应里的 `pageSize` 为实际生效值。
- [x] 新增存储与 background 用例覆盖超大 `pageSize` 被截到 100。
- [x] 命中计数的相关注释明确区分 cache-inspection 与短文本缓存的决策编号，不再让两个 D10 在同一段里各指一义。
- [x] 删除或实际使用测试中未被消费的夹具参数/响应，避免误导读者。
- [x] 仓库代理说明的实测用例数按本次结果更新；不修改既有历史文档段落。
- [x] 完整测试与 lint 通过；不改变既有翻译、命中、清空、清理和端口协议语义。

## Comments

- 来源：票 01 reviewer 的「点击已选中通用 TAB 重置分页」「表头原文 vs 骨架原文」「pageSize 无上界」，票 02 reviewer 的 D10 双义注释与无用测试夹具。前两项为确认的行为/术语问题，第三项为明确的输入边界风险，故合并为一张修复票。
- 未纳入本票的 Low：`cache-store` 列表游标循环与 `scanByIndex` 的重复、跨文件总页数公式重复、`sendMessage` try/catch 形状重复。它们不影响行为，留待下一轮重构。
- 本票完成后需要重新评审并同步最终文档与票据状态。

### 实施记录（基线 3e8fe47）

- **TAB 重入**（`src/options.js` 的 `selectTab`）：开头加一条 `aria-selected === "true"` 即返回——点击当前已选中的 TAB 是空操作，面板、焦点态本就正确，唯一被跳过的是 `loadCachePage(1)`。离开再进入仍走原路径（那时该 TAB 的 `aria-selected` 为 `false`），既有「离开再进入重新读取第 1 页」用例原样保留并通过。
- **表头术语**（`options.html`）：第一列 `<th>` 由「原文」改为「骨架原文」，与 CONTEXT 词表「短文本缓存」词条的措辞一致；同文件上方那条说明表格排版的注释一并改为「骨架原文/回显」，避免同一屏两套叫法。
- **分页上界**（`src/cache-store.js` 的 `list`）：新增模块常量 `PAGE_SIZE_MAX = 100`，`size` 改为 `Math.min(PAGE_SIZE_MAX, Math.max(1, Math.trunc(pageSize) || 1))`。上界落在存储边界而非调用方——设置页的 `CACHE_PAGE_SIZE` 仍是 20，异常调用（含直连 background 的 `list-cache`）最多取走 100 条；`page` 归一与总页数公式都基于生效后的 `size`，回应里的 `pageSize` 因此是实际生效值。
- **D 号双义**：`cache-store.js` / `background.js` 里凡是指 cache-inspection 的决策一律写「cache-inspection D10/D11/D12」，凡是指短文本缓存的降级收口写「短文本缓存 D10」。`get()` 那段注释原本把「命中事务 D10」与「故障静默 D10」并排写，现在两个不同 spec 的编号各带前缀，同一段里不再一号两义。
- **无用夹具**：`tests/options.test.js` 的 `cacheEntry(n, lastUsedAt = n, hitCount = 0)` 三个参数从未被调用方覆盖，收回成 `cacheEntry(n)`（`lastUsedAt` 取 `n`、`hitCount` 固定 0，需要别的次数时直接写条目字面量）；`tests/background.test.js` 的「两次真实命中累计为 2」用例备了第二条 `覆盖译` SSE 响应，但该用例只发一次上游请求，删掉这条永不消费的响应。
- **红→绿证据**：先改测试后改实现。红：`node --test tests/options.test.js` → 2 条失败（「点击已选中的 TAB 不重新读取」页码被打回第 1 页、「表头…」实得「原文」）；`node --test tests/cache-store.test.js tests/background.test.js` → 2 条失败（两处 `pageSize` 实得 100000、期望 100）。绿：实现落地后两条命令均 0 失败。
- **实测**：`npm test`（eslint + prettier --check + node --test）退出码 0，**337/337** 全绿（本票 +3 用例：设置页 1、存储 1、background 1）；`npm run lint` 单独再跑一次，退出码 0。
- **AGENTS.md**：用例数 334 → **337**（实测数字，非推算）；`src/` 17 个文件、ADR 0001–0008 未变。既有历史文档段落（`.scratch/cache-inspection/spec.md`、ADR、票 01–03）一字未动。
- **语义不变**：翻译请求与命中回放、`done.cached`、清空与自动清理的消息契约、内容脚本端口协议均未改动——本票只动了设置页 TAB 分支、表头文案、`list` 的入参上界与注释。
