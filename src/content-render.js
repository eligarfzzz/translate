// 译文节点写入与加载动画。DOM 写入集中于此——每次写入前过 live() 闸门（会话内
// 且节点仍在文档中），还原后的迟到回调绝不可能上屏。

import { textOf } from "./text-utils.js";
import { sanitizeHtml } from "./sanitize.js";

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 100;

// 译文容器样式
const NODE_STYLE =
  "color: #2d6da3; margin: 2px 0; padding: 1px 0; " +
  "font-size: 0.95em; line-height: 1.4; white-space: pre-wrap; word-break: break-word; " +
  "text-decoration: underline dashed #4a90d9; text-underline-offset: 3px;";

// 渲染器工厂：doc（建节点/净化/清扫）、win（计时器）、session（闸门 + 登记表）注入
function createRenderer({ doc, win, session }) {
  // 动画定时器登记表（还原/页面卸载时统一清理）
  const spinTimers = new Set();

  // 写入闸门：会话内（代号未作废）且节点仍挂在文档上
  const live = (div, gen) => session.inSession(gen) && div.isConnected;

  function startCellSpinner(div) {
    let i = 0;
    div.textContent = SPINNER_CHARS[0];
    const timer = win.setInterval(() => {
      i = (i + 1) % SPINNER_CHARS.length;
      if (div.isConnected) div.textContent = SPINNER_CHARS[i];
    }, SPINNER_INTERVAL);
    spinTimers.add(timer);
    return timer;
  }

  function stopSpin(timer) {
    if (timer == null) return;
    win.clearInterval(timer);
    spinTimers.delete(timer);
  }

  function clearAllSpinTimers() {
    spinTimers.forEach((t) => win.clearInterval(t));
    spinTimers.clear();
  }

  // 建容器：append 到宿主末尾，初始内容即 ⠋⠼ 动画（一宿主一容器）
  function createNode(hostEl) {
    const div = doc.createElement("div");
    div.className = "translate-node";
    div.style.cssText = NODE_STYLE;
    hostEl.appendChild(div);
    const timer = startCellSpinner(div);
    return { div, timer };
  }

  // 流式预览：剥标签纯文本直通上屏
  function renderPreview(div, raw, gen) {
    if (live(div, gen)) div.textContent = textOf(raw);
  }

  // 定稿：净化后 innerHTML 写入（回显全文即译文）
  function renderFinal(div, body, gen) {
    if (live(div, gen)) div.innerHTML = sanitizeHtml(body, doc);
  }

  // 错误标记：写在既有译文容器内（斜体红字），不新建节点
  function markError(div, message, gen) {
    if (!live(div, gen)) return;
    div.style.fontStyle = "italic";
    div.style.color = "#b33";
    div.style.fontSize = "0.9em";
    div.textContent = `翻译失败: ${message}`;
  }

  // 还原清理：停各宿主动画 + 移除其译文节点，再全量清扫兜底
  // （兜底扫描保证「还原只移除译文节点、原文一字不动」这条规则不留残余）
  function clearRendered() {
    for (const [, st] of session.hostState) {
      if (st.timer != null) stopSpin(st.timer);
      if (st.div && st.div.isConnected) st.div.remove();
    }
    clearAllSpinTimers();
    doc.querySelectorAll(".translate-node").forEach((el) => el.remove());
    session.hostState.clear();
  }

  return {
    createNode,
    stopSpin,
    clearAllSpinTimers,
    renderPreview,
    renderFinal,
    markError,
    clearRendered,
  };
}

export { createRenderer };
