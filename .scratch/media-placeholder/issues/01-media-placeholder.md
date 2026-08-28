# 01: 媒体标签占位化——投喂条目不再携带图形数据

**What to build:** 任何含 SVG/图片等媒体的页面，翻译请求的条目里媒体标签只剩同名空占位——base64 与路径数据不再进入 prompt，含图段落正常进批、语序保持；alt/title 丢弃；判定与净化行为零变化。

**Blocked by:** 无（可立即开始）

**Status:** ready-for-human（已实施 c3e9ced：两轴评审通过、无 blocker、92/92 测试绿；待人工验收）

- [x] snapshotHtml 将 8 个媒体标签（img/svg/picture/source/video/audio/canvas/map）替换为同名空占位（去属性去子树）
- [x] 回归用例红→绿：base64 img、svg path、picture/source 组合的占位断言；alt 随标签丢弃
- [x] pre/code"投喂保留"语义的回归用例不破
- [x] 判定侧（HARD_SKIP / nonCodeText）与 sanitize 零改动
- [x] 既有+新增测试全绿
- [x] CONTEXT.md 增补"媒体占位"词条
