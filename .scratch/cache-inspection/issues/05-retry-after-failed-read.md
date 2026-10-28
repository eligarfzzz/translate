# 05: 修复读取失败后的 TAB 重试并收口 D 号注释

**What to build:** 恢复列表读取失败后的重试路径：当前已选中的「通用」TAB 在最近一次读取成功后点击是空操作；最近一次读取失败后再次点击必须重新读取第 1 页，而不是被早退挡住。同时把两个文件中残留的无前缀决策编号补上所属 spec，避免同一模块里的 D8/D10 指向不同决策。

**Blocked by:** 04（修正基于当前 as-built）

**Status:** resolved

- [x] 设置页记录最近一次缓存读取是否成功；成功时点击已选中「通用」TAB 仍不重读、不改变页码。
- [x] 最近一次读取失败后点击已选中「通用」TAB，重新发出第 1 页请求并有机会恢复。
- [x] 新增设置页用例覆盖失败后重试；保留「成功后点已选中 TAB 不重读」和「离开再进入读第 1 页」用例。
- [x] 存储与设置页中残留的无前缀 D6/D8/D10 注释补上 cache-manual-clear 前缀；不改变代码行为。
- [x] `PAGE_SIZE_MAX` 归入模块常量区，保持单一集中位置。
- [x] 仓库代理说明的实测用例数按本次结果更新。
- [x] 完整测试与 lint 通过；不改变翻译、命中、清空、清理和端口协议语义。

## Comments

- 来源：票 04 reviewer 的「early return 移除了失败后的唯一重试路径」与残留 D 号注释。重试路径是相对修复前的确认行为回退，故单独修复。
- ADR-0008 的 as-built 规则（点已选中 TAB 在成功后为空操作、失败后重试；pageSize 上限 100）由主代理在文档收口时同步。
- 本票完成后重新评审并进入最终出口。

### 实施记录（基线 9383105）

- **重试路径**（`src/options.js`）：新增模块级 `lastCacheReadOk`，由 `loadCachePage` 在每次回应后按 `Boolean(res?.ok)` 维护（发送 / 回应抛错也算失败）。`selectTab` 的早退条件收窄为「已选中 **且**（不是通用 TAB **或** 最近一次读取成功）」：成功后点已选中的「通用」TAB 仍是空操作、不动页码；失败后再点则放行到原有的 `loadCachePage(1)`，即第 1 页重读。离开再进入不受影响——那时 `aria-selected` 为 `false`，本就走原路径。`panel-general` 的判定提到函数开头复用（`onGeneral`），行为不变。
- **D 号前缀**：`src/options.js` 里指 cache-inspection 的 D3/D4/D5/D6/D8/D9/D11/D14/D16 全部加 `cache-inspection ` 前缀；「清空缓存」段里指 cache-manual-clear 的 D6/D7/D10 加 `cache-manual-clear ` 前缀。`src/cache-store.js` 里指短文本缓存的 D1/D2/D6 加 `短文本缓存 ` 前缀，`原文还原` 的 D7 与 `list()` 内的 D5/D8/D9/D11 加 `cache-inspection ` 前缀，`clear()` 里「清空不是屏障」的 D8 加 `cache-manual-clear ` 前缀。收口后两文件已无任何无前缀 D 号（`grep -n 'D[0-9]' src/options.js src/cache-store.js` 的每一处都带 spec 前缀），代码行为一字未变。
- **`PAGE_SIZE_MAX`**（`src/cache-store.js`）：从 `scanByIndex` 与工厂之间挪进模块顶部常量区（`DB_NAME` / `DB_VERSION` / `STORE_NAME` / `INDEX_NAME` 之后），仍是唯一一处定义，`list()` 的引用不变。
- **红→绿证据**：先写用例后改实现。红：`node --test --test-name-pattern="读取失败后点击已选中" tests/options.test.js` → 1 失败（实得 1 条 `list-cache`，期望 2 条——早退挡住了重试）。绿：实现落地后同一命令 0 失败；`node --test --test-name-pattern="缓存表格" tests/options.test.js` → 18/18 通过（含既有的「成功后点已选中 TAB 不重读」「离开再进入读第 1 页」）。
- **变异验证（两向各跑一次，在仓库内临时改动后逐字还原）**：① 早退改回无条件的 `if (aria-selected === "true") return;` → 新用例转红、17 过 1 败；② 早退整条删掉（`if (false) return;`）→ 新用例与「点击已选中的 TAB 不重新读取」双双转红、16 过 2 败。两条用例各守一个方向，缺一不可。
- **实测**：`npm test`（eslint + prettier --check + node --test）退出码 0，**338/338** 全绿（本票 +1 用例）；`npm run lint` 单独再跑一次，退出码 0。
- **AGENTS.md**：用例数 337 → **338**（实测数字，非推算）；`src/` 17 个文件、ADR 0001–0008 未变。
- **语义不变**：翻译请求与命中回放、`done.cached`、清空与自动清理的消息契约、内容脚本端口协议均未改动——本票只动了设置页 TAB 分支、两处注释前缀与一个常量的位置。
