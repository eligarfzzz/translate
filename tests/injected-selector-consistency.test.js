// 注入物选择器单一来源守门测试（跨文件一致性，防回填字面量）——守的是
// review-01 遗留的重构边界：注入物选择器（.translate-node, .translate-progress）
// 只许定义在 src/injected-selector.js，host-discovery 的硬跳过表与
// content-observer 的注入物过滤都 import 同一份定义；谁在消费方回填组合
// 选择器字面量绕过单一来源，谁就撞上本文件的单一来源断言，测试转红。
// 仿 manifest-consistency 先例的静态读源检查，不建 DOM 夹具。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// 组合选择器字面量（译文节点与进度徽标的逗号并列形式——单一来源锁的就是这份定义；
// 单类名出现不受此限：那是元素类名身份，写入/单类清扫各有其用）
const INJECTED_SELECTOR_LITERAL_RE = /\.translate-node\s*,\s*\.translate-progress/;

test("组合选择器字面量全 src 只出现在单一来源模块", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
      } else if (entry.name.endsWith(".js")) {
        if (INJECTED_SELECTOR_LITERAL_RE.test(read(rel))) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, ["src/injected-selector.js"]);
});

test("host-discovery 的硬跳过表引用单一来源而非回填字面量", () => {
  const src = read("src/host-discovery.js");
  assert.ok(
    /import\s*\{[^}]*INJECTED_SELECTOR[^}]*\}\s*from\s*["']\.\/injected-selector\.js["']/.test(src),
    "host-discovery 应 import INJECTED_SELECTOR",
  );
  assert.ok(src.includes("${INJECTED_SELECTOR}"), "硬跳过表声明应拼接共用注入物选择器");
  assert.ok(!INJECTED_SELECTOR_LITERAL_RE.test(src), "host-discovery 不应回填组合选择器字面量");
});

test("content-observer 的注入物过滤引用单一来源而非回填字面量", () => {
  const src = read("src/content-observer.js");
  assert.ok(
    /import\s*\{[^}]*INJECTED_SELECTOR[^}]*\}\s*from\s*["']\.\/injected-selector\.js["']/.test(src),
    "content-observer 应 import INJECTED_SELECTOR",
  );
  assert.ok(
    /closest\(\s*INJECTED_SELECTOR\s*\)/.test(src),
    "注入物过滤应经 closest 用 import 进来的 INJECTED_SELECTOR",
  );
  assert.ok(!INJECTED_SELECTOR_LITERAL_RE.test(src), "content-observer 不应回填组合选择器字面量");
});
