# 01: HTML 包装协议——输入包 <html> 输出剥最外层 + 空模板回退

**What to build:** 提示词 `{host}` 注入统一包 `<html>…</html>`（模板示例同步）；新增 `stripHostWrapper` 在定稿时剥离模型回显的最外层 html 包装（容属性/大小写/空白，纯空壳归空串走"未返回译文"错误）；background 消费点对空串/纯空白模板回退默认提示词。删除 3 个与包装冲突的旧渲染断言，新增 3 个包装协议断言。

**Blocked by:** 无（与宿主即请求协议正交，叠加实施）

**Status:** needs-triage

- [x] renderPrompt：`{host}` 替换为 `<html>${hostHtml}</html>`（含 null/undefined → `<html></html>`）
- [x] 默认模板重写：Example 行展示 Input/Output 的 `<html>` 包装对应关系
- [x] stripHostWrapper：`/^<html[^>]*>([\s\S]*)<\/html>$/i` 剥最外层，容属性/大小写/首尾空白；纯空壳 → ""
- [x] content.js done 定稿：先剥离包装再判空/净化；`<html></html>` 空壳正确报"未返回译文"
- [x] background.js：空串/纯空白模板回退 DEFAULT_PROMPT_TEMPLATE（与 config.js 兜底双保险）
- [x] 测试：删除"注入位置恰好替换""多占位符""null/undefined 渲染为空串"3 个旧断言
- [x] 测试：新增"渲染带 html 包装""剥离最外层 html""只剥最外侧一层（双重包装）"3 个断言
- [ ] 全绿验收（当前剩 1 红："默认模板无标记协议条款"断言旧模板措辞，属模板重写遗留，另行处理）

## Comments

- 2026-08-28：按用户要求删 3 旧测试 + 加 3 新测试；3 新全绿，3 旧已删。遗留 1 红（模板措辞断言）不在本次范围。
