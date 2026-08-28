# 01: 输出侧媒体移除——sanitizeHtml 追加媒体 banned 清单

**What to build:** `sanitizeHtml` 的 banned 移除清单追加媒体元素（img/svg/picture/source/video/audio/canvas/map，与输入侧占位清单一致），模型回显的媒体整个移除（含子树）；补净化测试；CONTEXT.md 新增「媒体移除」词条；spec 文档。

**Blocked by:** 无

**Status:** needs-triage

- [x] lib/sanitize.js：banned 追加 img/svg/picture/source/video/audio/canvas/map（整个移除含子树）
- [x] tests/host-discovery.test.js：净化区新增媒体移除测试（svg 子树/嵌套 picture+source+img/map+area 全移除，周围文本保留）
- [x] CONTEXT.md：新增「媒体移除 (Media Removal)」词条（输出侧镜像语义）
- [x] 既有净化测试回归（script/iframe/on*/javascript:/正常标签）全绿
- [ ] 全绿验收

## Comments

- 2026-08-28：按用户确认（清单与输入侧一致、整个移除、只改 sanitizeHtml）实施；98/98 绿。
- 2026-08-28：文档补充两侧语义——输入占位保译文语序，输出去除保样式干净（CONTEXT.md 词条 _Why_、spec.md Solution/Further Notes、README 净化描述）。
