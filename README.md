# 页面翻译 (Chrome Extension)

初版 Chrome 扩展：在右键菜单翻译整个网页为中文。译文以插入方式显示在原文下方（虚线下划线），原文不被替换；支持流式输出、动态内容持续翻译、一键还原。配置页（左键点击工具栏图标直达）可修改端点/密钥/模型/目标语言/并发上限与完整提示词模板。

## 功能

- 左键点击工具栏图标 → 打开配置页（保存到同步存储，跨设备生效）
- 右键菜单「翻译页面」→ 翻译中变为「还原页面」，点击还原移除全部译文
- 翻译范围：标题 / 段落 / 按钮文字 / 链接文字（纯 URL 链接不翻）
- 排除：输入框 / iframe / 已是中文的文本（汉字占比 > 30%）
- 按块级宿主聚合翻译：段落/列表项/单元格等安全块末尾插入唯一的译文节点（虚线随文字行走），原文保留；行内元素不被打断，flex/grid 不新增子项
- `pre`/`code` 原样随所属块投喂给 LLM，由模型保留标签并自决翻译范围；整块纯代码的宿主直接跳过（剥码判空）
- 翻译中在译文容器内显示 ⠋⠼ 等宽字体加载动画，完成或失败后移除
- 流式输出：回显全文即译文——流式增量直通剥标签纯文本预览，完成时定稿为净化后的 HTML（媒体元素在净化时整个移除，译文样式干净）
- 宿主即请求：每个宿主独立一次端点请求（无条目、无标记协议），并发池控制同时在途请求数（默认 20，可配置）；单个请求失败只影响该宿主（显示斜体错误信息），其余照常完成
- MutationObserver 持续翻译新加载的内容（SPA / 懒加载）；折叠面板展开（display/class/hidden/details open 属性切换，无节点新增）同样触发补翻，高频抖动经防抖合并
- 刷新页面恢复原文（还原不持久化）
- 单元测试：`npm test` 一条命令跑 lint + 全量回归（node:test + jsdom，101 用例）

## 安装（开发者模式）

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录
4. 打开任意网页，右键 → 「翻译页面」

要求 Chrome 106+（`minimum_chrome_version`，理由见 [ADR-0006](./docs/adr/0006-native-esm-modules.md)）。

## 开发

零构建：源码即原生 ES 模块，`chrome://extensions` 加载的目录就是仓库目录。改完在扩展页点「重新加载」即生效（改内容脚本还需刷新目标页面）。

```
npm install     # 装 devDependencies（eslint / prettier / jsdom）
npm run lint    # eslint + prettier --check
npm run test:unit  # node:test 全量套件
npm test        # 上面两条串联
```

## 配置

**左键点击工具栏图标**打开配置页（也可在 `chrome://extensions` → 本扩展 → 「扩展选项」进入）。所有设置保存到 `chrome.storage.sync`（跨设备同步），下一次翻译立即生效；「恢复默认」一键回滚（回到空默认）。

**仓库零痕迹**：端点、密钥、模型三项默认值为空，代码、测试与文档不含任何真实端点、密钥或模型名——任何人克隆仓库都拿不到可用凭证。真实配置只在配置页填写，仅存浏览器 `chrome.storage.sync`，不产生任何仓库文件改动。未配置任一项时点「翻译页面」，每个宿主的译文位置会显示含打开配置页指引的明确错误（该宿主请求直接回告，不发起网络请求）。

可配置项：

| 项               | 说明                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `apiBase`        | OpenAI 兼容端点（v1），默认空                                                            |
| `apiKey`         | API 密钥（默认空，仅存浏览器存储）                                                       |
| `model`          | 模型名（默认空）                                                                         |
| `targetLang`     | 目标语言（默认中文）                                                                     |
| `concurrency`    | 并发池上限：同时在途的单宿主请求数（默认 20）                                            |
| `promptTemplate` | 完整提示词模板，含 `{host}` 占位符（单宿主骨架 HTML）；空串/缺占位符在运行时回退默认模板 |

**思考开关不可配置**：`reasoning_effort` 永远硬编码为 `"none"`，存储值一律忽略。

代码内默认值集中在 [`src/config.js`](./src/config.js)（`TRANSLATE_CONFIG`，端点/密钥/模型为空占位）。读取分两条语义：**运行时**统一走 `loadConfig()`（存储值经 `mergeConfig()` 类型防御合并——`null/undefined/""` 回退默认，非空字符串原样透传），**配置页回填**走 `loadConfigRaw()`（`mergeConfigRaw()`——保存什么读什么，空值透传为空串，UI 显示用户保存的真实值而非默认）——这正是 [`docs/adr/0003-hardcoded-config-with-ui-seam.md`](./docs/adr/0003-hardcoded-config-with-ui-seam.md) 预留接缝的兑现。

## 权限说明

