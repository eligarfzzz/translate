# 01: 配置核心与配置页——布尔镜像推广与四个缓存键

**What to build:** 「短文本缓存」的配置面落地：默认值表新增 `cacheEnabled`（布尔，**默认 `true`**）、`cacheMaxEntries`（10000）、`cacheTtlDays`（30）、`cacheMaxBytes`（30）。为支撑首个默认开的布尔键，「空即未设置」的布尔判空做镜像推广：**只存非默认面**——默认 `false` 的字段照旧只有 `true` 落盘；默认 `true` 的字段只有显式 `false` 落盘，其余形态一律删键回退默认。配置页「通用」TAB 新增四个控件（复选框「短文本缓存」+ 三个正整数输入），回填/保存/恢复默认照章。运行时 `loadConfig` 恒得到确定值。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `TRANSLATE_CONFIG` 新增四键：`cacheEnabled: true`、`cacheMaxEntries: 10000`、`cacheTtlDays: 30`、`cacheMaxBytes: 30`，注释照屋内风格写明语义。
- [x] `normalizeValue` 布尔分支镜像推广：`raw === !defaultValue`（严格布尔）才落盘为 `!defaultValue`，其余一律 `undefined`。`reuseSession` 的既有行为逐字节不变（既有用例保持绿，不许改）。
- [x] 三个数值键复用既有正整数规则（有限、> 0、整数；0 / 负数 / 小数 / 数字串之外的形态一律删键）。
- [x] 配置页「通用」TAB 四控件：`cacheEnabled` 复选框（标签「短文本缓存」）与三个 `type="number"` 输入；回填只填存储中真实存在的键，占位文字规则照旧（非空默认 → 默认值的字符串形）。
- [x] `tests/config.test.js` 新用例：`cacheEnabled` 的 `[false, false]` / `[true, undefined]` / `["true", undefined]` / `["false", undefined]` / `[1, undefined]` / `[null, undefined]`；数值键边界（合法整数落盘；`0` / `-1` / `1.5` / 空串 / 非数字串 → 删键）；`prune → merge` 往返。
- [x] `tests/options.test.js`：反向守门自动覆盖四新键（配置键必须有同名表单字段，守门一行不改）；保存/清空删键行为用例。
- [x] `npm test` 全绿（lint + node:test）。本票不碰 `content*.js` / `background.js` / 任何翻译与缓存逻辑。
- [x] 零痕迹：注释与测试不出现真实端点、密钥、厂商模型名。

## Comments

- 决策来源：spec `.scratch/short-text-cache/spec.md` 的 D8 / D9；布尔镜像规则的文档侧已先行落进 `CONTEXT.md`「空即未设置」词条与 `docs/adr/0003` 追加段，本票是实现侧。
- 屋内先例（session-reuse 票 01 的范围合并裁决）：配置键与同名表单字段是同一条纵切片——反向守门会在默认值表增键时转红，故配置页控件就在本票内，不要拆出去。
- 实施于 commit `bbb8a2ccd9a12f595ddb14075b2a46ef00f7f96f`（`feat(short-text-cache): 配置核心与配置页四缓存键（ticket 01）`，5 文件 +318/−13）；reviewer-verify 两轴审阅 **PASS / 0 blocker**（范围 `c829037d..bbb8a2c`）；`npm test` 实测 **225/225**（基线 214，+11）。评审非阻断观察项：`src/options.js` 复选框回填行依赖 `===` 优先于 `??` 的优先级，语义正确、加括号更直白（未修，归遗留 Low）。状态由主代理在出口统一标记。
