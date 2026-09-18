# 04: content 侧——cached 段跳过入链与清理触发

**What to build:** content 侧的两处小切口。其一：`done` 消息带 `cached: true` 时，该段照常预览/定稿/落定计数，但**跳过 `chain.push`**——缓存命中段永不进入会话重用的链，模型永远不会读到非本轮产生的译文（Q12 决策）；槽位前几段全命中时，链从第一个未命中段开始累积。其二：首轮 `runRound` 落定后（会话仍活跃且 `cacheEnabled` 开）向 background 发一条 `cleanup-cache` 消息，**每会话恰好一次**；重扫（`runRound(false)`）不发，开关关时不发，还原后迟到的收尾不发。

**Blocked by:** 03

**Status:** resolved

- [x] `done` 处理：渲染路径（剥壳、净化、定稿）逐字节不变；`msg.cached === true` 时不执行 `chain.push`，其余照旧。
- [x] 首轮清理触发：首轮 `translateEntries` 全部落定后、且会话仍活跃、且当次配置 `cacheEnabled` 为真，发送一次 `cleanup-cache`；同一会话的后续重扫不再发。
- [x] `tests/content-session-chain.test.js` / content-sandbox 新用例：cached 段不进链（同槽下一请求的 `history` 不含该段）；非 cached 段照常进链（回归）；首轮后 cleanup 消息恰好一次；重扫后不再发；开关关时不发；还原后不发（会话已关）。
- [x] `npm test` 全绿；不碰 background / 存储模块 / 配置页。
- [x] 零痕迹。

## Comments

- 决策来源：spec 的 D5 / D7 的 content 半。
- 进度徽标与落定收口不在本票范围：cached 命中走的仍是既有 `finish()` 唯一收口，每宿主恰好一次，无需新测试之外的改动——回归不绿才说明票 03 破坏了契约。
- 本票改动量小，但协议标志与触发时机的语义都在这里定型，请照 spec 逐条核。
- 实施于 commit `2c6216e43db0b356783a34e1eac06baca8c37e2f`（`feat(content): cached 段跳过入链 + 首轮落定后 cleanup-cache 触发（票 04）`，4 文件 +208/−1）；reviewer-verify 两轴审阅 **PASS / 0 findings**（范围 `a4da3ee..2c6216e`）；`npm test` 实测 **259/259**（+7）；变异验证（去 `isActive()` 守卫 → revert 竞态用例如期变红）确认守卫承力。边缘记录（非 finding）：首轮零宿主也会发清理，D7 文本下成立且无害。状态由主代理在出口统一标记。
