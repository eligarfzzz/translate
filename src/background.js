// background service worker：右键菜单 / 左键打开配置页 / API 代理（见 docs/adr/0004）。

import { getChannel } from "./debug.js";
import {
  DEFAULT_PROMPT_TEMPLATE,
  renderPrompt,
  wrapHost,
  isHostWrapped,
  stripHostWrapper,
} from "./prompt.js";
import { loadConfig } from "./config.js";
import { createCacheStore, cacheFingerprint, fitsCacheBytes } from "./cache-store.js";

const DBG = getChannel("bg", chrome.storage);

// 短文本缓存（ADR-0008）：service worker 生命周期一个存储实例；indexedDB 全局现取
// （node 测试由沙箱在 import 前注入替身）。一切 IDB 故障在 cache-store 模块内消化为
// 「未命中 / 跳过」并经此日志回调落痕——短文本缓存 D10 的降级只收口在 cache-store（票 02 裁决），
// 本文件不再设第二条 try/catch 路径。错误对象先 String 化再走日志，保住消息本体。
const cache = createCacheStore({
  indexedDB: globalThis.indexedDB,
  log: (...args) => DBG.error(...args.map(String)),
});

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
// 端口协议（ADR-0005 三件套 + 会话链扩展）：
//   content → background: start { text, history? }——history 为会话链（纯数据对
//     [{ html, echo }]：html = 该段原文骨架，echo = 模型原始回显），链序最老在前；
//     仅会话重用且链非空时携带，缺省即链首形态（每宿主一次独立请求）。
//   background → content: delta（增量文本）/ done（定稿，缓存命中回放时带可选标志
//     cached: true，ADR-0008）/ error（失败）/
//     restart（本轮尝试作废、重开一轮——重试前发出，让 content 清空累积回显）。

const inflight = new Map(); // port -> AbortController

// 上游错误文案里的「上下文超限」保守列举（大小写不敏感；写死不可配，spec D6）——
// 随网关演进可增补；未命中的错误一律不重试。
const CONTEXT_LIMIT_PATTERNS = [
  "context length",
  "maximum context",
  "context window",
  "token limit",
  "too many tokens",
];

function isContextLimitError(err) {
  const message = String(err?.message || "").toLowerCase();
  return CONTEXT_LIMIT_PATTERNS.some((pattern) => message.includes(pattern));
}

// 会话链的纵深防御：只接受 { html, echo } 均为字符串的对，其余形态一律丢弃
function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((turn) => turn && typeof turn.html === "string" && typeof turn.echo === "string")
    .map((turn) => ({ html: turn.html, echo: turn.echo }));
}

// 模板：归一化层已保证非空且含 {host}；这里只防绕过归一化的值让 renderPrompt 抛错（纵深防御）
function resolveTemplate(cfg) {
  return cfg.promptTemplate && cfg.promptTemplate.includes("{host}")
    ? cfg.promptTemplate
    : DEFAULT_PROMPT_TEMPLATE;
}

// 链首形态（每槽第一段、或重试重开的新会话）：与今日一字不差——单条 user，模板渲染
// （其中 {host} 由 renderPrompt 包一层 <html>…</html>）。
function headMessages(cfg, hostHtml) {
  return [
    {
      role: "user",
      content: renderPrompt(resolveTemplate(cfg), hostHtml, {
        target: cfg.targetLang,
        extra: cfg.extra,
      }),
    },
  ];
}

// 链中形态（spec D4）：历史对（链序最老在前；user = 包装原文、assistant = 原始回显）
// + 只有新文本的裸 user（不带模板）。user 侧的每轮文本都是恰一层 <html>…</html> 包装，
// 经 prompt.js 的包装 helper——与 {host} 注入同形，不在这里另写一套包装。
function chainMessages(history, hostHtml) {
  const messages = [];
  for (const turn of history) {
    messages.push({ role: "user", content: wrapHost(String(turn.html).trim()) });
    messages.push({ role: "assistant", content: turn.echo });
  }
  messages.push({ role: "user", content: wrapHost(hostHtml) });
  return messages;
}

