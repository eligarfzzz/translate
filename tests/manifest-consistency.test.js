// 清单一致性静态检查（取代已删除的全局符号契约测试）——守的是 ESM 换轨后
// 新出现的错误类别：清单/配置页指向不存在的文件、任一入口的 import 图里有
// 幽灵引用，或内容脚本动态 import 的模块图漏登记进 web_accessible_resources
// （三者都只在运行时炸）。
//
// 三个入口各自展开静态 import 图：service worker、配置页、内容脚本加载器
// 动态 import 的会话模块。存在性对三者一律要求；WAR 登记只对内容脚本那条
// 图要求——只有被页面世界 import 的模块才需要登记，扩展特权上下文不需要。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const manifest = JSON.parse(read("manifest.json"));

// 清单声明的全部脚本/页面引用（相对仓库根的路径）
function manifestRefs() {
  const refs = [manifest.background.service_worker, manifest.options_ui.page];
  for (const cs of manifest.content_scripts) refs.push(...cs.js);
  return refs;
}

// options.html 里的 <script src="..."> 引用
function optionsScriptRefs() {
  const html = read(manifest.options_ui.page);
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
}

// 静态 import 的目标（相对说明符）；动态 import 目标经 chrome.runtime.getURL 传入
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s(?:[\s\S]*?\sfrom\s)?["'](\.[^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)\s*\)/g;

// 静态 import 图的闭包展开：从 roots 出发逐层跟随相对说明符。
// 缺失文件收进 missing 而非静默跳过——静默跳过会让任意层级的幽灵 import
// 永远不出现在结果里（只有入口写错才报错），守门就形同虚设。
function moduleGraph(roots) {
  const seen = new Set();
  const missing = [];
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!exists(file)) {
      missing.push(file); // 不存在则无法继续展开，但必须被报告
      continue;
    }
    for (const m of read(file).matchAll(STATIC_IMPORT_RE)) {
      queue.push(path.posix.join(path.posix.dirname(file), m[1]));
    }
  }
  return { files: [...seen].filter(exists), missing };
}

// 内容脚本加载器动态 import 的会话模块入口
function contentEntries() {
  const loaderFiles = manifest.content_scripts.flatMap((cs) => cs.js);
  return loaderFiles.flatMap((file) =>
    [...read(file).matchAll(DYNAMIC_IMPORT_RE)].map((m) => m[1]),
  );
}

// 三个入口：标签 → 该入口的模块图根
function entryRoots() {
  return {
    "service worker": [manifest.background.service_worker],
    配置页: optionsScriptRefs(),
    内容脚本会话模块: contentEntries(),
  };
}

// web_accessible_resources 的资源模式 → 正则。
// * 跨目录匹配（含 /），与 Chrome 的 resources 模式语义一致：
// 写 [^/]* 会把 src/ 子目录里的模块误报为未登记。
function warMatchers() {
  const patterns = (manifest.web_accessible_resources || []).flatMap((r) => r.resources);
  return patterns.map((p) => new RegExp("^" + p.split("*").map(escapeRe).join(".*") + "$"));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("清单引用的文件全部存在", () => {
  const missing = manifestRefs().filter((rel) => !exists(rel));
  assert.deepEqual(missing, [], "manifest.json 引用了不存在的文件");
});

test("配置页引用的脚本全部存在", () => {
  const refs = optionsScriptRefs();
  assert.ok(refs.length > 0, "options.html 至少有一个 <script src>");
  const missing = refs.filter((rel) => !exists(rel));
  assert.deepEqual(missing, [], "options.html 引用了不存在的文件");
});

test("内容脚本动态 import 的模块图全部被 web_accessible_resources 覆盖", () => {
  const entries = contentEntries();
  assert.ok(entries.length > 0, "内容脚本加载器应有动态 import 入口");
  const matchers = warMatchers();
  assert.ok(matchers.length > 0, "manifest 应声明 web_accessible_resources");
  const { files } = moduleGraph(entries);
  const uncovered = files.filter((rel) => !matchers.some((re) => re.test(rel)));
  assert.deepEqual(uncovered, [], "以下模块被内容脚本 import 但未登记进可访问资源");
});

test("三个入口的 import 图都不含缺失文件（幽灵 import）", () => {
  const problems = [];
  for (const [label, roots] of Object.entries(entryRoots())) {
    assert.ok(roots.length > 0, `${label} 应至少有一个模块图入口`);
    for (const rel of moduleGraph(roots).missing) problems.push(`${label} → ${rel}`);
  }
  assert.deepEqual(problems, [], "import 图中存在不存在的文件（幽灵 import）");
});

test("web_accessible_resources 未启用 use_dynamic_url（与动态 import 不兼容，见 ADR-0006）", () => {
  for (const res of manifest.web_accessible_resources || []) {
    assert.notEqual(
      res.use_dynamic_url,
      true,
      "开启 URL 轮换后内容脚本动态 import 报 Failed to fetch dynamically imported module",
    );
  }
});
