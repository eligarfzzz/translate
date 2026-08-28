// 加载顺序集成冒烟：按 manifest.json 的 content_scripts 声明顺序，
// 在 jsdom 沙箱（最小 chrome/window stub，无 module——模拟 content script
// 隔离环境）逐个执行每个文件，验证两条契约：
//   1) 每个文件加载无异常（防 UMD 全局分支挂载错位，如 HostDiscovery 事故）
//   2) 每个文件承诺的全局符号存在且类型正确
// 新增 lib 文件时须同步更新 EXPECTED_GLOBALS 契约表（测试会主动提醒）。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

// 全局符号契约：文件路径 → { 符号名: 期望 typeof }
const EXPECTED_GLOBALS = {
  "lib/debug.js": { TranslateDebug: "object" },
  "lib/prompt.js": { DEFAULT_PROMPT_TEMPLATE: "string" },
  "lib/text-utils.js": { TextUtils: "object" },
  "lib/sanitize.js": { Sanitize: "object" },
  "lib/host-discovery.js": { HostDiscovery: "object" },
  "config.js": { loadConfig: "function", TRANSLATE_CONFIG: "object" },
  "content.js": {},
};

function buildSandbox() {
  const dom = new JSDOM("<html><body></body></html>");
  const noop = () => {};
  const sandbox = {
    document: dom.window.document,
    getComputedStyle: (el) => dom.window.getComputedStyle(el),
    window: dom.window,
    console,
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: { onMessage: { addListener: noop }, connect: noop },
      storage: {
        local: { get: noop, set: noop },
        sync: { get: noop, set: noop, remove: noop },
      },
    },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadAll(sandbox) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  const errors = [];
  for (const file of scripts) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    try {
      vm.runInContext(code, sandbox, { filename: file });
    } catch (e) {
      errors.push(`${file}: ${e.constructor.name}: ${e.message}`);
    }
  }
  return { scripts, errors };
}

test("content_scripts 按 manifest 顺序全部加载成功，无异常", () => {
  const sandbox = buildSandbox();
  const { errors } = loadAll(sandbox);
  assert.deepStrictEqual(errors, [], "加载序列中存在抛错文件");
});

test("加载后全局符号契约逐项成立", () => {
  const sandbox = buildSandbox();
  loadAll(sandbox);

  const problems = [];
  for (const [file, expects] of Object.entries(EXPECTED_GLOBALS)) {
    for (const [name, expectedType] of Object.entries(expects)) {
      // vm 词法/全局声明统一用 typeof 探测（const 不挂到全局对象上）
      const actual = vm.runInContext(`typeof ${name}`, sandbox);
      if (actual !== expectedType) {
        problems.push(`${file} 应导出 ${name} (${expectedType})，实际: ${actual}`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], "全局符号契约被破坏");
});

test("manifest 中出现的文件都被契约表覆盖", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  const uncovered = scripts.filter((f) => !(f in EXPECTED_GLOBALS));
  assert.deepStrictEqual(
    uncovered,
    [],
    "以下文件未在 EXPECTED_GLOBALS 契约表中登记，请补充其应导出的全局符号"
  );
});
