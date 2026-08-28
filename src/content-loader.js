// 内容脚本加载器（manifest 唯一注册的 content script，classic——MV3 不支持模块类型）。
// 同步注册 onMessage 并缓冲请求，动态 import 会话模块后依次转发——同步注册消除
// 「注入完立刻右键却静默无反应」的竞态（background 把 sendMessage 失败当作受限页，
// 那一次点击会被吞掉）。不启用 use_dynamic_url：与动态 import 不兼容（ADR-0006）。

(() => {
  const pending = [];
  let session = null;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (session) session.handleMessage(msg, sender, sendResponse);
    else pending.push({ msg, sender, sendResponse });
    return true; // 回应通道保持打开：会话就绪后再回应缓冲请求
  });

  import(chrome.runtime.getURL("src/content.js"))
    .then((mod) => {
      session = mod.createContentSession({
        document,
        chrome,
        getComputedStyle: (el) => getComputedStyle(el),
      });
      for (const { msg, sender, sendResponse } of pending.splice(0)) {
        session.handleMessage(msg, sender, sendResponse);
      }
    })
    .catch((err) => {
      console.error("[translate:cs] session module import failed:", String(err?.message || err));
    });
})();
