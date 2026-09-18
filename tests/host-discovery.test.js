// 工单 04：host-discovery 测试（jsdom）——
// 剥码提取 / 资格判定（纯码跳过+常规保留标签）/ DFS 发现 / 快照序列化 / 净化
// 票 01（feed-strip-non-rendering）：非渲染标签与注释剥离、剥离后为空则不产生条目
import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

import { createHostDiscovery } from "../src/host-discovery.js";
import { sanitizeHtml } from "../src/sanitize.js";

// 夹具：jsdom 元素树 + inline style 驱动 display + getBoundingClientRect 仅测试内 stub
function makeEnv(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
  };
  const hostState = new Map();
  const hd = createHostDiscovery({
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    hostState,
  });
  return { dom, hd, doc: dom.window.document, hostState };
}

const B = 'style="display:block"'; // 显式安全块，避免依赖 jsdom UA 样式表

// ============ 1. 剥码提取（nonCodeText） ============

test("nonCodeText: 剥除 code 子树，保留周边散文", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = "Use the <code>x</code> API";
  assert.equal(hd.nonCodeText(p), "Use the  API");
});

test("nonCodeText: 整段 pre/code → 空串", () => {
  const { hd, doc } = makeEnv("");
  const pre = doc.createElement("pre");
  pre.innerHTML = "<code>x = 1;</code>";
  assert.equal(hd.nonCodeText(pre), "");
});

test("nonCodeText: 混合容器只留散文（pre 剪掉）", () => {
  const { hd, doc } = makeEnv("");
  const div = doc.createElement("div");
  div.innerHTML = "<pre>code here</pre><p>docs</p>";
  assert.equal(hd.nonCodeText(div), "docs");
});

// ============ 2. 资格判定（qualifiesAsHost） ============

test("资格: 全码宿主（pre>code）→ 跳过", () => {
  const { hd, doc } = makeEnv("<pre><code>x = 1;</code></pre>");
  const pre = doc.body.firstElementChild;
  assert.equal(hd.qualifiesAsHost(pre), false);
});

test("资格: 常规宿主保留——含 code 标签的段落合格", () => {
  const { hd, doc } = makeEnv(`<p ${B}>Use <code>x</code> API</p>`);
  const p = doc.body.firstElementChild;
  assert.equal(hd.qualifiesAsHost(p), true);
});

