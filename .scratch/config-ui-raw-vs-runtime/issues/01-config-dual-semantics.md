# 01: 配置两条语义——mergeConfigRaw UI 透传 + 运行时兜底升级

**What to build:** 新增 `mergeConfigRaw`/`loadConfigRaw`（UI 回填语义：保存什么读什么，空值透传空串）；`mergeConfig`/`loadConfig` 改为运行时语义（null/undefined/"" 回退默认，非空字符串原样透传，不再 trim/`{host}` 校验）；`options.js fillForm` 改用 raw 路径；`background.js` 模板兜底从 `trim()` 升级为 `includes("{host}")`；测试改写 2 个 + 新增 raw 测试；README/config 注释/spec 同步。

**Blocked by:** 无

**Status:** needs-triage

- [x] config.js：`mergeConfig` 判空（null/undefined/"" → 默认），非空字符串原样透传（含纯空白、不含 {host} 模板）
- [x] config.js：新增 `mergeConfigRaw`/`loadConfigRaw`——空值透传空串（UI 语义），非空原样透传，数字同运行时
- [x] options.js：`fillForm` 改用 `loadConfigRaw()`（UI 显示保存的真实值）
- [x] background.js：模板兜底升级为 `includes("{host}")`（透传的非空模板缺占位符时回退默认）
- [x] 测试：改写“拒绝空串/纯空白”“接受含 {host} 拒绝不含”2 个；新增 mergeConfig 判空 + mergeConfigRaw 语义 2 个
- [x] README：配置表 promptTemplate 行、两条语义路径说明
- [x] config.js 头注释、html-wrapper-protocol spec Out of Scope 同步
- [ ] 全绿验收

## Comments

- 2026-08-28：按用户语义（UI 保存什么读什么 / 运行时空值默认）拆分两条路径；97/97 绿。
