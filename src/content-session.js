// 会话状态与生命周期：会话标志、代号作废、在途端口、已处理宿主登记。
// 依赖树叶子，其余三块都读它。安全边界的支点：inSession(gen) 是写 DOM 与
// 发请求的唯一判据；close() 让代号自增，还原前发出的请求回调全部失效，迟到写入不上屏。

function createSessionState() {
  // 会话外禁止一切 DOM 写入与请求（防幽灵译文 / 还原竞态）
  let sessionActive = false;
  let translating = false;
  let generation = 0; // 每次还原自增；旧回调凭代号作废
  const activePorts = new Set(); // 在途单宿主请求端口，还原时逐一中止
  // hostEl -> { div, timer }；兼作「已处理宿主」登记表，重扫据此跳过已翻宿主
  const hostState = new Map();

  return {
    hostState,
    isActive: () => sessionActive,
    isTranslating: () => translating,
    // 当前代号：请求发起时取快照，回调凭它判断是否已被还原作废
    generation: () => generation,
    // 仍在本次会话内（会话活跃且代号未变）
    inSession: (gen) => sessionActive && gen === generation,

    // 开启会话（「翻译」入口）：已开启或翻译进行中则拒绝，返回是否真的开启
    open() {
      if (sessionActive || translating) return false;
      sessionActive = true;
      translating = true;
      return true;
    },
    // 重扫入口：会话已开启，只标记「翻译进行中」（防抖据此忙则重试）
    beginTranslating() {
      translating = true;
    },
    endTranslating() {
      translating = false;
    },

    trackHost(hostEl, state) {
      hostState.set(hostEl, state);
    },
    addPort(port) {
      activePorts.add(port);
    },
    removePort(port) {
      activePorts.delete(port);
    },

    // 关闭会话（「还原」第一步）：代号作废 → 在途端口断开（断开即触发 background 侧中止）。
    // DOM 与调度清理不在此处：还原顺序集中在 content.js 的 revertPage。
    close() {
      generation++;
      sessionActive = false;
      translating = false;
      for (const port of [...activePorts]) {
        try {
          port.disconnect();
        } catch {} // 已断开的端口再断开会抛，忽略
      }
      activePorts.clear();
    },
  };
}

export { createSessionState };
