// 工单 04：host-discovery 测试（jsdom）——
// 剥码提取 / 资格判定（纯码跳过+常规保留标签）/ DFS 发现 / 快照序列化 / 净化
const { test } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const HostDiscovery = require("../lib/host-discovery.js");
const { sanitizeHtml } = require("../lib/sanitize.js");

// 夹具：jsdom 元素树 + inline style 驱动 display + getBoundingClientRect 仅测试内 stub
function makeEnv(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 };
  };
  const hostState = new Map();
  const hd = HostDiscovery.createHostDiscovery({
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
  p.innerHTML = 'Use the <code>x</code> API';
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
  div.innerHTML = '<pre>code here</pre><p>docs</p>';
  assert.equal(hd.nonCodeText(div), "docs");
});

// ============ 2. 资格判定（qualifiesAsHost） ============

test("资格: 全码宿主（pre>code）→ 跳过", () => {
  const { hd, doc } = makeEnv('<pre><code>x = 1;</code></pre>');
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
  const { hd, doc } = makeEnv(
    `<div style="display:flex"><p ${B}>inner flex text</p></div>`
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "P");
});

test("DFS: 纯码包裹层被剪枝（无条目产生）", () => {
  const { hd, doc } = makeEnv(`<div ${B}><pre><code>x = 1;</code></pre></div>`);
  assert.equal(hd.discoverEntries(doc.body).length, 0);
});

test("DFS: 硬跳过剪枝——aria-hidden 区域不产生条目", () => {
  const { hd, doc } = makeEnv(
    `<p ${B}>ok text here</p><p aria-hidden="true">ghost text</p>`
  );
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
  p.innerHTML = 'Use <code>x</code> and <b>bold</b>';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<code>x</code>"));
  assert.ok(snap.includes("<b>bold</b>"));
});

// ============ 5. discoverEntries 集成：标签透传到 payload ============

test("集成: 常规宿主的 payload 保留标签（标签透传到端口）", () => {
  const { hd, doc } = makeEnv(
    `<p ${B}>Use <code>fooBar</code> and <b>bold</b> text</p>`
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].html.includes("<code>fooBar</code>"));
  assert.ok(entries[0].html.includes("<b>bold</b>"));
});

test("集成: 整页只有代码块 → 零条目", () => {
  const { hd, doc } = makeEnv(
    `<pre><code>function a() {}</code></pre><pre><code>var b = 2;</code></pre>`
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
  ["clip.mp4", "note.mp3", "controls", "poster", "width", "coords", "area", 'name="m"']
    .forEach((gone) => assert.equal(snap.includes(gone), false, gone));
  assert.ok(snap.includes("A") && snap.includes("B") && snap.includes("C") && snap.includes("D") && snap.includes("E"));
});

test("回归: pre/code 投喂保留——占位化不动代码块（判定剥除、投喂保留）", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'Use <pre><code>x = 1; // init</code></pre> after';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<pre><code>x = 1; // init</code></pre>"));
  assert.ok(snap.includes("Use"));
});

test("集成: 含 base64 图的段落正常进批，payload 只剩空占位", () => {
  const { hd, doc } = makeEnv(
    `<p ${B}>Screenshot <img src="data:image/png;base64,iVBORw0KGgoAAAANS"> shown here</p>`
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
    assert.equal(snap.includes(gone), false, gone)
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

test("骨架: input 换名 span——value 属性转为文本", () => {
  const { hd, doc } = makeEnv("");
  const p = doc.createElement("p");
  p.innerHTML = 'Go <input type="submit" value="Search now"> ok';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<span>Search now</span>"));
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
  p.innerHTML =
    'A <button class="btn" type="button" onclick="evil()"><b>Click</b> me</button> B';
  const snap = hd.snapshotHtml(p);
  assert.ok(snap.includes("<span><b>Click</b> me</span>"));
  ["button", "class=", "onclick", "type="].forEach((gone) =>
    assert.equal(snap.includes(gone), false, gone)
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
  assert.ok(snap.includes("<span>Run</span>"));
  ["base64", "alt=", "diagram", "input", "class="].forEach((gone) =>
    assert.equal(snap.includes(gone), false, gone)
  );
  assert.ok(snap.includes("Pic") && snap.includes("Go") && snap.includes("End"));
});

// ============ 9. 裸放/嵌套 pre/code 候选整段跳过（与纯码包裹层语义统一） ============

test("资格: 候选自身为 PRE → 不具资格（裸放英文 pre 整段静默跳过）", () => {
  const { hd, doc } = makeEnv('<pre style="display:block">bare english prose in pre tag</pre>');
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("资格: 候选自身为 CODE → 不具资格", () => {
  const { hd, doc } = makeEnv(
    '<code style="display:block">standalone english code text</code>'
  );
  assert.equal(hd.qualifiesAsHost(doc.body.firstElementChild), false);
});

test("发现: 裸放英文 pre 不产生条目（修复前红：整段英文 pre 被当宿主投喂）", () => {
  const { hd, doc } = makeEnv(
    '<pre style="display:block">function englishWords() { return 1; }</pre>'
  );
  assert.equal(hd.discoverEntries(doc.body).length, 0);
});

test("发现: 混合容器内嵌套 pre 不再单独成宿主——只有 p 入批（修复前红）", () => {
  const { hd, doc } = makeEnv(
    `<div ${B}><p ${B}>docs prose here</p><pre style="display:block">var english words</pre></div>`
  );
  const entries = hd.discoverEntries(doc.body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el.tagName, "P");
});

test("回归: p+pre 混合宿主判定与投喂不变（pre 子树保留、骨架无属性）", () => {
  const { hd, doc } = makeEnv(
    `<div ${B}>Use <pre><code>x = 1; // init</code></pre> after</div>`
  );
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
    doc
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
    doc
  );
  for (const tag of ["img", "svg", "video", "audio", "canvas", "picture", "source", "map", "area"]) {
    assert.equal(out.includes("<" + tag), false, tag + " 应整个移除");
  }
  assert.ok(out.includes("keep"));
  assert.ok(out.includes("see"));
});
