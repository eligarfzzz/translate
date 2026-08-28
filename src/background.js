// background service worker：右键菜单 / 左键打开配置页 / API 代理（见 docs/adr/0004）。

import { getChannel } from "./debug.js";
import { DEFAULT_PROMPT_TEMPLATE, renderPrompt } from "./prompt.js";
import { loadConfig } from "./config.js";

const DBG = getChannel("bg", chrome.storage);

const MENU_ID = "translate-page";

chrome.runtime.onInstalled.addListener(refreshMenu);
chrome.runtime.onStartup.addListener(refreshMenu);

// 左键工具栏图标：打开配置页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

function refreshMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "翻译页面",
      contexts: ["page", "frame", "selection", "link", "editable"],
    });
  });
}

function setMenuTitle(title) {
  chrome.contextMenus.update(MENU_ID, { title }, () => void chrome.runtime.lastError);
}

// 向目标页的 content script 查询会话状态；受限页返回 null
function askSession(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "get-session" }).catch(() => null);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const sess = await askSession(tab.id);
  DBG.debug(
    "menu click, tab",
    tab.id,
    "session:",
    sess ? (sess.active ? "active" : "idle") : "unavailable",
  );
  if (!sess) return; // 受限页（chrome:// 等）：不切换、不错位

  if (sess.active) {
    chrome.tabs.sendMessage(tab.id, { type: "revert" }).catch(() => {});
    setMenuTitle("翻译页面");
  } else {
    chrome.tabs.sendMessage(tab.id, { type: "translate" }).catch(() => {});
    setMenuTitle("还原页面");
  }
});

// 切换活动标签时同步菜单标题（受限页查询失败则保持现状）
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const sess = await askSession(tabId);
  if (sess) setMenuTitle(sess.active ? "还原页面" : "翻译页面");
});

// ---------------- 翻译请求代理（每宿主一个端口，ADR-0005） ----------------

const inflight = new Map(); // port -> AbortController

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translate-host") return;
  const ac = new AbortController();
  inflight.set(port, ac);

  // content 侧断开（还原/会话结束）＝ 中止上游请求
  port.onDisconnect.addListener(() => {
    ac.abort();
    inflight.delete(port);
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "start") return;
    const host = typeof msg.text === "string" ? msg.text : "";
    DBG.debug("host request start");
    try {
      const cfg = await loadConfig(chrome.storage);

      // 未配置守卫（零痕迹默认）：任一为空则经既有错误通道回告（含配置页指引），不发起网络请求。
      const missing = [
        !cfg.apiBase && "API 端点",
        !cfg.apiKey && "API 密钥",
        !cfg.model && "模型",
      ].filter(Boolean);
      if (missing.length) {
        DBG.error("host request rejected: unconfigured ->", missing.join(", "));
        safePost(port, {
          type: "error",
          message: `未配置${missing.join("、")}——左键点击扩展图标打开配置页，填写保存后重试`,
        });
        return;
      }

      DBG.debug("config:", {
        apiBase: cfg.apiBase,
        model: cfg.model,
        concurrency: cfg.concurrency,
        targetLang: cfg.targetLang,
      });
      await streamTranslate(
        cfg,
        host,
        (text) => safePost(port, { type: "delta", text }),
        ac.signal,
      );
      DBG.debug("host request done");
      safePost(port, { type: "done" });
    } catch (err) {
      DBG.error("host request failed:", String(err?.message || err));
      if (!ac.signal.aborted) {
        safePost(port, { type: "error", message: String(err?.message || err) });
      }
    } finally {
      inflight.delete(port);
    }
  });
});

function safePost(port, msg) {
  try {
    port.postMessage(msg);
  } catch {}
}

async function streamTranslate(cfg, host, onDelta, signal) {
  // 骨架 HTML 不做空白压缩，保护缩进与结构；回显全文即译文（无标记协议）。
  const hostHtml = String(host).trim();
  // 模板缺 {host} 时回退默认（透传的非空模板可能缺占位符，双保险）
  const template =
    cfg.promptTemplate && cfg.promptTemplate.includes("{host}")
      ? cfg.promptTemplate
      : DEFAULT_PROMPT_TEMPLATE;
  const prompt = renderPrompt(template, hostHtml, { target: cfg.targetLang });
  const url = `${cfg.apiBase}/chat/completions`;
  DBG.debug("upstream request:", url, "model:", cfg.model);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      reasoning_effort: cfg.reasoningEffort,
      temperature: 0.3,
    }),
    signal,
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 300);
    } catch {}
    DBG.error("upstream HTTP", resp.status, detail);
    throw new Error(`HTTP ${resp.status} ${detail}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let deltas = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          if (deltas === 0) DBG.debug("first delta received");
          deltas++;
          onDelta(delta.content);
        }
      } catch {}
    }
  }

  DBG.debug("upstream done, deltas:", deltas);

  // 尾部残留
  if (buffer.trim()) {
    const data = buffer.trim().replace(/^data:\s*/, "");
    if (data && data !== "[DONE]") {
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) onDelta(delta.content);
      } catch {}
    }
  }
}
