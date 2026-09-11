// 进度徽标：会话期视口右下角的悬浮进度显示（会话装配第五块，与 render/translate/
// observer 平级）。依赖单向、环境显式注入（document、now：返回毫秒的时间源，
// 真实环境是 Date.now、测试沙箱接手动时钟），jsdom 沙箱可直接驱动。
// 计数与文案渲染全部收在模块内部，调用方只驱动四个方法：
// show()（建节点上屏，耗时起点即此刻）/ addHosts(translatable, all)（本轮发现宿主进分母与括号）/
// settled(counted, errored)（宿主流落定：counted=是否计入分子，errored=是否计入错误）/
// remove()（摘节点、计数与定格值清零）。
// 耗时读数是定格值不是秒表：只在集合「全部落定」的那一刻取一次，模块内不装
// 任何计时器（会话静止时无在途计时器这条不变量不受影响）。
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

// 进度徽标工厂：doc（建节点）、now（时间源，返回毫秒）注入
function createProgressBadge({ doc, now }) {
  let div = null;
  let done = 0; // 已落定宿主数（分子）
  let total = 0; // 进度分母（档 0 + 档 1：排除边缘区域）
  let totalAll = 0; // 全部宿主数（含边缘区域，括号内显示）
  let errors = 0; // 出错宿主数（> 0 时文案追加错误括号）
  let settledAllCount = 0; // 全档位落定数（含边缘区域）——判定「全部已发现宿主都落定」
  let startedAt = 0; // 耗时起点（show() 时刻，毫秒）
  let mainSecs = null; // 主内容（档 0/1）全部落定那一刻的已用秒数（定格值，null=未定格）
  let allSecs = null; // 全部宿主落定那一刻的已用秒数（定格值，null=未定格）

  // 已用秒数：只在定格那一刻取一次，向下取整（与百分比同口径，不显示小数）
  function elapsedSeconds() {
    return Math.floor((now() - startedAt) / 1000);
  }

  // 文案：<pct>% <done>/<total>(<totalAll>)，错误数 > 0 时追加 (<errors>)，
  // 全部已发现宿主（含边缘档）落定后追加 ` <主内容秒数>(<全量秒数>)s`——直接
  // 空格分隔、单位只写一次。total 为 0 时百分比按 0 显示（不产 NaN）；百分比向下
  // 取整（全部落定才 100%）；空主内容集合按 0 写（空集视为起点即完成，不引入第三
  // 态）；零宿主页面（totalAll 为 0）永不显示时间：没有任何翻译发生过。
  // 两个定格值都写 ?? 0 兜底：显示条件已蕴含非 null（今日不可达），纯防御——
  // 条件将来若被改写，也不会把字面 null 打到页面上，勿当冗余删掉
  function format() {
    const pct = total === 0 ? 0 : Math.floor((done / total) * 100);
    let text = `${pct}% ${done}/${total}(${totalAll})`;
    if (errors > 0) text += `(${errors})`;
    if (totalAll > 0 && settledAllCount === totalAll) text += ` ${mainSecs ?? 0}(${allSecs ?? 0})s`;
    return text;
  }

  function render() {
    if (div) div.textContent = format();
  }

  return {
    // 建节点上屏（幂等：已在屏不重复挂载），初始即零态文案；耗时起点即此刻
    show() {
      if (div) return;
      startedAt = now();
      div = doc.createElement("div");
      div.className = "translate-progress";
      div.style.cssText = BADGE_STYLE;
      div.textContent = format();
      doc.body.appendChild(div);
    },
    // 本轮发现的宿主计入分母：translatable（档 0 + 档 1）进进度分母，
    // all（含档 2 边缘区域）进括号总数。新宿主使对应集合重新「未落定」：
    // 新增主内容宿主 → 两个定格值都作废（正文确实还没翻完）；只新增边缘档宿主
    // → 只作废全量定格值（正文早已翻完这个事实没变，括号外保持旧读数）。
    // 读数先撤下，避免把过时的旧值当成当前耗时
    addHosts(translatable, all) {
      total += translatable;
      totalAll += all;
      if (translatable > 0) {
        mainSecs = null;
        allSecs = null;
      } else if (all > 0) {
        allSecs = null;
      }
      render();
    },
    // 宿主流落定：counted 为真时分子 +1（档 0+1 计入分子分母同口径，百分比不超
    // 100%）；errored 为真时错误数 +1（错误括号为全档位口径：档 2 失败也计入，
    // 但不进分子）。落定收口保证每宿主恰好一次，故全档位落定数直接 +1。
    // 各集合首次「全部落定」的那一刻定格一次耗时；已定格的不被后续落定刷新
    // （档 2 落定不会把已定格的正文时间往后挪）。计数变化即重渲染
    settled(counted, errored) {
      if (counted) done++;
      if (errored) errors++;
      settledAllCount++;
      if (mainSecs === null && total > 0 && done === total) mainSecs = elapsedSeconds();
      if (allSecs === null && totalAll > 0 && settledAllCount === totalAll)
        allSecs = elapsedSeconds();
      render();
    },
    // 摘节点、计数与定格值清零（还原路径唯一出口；下次 show 回到零态并重新起算）
    remove() {
      if (div) {
        div.remove();
        div = null;
      }
      done = 0;
      total = 0;
      totalAll = 0;
      errors = 0;
      settledAllCount = 0;
      startedAt = 0;
      mainSecs = null;
      allSecs = null;
    },
  };
}

export { createProgressBadge };
