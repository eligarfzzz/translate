# Spec: 输出侧媒体移除——模型回显的媒体元素整个删除

## Problem Statement

输入侧（快照投喂）媒体标签（img/svg/picture/source/video/audio/canvas/map）已被占位化（媒体占位，CONTEXT.md），base64/路径数据不进 prompt。但输出侧（模型回显的译文）没有对应处理：模型可能回显或凭空编造媒体元素（如把 `<svg>` 当普通标签回显、幻觉生成 img/video），这些元素会原样写入译文节点——带来交互元素、外部资源加载、布局污染。且实测发现输入侧资格判定与投喂不一致（svg 内文本计入判定但快照占位丢失），输出侧需统一：模型回显的媒体**整个移除**。

## Solution

`sanitizeHtml`（模型回显写入 DOM 前的唯一闸门）的 banned 移除清单追加媒体元素：`img, svg, picture, source, video, audio, canvas, map`（与输入侧 `MEDIA_PLACEHOLDER_SELECTOR` 清单完全一致）。命中即整个元素连同子树一并移除（`remove()` 语义），不留空壳、不保留文本。

**两侧语义的分工**：输入前保持占位是为了**译文语序**——占位空壳让模型知道媒体在原句中的位置，从而保持周围文字的翻译顺序；输出后去除占位是为了**样式干净**——译文里不再需要语序信号，媒体元素（无论模型回显还是编造）直接删除，避免交互元素、外部资源加载与布局污染。

## User Stories

1. 作为页面读者，模型回显的 img/svg/video/canvas 等媒体不会出现在译文节点里。
2. 作为扩展 owner，输出侧媒体清单与输入侧占位清单一致，两侧语义对称（输入占位保语序，输出移除防污染）。
3. 作为扩展 owner，脚本/iframe/事件属性等既有净化行为不变（仅追加媒体）。

## Implementation Decisions

- 媒体清单与 `MEDIA_PLACEHOLDER_SELECTOR`（host-discovery.js）完全一致：`img, svg, picture, source, video, audio, canvas, map`。
- 移除为整个元素（含子树），与输入侧"同名空占位"不同——输出侧无保语序需求，直接删。
- 仅改 `sanitizeHtml`；`snapshotHtml`（输入侧）、宿主资格判定不动。
- `iframe` 已在既有 banned 中，不重复；`math` 不在清单。

## Testing Decisions

- 净化测试：媒体元素（svg 含 path/text 子树、img、video、audio、canvas、picture+source+img、map+area）全部移除，周围文本保留。
- 既有净化测试（script/iframe、on* 属性、javascript: URL、正常标签保留）回归不变。

## Out of Scope

- 输入侧资格判定与投喂的 svg 不一致问题（nonCodeText 计入 svg 文本但快照占位）——另行处理。
- 媒体占位清单变更（新增/删除媒体类型）。
- 输出侧占位（保留空壳）语义——本 spec 是移除。

## Further Notes

- 与「媒体占位」互为输入/输出镜像：占位在 feed 序列化（保译文语序），移除在回显净化（保样式干净）。
- 输入侧资格判定与投喂的 svg 不一致问题（nonCodeText 计入 svg 文本但快照占位丢失）仍待处理。
