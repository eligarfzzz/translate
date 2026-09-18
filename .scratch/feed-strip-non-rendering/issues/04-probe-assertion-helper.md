# 04: 端口守门用例的探针断言收成一处（L4 测试卫生）

**What to build:** 票 02 的端口守门用例里，「给定一组探针、逐个断言载荷不含它」这个断言循环重复出现了三次（其中两处连探针数组都就地手写）。把断言循环收成一个文件内的辅助函数，三处改为调用它。纯重构：不改任何探针、不改任何断言的语义与强度、不改用例名、不改断言数量，`npm test` 的通过数与失败数逐字节不变。

**Blocked by:** 02（端口请求内容的端到端守门——本票只动它新增的那段用例）

**Status:** resolved

- [x] 在 `tests/content-rescan.test.js` 内新增一个断言辅助（例如 `assertPayloadExcludes(payload, probes, context)`），语义：对 `probes` 逐项断言 `payload.includes(probe) === false`，失败消息带上 `context` 与该探针。
- [x] 三处调用改为使用该辅助：
  - 既有 `STRIPPED_PROBES` 那一处（脚本与注释探针，断言单个 `start.text`）；
  - `<template>` 用例里就地手写的探针数组那一处（断言单个 `start.text`）；
  - 嵌套深度用例里就地手写的探针数组那一处（断言拼接后的 `allPayloads`）。
- [x] **探针数组仍留在各自用例内**：三组探针是各用例的规格内容，不得合并成一个大数组——合并会让某条用例失败时无法定位是哪种形状泄漏。
- [x] 断言数量与强度零变化：三处的探针项数、断言条件（`includes === false`）、断言消息所承载的信息量都不减；既有用例名零改动。
- [x] 纯重构：不新增用例、不删除用例、不改源码（`src/` 零改动）、不动其它测试文件（`tests/host-discovery.test.js` 里同形状的断言属本票范围外，见 Comments）。
- [x] `npm test`（lint + node --test）全绿，实测通过数与改动前一致（改动前为 294）；prettier / eslint 通过。
- [x] 零痕迹：不引入真实端点、密钥、厂商模型名。

## Comments

- 来源：票 02 的 reviewer-verify 两轴评审 Standards 轴第 5 条（非阻断 judgement call）——「探针列表形状重复出现，可抽一个 `assertPayloadExcludes(start.text, [...])`」。原文见 `.scratch/feed-strip-non-rendering/issues/02-port-payload-guard.md` 的 Comments。
- 定位（改动前的行号）：`tests/content-rescan.test.js:1093`（`STRIPPED_PROBES` 常量）、`:1121`（消费它的循环）、`:1160`（`<template>` 用例里就地手写的循环）、`:1280`（深度用例里就地手写的循环）。
- 范围外的同形状断言：`tests/host-discovery.test.js:628-636` 与 `:729-739` 也是「逐个探针断言不含」，但它们是票 01 的接缝一用例，评审未提出，本票不动——避免把一次评审发现扩成跨文件重构。
- 为什么值得做：三处各自的探针数组与断言措辞需同步维护；将来若改断言消息格式或补统一失败上下文，要改三处。属可读性与维护性，无正确性风险。

- 实施于 commit `4005fb78811f6f5d0fb827bdc2e342bef764114c`（`refactor(feed-strip-non-rendering): 票 04 端口守门探针断言收成一处`，1 文件 +35/−25，`src/` 零改动）；reviewer-verify 两轴审阅 **VERDICT=PASS / 0 blocker**（范围 `aa1cf4b..4005fb7`）。
- 落地形态：`tests/content-rescan.test.js:1094` 新增文件内辅助 `assertPayloadExcludes(payload, probes, context)`（体内 `assert.equal(payload.includes(probe), false, \`${context} ${probe}\`)`）；三处调用点 `:1129`（`STRIPPED_PROBES` + `start.text`）、`:1166`（`<template>` 就地数组 + `start.text`）、`:1288`（深度用例就地数组 + `allPayloads`）；三组探针数组仍留在各自用例内，未合并。
- 实测（主代理）：`npm test`（eslint + prettier --check + node --test）**294/294** 全绿，exit 0；`git status` 干净。
- 实施票自证：改动前/后用例数 294/294、本文件 41/41，用例名逐条一致；以 `--import` 插桩记录断言调用（改动前 324 条、改动后 324 条），JSON 文本逐字节相同；临时往 `STRIPPED_PROBES` 加真实泄漏探针 → `node --test` 报 `AssertionError: 载荷不含 Alpha english prose`（pass 40 / fail 1），还原后文件 sha256 与还原前一致、复绿 41/41。
- 评审非阻断观察（未修，留待下一轮）：(a) 跨文件同形状断言仍在 `tests/host-discovery.test.js:628-636` 与 `:729-739`，属票面明示的范围外（避免把一次评审发现扩成跨文件重构）；(b) `context` 以裸字符串表达上下文属轻度 Primitive Obsession，但该签名是票面点名要求的。状态由主代理在出口统一标记。
