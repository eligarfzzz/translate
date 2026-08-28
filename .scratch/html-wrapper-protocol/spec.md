# Spec: HTML 包装协议——输入包 <html>，输出剥最外层

## Problem Statement

宿主即请求（ADR-0005）把单宿主骨架 HTML 直接注入提示词。实测（network-log.har，135 条端点请求）模型对裸 HTML 片段的回显行为不稳定：对短片段（用户名等）会自行添加代码围栏、`<pre>` 加壳、甚至幻觉生成整页 HTML；且片段缺乏明确的"这是一整块页面片段"的边界标记，模型容易把指令文字与片段混为一谈。同时配置层对提示词模板的消费点（background.js 的 `renderPrompt` 调用）没有空串防御，依赖 config.js 的间接兜底。

## Solution

**HTML 包装协议**：

- **输入侧**：`renderPrompt` 注入 `{host}` 时统一包一层 `<html>…</html>`——给模型明确的"完整片段边界"信号，模板示例同步展示 `Input: <html>…</html>` / `Output: <html>…</html>` 的对应关系。
- **输出侧**：`stripHostWrapper` 剥离模型回显的最外层 `<html>…</html>` 包装后再写入译文节点（容忍属性、大小写、首尾空白；无包装原样返回；纯空壳 `<html></html>` 归一为空串，正确落入"未返回译文"错误分支，而非写入空 div）。
- **空串回退**：`background.js` 消费点对空串/纯空白模板回退 `DEFAULT_PROMPT_TEMPLATE`（与 config.js 既有兜底形成双保险）。

## User Stories

1. 作为扩展 owner，投喂给端点的提示词片段带 `<html>` 边界包装，模型回显同样包装，协议自洽。
2. 作为页面读者，模型按模板回显 `<html>…</html>` 包装时，写入译文节点的内容不含这层包装（已被剥离）。
3. 作为扩展 owner，模型只回 `<html></html>` 空壳时，该宿主显示"未返回译文"错误而非空白 div。
4. 作为扩展 owner，配置页把提示词模板清空保存后，翻译仍使用默认提示词，不抛 `missing {host}`。

## Implementation Decisions

- `stripHostWrapper(text)`：`String(text).trim()` 后用 `/^<html[^>]*>([\s\S]*)<\/html>$/i` 匹配；命中则返回 `m[1].trim()`，否则返回 trim 后的原文。贪婪匹配天然只剥最外层一层（双重包装留内层 `<html>`）。
- 剥离时机：content.js `done` 定稿处先剥离再判空/净化；流式预览不受影响（`TextUtils.textOf` 本就剥所有标签）。
- 空串回退：background.js `streamTranslate` 中 `cfg.promptTemplate && cfg.promptTemplate.trim() ? cfg.promptTemplate : DEFAULT_PROMPT_TEMPLATE`。
- 测试：删除 3 个旧语义断言（"注入位置恰好替换""多占位符""null/undefined 渲染为空串"——均与新包装语义冲突）；新增 3 个包装协议断言。

## Testing Decisions

- 接缝（纯函数）：渲染输出含 `<html>` 包装；`stripHostWrapper` 剥最外层；文本本身含 html 只剥一层（含双重包装用例）。
- 既有测试：其余 prompt 测试、host-discovery/config/content-rescan 保持绿。

## Out of Scope

- 代码围栏（```）剥离——模型若输出围栏包住 `<html>`，不在本协议处理范围（sanitize 兜底，围栏文本原样显示）。
- 配置语义拆分（UI 保存什么读什么 vs 运行时空值回退默认）——由独立 spec 覆盖（见 .scratch/config-ui-raw-vs-runtime/）。
- 模板措辞断言更新（"默认模板无标记协议条款"测试仍红，属模板重写遗留，另行处理）。

## Further Notes

- 包装协议与 ADR-0005 的"宿主即请求"正交叠加：仍是一宿主一请求、无 [N] 标记，只是片段边界显式化。