test("资格: 纯中文宿主 → 跳过", () => {
  const { hd, doc } = makeEnv(`<p ${B}>这是一段完全中文的段落内容</p>`);
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("资格: 纯 URL 宿主 → 跳过", () => {
  const { hd, doc } = makeEnv(`<p ${B}>https://example.com/a/b?x=1</p>`);
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("资格: display:none 宿主 → 跳过", () => {
  const { hd, doc } = makeEnv('<p style="display:none">hidden english text</p>');
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("资格: 已在 hostState 的宿主 → 跳过（防重复处理）", () => {
  const { hd, doc, hostState } = makeEnv(`<p ${B}>qualified english text</p>`);
  const p = doc.body.firstElementChild;
  hostState.set(p, {});
  assert.equal(hd.qualifiesAsHost(p), false);
});

// ============ 3. DFS 宿主发现（discoverEntries） ============

test("DFS: 安全块白名单命中——独立段落成为宿主", () => {
  const { hd, doc } = makeEnv(`<p ${B}>hello world content</p>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el, doc.body.firstElementChild);
});

test("DFS: 更深块存在时下探——宿主是 p 而非包裹 div", () => {
  const { hd, doc } = makeEnv(`<div ${B}><p ${B}>para text here</p></div>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "P");
});

test("DFS: flex 容器下探至子项内部", () => {
  const { hd, doc } = makeEnv(`<div style="display:flex"><p ${B}>inner flex text</p></div>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "P");
});

test("DFS: 纯码包裹层被剪枝（无条目产生）", () => {
  const { hd, doc } = makeEnv(`<div ${B}><pre><code>x = 1;</code></pre></div>`);
  assert.equal(hd.discoverEntries(doc.body).length, 0);
});

test("DFS: 硬跳过剪枝——aria-hidden 区域不产生条目", () => {
  const { hd, doc } = makeEnv(`<p ${B}>ok text here</p><p aria-hidden="true">ghost text</p>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].el.textContent.includes("ok text"));
});

// ============ 4. 快照序列化（snapshotHtml） ============

test("快照: 剔除自身插入物（.translate-node）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'real text<span class="translate-node">插入的译文</span>';
  const snap = hd.snapshotHtml(p);
  assert.equal(snap.includes("translate-node"), false);
  assert.ok(snap.includes("real text"));
});

test("快照: 含标签原样透传（code/b 结构保留）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = "Use <code>x</code> and <b>bold</b>";
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<code>x</code>"));
  assert.ok(snap.includes("<b>bold</b>"));
});

// ============ 5. discoverEntries 集成：标签透传到 payload ============

test("集成: 常规宿主的 payload 保留标签（标签透传到端口）", () => {
  const { hd, doc } = makeEnv(`<p ${B}>Use <code>fooBar</code> and <b>bold</b> text</p>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].html.includes("<code>fooBar</code>"));
  assert.ok(entries[0].html.includes("<b>bold</b>"));
});

test("集成: 整页只有代码块 → 零条目", () => {
  const { hd, doc } = makeEnv(
    `<pre><code>function a() {}</code></pre><pre><code>var b = 2;</code></pre>`,
  );
  assert.equal(hd.discoverEntries(doc.body).length, 0);
});

// ============ 6. 净化（sanitizeHtml） ============

// ============ 7. 媒体占位（投喂序列化：图形数据不进 prompt） ============

test("占位: img——base64 src 与 alt 丢弃，只剩同名空占位", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'Text before <img src="data:image/png;base64,iVBORw0KGgoAAAANS" alt="diagram title"> and after';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<img>"));
  assert.equal(snap.includes("base64"), false);
  assert.equal(snap.includes("alt="), false);
  assert.equal(snap.includes("diagram"), false);
  assert.ok(snap.includes("Text before"));
  assert.ok(snap.includes("and after"));
  assert.ok(snap.length < p.innerHTML.length); // 占位化直接压低批次字符计数
});

test("占位: svg——path 坐标与 viewBox 丢弃，子树清空为 <svg></svg>", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'See <svg viewBox="0 0 24 24"><path d="M0 0L24 24Z" fill="red"></path></svg> chart below';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<svg></svg>"));
  assert.equal(snap.includes("M0 0L24 24Z"), false);
  assert.equal(snap.includes("viewBox"), false);
  assert.equal(snap.includes("path"), false);
  assert.ok(snap.includes("See"));
  assert.ok(snap.includes("chart below"));
});

test("占位: picture/source 组合——嵌套媒体一并清空，各自同名空占位", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'Pic <picture><source srcset="a.webp 1x, b.webp 2x" type="image/webp"><img src="a.jpg" alt="fallback"></picture> here';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<picture></picture>"));
  assert.equal(snap.includes("srcset"), false);
  assert.equal(snap.includes("a.webp"), false);
  assert.equal(snap.includes("a.jpg"), false);
  assert.equal(snap.includes("fallback"), false);
  assert.ok(snap.includes("Pic"));
  assert.ok(snap.includes("here"));
});

test("占位: video/audio/canvas/map 同清单占位（媒体清单变化即红）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'A <video src="clip.mp4" controls poster="p.jpg"></video>' +
    ' B <audio src="note.mp3" controls></audio>' +
    ' C <canvas width="500" height="200"></canvas>' +
    ' D <map name="m"><area href="#r" coords="0,0,1,1"></area></map> E';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<video></video>"));
  assert.ok(snap.includes("<audio></audio>"));
  assert.ok(snap.includes("<canvas></canvas>"));
  assert.ok(snap.includes("<map></map>"));
  ["clip.mp4", "note.mp3", "controls", "poster", "width", "coords", "area", 'name="m"'].forEach(
    (gone) => assert.equal(snap.includes(gone), false, gone),
  );
  assert.ok(
    snap.includes("A") &&
      snap.includes("B") &&
      snap.includes("C") &&
      snap.includes("D") &&
      snap.includes("E"),
  );
});

test("回归: pre/code 投喂保留——占位化不动代码块（判定剥除、投喂保留）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = "Use <pre><code>x = 1; // init</code></pre> after";
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<pre><code>x = 1; // init</code></pre>"));
  assert.ok(snap.includes("Use"));
});

test("集成: 含 base64 图的段落正常进批，payload 只剩空占位", () => {
  const { hd, doc } = makeEnv(
    `<p ${B}>Screenshot <img src="data:image/png;base64,iVBORw0KGgoAAAANS"> shown here</p>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].html.includes("<img>"));
  assert.equal(entries[0].html.includes("base64"), false);
  assert.ok(entries[0].html.includes("Screenshot"));
  assert.ok(entries[0].html.includes("shown here"));
});

// ============ 8. 骨架序列化（属性全剥 + input/button 换名 span） ============

test("骨架: 属性全剥——<a class=x href=y>T</a> → <a>T</a>", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'See <a class="btn link" href="https://example.com/docs" target="_blank" title="manual">the manual</a> now';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<a>the manual</a>"));
  ["class=", "href", "target=", "title=", "example.com", "btn"].forEach((gone) =>
    assert.equal(snap.includes(gone), false, gone),
  );
  assert.ok(snap.includes("See"));
  assert.ok(snap.includes("now"));
});

test("骨架: 各类元素属性全剥——span/code/em 只剩标签与文本", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    '<span class="x" id="s1" data-kind="v">Alpha</span> <code class="hljs lang-ts">beta()</code> <em style="color:red">gamma</em>';
  const snap = hd.snapshotHtml(p);
  assert.equal(snap, "<span>Alpha</span> <code>beta()</code> <em>gamma</em>");
});

