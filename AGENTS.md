## Codebase

MV3 Chrome extension, **native ES modules, zero build** — the directory loaded in `chrome://extensions` is this repository directory. Dependencies are expressed as `import` statements only; there is no ordered script list, no `importScripts`, no global-symbol contract between files.

```
manifest.json   MV3 清单（含 minimum_chrome_version: 106）
options.html    配置页（单个 <script type="module"> 入口）
src/            全部源文件（14 个，扁平，不按角色分子目录）
tests/          node:test 套件（101 用例，jsdom 做 DOM 层）
docs/adr/       架构决策记录（0001–0006）
```

内容脚本入口是 `src/content-loader.js`（classic，MV3 的 `content_scripts` 不支持模块类型）：它同步注册 `onMessage` 并缓冲，再动态 import `src/content.js`。会话逻辑拆为 `content-session` / `content-render` / `content-translate` / `content-observer` 四块，由 `content.js` 装配。

```
npm run lint       # eslint + prettier --check
npm run test:unit  # node:test
npm test           # 上面两条串联
```

改动前必读的两条约束：`onMessage` 只在加载器里注册一次（会话侧自注册会导致消息处理两次，见 ADR-0006）；`use_dynamic_url` 不得启用（与动态 import 不兼容，已实测证伪）。

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (root `CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.
