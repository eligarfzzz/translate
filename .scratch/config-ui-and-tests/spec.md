Status: ready-for-agent

# 配置页面 UI 与单元测试

## Problem Statement

用户想更换 API 端点、模型或调整翻译行为时，必须直接修改扩展源码并重新加载，每次调整都是一次代码编辑；翻译核心逻辑（条目装配、批次划分、文本判定）没有任何自动化测试，每轮迭代后的正确性只能靠在真实浏览器里手测，回归风险高。

## Solution

提供一个最简样式的配置页面：左键点击扩展图标即可打开，可修改 API 端点、密钥、模型、目标语言、思考开关、批次大小、字符上限、最大并发以及完整提示词模板，保存到浏览器同步存储，跨设备生效；提供一键恢复默认。同时把翻译流水线的纯逻辑抽成独立模块，用 node 内置测试框架覆盖，命令行一条命令即可回归。

## User Stories

1. As a user, I want to open the config page by left-clicking the extension icon, so that I don't need to dig through chrome://extensions menus.
2. As a user, I want to change the API endpoint in the config page, so that I can switch between different OpenAI-compatible providers without editing code.
3. As a user, I want to change the API key, so that I can rotate credentials safely.
4. As a user, I want to change the model name, so that I can try different models for translation quality.
5. As a user, I want to change the target language, so that the extension translates pages into the language I read.
7. As a user, I want to tune batch size and max chars per batch, so that I can balance speed against API stability on slow endpoints.
8. As a user, I want to tune max concurrency, so that I can avoid rate-limit errors on my provider.
9. As a user, I want to edit the full prompt template, so that I can control translation style and rules myself.
10. As a user, I want a restore-defaults button, so that I can undo bad edits without hunting for the source.
11. As a user, I want my settings saved via sync storage, so that they follow me across devices.
12. As a user, I want saved settings to survive extension reloads, so that configuration is one-time work.
13. As a user, I want invalid values to be rejected on load, so that a typo can't break the whole extension.
14. As a user, I want the config page to use plain default browser styling, so that it loads instantly and stays maintainable.
15. As a developer, I want the entry-assembler extracted as a pure module, so that its protocol behavior can be tested without a browser.
16. As a developer, I want tests for the [i]-marker splitting, so that formatting regressions are caught before they reach users.
17. As a developer, I want tests for multi-line entries, so that streaming assembly of long blocks stays correct.
18. As a developer, I want tests for missing leading markers, so that degraded model output still routes safely.
19. As a developer, I want tests for overflow entries, so that extra output can never corrupt other cells.
20. As a developer, I want tests for char-by-char streaming, so that chunk boundaries never break assembly.
21. As a developer, I want tests for batch splitting rules, so that size/char limits and unbreakable-host guarantees hold.
22. As a developer, I want tests for the Chinese-ratio and URL filters, so that skip behavior stays predictable.
23. As a developer, I want tests for prompt rendering, so that {entries} injection and numbering stay correct.
24. As a developer, I want tests for config merging, so that stored junk values fall back to safe defaults.
25. As a developer, I want one command to run all tests, so that regression checking is zero-friction.
26. As a developer, I want the DOM layer covered by tests through a jsdom harness, so that host-discovery and sanitization regressions are caught automatically.
27. As a developer, I want lib modules to work both in the extension and under node, so that tests need no browser shim beyond jsdom.

## Implementation Decisions

- Configuration persistence uses sync storage under a single namespaced key; a new async loader merges stored values over in-code defaults (fulfilling the seam reserved by ADR-0003). Defaults live in code; stored values only override.
- Config merging is a pure, type-defensive function: numbers must be finite and positive, strings must be non-empty, and a stored prompt template is accepted only if it still contains the {entries} placeholder.
- The prompt template is fully user-editable and contains the {entries} placeholder; entry numbering and assembly remain code-owned. A restore-defaults action rewrites the stored config (including the template).
- Left-clicking the toolbar icon opens the options page (no popup); the options page uses plain native styling with a save and a restore-defaults control.
- Pure logic moves to a lib layer with dual-environment loading (globals for the extension, module exports for node), matching the existing config.js pattern: entry assembler, text utilities, batching, prompt rendering.
- The entry assembler exposes feed/finish and reports per-entry finalize and preview events through callbacks; DOM writes and sanitization stay outside it.
- Batch construction honors max items, cumulative char limit, and the unbreakable-host rule from ADR-0001's streaming-batch decision.
- Thinking is never configurable: reasoning_effort is hardcoded to "none" (the value verified to disable thinking on the gateway); the config surface does not expose it and stored values for it are ignored.
- DOM-layer behavior is tested through jsdom (the single devDependency): code-stripped text extraction, host qualification, DFS host discovery, snapshot serialization, and sanitization. Real layout geometry is not testable in jsdom, so tests stub getBoundingClientRect via the fixture — production code stays untouched.

## Testing Decisions

- Tests verify external behavior of the lib seams only — no assertions on internal scan positions or buffer states.
- Covered modules: entry assembler (standard, cross-chunk, missing leading marker, overflow, char-by-char streaming, multi-line bodies), text utilities (Chinese-ratio boundaries, URL stripping, letter presence), batching (item limit, char limit, unbreakable host, empty input), prompt rendering ({entries} injection, numbering), config merging (type defense, bad template rejection), and the DOM layer under jsdom: code-stripped text extraction (pre/code subtrees pruned), host qualification (all-code hosts skipped, normal hosts kept with tags intact), DFS discovery (safe-block whitelist, flex/grid descent, hard-skip pruning), snapshot serialization, and sanitization (script/iframe removal, on*-attribute stripping).
- Prior art: the hand-verified assembler scenarios from the March debugging session become the core test cases, promoted from manual protocol to tests.
- Runner is node's built-in test runner; jsdom is the only dependency (devDependency). Real layout geometry (getBoundingClientRect) is stubbed in the test fixture and never asserted.

## Out of Scope

- Real layout geometry (anything depending on actual page layout metrics) — jsdom has no layout engine; the fixture stubs it.
- A toolbar popup; config import/export; multiple configuration profiles.
- Encrypting or hiding the stored API key (risk posture unchanged per ADR-0003).
- Changing skip rules, host discovery, revert/session semantics, or any ADR decision made so far.

## Further Notes

- Known trade-offs carried forward: a line starting with bracket-digits inside a pre block could still be mistaken for a marker (prompt forbids it; impact is confined to that host); the API key remains visible to anyone with the extension package.
- The content script's per-flow config read is async; flows read config once at entry, mid-flow changes take effect on the next translation run.