test("骨架: input 换名 span——纯占位，value 属性不进投喂", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'Go <input type="submit" value="Search now"> ok';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<span></span>"));
  assert.equal(snap.includes("Search now"), false);
  assert.equal(snap.includes("input"), false);
  assert.equal(snap.includes("type="), false);
  assert.ok(snap.includes("Go"));
  assert.ok(snap.includes("ok"));
});

test("骨架: input 无 value → 空 span（placeholder 不进投喂）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'X <input type="text" placeholder="Type words here"> Y';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<span></span>"));
  assert.equal(snap.includes("input"), false);
  assert.equal(snap.includes("placeholder"), false);
  assert.equal(snap.includes("Type words"), false);
});

test("骨架: button 换名 span——子内容与嵌套标签保留、属性全剥", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'A <button class="btn" type="button" onclick="evil()"><b>Click</b> me</button> B';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<span><b>Click</b> me</span>"));
  ["button", "class=", "onclick", "type="].forEach((gone) =>
    assert.equal(snap.includes(gone), false, gone),
  );
  assert.ok(snap.includes("A"));
  assert.ok(snap.includes("B"));
});

test("骨架: 与媒体占位叠加——img 空占位 + input 换名 + 属性全剥一次到位", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML =
    'Pic <img src="data:image/png;base64,iVBORw0KGgoAAAANS" alt="diagram"> Go <input value="Run" class="go"> End';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<img>"));
  assert.ok(snap.includes("<span></span>"));
  ["base64", "alt=", "diagram", "Run", "input", "class="].forEach((gone) =>
    assert.equal(snap.includes(gone), false, gone),
  );
  assert.ok(snap.includes("Pic") && snap.includes("Go") && snap.includes("End"));
});

// ============ 9. 裸放/嵌套 pre/code 候选整段跳过（与纯码包裹层语义统一） ============