// 上游请求 + 收尾判定与重试（spec D6：重试在 background 内部完成，content 只看到一次
// done 或一次 error）。流式过程累积全文 full，收尾按序判定：
//   1) 超限（HTTP 错误文案命中保守清单）：仅会话模式重试——非会话模式内容没变长，重试无意义
//   2) 形态（200 但 full 非空且 trim 后整体不是恰一层包装）：两种模式都重试——判定与剥壳
//      同源（prompt.js 的 isHostWrapped），无第二套「什么是包装」的标准
//   3) 空回显（"" / 纯空白 / <html></html>）不重试：维持既有「未返回译文」口径
// 两种触发器各重试一次，都以链首形态（无历史）重试；再败走既有错误通道。
// 重试前先发 restart 统一恢复：失败尝试已流式送出的预览无法撤回，restart 让 content
// 清空累积回显，定稿与入链回显因此只含重试那次（超限路径下 content 尚无回显，同一条路径）。
// 返回获胜尝试的累积全文（空回显为 ""），供缓存写入判定（D4）；失败路径照旧抛错。
async function requestWithRetry({ cfg, messages, head, allowLimitRetry, onDelta, signal, port }) {
  let limitRetries = allowLimitRetry ? 1 : 0;
  let shapeRetries = 1;
  let attempt = messages;
  let attemptNo = 1;
  for (;;) {
    let full = "";
    try {
      await streamTranslate(
        cfg,
        attempt,
        (text) => {
          full += text;
          onDelta(text);
        },
        signal,
      );
    } catch (err) {
      if (limitRetries === 0 || !isContextLimitError(err)) throw err;
      limitRetries--;
      attemptNo++;
      DBG.debug(
        `retry attempt ${attemptNo}: 上下文超限 ->`,
        String(err?.message || err).slice(0, 120),
      );
      safePost(port, { type: "restart" });
      attempt = head;
      continue;
    }
    if (full.trim() === "" || isHostWrapped(full)) return full;
    if (shapeRetries === 0) throw new Error("回显不合 <html> 包装（重试后仍不合）");
    shapeRetries--;
    attemptNo++;
    DBG.debug(`retry attempt ${attemptNo}: 回显不合包装 ->`, full.trim().slice(0, 120));
    safePost(port, { type: "restart" });
    attempt = head;
  }
}

// 可入缓存的回显（D4）：恰一层 <html> 包装且剥壳后非空——"" / 纯空白 / <html></html>
// 一律不写。判定与剥壳同源 prompt.js，与 content 的「未返回译文」口径一致。
function cacheableEcho(full) {
  return isHostWrapped(full) && stripHostWrapper(full) !== "";
}

