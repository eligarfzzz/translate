# 03: 评审跟进——`settledAll` 改名与耗时兜底对称化

**What to build:** 收掉票 01 评审提出的两个 Standards 轴判断项（纯可读性 / 防御性，**零行为变化**）：全档位落定计数 `settledAll` 改名为 `settledAllCount`——它是计数器，旧名字读起来像布尔"全部已落定"；`format()` 里 `${allSecs}` 补上 `?? 0`，与 `${mainSecs ?? 0}` 对称——评审已用 7 组次序推演 + 用例证明该分支**今日不可达**（显示条件蕴含 `allSecs !== null`），这次兜底是为了让显示条件将来被改写时不会把字面 `null` 打到页面上。**不改行为、不改断言、不新增测试**（没有新的可观测行为可供断言）。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `src/content-progress.js` 的 `settledAll` → `settledAllCount`：声明处、`settled()` 的自增与定格判定、`format()` 的显示条件、`remove()` 的归零，全部同步。
- [x] 改名后该文件不得残留旧标识符：`grep -n 'settledAll' src/content-progress.js` 的每一处都必须落在 `settledAllCount` 里（自带前缀，故需逐处核对而不是只看 grep 是否有输出）。
- [x] `format()` 的模板串 `${allSecs}` → `${allSecs ?? 0}`；注释说明这是**防御性**写法（显示条件已蕴含非 null），避免后人当作冗余删掉。
- [x] 本票**只碰 `src/content-progress.js` 一个文件**：`tests/`、`CONTEXT.md`、`AGENTS.md` 一律不动（断言与文档描述的是对外行为，改名属模块内部实现细节）。
- [x] 行为零变化：`npm test` 全绿且**用例数不变**（184）；不得新增、删除、改写任何断言；不得出现任何格式化以外的顺带改动。
- [x] 证据形态（本票不适用红→绿，见 Comments）：`git diff --stat` 只列 `src/content-progress.js`；`npm test` 退出码 0 且 `tests 184 / pass 184 / fail 0`；`git diff --stat` 中不出现 `tests/`。

## Comments

- 来源：票 01 评审 Standards 轴的三条判断项。用户选择收掉其中两条（改名、对称兜底）；第三条（两处定格子句与两处解冻分支同形重复）评定为**恰两个集合时明确写法优于抽表**——抽表在这个规模上会滑向投机泛化，**不收**。
- 无红→绿：本票不产生新的可观测行为，没有"先写断言看红"的正当时机；证据形态改为「diff 只碰一个文件 + 全量套件原样通过 + 用例数不变」。
- 外部引用同步：`spec.md` 的 D1/D2 提过 `settledAll` 这个内部名，由主代理在同轮收尾里改为新名，并补一条 D10 记录对称兜底；本票不动 `.scratch/` 下任何文件。
- 不新增导出、不改签名：`createProgressBadge({ doc, now })` 的对外形态与四个方法签名一字不改。
- 实施于 commit `1115f94`；reviewer-verify 两轴审阅 **PASS / 0 blocker**，范围 `9c91528..1115f94`（1 文件，+9/−6）。6 项验收全部满足。
- 评审的验证手法（比我预期的更强）：把 `git show` 两个版本的代码**去空白 + 去注释后逐字节比对**，只剩两处差异——`settledAll` → `settledAllCount`（5 处）与 `(${allSecs})` → `(${allSecs ?? 0})`；连同 `tests/` 相对父提交字节不变，坐实「零夹带、行为零变化」。
- 评审的旧名扫描：`git grep -nP 'settledAll(?!Count)'` 在 `src/`、`tests/` **零命中**（仓库其余命中都在 `.scratch/` 文档里）。
- 主代理独立复核（不采信子代理结论）：`grep -rn settledAll src tests` 只剩 `settledAllCount` 的 5 处（:29/:50/:93/:95/:109）；`npm test` → **184/184，exit 0**；工作区干净。
- 评审的零影响 nit：`src/content-progress.js:43` 句末顺带补了一个句号（落在本票重写的同一注释块内），超出票面字面范围但无行为影响。
- **未修缺陷（评审发现、主代理已复现，待开票 04）**：本票新增的注释把「今日不可达」说宽了——`${mainSecs ?? 0}` 是**活分支**，不是防御性冗余。复现：只含边缘档宿主的页面（主内容 0 个，`total === 0`）→ `mainSecs` 恒为 `null`，而显示条件 `totalAll > 0 && settledAllCount === totalAll` 照样成立，实得 `0% 0/0(2) 0(3)s`（括号外那个 `0` 即该兜底产物），且这正是 spec **D4** 的要求。`${allSecs ?? 0}` 才是真正的死分支。评审判定为低严重度、不阻断本票验收；修法是把「今日不可达」限定到 `${allSecs}`。
- 收尾项已完成，并被后续修订推进：
  - `spec.md` 的 D1/D2 已同步新名、D10 已补（commit `59a5e40`）；
  - D10 的措辞随后又被 spec 修订改成更直白的版本（去掉"今日不可达"，明确 `${mainSecs ?? 0}` 是活兜底、`${allSecs ?? 0}` 是当前代码路径走不到的兜底）——起因是用户质疑"为什么是今日不可达，明日可达吗"。
- 「未修缺陷（待开票 04）」已开票：**票 04** 把 R9 并入实施，修法比本票记录的建议更进一步——不再只是"限定到 `${allSecs}`"，而是按 D10 把两种兜底的性质分别写清楚。
- 第 3 条验收项里"注释说明这是**防御性**写法（显示条件已蕴含非 null）"这句表述**本身就是** R9 的来源（把只适用于 `${allSecs}` 的性质套到了 `${mainSecs}` 上）；该注释由票 04 重写。本票的验收记录不追改。