`host_permissions` 声明为 `<all_urls>`（翻译扩展品类惯例）：本扩展需在任意页面注入翻译（`content_scripts` 同为 `<all_urls>`），同时支持在配置页填写任意 OpenAI 兼容端点——跨域调用需对端点域名预先授权，声明宽权限使自定义端点填完即用。

## 结构

```
manifest.json     MV3 清单（权限、后台、content script、options 页、action、最低 Chrome 版本）
options.html      配置页（原生样式，单个 <script type="module"> 入口）
src/              全部源文件（原生 ES 模块，依赖关系写在 import 语句里）
  content-loader.js   manifest 里唯一的 content script（classic）：同步注册消息监听并缓冲，
                      再动态 import 会话模块——onMessage 的唯一注册与派发点（ADR-0006）
  content.js          会话装配：把下面四块接成 createContentSession()，并派发消息
  content-session.js  会话状态与生命周期（会话标志、代号作废、在途端口、宿主登记）
  content-render.js   译文节点写入与加载动画
  content-translate.js 单宿主端口流程与并发池（ADR-0005）
  content-observer.js 页面观察器与防抖调度
  background.js     右键菜单（与页面握手切换）、左键直达配置页、全部 API/SSE 请求代理（ADR-0004）
  config.js         默认值 + mergeConfig() 类型防御合并 + loadConfig() 异步加载（storage 注入）
  debug.js          三通道日志（console 双级 + storage.local 环形落盘）
  prompt.js         默认提示词模板 + renderPrompt()（{host} 单宿主占位）
  text-utils.js     isChinese / textOf / hasTranslatableText
  sanitize.js       sanitizeHtml() 白名单净化（含媒体元素移除：svg/img/video/canvas 等）
  host-discovery.js 剥码文本提取 / 宿主资格 / DFS 宿主发现 / 骨架序列化
  options.js        配置页逻辑（回填 / 保存 / 恢复默认）
tests/            node:test 套件（101 用例，含 jsdom DOM 层集成测试）
```

MV3 下 content script 无 CORS 豁免，所有翻译请求由 background service worker 代理发起；
每个宿主一条 `runtime.connect` 端口（ADR-0005），流式 delta 回传，断开即中止上游请求。

MV3 的 `content_scripts` 声明不支持模块类型，所以内容脚本入口是一个 classic 加载器，
模块经 `web_accessible_resources` 动态 import（未启用 `use_dynamic_url`——与动态 import
不兼容，实测见 ADR-0006）。`tests/manifest-consistency.test.js` 静态守住这套清单一致性。

## 测试

```
npm test
```

`npm test` = `npm run lint && npm run test:unit`（101 用例）。node 内置测试运行器 + jsdom 覆盖：
宿主即请求协议（一次 translate = N 个独立端口请求、流式预览/done 定稿/空回显）、并发池上限与失败粒度、
重扫调度（防抖合并/忙则重试/展开属性/会话外安全边界）、骨架序列化、文本判定边界、提示词渲染、
配置合并类型防御、宿主发现与净化（jsdom）、清单一致性（引用文件存在 / import 图无幽灵引用 /
模块图已登记可访问资源）。真实布局几何不测（jsdom 无排版引擎，夹具 stub）。

## 文档

- `docs/adr/0001-streaming-batched-translation.md` — 流式分批决策（分批部分已被 0005 取代，流式部分延续）
- `docs/adr/0002-insertion-not-replacement.md` — 插入式译文决策（含 v2/v3 修订）
- `docs/adr/0003-hardcoded-config-with-ui-seam.md` — 硬编码配置 + UI 接入点（已兑现）
- `docs/adr/0004-background-worker-proxy.md` — MV3 CORS 限制下 API 请求走 background
- `docs/adr/0005-per-host-request.md` — 宿主即请求：废除批次合并与标记协议（取代 0001 分批部分）
- `docs/adr/0006-native-esm-modules.md` — 原生 ESM 零构建：加载器竞态、`use_dynamic_url` 实测证伪、最低版本 106、已知盲区

## 问题排查

运行日志本地落盘（`chrome.storage.local`，三通道各保留最近 500 条，密钥自动脱敏为 `sk-***`）：

| 通道                           | 键        | 查看位置                                                      |
| ------------------------------ | --------- | ------------------------------------------------------------- |
| 翻译主流程（content script）   | `log-cs`  | 任意被翻译页面的 DevTools Console（勾选 Verbose 级别）        |
| API 请求代理（service worker） | `log-bg`  | `chrome://extensions` → 本扩展 → 「检查视图：service worker」 |
| 配置页动作                     | `log-opt` | 配置页 DevTools Console                                       |

- 配置页「导出日志」按钮：合并三通道按时间排序，下载 JSON 文件（排查时可直接把该文件发给开发者）
- 配置页「清空日志」按钮：清除全部落盘日志
- 也可在控制台手动查看：`chrome.storage.local.get('log-cs', c => console.table(c['log-cs']))`
