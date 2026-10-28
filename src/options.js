// 配置页逻辑：TAB 分组 → 回填（值 + 占位文字由配置模块给出）→ 保存（sync 存储）/ 按组恢复默认（= 清空）/ 日志导出
import { getChannel } from "./debug.js";
import {
  TRANSLATE_CONFIG,
  loadStoredConfig,
  pruneConfig,
  isMissingHostPlaceholder,
  placeholderText,
} from "./config.js";

// 分组表是唯一事实来源：TAB 归属、恢复默认的作用域、FIELDS 全部由它派生，避免两处清单漂移
const GROUPS = {
  api: { label: "API", fields: ["apiBase", "apiKey", "model", "concurrency", "reuseSession"] },
  prompt: { label: "提示词", fields: ["promptTemplate", "extra"] },
  general: {
    label: "通用",
    fields: ["targetLang", "cacheEnabled", "cacheMaxEntries", "cacheTtlDays", "cacheMaxBytes"],
  },
};
const FIELDS = Object.values(GROUPS).flatMap((g) => g.fields);
const form = document.getElementById("form");
const status = document.getElementById("status");
const DBG = getChannel("opt", chrome.storage);

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

// 表单控件 ↔ 配置值（唯一一处）：文本/数字控件走 value（恒为字符串），复选框走 checked（布尔）。
// 回填、保存、按组清空三处都经这两个函数，控件类型的知识不散落。写入 undefined 即「未设置」
// ——空框 / 复选框的默认勾选态（默认关 → 未勾选，默认开 → 勾选），正是「空即未设置」在 DOM
// 上的形态；判空本身仍在配置模块。
const readValue = (el) => (el.type === "checkbox" ? el.checked : el.value);
const writeValue = (el, value) => {
  // 复选框的「未设置」是默认态：值缺省时回默认值表的勾选面（默认开字段清空后仍勾选，
  // 保存才删键回退默认，而不是把默认面写成非默认面落盘）
  if (el.type === "checkbox") el.checked = value ?? TRANSLATE_CONFIG[el.name] === true;
  else el.value = value ?? "";
};

// 空框占位：占位文字（默认值本身 / 空串默认值字段的示例）由配置模块给出，运行时注入、
// 不写进 HTML；一视同仁——不区分该字段是否已设置，有值时占位本就不显示。
// 复选框没有空框，不收占位（布尔字段的占位文字是 String(默认值)，写进 DOM 只是废属性）。
function fillPlaceholders() {
  for (const f of FIELDS) {
    const el = form.elements[f];
    if (!el || el.type === "checkbox") continue;
    el.placeholder = placeholderText(f);
  }
}

async function fillForm() {
  // 回填：只显示存储中真实存在的非空值；未设置的字段留空（空即未设置），由占位显示将生效的默认值
  const stored = await loadStoredConfig(chrome.storage);
  for (const f of FIELDS) {
    if (form.elements[f]) writeValue(form.elements[f], stored[f]);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formValues = {};
  // 表单值：文本/数字控件是字符串，复选框是布尔——判空规则在配置模块按默认值类型分派
  for (const f of FIELDS) formValues[f] = readValue(form.elements[f]);
  // 模板非空但缺 {host}：与「模板为空」区分，给专门文案；判定函数与归一化同源（配置模块）
  const templateDropped = isMissingHostPlaceholder("promptTemplate", formValues.promptTemplate);
  // 反馈口径：基准是写入之前的归一化存储——只有真正被清掉的旧键才算「已删除设置」，
  // 从未设置过的字段（含存储里本就没有的键）不在其中。基准取归一化后的存储：存储里的
  // 非法值（并发 -1、缺 {host} 的模板）本来就没生效，清掉它不算删除设置（空即未设置）
  const before = await loadStoredConfig(chrome.storage);
  // 空即未设置：空字段不进载荷；全空时删除 config 键本身（整包重写天然清掉旧键）
  const payload = pruneConfig(TRANSLATE_CONFIG, formValues);
  const keys = Object.keys(payload);
  if (keys.length) await chrome.storage.sync.set({ config: payload });
  else await chrome.storage.sync.remove("config");
  DBG.debug("config saved (keys):", keys.join(", ") || "(none: config removed)");
  const cleared = Object.keys(before).filter((k) => !Object.hasOwn(payload, k)).length;
  if (templateDropped) {
    // 专门文案只说模板；其余被清掉的旧键另行计数，不被它吞掉。存储里确实存着模板时才减 1
    // （它已由专门文案报过）——存储里本没有模板则它不在 cleared 里，写死减 1 会造出负数
    const templateItself = Object.hasOwn(before, "promptTemplate") ? 1 : 0;
    const others = cleared - templateItself;
    const extraNote = others ? `；另有 ${others} 项为空，已删除设置、回退默认` : "";
    flash(`已保存 ✓ 提示词模板缺 {host}，视为留空未保存，将使用内置默认模板${extraNote}`);
  } else if (cleared) {
    flash(`已保存 ✓ 下一次翻译生效；其中 ${cleared} 项为空，已删除设置、回退默认`);
  } else {
    flash("已保存 ✓ 下一次翻译生效");
  }
});

