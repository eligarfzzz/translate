// 页面观察器与防抖调度：会话期内持续翻译新内容（SPA / 懒加载 / 折叠展开）；
// 子节点新增与展开/显隐属性切换共用同一防抖入口，高频抖动不产生请求风暴。

const RESCAN_DEBOUNCE_MS = 500;

// 属性过滤器：只关注展开/显隐类切换；发现更多展开型属性扩充此表即可
const RESCAN_ATTR_FILTER = ["class", "style", "hidden", "open"];

// 调度器工厂：doc / win / session / runRescan（重扫执行体）注入
function createScheduler({ doc, win, session, runRescan }) {
  let observer = null;
  let debounceTimer = null;

  // 防抖到期：会话已结束则丢弃；翻译中则重排同样时长（忙则重试，流式期间新内容不漏翻）
  function scheduleScan() {
    if (debounceTimer) win.clearTimeout(debounceTimer);
    debounceTimer = win.setTimeout(async () => {
      debounceTimer = null;
      if (!session.isActive()) return;
      if (session.isTranslating()) {
        scheduleScan(); // 忙则重试：等下一轮空闲再扫
        return;
      }
      await runRescan();
    }, RESCAN_DEBOUNCE_MS);
  }

  // 扩展注入物选择器表：译文节点与进度徽标同等待遇（永不成为重扫触发源）。
  // 各自比对（added 判定、属性变化判定）都经 closest 走同一张表——
  // 子树内新增/属性变化同样被滤（徽标每次重渲染都改 DOM，不滤则每次
  // 进度跳动都白排一轮防抖）；两表与 host-discovery 的硬跳过表手动同步。
  const INJECTED_SELECTOR = ".translate-node, .translate-progress";
  const isInjected = (el) => el.nodeType === win.Node.ELEMENT_NODE && el.closest(INJECTED_SELECTOR);

  function start() {
    if (observer) return;
    observer = new win.MutationObserver((mutations) => {
      if (!session.isActive()) return;
      for (const m of mutations) {
        if (m.type === "attributes") {
          // 位于扩展注入物子树内（含其自身）的属性变化忽略：不触发重扫
          const t = m.target;
          if (isInjected(t)) continue;
          scheduleScan();
          return;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === win.Node.ELEMENT_NODE) {
            if (isInjected(n)) continue; // 自身注入物（.translate-node / .translate-progress）
            scheduleScan();
            return;
          }
        }
      }
    });
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: RESCAN_ATTR_FILTER,
    });
  }

  // 还原时调用：摘观察器 + 取消挂起防抖（下次「翻译」重建）
  function stop() {
    if (debounceTimer) {
      win.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  return { start, stop };
}

export { createScheduler };
