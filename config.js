// ============================================================
// 配置中心
//
// 代码内默认值 + 同步存储覆盖（兑现 ADR-0003 预留接缝）。
// 零痕迹（ADR-0003 演进）：端点/密钥/模型默认为空占位，
// 仓库不含任何真实凭证；真实配置仅存浏览器 sync 存储。
//
// 两条语义路径（同一存储，不同消费语义）：
//   • 运行时（loadConfig/mergeConfig）：空值（null/undefined/""）一律
//     回退默认——端点收到的永远是有效默认，绝不用空串发请求；
//   • UI 回填（loadConfigRaw/mergeConfigRaw）：保存什么读什么——
//     空值透传为空串，配置页显示用户保存的真实值而非默认。
// reasoningEffort 永不可配置：硬编码 "none"，存储值一律忽略。
// ============================================================

const TRANSLATE_CONFIG = {
  // OpenAI 兼容 API 端点（默认空：克隆仓库拿不到可用凭证，
  // 真实端点在配置页填写，仅存浏览器 sync 存储）
  apiBase: "",
  // API 密钥（默认空：真实密钥永不进仓库，仅存浏览器存储）
  apiKey: "",
  // 模型名（默认空）
  model: "",
  // 目标语言
  targetLang: "中文",
  // 关闭思考：该网关使用 reasoning_effort: "none" 生效；永不可配置
  reasoningEffort: "none",
  // 并发池上限：同时在途的单宿主请求数（每宿主一次端点请求）
  concurrency: 20,
};

// 永不接受存储覆盖的键
const NON_OVERRIDABLE_KEYS = new Set(["reasoningEffort"]);

// 运行时语义：存储值类型防御式合并到默认值之上。
// 判空：null / undefined / "" 一律使用默认值（不覆盖）；
// 非空字符串原样透传（保存什么读什么，不再 trim 校验、不再要求 {host}）；
// 数字需有限且 > 0（数字字符串自动转换）；未知键丢弃（含历史遗留键）；
// reasoningEffort 永不覆盖。
function mergeConfig(defaults, stored) {
  const out = { ...defaults, promptTemplate: DEFAULT_PROMPT_TEMPLATE };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const key of Object.keys(defaults)) {
    if (NON_OVERRIDABLE_KEYS.has(key)) continue;
    const val = stored[key];
    if (val === undefined || val === null || val === "") continue;
    if (typeof defaults[key] === "number") {
      const n = typeof val === "number" ? val : Number(String(val).trim());
      if (Number.isFinite(n) && n > 0) out[key] = n;
    } else if (typeof defaults[key] === "string") {
      if (typeof val === "string") out[key] = val;
    }
  }
  if (typeof stored.promptTemplate === "string" && stored.promptTemplate !== "") {
    out.promptTemplate = stored.promptTemplate;
  }
  return out;
}

// UI 回填语义：保存什么读什么——空值（null/undefined/""）透传为空串，
// 配置页显示用户保存的真实值；非空字符串原样透传；数字同运行时语义。
// 与 mergeConfig 的唯一区别：空值不覆盖成默认，而是保留空。
function mergeConfigRaw(defaults, stored) {
  const out = { ...defaults };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const key of Object.keys(defaults)) {
    if (NON_OVERRIDABLE_KEYS.has(key)) continue;
    const val = stored[key];
    if (val === undefined || val === null) continue;
    if (typeof defaults[key] === "number") {
      const n = typeof val === "number" ? val : Number(String(val).trim());
      if (Number.isFinite(n) && n > 0) out[key] = n;
    } else {
      out[key] = String(val);
    }
  }
  if (typeof stored.promptTemplate === "string") {
    out.promptTemplate = stored.promptTemplate; // 含空串：透传保存值
  }
  return out;
}

// 异步加载有效配置（运行时语义）：扩展环境读 sync 存储单键 "config"；
// node 测试环境（无 chrome）直接返回默认合并。
async function loadConfig() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
    return mergeConfig(TRANSLATE_CONFIG, null);
  }
  const stored = await chrome.storage.sync.get("config");
  return mergeConfig(TRANSLATE_CONFIG, stored && stored.config);
}

// 异步加载配置（UI 回填语义）：保存什么读什么，空值透传为空串。
// 仅配置页回填使用；运行时一律走 loadConfig（空值回退默认）。
async function loadConfigRaw() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
    return mergeConfigRaw(TRANSLATE_CONFIG, null);
  }
  const stored = await chrome.storage.sync.get("config");
  return mergeConfigRaw(TRANSLATE_CONFIG, stored && stored.config);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TRANSLATE_CONFIG, mergeConfig, mergeConfigRaw, loadConfig, loadConfigRaw };
}