// 缓存消息监听器（同一主题的消息聚在一处，spec D4）：
//   clear-cache（手动清空，票 01）：整库清空并异步回应 { ok, removed }——该分支保持回应
//     通道打开（return true）。清空与 cacheEnabled 无关（D6）：不加载配置，开关关着照清。
//     失败留痕由 store 经注入的日志回调（本文件的 DBG.error 通道）完成，本分支不重复记
//     第二条，也不另设 try/catch——store 的 clear() 本身不抛（短文本缓存 D10 收口）。
//   list-cache（设置页分页查看，cache-inspection 票 01 / 02）：独立的请求—响应消息，与清空 /
//     清理各自契约、不合并成带模式参数的消息（D8）。请求携带 page / pageSize，回应
//     { ok: true, page, pageSize, total, entries } 或失败态 { ok: false }（D9：主动读取的
//     故障必须可见）；entries 的每个条目带 original / echo / hitCount / lastUsedAt（D8）。
//     不读配置也不看 cacheEnabled——展示的是整库实际内容（D2），
//     与手动清空同一范围；数据库结构知识因此仍只在 store 模块（本分支只转交页码）。
//   cleanup-cache（自动清理触发，D7）：content 在每会话首轮落定后发来；缓存开才以当前配置
//     执行一次清理（删过期 + 淘超限），缓存关一律不清。清理失败只记日志——它没有也不该有
//     页面可见面。fire-and-forget：不读回应通道。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "clear-cache") {
    cache.clear().then((result) => sendResponse({ ok: result.ok, removed: result.removed }));
    return true; // 异步回应：保持回应通道打开
  }
  if (msg?.type === "list-cache") {
    // store.list 不抛（故障收口为 { ok: false }，日志已在 store 侧留痕）
    cache.list({ page: msg.page, pageSize: msg.pageSize }).then((result) => sendResponse(result));
    return true; // 异步回应：保持回应通道打开
  }
  if (msg?.type !== "cleanup-cache") return;
  (async () => {
    const cfg = await loadConfig(chrome.storage);
    if (!cfg.cacheEnabled) return;
    await cache.cleanup({
      now: Date.now(),
      ttlDays: cfg.cacheTtlDays,
      maxEntries: cfg.cacheMaxEntries,
    });
  })().catch((e) => DBG.error("cache cleanup failed:", String(e?.message || e)));
});

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
    // 骨架 HTML 不做空白压缩，保护缩进与结构；回显全文即译文（无标记协议）。
    const hostHtml = typeof msg.text === "string" ? msg.text.trim() : "";
    const history = normalizeHistory(msg.history);
    DBG.debug("host request start,", history.length ? `chain: ${history.length}` : "chain head");
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

      // 短文本缓存查询（D2/D3）：未配置守卫之后、fetch 之前；开关开且骨架字节过门才查，
      // 指纹按当次 loadConfig 结果现算。命中 = 回放一条缓存回显全文 delta +
      // done{cached:true}，不发上游请求——content 的预览/定稿/落定/计数零改动，
      // 看到一次普通的快速应答。lastUsedAt 的命中刷新与 hitCount 递增在 store 内部
      // 同一次读写事务里完成（cache-inspection D10）——命中路径本身一字未变。
      const cacheable = cfg.cacheEnabled && fitsCacheBytes(hostHtml, cfg.cacheMaxBytes);
      const fingerprint = cacheable ? cacheFingerprint(cfg) : null;
      if (cacheable) {
        const hit = await cache.get(fingerprint, hostHtml, Date.now());
        if (hit) {
          DBG.debug("cache hit:", hostHtml);
          safePost(port, { type: "delta", text: hit.echo });
          safePost(port, { type: "done", cached: true });
          return;
        }
      }

      // 链首形态同时是重试形态（弃历史、以链首重开一局）
      const head = headMessages(cfg, hostHtml);
      const full = await requestWithRetry({
        cfg,
        messages: history.length ? chainMessages(history, hostHtml) : head,
        head,
        allowLimitRetry: history.length > 0, // 超限重试仅会话模式
        onDelta: (text) => safePost(port, { type: "delta", text }),
        signal: ac.signal,
        port,
      });
      // 成功收尾才写缓存（D4）：恰一层包装且剥壳后非空的回显（含重试获胜）才落库；
      // 错误/中止走下面的 catch，空回显（"" / <html></html>）被 cacheableEcho 挡下——都不写。
      if (cacheable && cacheableEcho(full)) {
        await cache.put(fingerprint, hostHtml, full, Date.now());
      }
      DBG.debug("host request done");
      safePost(port, { type: "done" });
    } catch (err) {
      if (ac.signal.aborted) {
        // port 断开（还原/刷新/关页）导致的预期中止：降级为 debug，不再当错误刷屏
        DBG.debug("host request aborted (port closed):", String(err?.message || err));
      } else {
        DBG.error("host request failed:", String(err?.message || err));
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

async function streamTranslate(cfg, messages, onDelta, signal) {
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
      messages,
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
