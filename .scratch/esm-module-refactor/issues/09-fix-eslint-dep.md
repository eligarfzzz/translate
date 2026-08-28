# 09: 修复——`@eslint/js` 登记为直接开发依赖

**What to build:** `eslint.config.mjs` 里 `import js from "@eslint/js"`，但它此前只是 eslint 的传递依赖，靠 npm 扁平化提升到 `node_modules` 顶层才能解析。换 pnpm / yarn PnP，或 eslint 日后不再依赖它，`npm run lint` 会直接报模块找不到。以精确版本 9.39.1（与当时安装一致）写入 devDependencies，lock 同步；不改任何 lint 规则与源码。

**Blocked by:** None（review-02 发现的缺陷，随 05 批次处理）

**Status:** done（已实施：a1a26f4）

- [x] `@eslint/js` 以精确版本 pin 写入 devDependencies，lock 同步
- [x] 未改任何 lint 规则与源码
- [x] lint 0、98/98 绿（修复时点）

## Comments

- 2026-08-28：实施于 commit a1a26f4（2 文件 +2 行）。review-05 批次（reviewer-verify）确认：`npm install --dry-run` 与 `npm ls --depth=0` 均 exit 0；全仓裸模块标识符检索确认只剩 `@eslint/js`/`globals`/`jsdom` 且均已声明——修复关掉的是整类缺陷。
- 遗留（低，记录在案）：`eslint` 与 `@eslint/js` 的版本字面量成对出现（9.39.1 ×2），升级须同步，仓库内无工具守护；修法在仓库之外（Renovate 分组或文档注记）。