test("资格: 候选自身为 PRE → 不具资格（裸放英文 pre 整段静默跳过）", () => {
  const { hd, doc } = makeEnv('<pre style="display:block">bare english prose in pre tag</pre>');
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("资格: 候选自身为 CODE → 不具资格", () => {
  const { hd, doc } = makeEnv('<code style="display:block">standalone english code text</code>');
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("发现: 裸放英文 pre 不产生条目（修复前红：整段英文 pre 被当宿主投喂）", () => {
  const { hd, doc } = makeEnv(
    '<pre style="display:block">function englishWords() { return 1; }</pre>',
  );
  assert.equal(hd.discoverEntries(doc.body).length, 0);
});

test("发现: 混合容器内嵌套 pre 不再单独成宿主——只有 p 入批（修复前红）", () => {
  const { hd, doc } = makeEnv(
    `<div ${B}><p ${B}>docs prose here</p><pre style="display:block">var english words</pre></div>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "P");
});

test("回归: p+pre 混合宿主判定与投喂不变（pre 子树保留、骨架无属性）", () => {
  const { hd, doc } = makeEnv(`<div ${B}>Use <pre><code>x = 1; // init</code></pre> after</div>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].html.includes("<pre><code>x = 1; // init</code></pre>"));
  assert.ok(entries[0].html.includes("Use"));
  assert.ok(entries[0].html.includes("after"));
});

test("净化: 移除 script 与 iframe", () => {
  const { doc } = makeEnv("");
  const out = sanitizeHtml('<p>keep</p><script>evil()</script><iframe src="x"></iframe>', doc);
  assert.equal(out.includes("script"), false);
  assert.equal(out.includes("iframe"), false);
  assert.ok(out.includes("keep"));
});

test("净化: 移除 on* 属性", () => {
  const { doc } = makeEnv("");
  const out = sanitizeHtml('<p onclick="evil()">t</p>', doc);
  assert.equal(out.includes("onclick"), false);
  assert.ok(out.includes("t"));
});

test("净化: 移除 javascript: 与 data:text/html URL", () => {
  const { doc } = makeEnv("");
  const out = sanitizeHtml(
    '<a href="javascript:alert(1)">a</a><img src="data:text/html;base64,x">',
    doc,
  );
  assert.equal(out.includes("javascript:"), false);
  assert.equal(out.includes("data:text/html"), false);
});

test("净化: 正常 URL 与标签保留", () => {
  const { doc } = makeEnv("");
  const out = sanitizeHtml('<a href="https://ok.com">y</a><code>x</code>', doc);
  assert.ok(out.includes('href="https://ok.com"'));
  assert.ok(out.includes("<code>x</code>"));
});

test("净化: 媒体元素整个移除（svg/img/video/canvas 等，与输入侧占位清单一致）", () => {
  const { doc } = makeEnv("");
  const out = sanitizeHtml(
    '<p>keep<img src="x.png">see<svg viewBox="0 0 24 24"><path d="M0 0L24 24Z"></path><text>label</text></svg>' +
      '<video src="v.mp4" controls></video><audio src="a.mp3"></audio>' +
      '<canvas width="500"></canvas><picture><source srcset="a.webp"><img src="a.jpg"></picture>' +
      '<map name="m"><area coords="0,0"></map></p>',
    doc,
  );
  for (const tag of [
    "img",
    "svg",
    "video",
    "audio",
    "canvas",
    "picture",
    "source",
    "map",
    "area",
  ]) {
    assert.equal(out.includes("<" + tag), false, tag + " 应整个移除");
  }
  assert.ok(out.includes("keep"));
  assert.ok(out.includes("see"));
});

// ============ 6b. 净化：空白规范与空节点去除（工单 01） ============
// 断言只落在函数外部行为：输入 HTML → 输出 HTML 字符串形态。

function sanitizeWith(html, doc) {
  return sanitizeHtml(html, doc);
}

test("空白: 块间纯空白节点删除，不残留空行/缩进空白", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>a</p>\n\n<p>b</p>", doc), "<p>a</p><p>b</p>");
});

test("空白: 行内相邻两侧各保单空格（Hello <b>bold</b> 不粘连）", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>alpha <b>bold</b> beta</p>", doc), "<p>alpha <b>bold</b> beta</p>");
  assert.equal(
    sanitizeWith("<p>Hello <b>bold</b> world</p>", doc),
    "<p>Hello <b>bold</b> world</p>",
  );
});

test("空白: 句间/词间空格保留（含中部空白不压缩、单空格文本保留）", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>hello world</p>", doc), "<p>hello world</p>");
  assert.equal(sanitizeWith("<p>First.  Second.</p>", doc), "<p>First.  Second.</p>");
  assert.equal(sanitizeWith("<p>a  b</p>", doc), "<p>a  b</p>");
  assert.equal(sanitizeWith("<p>Hello  \n\n  world</p>", doc), "<p>Hello  \n\n  world</p>");
});

test("空白: 实体空白清理——&nbsp;/&#10;/&#9;/&#x200B; 及零宽字符", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>x</p>&nbsp;&#10;&#9;&#x200B;<p>y</p>", doc), "<p>x</p><p>y</p>");
  assert.equal(sanitizeWith("<p>a\u00a0b</p>", doc), "<p>a&nbsp;b</p>");
  assert.equal(sanitizeWith("<p> \u200B </p>", doc), "");
  assert.equal(sanitizeWith("<p>a\u200Bb</p>", doc), "<p>a\u200Bb</p>");
});

test("空白: 空壳元素删除——块间 <div> </div>、<span>\n</span>、<p> </p>", () => {
  const { doc } = makeEnv("");
  assert.equal(
    sanitizeWith("<p>one</p><div> </div><span>\n</span><p>two</p>", doc),
    "<p>one</p><p>two</p>",
  );
  assert.equal(sanitizeWith("<p>a</p><p> </p><p>b</p>", doc), "<p>a</p><p>b</p>");
});

test("空白: 链式空壳自底向上清空——空 ul 内空 li 整体消失", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<ul><li></li><li> </li></ul>", doc), "");
});

