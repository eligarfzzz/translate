// 配置页逻辑：TAB 分组 → 回填 → 保存（sync 存储）/ 按组恢复默认 / 日志导出
import { getChannel } from "./debug.js";
import { loadConfigRaw, TRANSLATE_CONFIG } from "./config.js";

// 分组表是唯一事实来源：TAB 归属、恢复默认的作用域、FIELDS 全部由它派生，避免两处清单漂移
const GROUPS = {
  api: { label: "API", fields: ["apiBase", "apiKey", "model", "concurrency"] },
  prompt: { label: "提示词", fields: ["promptTemplate"] },
  general: { label: "通用", fields: ["targetLang"] },
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

async function fillForm() {
  // UI 回填语义：保存什么读什么（空值显示为空，而非默认）
  const cfg = await loadConfigRaw(chrome.storage);
  for (const f of FIELDS) {
    if (form.elements[f]) form.elements[f].value = cfg[f];
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const stored = {};
  for (const f of FIELDS) stored[f] = form.elements[f].value;
  await chrome.storage.sync.set({ config: stored });
  DBG.debug("config saved (keys):", FIELDS.join(", "));
  const tpl = stored.promptTemplate || "";
  flash(
    tpl && !tpl.includes("{host}")
      ? "已保存，但提示词模板缺 {host}，将回退默认"
      : "已保存 ✓ 下一次翻译生效",
  );
});

// 按组恢复默认：只把该组输入框填成默认值，不写存储、不碰其他组字段（点保存才落盘）
for (const btn of document.querySelectorAll("[data-restore]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.restore;
    const group = GROUPS[name];
    if (!group) return;
    for (const f of group.fields) {
      if (form.elements[f]) form.elements[f].value = TRANSLATE_CONFIG[f];
    }
    DBG.debug("group restored to defaults (not saved):", name);
    flash(`已恢复「${group.label}」默认值，点保存生效`);
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

fillForm();
