// 配置中心：默认值 + sync 存储覆盖（ADR-0003）；零痕迹——真实凭证仅存浏览器，仓库无痕。
// 两条语义共用 mergeStored：运行时空值回退默认（绝不用空串发请求）；UI 回填保存什么读什么。
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
  // 提示词模板：默认值表里的普通字符串项，无特判；模板正文的唯一来源是 prompt.js
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
};

// 永不接受存储覆盖的键
const NON_OVERRIDABLE_KEYS = new Set(["reasoningEffort"]);

// 共用核心：null/undefined 不覆盖；未知键丢弃；数字需有限且 >0；reasoningEffort 永不覆盖。
// raw 是两条语义的唯一分歧：false（运行时）空串不覆盖默认；true（UI 回填）空串透传。
function mergeStored(defaults, stored, raw) {
  const out = { ...defaults };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const key of Object.keys(defaults)) {
    if (NON_OVERRIDABLE_KEYS.has(key)) continue;
    const val = stored[key];
    if (val === undefined || val === null) continue;
    if (!raw && val === "") continue; // ← 两条语义唯一的判空分歧
    if (typeof defaults[key] === "number") {
      const n = typeof val === "number" ? val : Number(String(val).trim());
      if (Number.isFinite(n) && n > 0) out[key] = n;
    } else if (typeof defaults[key] === "string") {
      if (raw) out[key] = String(val);
      else if (typeof val === "string") out[key] = val;
    }
  }
  return out;
}

// 运行时语义：空值回退默认（端点永远拿到有效值，绝不用空串发请求）。
function mergeConfig(defaults, stored) {
  return mergeStored(defaults, stored, false);
}

// UI 回填语义：保存什么读什么（空值透传为空串，配置页显示真实保存值）。
function mergeConfigRaw(defaults, stored) {
  return mergeStored(defaults, stored, true);
}

// 注入的 storage 读 sync 存储单键 "config"；未注入 storage 时返回默认合并。
async function readStored(storage) {
  if (!storage || !storage.sync) return null;
  const stored = await storage.sync.get("config");
  return stored && stored.config;
}

// 异步加载有效配置（运行时语义）。
async function loadConfig(storage) {
  return mergeConfig(TRANSLATE_CONFIG, await readStored(storage));
}

// 异步加载配置（UI 回填语义）：保存什么读什么，空值透传为空串。
// 仅配置页回填使用；运行时一律走 loadConfig（空值回退默认）。
async function loadConfigRaw(storage) {
  return mergeConfigRaw(TRANSLATE_CONFIG, await readStored(storage));
}

export { TRANSLATE_CONFIG, mergeConfig, mergeConfigRaw, loadConfig, loadConfigRaw };