test("空白: 空表格结构保留（td/th/tr 空壳不塌陷）", () => {
  const { doc } = makeEnv("");
  assert.equal(
    sanitizeWith("<table><tr><td></td><td> </td></tr></table>", doc),
    "<table><tbody><tr><td></td><td></td></tr></tbody></table>",
  );
});

test("空白: pre/code 内部换行缩进与注释原样（整棵子树豁免）", () => {
  const { doc } = makeEnv("");
  assert.equal(
    sanitizeWith(`<pre><code>  keep  \n  indent\n</code></pre>`, doc),
    `<pre><code>  keep  \n  indent\n</code></pre>`,
  );
});

test("空白: void 元素 br 保留——模型用其表达的换行仍生效", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>a<br>b</p>", doc), "<p>a<br>b</p>");
});

test("空白: 首个文本节点的前导空白照删不保（缩进不留屏）", () => {
  const { doc } = makeEnv("");
  assert.equal(sanitizeWith("<p>  hello world  </p>", doc), "<p>hello world</p>");
  assert.equal(sanitizeWith("<p> \n  hello world\n</p>", doc), "<p>hello world</p>");
});

// ============ 10. 区域分档与排序（翻译优先级：只改请求次序） ============

test("分档: main 内宿主判正文档（0）", () => {
  const { hd, doc } = makeEnv(`<main ${B}><p ${B}>main prose text</p></main>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 0);
});

test("分档: 无标记宿主判未标记档（1）", () => {
  const { hd, doc } = makeEnv(`<div ${B}><p ${B}>plain prose text</p></div>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 1);
});

test("分档: footer 内宿主判边缘档（2）", () => {
  const { hd, doc } = makeEnv(`<footer ${B}><p ${B}>footer prose text</p></footer>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 2);
});

test("分档: 宿主自身即边缘标记 → 边缘档（自身参与判定）", () => {
  const { hd, doc } = makeEnv(`<nav ${B}>navigation prose text</nav>`);
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "NAV");
  assert.equal(entries[0].tier, 2);
});

test("分档: main > nav 判边缘档——最近祖先胜出", () => {
  const { hd, doc } = makeEnv(
    `<main ${B}><nav ${B}><p ${B}>table of contents link text</p></nav></main>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 2);
});

