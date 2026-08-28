# 01: 真机验证——内容脚本动态 import 扩展资源确实可用

**What to build:** 在真实 Chrome 里确认整个 ESM 方案的地基成立：一个内容脚本能通过扩展资源 URL 动态 import 到扩展自己的模块并拿到导出；开启资源 URL 轮换（`use_dynamic_url`）后这条路依然通；模块化 service worker 同时可用。用一个最小的一次性扩展验证（不动本仓库任何源文件），把验证通过的 Chrome 版本记下来作为最低版本声明的依据。

这张票存在的唯一理由：它是本次重构风险最高、且开发机无法验证的假设。先证伪比事后返工便宜——若不成立，后续换轨票的前提就没了，必须回到决策而不是硬做。

**Blocked by:** None (can start immediately)

**Status:** done（已实测完成：Edge 148 headless 跑通探针，结论为降级方案 A——放弃 `use_dynamic_url`）

- [x] 最小扩展：一个 classic 内容脚本 + 一个被它动态 import 的模块 + 一个模块化 service worker，加载后控制台确认三者都工作
- [x] 被 import 的模块已列入可访问资源；确认未列入时的报错形态（作为后续一致性检查要防的错误）
- [ ] 开启资源 URL 轮换后重复验证：动态 import 仍成功 —— **实测不成立**（这条正是降级的触发点，见 Comments）
- [x] 记录验证所用的 Chrome 版本号，以及模块化 service worker 与 URL 轮换各自的版本下限（查官方文档确认，不靠推测）
- [x] 结论写进本票 `## Comments`：可行 / 需降级（关掉 URL 轮换）/ 不可行（前提失效，停下来回到决策）
- [x] 验证用的一次性扩展目录不进本仓库

## Comments

- 2026-08-28：真机实测完成，结论 **需降级——采用降级方案 A：放弃 `use_dynamic_url`**。

  实测环境与局限：本机 Chrome 151 与 Edge 148 均已安装。Chrome 稳定版有企业策略禁止 `--load-extension`（日志原文：`--load-extension is not allowed in Google Chrome, ignoring`），因此实测在 **Edge 148 headless**（同 Chromium 内核）完成，探针通过本地 HTTP 回报结果——**这是本次验证的已知局限：验的是 Chromium 内核行为，不是 Chrome 官方版本本身**。

  结果：
  - 开启 `use_dynamic_url: true` → 内容脚本动态 import 扩展模块 **失败**，报错 `Failed to fetch dynamically imported module`
  - 关闭 `use_dynamic_url` → 动态 import **成功**；模块内静态 import 二级依赖成功（`dep-loaded`）；未登记进 `web_accessible_resources` 的模块被正确阻止；模块化 service worker + 静态 import 成功
  - 隔离实验（决定性）：开启轮换时对**同一个 URL** 分别 `fetch` 与 `import`，`fetch` 返回 HTTP 200（597 字节），`import` 失败 → 证明不是资源不可访问，而是**模块加载器这条路被轮换 URL 掐断**

  版本下限（查 developer.chrome.com 官方文档所得）：
  - 模块化 service worker（`type: module`）：Chrome 92
  - Chrome 106 起「沙箱 iframe 与动态 import 这类不透明来源也能访问可访问资源」
  - 据此 `minimum_chrome_version` 取 **106**（92 只保证 SW，动态 import 那条路要到 106 才可靠）

  用户已拍板：**降级方案 A** —— 放弃 `use_dynamic_url`，接受页面可用固定扩展 ID 探测扩展是否安装（指纹识别）。理由：本扩展未打包、私有、不上商店，不会出现在任何指纹清单里；且它本来就会往页面插入 `class=translate-node` 的译文节点，读 DOM 比猜 ID 容易得多，轮换 URL 挡不住那条路。
