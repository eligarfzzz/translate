// 进度徽标：会话期视口右下角的悬浮进度显示（会话装配第五块，与 render/translate/
// observer 平级）。依赖单向、环境显式注入（document），jsdom 沙箱可直接驱动。
// 计数与文案渲染全部收在模块内部，调用方只驱动四个方法：
// show()（建节点上屏）/ addHosts(translatable, all)（本轮发现宿主进分母与括号）/ settled(counted, errored)
//   （宿主流落定：counted=是否计入分子，errored=是否计入错误）/ remove()（摘节点、计数清零）。
// 徽标是扩展注入物，与译文节点同等待遇：class 被硬跳过选择器表（host-discovery）
// 与观察器忽略表（content-observer）收录——自身永不成为宿主、不触发重扫。

// 徽标样式（内联硬编码常量，与译文节点同款做法，不进配置中心、不用 Shadow DOM）：
// fixed 右下角、半透明深底浅字、小号等宽数字、圆角、pointer-events: none、最高档 z-index
const BADGE_STYLE =
  "position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; " +
  "padding: 4px 8px; border-radius: 6px; " +
  "background-color: rgba(20, 20, 20, 0.75); color: #eee; " +
  "font-size: 12px; line-height: 1.5; font-family: Consolas, Monaco, monospace; " +
  "pointer-events: none;";

// 进度徽标工厂：doc（建节点）注入
function createProgressBadge({ doc }) {
  let div = null;
  let done = 0; // 已落定宿主数（分子）
  let total = 0; // 进度分母（档 0 + 档 1：排除边缘区域）
  let totalAll = 0; // 全部宿主数（含边缘区域，括号内显示）
  let errors = 0; // 出错宿主数（> 0 时文案追加错误括号）

  // 文案：<pct>% <done>/<total>(<totalAll>)，错误数 > 0 时追加 (<errors>)。
  // total 为 0 时百分比按 0 显示（不产 NaN）；百分比向下取整（全部落定才 100%）
  function format() {
    const pct = total === 0 ? 0 : Math.floor((done / total) * 100);
    let text = `${pct}% ${done}/${total}(${totalAll})`;
    if (errors > 0) text += `(${errors})`;
    return text;
  }

  function render() {
    if (div) div.textContent = format();
  }

  return {
    // 建节点上屏（幂等：已在屏不重复挂载），初始即零态文案
    show() {
      if (div) return;
      div = doc.createElement("div");
      div.className = "translate-progress";
      div.style.cssText = BADGE_STYLE;
      div.textContent = format();
      doc.body.appendChild(div);
    },
    // 本轮发现的宿主计入分母：translatable（档 0 + 档 1）进进度分母，
    // all（含档 2 边缘区域）进括号总数
    addHosts(translatable, all) {
      total += translatable;
      totalAll += all;
      render();
    },
    // 宿主流落定：counted 为真时分子 +1（档 0+1 计入分子分母同口径，百分比不超
    // 100%）；errored 为真时错误数 +1（错误括号为全档位口径：档 2 失败也计入，
    // 但不进分子）。计数变化即重渲染
    settled(counted, errored) {
      if (counted) done++;
      if (errored) errors++;
      render();
    },
    // 摘节点、计数清零（还原路径唯一出口；下次 show 回到零态）
    remove() {
      if (div) {
        div.remove();
        div = null;
      }
      done = 0;
      total = 0;
      totalAll = 0;
      errors = 0;
    },
  };
}

export { createProgressBadge };
