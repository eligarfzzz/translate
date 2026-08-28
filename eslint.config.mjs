// ESLint flat config：推荐基线 + 四条自定义规则（禁 var / 要 const / 严格等号 / 禁隐式全局）。
import js from "@eslint/js";
import globals from "globals";

// 四条自定义规则：recommended 不管 var 与 prefer-const，而两代写法混用正是要根治的；
// no-implicit-globals 随 ESM 换轨启用——全局符号不再是模块间契约（见 ADR-0006）
const styleRules = {
  "no-var": "error",
  "prefer-const": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-implicit-globals": "error",
};

export default [
  { ignores: ["node_modules/**", ".scratch/**"] },
  js.configs.recommended,

  // 源文件：浏览器 + 扩展 API，ESM
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      ...styleRules,
      // 故意为空的 catch（断开端口 / 解析失败即忽略）遍布端口与 SSE 流程
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // 内容脚本加载器：manifest 注册的 classic script（MV3 content_scripts 不支持模块类型）
  {
    files: ["src/content-loader.js"],
    languageOptions: { sourceType: "script" },
  },

  // 测试：node（ESM）
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
    },
    rules: styleRules,
  },

  // 根配置文件：node
  {
    files: ["eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
    },
    rules: styleRules,
  },
];
