# 03: 文档校准——as-built 核对与用例数

**What to build:** 对照 spec `.scratch/cache-manual-clear/spec.md` 逐条核对 D1–D13 与实际实现的漂移，把该改的文档改到位：`CONTEXT.md`「短文本缓存」词条（手动清空 + 那条唯一会回报成败的例外）、`docs/adr/0008` 的 Evolved 段（若 as-built 与已写的段有出入则修订该段，不改写历史段落）、`docs/adr/0004`（消息清单的持有者：本轮新增了 runtime 消息，裁决是否追加指针）、`AGENTS.md` 用例数与文件数按**实测值**更新（不许推算）。同时把上一轮遗留的「旧 spec 说手动清空是 Out of Scope」对齐到本功能。

**Blocked by:** 02

**Status:** resolved

- [x] D1–D13 逐条核对 as-built（存储模块的清空原语、background 的消息分支与回应契约、配置页按钮的 DOM 形态与文案、两侧的开关无关性），漂移处改文档或如实记录为已知偏差。
- [x] `CONTEXT.md`「短文本缓存」词条按 as-built 校准；行文遵守词表术语，不发明新说法。
- [x] `docs/adr/0008` 的 Evolved 段按 as-built 校准；若实现暴露了 spec 未预料的取舍，补记在该段（追加，不改写其前的历史段落）。
- [x] `docs/adr/0004` 裁决：本轮新增了 runtime 消息（不是端口协议消息），说明「是否追加指针」的理由并照裁决执行。
- [x] 旧 spec `.scratch/short-text-cache/spec.md` 的 Out of Scope 条目「手动清空缓存的 UI 按钮（DevTools 可清；等真实需求再加）」按现状标注（该条目已由本功能搬进范围）；**不改写旧 spec 的历史决策段**，只在 Out of Scope 处如实标注。
- [x] `AGENTS.md` 的用例数与 `src/` 文件数改成**实测值**；ADR 清单区间若变化一并更新。
- [x] 若核对中发现本功能的 spec 自身写错（与最终实现不一致且是 spec 的问题），改 spec 并在本票 Comments 记录。
- [x] `npm test` 全绿（prettier 覆盖 `CONTEXT.md` / `AGENTS.md`；`docs/adr/` 与 `.scratch/` 在 `.prettierignore` 豁免内）。
- [x] 只动文档，不碰源码与测试。

## Comments

- 屋内 docs-sync 票惯例：依赖前一票的实测用例数，故 Blocked by 02。
- 票 01 / 02 已在实施期先把 `CONTEXT.md` 与 `docs/adr/0008` 的演进段写好（上一轮 `/to-spec` 的产物）；本票的活是**核对**它们与 as-built 是否一致——不一致就改，一致就在 Comments 记一句「逐条相符，未改动」。
- `docs/adr/` 在 `.prettierignore` 内，追加段不受 prettier 管辖；`CONTEXT.md` 与 `AGENTS.md` 受管辖，改动后必须过 `npm run lint`。
- 票 03 实施记录（基线 abe0cb2）：D1–D13 逐条核对 as-built——`src/cache-store.js` 的 `clear()`（单事务先 count 后 clear、整库无指纹筛选、不收配置参数、空库 `{ ok: true, removed: 0 }`、故障记日志返回 `{ ok: false, removed: 0 }` 不抛，D1/D5）；`src/background.js` 的 `clear-cache` 分支（挂在既有缓存消息监听器上、`return true` 异步回应 `{ ok, removed }`、不 loadConfig 即不读 `cacheEnabled`，D3/D4/D6）与 `cleanup-cache` 既有契约逐字节不变；`options.html` 按钮（通用 TAB 按钮行末尾、`type="button"`、`id="clear-cache"`、无 `name`、文案「清空缓存」，D2）与 `src/options.js` 点击处理器（成功文案含条数、0 条同走成功文案、失败文案「缓存清空失败，请重试」、发送抛错同文案、零 `chrome.storage` 接触——为守 D10 连 DBG 都不走，D7/D9/D10）；票 01/02 的 diff 不含任何 `content*.js`（D11）；`cleanup-cache` 触发链未动（D12）；代码/测试/文档无真实端点、密钥、厂商模型名（D13，测试库内数据全假值）。结论：`CONTEXT.md`「短文本缓存」词条与 `docs/adr/0008` 的 Evolved 段同实现逐条相符，无漂移，未改动。
- ADR-0004 裁决：**不追加指针**。本轮新增的 `clear-cache` 是 options → background 的一次性 runtime 请求-响应消息，不在 ADR-0004 的管辖面——其消息清单是 content ↔ background 翻译流的端口协议（`delta`/`done`/`error`，及后来追加的 `restart` 与 `done.cached`）；同为 runtime 消息的先例 `cleanup-cache` 上一轮也未追加。`clear-cache` 的契约已由 ADR-0008 的 Evolved 段承载，ADR-0004 的核心决策（一切 API 走 background、每宿主一端口）未被触动。
- 旧 spec `.scratch/short-text-cache/spec.md` 的 Out of Scope 条目「手动清空缓存的 UI 按钮」已在原处追加「已搬进范围」标注（保留原文，指向本功能 spec 与 ADR-0008 Evolved 段）；历史决策段未改写。
- `AGENTS.md` 按实测更新：用例数 259 → 272（`npm run test:unit` 实测 pass 272 / fail 0）；`src/` 文件数 17 未变（本轮无新增源文件）；ADR 清单 0001–0008 未变（本轮无新增 ADR）。
- spec 核对结论：D1–D13 与 Testing Decisions 未发现与最终实现不一致之处，`.scratch/cache-manual-clear/spec.md` 未改。
- 验收核对与出口标记（主代理）：reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `abe0cb2..bedb9d4`）；主代理在干净工作树（`HEAD == bedb9d4`）上实测 `npm test` 退出码 0、**272/272**、lint（eslint + prettier --check）通过——本票对「prettier 管辖面」的推断由此获得执行证据。评审非阻断观察项：① 票据 Status/勾选框未翻转属预期（出口标记由独立提交统一做，本提交即由主代理完成）；② Comments 「cleanup-cache 既有契约逐字节不变」措辞微松——可执行契约确实逐字节未变，但该分支注释头在票 01 被改写，指行为契约则准确；③ 272 用例数为静态复算佐证（270 个行首 `test(` 调用点 + 3 元素形态表驱动循环），与实测值一致。
