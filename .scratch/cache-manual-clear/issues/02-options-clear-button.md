# 02: 配置页「清空缓存」按钮

**What to build:** 用户可见的那一面：配置页「通用」TAB 的按钮行末尾多一个「清空缓存」，点击即清空整个缓存库，状态栏回显清掉了多少条。它不是设置项——不参与「保存」、不写任何配置、不需要重载页面；点完立刻生效，页面上的译文与正在进行的翻译都不受影响。失败时明说失败，而不是假装清掉了。

**Blocked by:** 01（按钮发的那条消息由票 01 落地）

**Status:** resolved

- [x] `options.html` 通用 TAB 的按钮行末尾（`恢复默认` / `导出日志` / `清空日志` 之后）新增「清空缓存」按钮：`type="button"`、`id="clear-cache"`、**不带 `name` 属性**。放在这一行是因为它同属「不参与保存的一次性动作」，挨着缓存那几个控件会被误读成「保存时才生效」的设置项。
- [x] `src/options.js` 新增点击处理器：发 `{ type: "clear-cache" }` 并等回应；回应 `ok` 为真 → 状态栏显示成功文案且含条数（`0` 条也走成功文案，不另写分支）；`ok` 为假、或发送 / 回应本身抛错 → 状态栏显示失败文案（不含技术细节，与成功文案可区分）。
- [x] 点击不触发任何 `chrome.storage` 写入（`sync` / `local` 一字不碰）、不需要先「保存」、也不改任何输入框的值。
- [x] `tests/helpers/options-sandbox.js` 给 chrome 替身补 `runtime.sendMessage`：可注入本次回应（成功 / 失败），并把发出的消息按序记录为可观测列表；沙箱另暴露「点清空缓存」的快捷方法与状态栏读取（沿用既有 `restore()` / `status` 的形态）。
- [x] `tests/options.test.js` 新用例：点击恰好发出一条 `clear-cache`（载荷与类型正确）；成功文案含回应里的条数；`removed: 0` 仍是成功文案；回应失败态时显示失败文案；存储里 `cacheEnabled: false` 时**照样**发出去（D6 在配置页这一侧的承力用例：按钮不因开关关闭而失效）；点击后 `syncWrites` 为空（不写存储）；既有的两条反向守门（表单字段 ⊆ 默认值表键、默认值表键 ⊆ 表单字段）保持绿，即证明新按钮确实没有 `name`。
- [x] 变异验证：在发送前加一条「复选框未勾选就不发」的守卫 → 「开关关闭仍发出」用例必须转红。
- [x] `npm test` 全绿；不碰 `src/background.js` / `src/cache-store.js` / `content*.js`。
- [x] 零痕迹：不出现真实端点、密钥、厂商模型名。

## Comments

- 决策来源：spec `.scratch/cache-manual-clear/spec.md` 的 D2 / D6 / D7 / D9 / D10，以及 Testing Decisions 的「配置页」一条。
- 不加载配置是本票的关键点之一：按钮既不用知道 `cacheEnabled`，也不用读端点 / 模型；谁来判断「要不要清」这件事不存在——用户点了就清。
- 不加二次确认、不去抖：缓存可再生，同族的「清空日志」点了就清；连点第二次照常回「（0 条）」。
- D7 的边界（用户显式要求的动作必须回报成败）在这半落地：失败文案是要求，静默或假报成功是缺陷。
- 实施于 commit `abe0cb2e2863752268dc7c940ceff05722137e38`（`feat(cache-manual-clear): 票 02 配置页「清空缓存」按钮`，4 文件 +118/−5）；reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `f769b09..abe0cb2`）；`npm test` 实测 **272/272**（基线 266，+6）；变异（发送前加「复选框未勾选就不发」守卫）实测 D6 用例如期转红后回滚。跨票契约闭环经评审复核：`clear()` 成功恒返 `{ok:true, removed}`、失败恒返 `{ok:false, removed:0}`，故页面侧 `res.removed` 在 ok 时恒为数字，无「undefined 条」路径。评审非阻断观察项：① `src/options.js:165-167` 的 catch 分支无测试（沙箱 `sendMessage` 只 resolve，无法注入 reject）——票面与 spec 用例清单均未要求，实现本身正确；②「不写存储」只钉了 sync 半面（`tests/options.test.js:761` 断言 `syncWrites` 空，沙箱未暴露 `localWrites`），若将来有人在处理器里加 `DBG.debug`（会写 `log-opt`）不会有测试转红——留作加固建议；③ `options.html:170` 注释措辞略松（直接拦 name'd 按钮的是正向守门，两守门合起来约束 name 集 = 键集）；④ prettier 合规为目视推断（评审按约束未跑 lint），已由主代理出口 `npm test` 实测兑底。状态由主代理在出口统一标记。
