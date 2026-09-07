# 03: 注入物选择器单一来源重构

**What to build:** 消除扩展注入物选择器的双处手工同步（review-01 遗留项，owner 拍板重构）。新建常量模块导出 `INJECTED_SELECTOR`（值为 `.translate-node, .translate-progress`，即本扩展插入页面的一切元素：译文节点、进度徽标），host-discovery 的硬跳过表与 content-observer 的注入物过滤都 import 这同一份定义；两处「手动同步」注释替换为指向单一来源的注释。这是行为不变的重构：既有全部用例保持原样并通过；新增一个跨文件一致性用例（仿 manifest-consistency 先例），断言硬跳过表确实包含共用注入物选择器，防止未来有人回填字面量绕过单一来源。

**Blocked by:** 01, 02（已完成）

**Status:** resolved

- [x] 注入物选择器只有一个定义来源（新常量模块 `INJECTED_SELECTOR`），host-discovery 的硬跳过表与 content-observer 的注入物过滤均 import 使用
- [x] 代码库中不再存在注入物类名字面量的第二处拷贝（grep 验证）
- [x] 两处「手动同步」注释更新为指向单一来源
- [x] 新增一致性测试：硬跳过选择器包含共用注入物选择器
- [x] 既有用例零改动（行为保持），`npm test` 全绿
- [x] refactor 类型 commit，与功能 commit 分开

## Comments

- 实施于 commit `f6ad075`；双路并行审查（两轴 + 重构专项）均 NO_BLOCKER。
- 边界确认（supervisor 通道）：className 写入点与 snapshot/清扫的单类查询是类名身份而非组合选择器拷贝，不在本票范围；守门正则按精确顺序匹配组合字面量，局限已在测试头注释声明。