// 按组恢复默认 = 清空该组输入框（占位随即显示将生效的默认值）：不写存储、不碰其他组字段，
// 点保存才落盘——落盘即删键，该组从此永远跟随版本默认，而不是被冻结在当前这一版默认上
for (const btn of document.querySelectorAll("[data-restore]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.restore;
    const group = GROUPS[name];
    if (!group) return;
    for (const f of group.fields) {
      // 清空 = 写回「未设置」：文本/数字控件回空框，复选框回默认勾选态
      if (form.elements[f]) writeValue(form.elements[f], undefined);
    }
    DBG.debug("group cleared (not saved):", name);
    flash(`已清空「${group.label}」，将使用默认值，点保存生效`);
  });
}

// TAB 切换：hidden 切面板、aria-selected 切标签态，左右方向键在标签间移动焦点
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  // 进入「通用」TAB 就读第 1 页（D6）：不持续自动刷新，每次进入都是一次新读取
  if (tab.getAttribute("aria-controls") === "panel-general") loadCachePage(1);
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

// ---------------- 缓存内容表格（cache-inspection 票 01 / 02） ----------------
// 只读视图：走独立的 list-cache 请求—响应消息（D8），页码与每页条数由本页提出，
// background 回应归一后的页码与条目（原文 / 回显 / 命中次数 / 最后使用时间）。表格不参与保存：
// 所有文本经 textContent 注入，缓存里的标签不会成为本页元素（D3/D16）。命中次数是
// 每条条目的累计使用信息，不是全局命中率（D14）——只多一列，不新增汇总区。
// 读取失败显示失败提示，不伪装成空库（D9）。
const CACHE_PAGE_SIZE = 20; // 每页固定二十条（D4，不可配）
const cacheRows = document.getElementById("cache-rows");
const cacheStatus = document.getElementById("cache-status");
const pageInfo = document.getElementById("cache-page-info");
const prevPage = document.getElementById("cache-prev");
const nextPage = document.getElementById("cache-next");
let cachePage = 1; // 当前展示的页码（取回应里的归一页码，而不是请求页码）

function renderCacheRows(entries) {
  cacheRows.textContent = ""; // 重绘前清空旧行（不用 innerHTML）
  for (const entry of entries) {
    const tr = document.createElement("tr");
    // 次数与其它列同样走 textContent；缺字段的旧条目已由 store 按零归一（D11）
    const cells = [
      entry.original,
      entry.echo,
      String(entry.hitCount),
      new Date(entry.lastUsedAt).toLocaleString(),
    ];
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    cacheRows.append(tr);
  }
}

// 翻页按钮与页码文案跟随当次回应：空库/失败态两个按钮都禁用
function renderCachePager({ total, page, pageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  pageInfo.textContent = `第 ${page} / ${pages} 页 · 共 ${total} 条`;
  prevPage.disabled = page <= 1;
  nextPage.disabled = page >= pages;
}

function renderCacheFailure() {
  cacheRows.textContent = "";
  cacheStatus.textContent = "缓存读取失败，请重试";
  pageInfo.textContent = "";
  prevPage.disabled = true;
  nextPage.disabled = true;
}

async function loadCachePage(page) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "list-cache", page, pageSize: CACHE_PAGE_SIZE });
  } catch {
    res = null; // 发送/回应本身抛错（如 SW 不在）：与回应失败态同一提示
  }
  if (!res?.ok) {
    renderCacheFailure();
    return;
  }
  cachePage = res.page; // 越界请求由 background 归一并回告（D5）
  renderCacheRows(res.entries);
  renderCachePager(res);
  cacheStatus.textContent = res.total ? "" : "缓存为空";
}

prevPage.addEventListener("click", () => loadCachePage(cachePage - 1));
nextPage.addEventListener("click", () => loadCachePage(cachePage + 1));

// 导出日志：合并三通道按时间排序，下载为 JSON 文件
document.getElementById("export-logs").addEventListener("click", async () => {
  const res = await chrome.storage.local.get(["log-cs", "log-bg", "log-opt"]);
  const all = [...(res["log-cs"] || []), ...(res["log-bg"] || []), ...(res["log-opt"] || [])].sort(
    (a, b) => a.ts.localeCompare(b.ts),
  );
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `translate-logs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  DBG.debug("logs exported:", all.length, "entries");
  flash(`已导出 ${all.length} 条日志`);
});

document.getElementById("clear-logs").addEventListener("click", async () => {
  await chrome.storage.local.remove(["log-cs", "log-bg", "log-opt"]);
  DBG.debug("logs cleared");
  flash("日志已清空");
});

// 「清空缓存」：一次性动作，不是设置项——不参与保存（按钮无 name）、不读配置（开关关着
// 照清，spec D6）、点击不触发任何 chrome.storage 写入（sync / local 一字不碰，D10），
// 所以这里不能走 DBG（DBG 会落盘 log-opt）。回应 ok 为真 → 成功文案含条数（0 条不另立
// 分支）；ok 为假或发送 / 回应抛错 → 失败文案（不含技术细节，故障细节由 background 侧
// 记日志，D7：用户显式要求的动作必须回报成败，静默或假报成功是缺陷）
document.getElementById("clear-cache").addEventListener("click", async () => {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "clear-cache" });
  } catch {
    res = null; // 发送 / 回应本身抛错（如 SW 不在）：与回应失败态同一失败文案
  }
  flash(res?.ok ? `缓存已清空（${res.removed} 条）` : "缓存清空失败，请重试");
  // 清空成功 → 表格立即刷新：回到第 1 页重新读取（D6）。失败不动表格
  if (res?.ok) loadCachePage(1);
});

fillPlaceholders();
fillForm();