test("分档: aside > article 判正文档——最近祖先胜出（反向）", () => {
  const { hd, doc } = makeEnv(
    `<aside ${B}><article ${B}><p ${B}>sidebar article prose</p></article></aside>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 0);
});

test("分档: role 与标签等效（div role=navigation → 边缘档）", () => {
  const { hd, doc } = makeEnv(
    `<div role="navigation" ${B}><p ${B}>menu entry prose text</p></div>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier, 2);
});

test("排序: 正文→未标记→边缘，档内保持文档序", () => {
  const { hd, doc } = makeEnv(
    `<footer ${B}><p ${B}>footer prose text</p></footer>` +
      `<div ${B}><p ${B}>unmarked prose text</p></div>` +
      `<main ${B}><p ${B}>main first prose</p><p ${B}>main second prose</p></main>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((e) => e.tier),
    [0, 0, 1, 2],
  );
  assert.ok(entries[0].html.includes("main first"));
  assert.ok(entries[1].html.includes("main second"));
  assert.ok(entries[2].html.includes("unmarked"));
  assert.ok(entries[3].html.includes("footer"));
});

// ============ 11. 非渲染标签与注释剥离、剥离后为空则不产生条目（票 01） ============
// 断言只落在快照返回的字符串与宿主发现出口的条目上；层数只是构造手段。

// 非渲染标签清单逐项：内容标记 + 元素自身都不得出现在快照里
const NON_RENDERED_CASES = [
  ["script", '<script>var mark = "SCRIPT_MARK";</script>', "SCRIPT_MARK"],
  ["style", "<style>.mark { color: red } /* STYLE_MARK */</style>", "STYLE_MARK"],
  ["iframe", '<iframe src="IFRAME_MARK"></iframe>', "IFRAME_MARK"],
  ["template", "<template><span>TEMPLATE_MARK</span></template>", "TEMPLATE_MARK"],
  ["noscript", "<noscript><span>NOSCRIPT_MARK</span></noscript>", "NOSCRIPT_MARK"],
  ["link", '<link rel="stylesheet" href="LINK_MARK.css">', "LINK_MARK"],
  ["meta", '<meta name="x" content="META_MARK">', "META_MARK"],
  ["base", '<base href="BASE_MARK/">', "BASE_MARK"],
];

// 剥离后只剩空白的各形态（实体经文本内容取用后已解码）
const BLANK_HOST_FORMS = [
  `<span ${B}> </span>`,
  `<div ${B}><br></div>`,
  `<div ${B}><img src="BLANK_IMG_MARK.png"></div>`,
  `<div ${B}>   \n\t  </div>`,
  `<div ${B}>&nbsp;</div>`,
  `<div ${B}>&ensp;&ensp;</div>`,
  `<div ${B}>&#8203;&#8203;</div>`,
  `<div ${B}>&#8204;&#8205;</div>`,
];

test("剥离: 非渲染标签逐项删除——清单内每项连同其内容都不进快照", () => {
  const { hd, doc } = makeEnv("");
  for (const [tag, html, marker] of NON_RENDERED_CASES) {
    const el = doc.createElement("div");
    el.innerHTML = `Before ${html} After`;
    const snap = hd.snapshotHtml(el);
    assert.equal(snap.includes(marker), false, `${tag}: 内容应被剥离（${marker}）`);
    assert.equal(snap.includes(`<${tag}`), false, `${tag}: 元素自身应被剥离`);
    assert.ok(snap.includes("Before") && snap.includes("After"), `${tag}: 周边正文保留`);
  }
});

test("剥离: template 的 content 内文本/属性/媒体数据/脚本都不出现在快照里", () => {
  const { hd, doc } = makeEnv("");
  const el = doc.createElement("div");
  el.innerHTML =
    'Keep <template data-tpl="TPL_ATTR">' +
    '<span data-x="1">TEMPLATE_TEXT_MARK</span>' +
    '<img src="data:image/png;base64,TPL_MEDIA_MARK">' +
    '<script>var s = "TPL_SCRIPT_MARK";</script>' +
    "</template> tail";
  const snap = hd.snapshotHtml(el);
  assert.equal(snap, "Keep  tail", "删 template 元素即连带 content 一并消失");
  for (const gone of [
    "template",
    "TEMPLATE_TEXT_MARK",
    "TPL_ATTR",
    "TPL_MEDIA_MARK",
    "TPL_SCRIPT_MARK",
    "data-x",
  ]) {
    assert.equal(snap.includes(gone), false, gone);
  }
});

test("剥离: HTML 注释不出现在快照里（含渲染标记形态）", () => {
  const { hd, doc } = makeEnv("");
  const el = doc.createElement("div");
  el.innerHTML = "Alpha <!--COMMENT_MARK--> beta <!--?lit$29506216$--> gamma";
  const snap = hd.snapshotHtml(el);
  assert.equal(snap.includes("COMMENT_MARK"), false);
  assert.equal(snap.includes("lit$"), false);
  assert.equal(snap.includes("<!--"), false);
  assert.equal(snap, "Alpha  beta  gamma", "注释删净，正文与语序不变");
});

test("判空: 剥离后只剩空白的各形态快照为空串且不产生条目", () => {
  const { hd, doc } = makeEnv(BLANK_HOST_FORMS.join(""));
  assert.equal(hd.discoverEntries(doc.body).length, 0, "空白形态一律不产生条目");
  for (const host of doc.body.children) {
    assert.equal(hd.snapshotHtml(host), "", `${host.outerHTML} 快照应为空串`);
  }
});

test("判空: 空宿主不写「已处理」登记——页面后来填充内容时下一轮重扫仍会评估它", () => {
  // 资格判定通过（媒体备用文本计字）、快照却在媒体步骤清空后为空的块：
  // 出口丢弃它，但不留下任何登记痕迹
  const { hd, doc, hostState } = makeEnv(
    `<div ${B}><svg viewBox="0 0 10 10"><text>chart label english</text></svg></div>`,
  );
  const host = doc.body.firstElementChild;
  assert.equal(hd.discoverEntries(doc.body).length, 0, "判空宿主不产生条目");
  assert.equal(hostState.size, 0, "空宿主不写「已处理」登记（不是「登记后跳过」）");

  // 页面后来自行填充正文：同一块在下一轮重扫里被重新评估并成为宿主
  host.innerHTML = "Late english content";
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1, "填充内容后的重扫仍会评估它");
  assert.equal(entries[0].el, host);
  assert.equal(entries[0].html, "Late english content");
});

test("判空: 纯脚本容器（被样式撑出高度）不产生条目", () => {
  const { hd, doc } = makeEnv(
    `<div ${B}><script>var mark = "ONLY SCRIPT english words";</script></div>`,
  );
  const host = doc.body.firstElementChild;
  assert.equal(hd.snapshotHtml(host), "", "剥离脚本后容器为空");
  assert.equal(hd.discoverEntries(doc.body).length, 0, "纯脚本容器不成为宿主");
});

test("资格: 脚本里的中文不影响判定——短英文 + 长中文脚本仍成宿主", () => {
  const scriptProse =
    'var note = "这是一段很长的中文脚本文本，用来把汉字占比推高到三成以上，从而在修复前让整段被跳过";';
  const { hd, doc } = makeEnv(`<p ${B}>Short english note<script>${scriptProse}</script></p>`);
  const p = doc.body.firstElementChild;
  assert.equal(hd.qualifiesAsHost(p), true, "脚本文本不计入汉字占比");
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1, "短英文段落仍成宿主");
  assert.equal(entries[0].el, p);
  assert.equal(entries[0].html, "Short english note", "请求内容只剩正文");
});

