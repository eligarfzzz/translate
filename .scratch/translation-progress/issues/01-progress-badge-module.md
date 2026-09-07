# 01: 进度徽标模块与会话生命周期

**What to build:** 点「翻译」后，视口右下角出现悬浮进度徽标（`position: fixed` 右下角、半透明深底浅字、小号等宽数字、圆角、`pointer-events: none`、最高档 z-index，样式内联硬编码、不用 Shadow DOM），显示零态文案 `0% 0/0(0)`。徽标模块是会话装配的第五块（进度徽标工厂，document 环境显式注入，与 render/translate/observer 平级），接口四方法：`show()` / `addHosts(translatable, all)` / `settled(errored)` / `remove()`，计数与文案渲染收在模块内部。文案格式为 `<pct>% <done>/<total>(<totalAll>)`，错误数 > 0 时追加 `(<errors>)`；`total` 为 0 时百分比按 0 显示（不产 NaN）。本票只接生命周期：会话开启成功后 `show()`、还原路径 `remove()`、会话拒绝重入时不重复 `show()`；`addHosts`/`settled` 的调用方接线在票 02。徽标是扩展注入物，与译文节点同等待遇：硬跳过选择器表排除（自身永不成为宿主），观察器忽略其子树变化（进度跳动不触发重扫）。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 翻译消息路径会话开启成功后徽标上屏，零态文本为 `0% 0/0(0)`（total=0 时百分比按 0，不产 NaN）
- [x] 徽标 fixed 定位视口右下角、半透明深底、等宽小号字、`pointer-events: none`、最高档 z-index，样式内联硬编码
- [x] 点「还原」后徽标从文档移除；再次点「翻译」可重新挂载
- [x] 会话已活跃时重复「翻译」消息不重复挂载徽标
- [x] 徽标元素及其子树永不成为宿主（页面只剩徽标可扫时也不产生端口请求）
- [x] 徽标自身 DOM 变化不触发重扫（不排防抖、不产生额外端口）
- [x] 沙箱集成测试先红后绿，沿用 content-sandbox 既有夹具（消息/端口输入 → DOM 输出），不断言模块内部计数器，不改既有用例
- [x] `npm test` 全绿（lint + 既有用例 + 新用例）

## Comments

2026-09（ticket 01）：新增 src/content-progress.js（进度徽标工厂，会话装配第五块：show/addHosts/settled/remove，计数与文案收在模块内部，样式内联硬编码）。content.js 接线：translatePage 会话开启成功后 badge.show()（拒绝重入时 path 不到）、revertPage 增 badge.remove()。自排除：host-discovery 硬跳过表追加 .translate-progress；content-observer 注入物过滤统一为 .translate-node, .translate-progress（added 判定与属性判定共用）。5 个沙箱集成用例先红后绿（无徽标元素 → 徽标 DOM 断言），断言只落在文档里的徽标元素上，不断言内部计数器，不改既有用例；全量测试 127/127 全绿。addHosts/settled 接线留待 ticket 02。
