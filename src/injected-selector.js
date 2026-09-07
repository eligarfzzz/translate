// 扩展注入物选择器单一来源：本扩展插入页面的一切元素——译文节点与进度徽标。
// 宿主发现（host-discovery 的硬跳过表）与页面观察器（content-observer 的注入物
// 过滤）都 import 这份定义，各自不再手抄类名列表；要改注入物集合只许改此模块，
// 防回填字面量的守门测试见 tests/injected-selector-consistency.test.js。

export const INJECTED_SELECTOR = ".translate-node, .translate-progress";