test("回归: 含脚本的常规段落仍成宿主，快照只剩正文且语序不变", () => {
  const { hd, doc } = makeEnv(
    `<p ${B}>Alpha english text<script>var x = "SCRIPT_MARK";</script> beta english text</p>`,
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1, "含脚本的常规段落照常成宿主");
  assert.equal(entries[0].html, "Alpha english text beta english text", "脚本删净、正文语序不变");
});

test("剥离: 嵌套深度不限——逐层加深的包裹里，最内层的脚本/框架/模板/注释都被剥离", () => {
  const { hd, doc } = makeEnv("");
  const inner =
    '<script>var deep = "DEEP_SCRIPT_MARK";</script>' +
    "<noscript><span>DEEP_NOSCRIPT_MARK</span></noscript>" +
    "<template><span>DEEP_TEMPLATE_MARK</span></template>" +
    "<!--DEEP_COMMENT_MARK-->" +
    "<b>kept english prose</b>";
  const host = doc.createElement("div");
  host.setAttribute("style", "display:block");
  doc.body.appendChild(host);

  // 层数只是构造手段，不是规格内容：循环逐层加深地构造，每一层都断言。
  // 断言写在「全部条目的快照串起来」上，不假定只有一个条目。
  let wrapped = inner;
  for (let depth = 1; depth <= 14; depth++) {
    wrapped = `<span>${wrapped}</span>`;
    host.innerHTML = wrapped;
    const all = hd
      .discoverEntries(doc.body)
      .map((e) => e.html)
      .join("");
    for (const gone of [
      "DEEP_SCRIPT_MARK",
      "DEEP_NOSCRIPT_MARK",
      "DEEP_TEMPLATE_MARK",
      "DEEP_COMMENT_MARK",
      "<script",
      "<noscript",
      "<template",
      "<!--",
    ]) {
      assert.equal(all.includes(gone), false, `深度 ${depth} 仍应剥离：${gone}`);
    }
    assert.ok(all.includes("kept english prose"), `深度 ${depth}：正文保留`);
  }
});

