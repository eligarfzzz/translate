# 02: 风格基线——lint 与 formatter 落地，两代写法归一

**What to build:** 仓库从此有工具替人拦住风格漂移：一条命令跑 lint，一条命令跑测试，`npm test` 串联二者。`var` 与手写索引 for 循环从宿主发现、净化两个模块中消失（它们是仓库里唯一还留着上一代写法的地方），全树排版由 formatter 统一。翻译行为完全不变。

注意：此时源码仍是 classic script（全局符号体系尚在），所以隐式全局那条规则还不能开——它随换轨票一起启用。

**Blocked by:** None (can start immediately)

**Status:** done（已实施：397af67，lint 0、98/98 绿）

- [x] formatter 落地：默认配置，仅放宽单行宽度到 100（设 80 会产生大量与本次无关的换行噪音）；全树格式化一次
- [x] lint 落地：推荐基线 + 禁 `var`、要求 `const`、要求严格等号三条自定义规则（推荐基线本身不管前两条，而两代写法混用正是要根治的东西）
- [x] globals 按目录分段：源文件为浏览器 + 扩展 API，测试与根配置文件为 node
- [x] 宿主发现与净化两个模块现代化：`var` → `const`/`let`，索引 for 循环 → `for...of`；就地删除元素的循环先物化成数组再遍历
- [x] 脚本拆为 lint 与单测两条，`npm test` 串联；lint 零告警
- [x] 98 个既有测试断言一字未改，全绿

## Comments

- 2026-08-28：实施于 commit 397af67。断言未改经独立核验（同一 Prettier 配置下对比 HEAD，唯一非格式化差异是一个未用的解构项）。review（内置 reviewer，无 shell）无 blocker；一项真实依赖缺陷（`@eslint/js` 未登记直接依赖）由修复票 09 处理。
