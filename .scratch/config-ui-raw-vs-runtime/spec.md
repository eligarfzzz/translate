# Spec: 配置两条语义——UI 保存什么读什么，运行时空值回退默认

## Problem Statement

配置页保存空值（清空输入框）后重新打开，UI 回填显示的是默认值而非空——因为 `options.js fillForm` 与 `background.js/content.js` 共用同一个 `mergeConfig`，而它把空串替换成了默认值。用户期望“保存什么读什么”（UI 显示空），同时端点消费必须用默认值兜底（绝不用空串发请求）。单一 merge 函数无法同时满足两条路径。

## Solution

**两条语义路径，同一存储，不同消费语义**：

- **运行时**（`loadConfig`/`mergeConfig`）：`null/undefined/""` 一律回退默认——端点收到的永远是有效默认。非空字符串原样透传（保存什么读什么，不再 trim 校验、不再要求 `{host}`）。数字需有限且 `>0`。`reasoningEffort` 永不可配。
- **UI 回填**（`loadConfigRaw`/`mergeConfigRaw`）：空值透传为空串——配置页显示用户保存的真实值而非默认。非空字符串原样透传。数字同运行时语义。

`background.js` 消费点兜底升级：`promptTemplate` 为空串/纯空白/不含 `{host}` 时回退 `DEFAULT_PROMPT_TEMPLATE`（因为运行时语义现在透传不含 `{host}` 的非空模板，`renderPrompt` 会抛 `missing {host}`，必须在此兜住）。

## User Stories

1. 作为扩展 owner，清空配置页输入框保存后重新打开，UI 显示空（保存什么读什么），而非默认值。
2. 作为扩展 owner，端点消费时空值一律用默认值——空模板用默认模板、空端点/密钥/模型被未配置守卫拦截，绝不用空串发请求。
3. 作为扩展 owner，自定义模板即使不含 `{host}` 也能保存并在 UI 回显；运行时该模板回退默认模板，不崩溃。

## Implementation Decisions

- `mergeConfigRaw` 与 `mergeConfig` 的唯一区别：空值不覆盖成默认，而是保留空（`String(val)` 透传）；`promptTemplate` 空串透传。
- `options.js fillForm` 改用 `loadConfigRaw()`；其余运行时消费方（background/content）继续 `loadConfig()`，零改动。
- `background.js` 模板兜底条件从 `trim()` 升级为 `includes("{host}")`。

## Testing Decisions

- `mergeConfig`：null/undefined/空串回退默认；非空字符串（含纯空白）透传；非空不含 `{host}` 模板透传；空串/缺失模板回退默认。
- `mergeConfigRaw`：空串透传为空串；非空透传；未存键用默认；reasoningEffort 永不可配。
- 既有测试改写 2 个（“拒绝空串/纯空白”“接受含 {host} 拒绝不含”），其余保持。

## Out of Scope

- 纯空白 `"   "` 的 trim 归一（按 `null/undefined/""` 判空，纯空白视为非空透传）。
- 数字字段空值（`concurrency`）的 UI 回显语义（运行时 `>0` 校验保留，UI 透传）。
- ADR-0003 历史决策文本（保持原样，README/config 注释已同步新语义）。

## Further Notes

- 与 html-wrapper-protocol 正交：包装协议管输入/输出格式，本 spec 管配置读取语义。