test("判空: 嵌套深度不限的空壳判空——逐层加深的包裹里最内层只有空白，出口始终无条目", () => {
  const { hd, doc } = makeEnv("");
  const host = doc.createElement("div");
  host.setAttribute("style", "display:block");
  doc.body.appendChild(host);

  let wrapped = "   ";
  for (let depth = 1; depth <= 14; depth++) {
    wrapped = `<span>${wrapped}</span>`;
    host.innerHTML = wrapped;
    assert.equal(hd.discoverEntries(doc.body).length, 0, `深度 ${depth}：整条空壳链算空`);
  }
});

test("判空: 任意深度下，剥离/占位后内容为空的宿主都被出口丢弃", () => {
  const { hd, doc } = makeEnv("");
  const host = doc.createElement("div");
  host.setAttribute("style", "display:block");
  doc.body.appendChild(host);

  // 媒体备用文本使资格判定通过，快照却在媒体步骤清空后为空——判空兜住资格判定
  // 覆盖不到的偏差，且这份兜底在任意深度都成立
  const svgOnly = '<svg viewBox="0 0 10 10"><text>chart label english</text></svg>';
  let wrapped = svgOnly;
  for (let depth = 1; depth <= 14; depth++) {
    wrapped = `<span>${wrapped}</span>`;
    host.innerHTML = wrapped;
    assert.equal(hd.qualifiesAsHost(host), true, `深度 ${depth}：资格判定通过（判空是唯一兜底）`);
    assert.equal(hd.snapshotHtml(host), "", `深度 ${depth}：媒体子树清空后只剩空白 → 快照空串`);
    assert.equal(hd.discoverEntries(doc.body).length, 0, `深度 ${depth}：出口丢弃快照为空的候选`);
  }
});

test("零写入: 剥离与判空只作用于克隆子树，页面真实 DOM 逐字节不变", () => {
  const { hd, doc } = makeEnv(
    `<div ${B}>Alpha<script>var s = "SCRIPT_MARK";</script><!--COMMENT_MARK--><template><span>T</span></template> beta</div>`,
  );
  const host = doc.body.firstElementChild;
  const before = host.innerHTML;
  hd.discoverEntries(doc.body);
  hd.snapshotHtml(host);
  assert.equal(host.innerHTML, before, "页面真实 DOM 零写入");
  assert.ok(
    before.includes("SCRIPT_MARK") && before.includes("<!--COMMENT_MARK-->"),
    "原文含脚本与注释",
  );
});
