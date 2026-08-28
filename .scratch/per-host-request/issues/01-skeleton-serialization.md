# 01: 投喂骨架序列化——剥属性、input/button 换名、裸 pre 跳过

**What to build:** 宿主快照只剩标签与文本：全部元素属性剥离、input/button 换名为 span（input 的 value 转为文本、button 子内容保留）、媒体 8 标签空占位（既有）叠加生效；裸放/嵌套的 pre/code 段整段静默跳过，与纯码包裹层语义统一；混合段（p+pre）与既有判定行为回归不变。

**Blocked by:** 无（可立即开始；与票 02 正交，按序实施）

**Status:** ready-for-human（已实施 f6d2e3f：红先测试绿、103/103 全绿；待人工验收）

- [x] snapshotHtml 序列化管线：剔译文节点 → 媒体空占位 → input/button 换名 span（value 转文本）→ 剥全部属性
- [x] qualifiesAsHost：候选自身为 PRE/CODE 时不具资格（裸/嵌套 pre 整段跳过）
- [x] 回归用例红→绿：属性全剥（a/href/class 形态）、input value 转文本、button 子内容保留、媒体占位叠加、裸 pre 与嵌套 pre 跳过、p+pre 混合段不变
- [x] 判定侧其余（HARD_SKIP/nonCodeText 可见性）与 sanitize 零改动
- [x] 既有+新增测试全绿
