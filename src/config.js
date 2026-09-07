// 配置中心：默认值 + sync 存储覆盖（ADR-0003）；零痕迹——真实凭证仅存浏览器，仓库无痕。
// 空即未设置（empty means unset）：判空规则按默认值类型界定，只在本文件实现一次，
// 读路径（sanitizeStored / mergeConfig / loadStoredConfig）与写路径（pruneConfig）
// 全部经由它——空值不落盘、读取回退默认，绝不出现第二条语义。
// 规则的解释权也在此：缺占位符的规则本体只有一处（lacksHostPlaceholder）——
// 归一化实现直接调用它，配置页经公开谓词 isMissingHostPlaceholder 调用（类型与空白
// 守卫只在公开谓词里做一次，内核不做第二遍）；占位文字的字段知识也只由本文件给出
// （placeholderText + 空串默认值的示例清单）——消费方零字段知识，改规则只改这一处。
// reasoningEffort 永不可配；storage 由调用方注入。

import { DEFAULT_PROMPT_TEMPLATE } from "./prompt.js";

const TRANSLATE_CONFIG = {
  // 端点/密钥/模型默认空：真实值仅存浏览器 sync 存储，仓库零痕迹
  apiBase: "",
  apiKey: "",
  model: "",
  // 目标语言
  targetLang: "中文",
  // 关闭思考：该网关使用 reasoning_effort: "none" 生效；永不可配置
  reasoningEffort: "none",
  // 并发池上限：同时在途的单宿主请求数（每宿主一次端点请求）
  concurrency: 20,
  // 提示词模板：模板正文的唯一来源是 prompt.js；归一化时额外要求含 {host}（见 HOST_PLACEHOLDER_KEYS）
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  // 追加提示词：插到模板里 {extra} 处的自定义规则（多行可用）；空即未设置，跟随版本默认（空）
  extra: "",
};

// 永不接受存储覆盖的键
const NON_OVERRIDABLE_KEYS = new Set(["reasoningEffort"]);

// 需要 {host} 占位符的字段：字符串规则之上再加一层语义校验，缺占位符等同留空
const HOST_PLACEHOLDER_KEYS = new Set(["promptTemplate"]);

// 默认值为空串的字段没有可显示的默认值（三个零痕迹 API 字段），占位改给描述性假值示例
// （仓库不含真实端点、凭证或厂商模型名）。示例清单与默认值表同处本模块，只经
// placeholderText 取用；示例是可选字段知识，不是空默认字段的必配项——但清单里的键
// 必须默认值为空串，否则那条示例是死代码（由配置测试守门）。
const EMPTY_DEFAULT_PLACEHOLDERS = {
  apiBase: "https://example.com/v1",
  apiKey: "sk-example-not-a-real-key",
  model: "example-model",
};

// 占位文字的唯一取值函数：默认值非空 → 默认值本身；默认值为空串 → 该字段的示例；
// 无默认值（未知键）或示例缺失 → 空串。恒返回字符串，绝不产出字面量 "undefined"。
function placeholderText(key) {
  const dflt = TRANSLATE_CONFIG[key];
  if (dflt === undefined) return "";
  if (dflt !== "") return String(dflt);
  return EMPTY_DEFAULT_PLACEHOLDERS[key] ?? "";
}

// 缺占位符的规则本体（唯一一处）：该字段声明需要 {host}，而给定的字符串不含它。
// 入参必须已是 trim 后的非空字符串——类型与空白守卫不在这里做第二遍，由调用方各自守好。
function lacksHostPlaceholder(key, trimmed) {
  return HOST_PLACEHOLDER_KEYS.has(key) && !trimmed.includes("{host}");
}

// 「因缺占位符而被判空」的公开判定：类型与空白守卫只在此一处，随后委托规则本体。
// 非字符串、空串、纯空白一律为假（空模板因此照常走通用文案，而非缺占位符的专门文案）；
// 配置页调用它决定保存反馈，归一化实现直接调规则本体——判定与归一化结果不可能漂移。
function isMissingHostPlaceholder(key, raw) {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false;
  return lacksHostPlaceholder(key, s);
}

// 唯一判空实现：按默认值类型界定「空」，返回归一化后的值；返回 undefined 即「空」
// （有效值永远不是 undefined）。读路径与写路径共用此函数，判断不可能漂移。
//   字符串：字符串且 trim 后非空——null/undefined/数字/对象/数组/纯空白一律为空
//   数字：number 或数字串，有限、大于 0 的整数——0/负数/小数/NaN/非有限/非数字串/空串为空
//   提示词模板：字符串规则之上还必须包含 {host}，缺占位符等同留空（规则本体见 lacksHostPlaceholder）
function normalizeValue(key, defaultValue, raw) {
  if (typeof defaultValue === "number") {
    if (typeof raw !== "number" && typeof raw !== "string") return undefined;
    const n = typeof raw === "number" ? raw : Number(raw.trim());
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }
  if (typeof defaultValue !== "string") return undefined;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (lacksHostPlaceholder(key, s)) return undefined;
  return s;
}

// 归一化入口：默认值表 + 原始值（存储或表单）→ 只含有效键、值已归一化的新对象。
// raw 非对象/数组/字符串原始值一律视为空；未知键丢弃；reasoningEffort 永不进入结果。
function sanitizeStored(defaults, raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(defaults)) {
    if (NON_OVERRIDABLE_KEYS.has(key)) continue;
    const val = normalizeValue(key, defaults[key], raw[key]);
    if (val !== undefined) out[key] = val;
  }
  return out;
}

// 读路径：默认全量 + 归一化结果（任何空/非法值一律回退默认）。
function mergeConfig(defaults, raw) {
  return { ...defaults, ...sanitizeStored(defaults, raw) };
}

// 写路径：表单值（HTML 输入恒为字符串）→ 存储载荷（数字字段转 number、字符串字段 trim）。
// 与读路径同源：空字段不进载荷，空与非空的判断与运行时读取完全一致。
function pruneConfig(defaults, formValues) {
  return sanitizeStored(defaults, formValues);
}

// 读 sync 存储里 config 的原始对象；缺失（或 storage 未注入）返回 null。
async function readStored(storage) {
  if (!storage || !storage.sync) return null;
  const stored = await storage.sync.get("config");
  return stored?.config ?? null;
}

// 运行时有效配置：读路径合并，background 与 content 共用。
async function loadConfig(storage) {
  return mergeConfig(TRANSLATE_CONFIG, await readStored(storage));
}

// 存储中「真实存在」的配置（已归一化，不含默认值合并）：配置页回填用——
// 页面要的正是「哪些键被真正设置过」，未设置的键不存在于此对象。
async function loadStoredConfig(storage) {
  return sanitizeStored(TRANSLATE_CONFIG, await readStored(storage));
}

export {
  TRANSLATE_CONFIG,
  EMPTY_DEFAULT_PLACEHOLDERS,
  sanitizeStored,
  mergeConfig,
  pruneConfig,
  readStored,
  loadConfig,
  loadStoredConfig,
  isMissingHostPlaceholder,
  placeholderText,
};
