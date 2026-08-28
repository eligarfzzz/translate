# 10: 修复——消息入口唯一化 + 幽灵 import 守门补全

**What to build:** code-review 05 的三项发现，一次修复：

1. **major-1 双份 onMessage 监听**：05 把启动权交给 `src/content-loader.js` 后，`src/content.js` 里 04 时代的自注册没删，同一个 `handleMessage` 挂在两条路径上——会话就绪后每条消息处理两次、`sendResponse` 调两次（Chrome 只接受第一次，第二次在内容脚本控制台报错），日志翻倍。删除自注册，加载器成为唯一注册与派发点；反向修（删加载器转发）会把 document_idle 竞态放回来，不可取。
2. **major-2 幽灵 import 漏网**：`moduleGraph` 原先把不存在的文件静默 `continue`，任意层级的静态 import 指向不存在文件永远不被报告（只有动态入口写错才报）。改为收进 `missing` 并断言；遍历起点从「只有内容脚本加载器」扩成三个入口（service worker / 配置页 / 内容脚本会话模块），后两者只查文件存在性，不要求登记 WAR（只有被页面世界动态 import 的模块图才需要）。
3. **nit-3 WAR 通配语义**：`*` 原译为 `[^/]*`（不跨目录），与 Chrome 的 resources 模式推断不一致，会把 `src/` 子目录里的模块误报为未登记——07 拆分若落进子目录就会撞上假红。改为跨目录匹配。

**Blocked by:** 05（d71531f——缺陷由该提交引入/暴露）

**Status:** done（已实施：68190de）

- [x] `src/content.js` 自注册删除，加载器成为唯一入口；测试基建随之扮演加载器角色，会话自注册非空即回归
- [x] 新增回归用例（先红后绿）
- [x] 守门测试：missing 收集 + 三入口遍历 + WAR 通配跨目录
- [x] 变异验证：幽灵 import 注入 `src/options.js` 后测试变红（修复前 101 全绿）
- [x] 既有测试断言一字未改（content-rescan 仅追加一个 test 块）；lint 0、101/101 绿
- [x] ADR-0006 相关描述同步

## Comments

- 2026-08-29：实施于 commit 68190de（5 文件，+88/−26）。review（reviewer-verify，git archive 字节精确快照 + 30 余组变异）确认三项均真修：major-1 恢复自注册 → exit 1；major-2 四组变异在旧版（d71531f）全绿漏网、新版全抓住；nit-3 双向语义验证一致。
- 新发现并记录在 ADR-0006 Known blind spots（不阻塞）：加载器零可执行测试覆盖（spec 有意为之）；测试沙箱走同步捷径而非缓冲转发路径；WAR `*` 跨 `/` 为阅读推断未经真机验证。
