// 配置页逻辑：回填 → 保存（sync 存储）/ 恢复默认
(() => {
  "use strict";

  const FIELDS = [
    "apiBase", "apiKey", "model", "targetLang",
    "concurrency", "promptTemplate",
  ];
  const form = document.getElementById("form");
  const status = document.getElementById("status");
  const DBG = TranslateDebug.getChannel("opt");

  function flash(msg) {
    status.textContent = msg;
    setTimeout(() => { status.textContent = ""; }, 2500);
  }

  async function fillForm() {
    // UI 回填语义：保存什么读什么（空值显示为空，而非默认）
    const cfg = await loadConfigRaw();
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
    flash(tpl && !tpl.includes("{host}")
      ? "已保存，但提示词模板缺 {host}，将回退默认"
      : "已保存 ✓ 下一次翻译生效");
  });

  document.getElementById("restore").addEventListener("click", async () => {
    await chrome.storage.sync.remove("config");
    await fillForm();
    DBG.debug("config restored to defaults");
    flash("已恢复默认");
  });

  // 导出日志：合并三通道按时间排序，下载为 JSON 文件
  document.getElementById("export-logs").addEventListener("click", async () => {
    const res = await chrome.storage.local.get(["log-cs", "log-bg", "log-opt"]);
    const all = [...(res["log-cs"] || []), ...(res["log-bg"] || []), ...(res["log-opt"] || [])]
      .sort((a, b) => a.ts.localeCompare(b.ts));
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
})();
