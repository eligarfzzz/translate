# Translate

A Chrome extension that translates whole web pages into Chinese via an OpenAI-compatible API, showing translations as inserted blocks beneath the original text.

## Language

**译文节点 (Translation Node)**:
A DOM container appended to the end of a block-level host that displays that host's Chinese translation. Marked with a dashed underline; exactly one per host while its translation is active. The original text is never replaced or modified.
_Avoid_: translated text, replacement text

**宿主 (Host)**:
The deepest safe block-level ancestor (paragraph, list item, table cell) whose skeleton HTML — tag names and text, attributes stripped — is fed to the LLM as that host's own request. Inline chains and flex/grid items defer as before; a host candidate that is itself pre/code is skipped outright, as is a host whose content is entirely pre/code (stripped-of-code emptiness test).
_Avoid_: parent, container, wrapper

**并发池 (Concurrency Pool)**:
The worker pool bounding how many per-host requests may be in flight at once (`concurrency`, default 20, adjustable in the options page). Every host travels alone — one request, no merging, no `[N]` markers; the whole reply is that host's translation, streamed through as a tag-stripped preview and finalized sanitized on done. A failure marks that host alone.
_Avoid_: batch, chunk, group, request unit, 翻译批次

**还原 (Revert)**:
Ending the translation session: removing all translation nodes and restoring the page to its untranslated state. Reverting is stateless — a page refresh restores the original state. Reverting also cancels all in-flight requests; nothing written after a revert may appear on the page.
_Avoid_: undo, restore, rollback

**会话 (Session)**:
The period between clicking Translate and clicking Revert on one tab. Translation work — including auto-translating dynamically added content — happens only inside an active session; outside one, nothing is fetched or written.
_Avoid_: task, job, run

**加载动画 (Loading Spinner)**:
A monospace ⠋⠼ animation rendered inside a host's translation node while its translation is streaming, stopped the moment real content arrives.
_Avoid_: loader, spinner, progress

**媒体占位 (Media Placeholder)**:
The same-name empty element a media tag (img/svg/picture/source/video/audio/canvas/map) becomes in a host snapshot before feeding the LLM: all attributes (alt/title included) and the entire subtree are stripped, so base64 and path data never enter the prompt, while the surrounding word order is preserved. Placeholder-ization lives only in feed serialization on a cloned subtree; host qualification and echo sanitization are unchanged.
_Why_: the placeholder keeps the media's position in the sentence so the model preserves the surrounding word order in the translation; the empty shell costs almost nothing and never renders.
_Avoid_: media stripping, tag removal

**媒体移除 (Media Removal)**:
The output-side counterpart of the media placeholder: the echo sanitizer (sanitizeHtml) removes the same media tags (img/svg/picture/source/video/audio/canvas/map) entirely — element and subtree — from the model's echoed translation before it is written into the translation node, so no media element the model invents or echoes can appear in translated output. Removal lives only in the echo sanitizer; feed serialization and host qualification are unchanged.
_Why_: on the way in, the placeholder preserves word order (the model still sees where the media sat); on the way out, there is no sentence-order concern anymore — the media is gone from the translation, so the removal keeps the rendered output clean: no interactive elements, no external resource loads, no layout pollution from a model-invented img/svg/video.
_Avoid_: media stripping in feed, placeholder in output

**边缘区域 (Peripheral Region)**:
A page region that is not the main content: `header` / `footer` / `nav` / `aside`, plus their ARIA equivalents (`[role=banner]` / `[role=contentinfo]` / `[role=navigation]` / `[role=complementary]`). A host inside one still gets translated in full; the marking only pushes it to the back of the queue. Its counterpart is the 正文区域 (`main` / `article` / `[role=main]`).
_Avoid_: 次要区域, chrome, boilerplate, 不翻区域

**翻译优先级 (Translation Priority)**:
The order in which discovered hosts enter the 并发池: 正文区域 hosts first, unmarked hosts next, 边缘区域 hosts last. A host's tier is decided by the **nearest** marked ancestor, starting from the host itself — so `main > nav` is peripheral and `aside > article` is main content. Within one tier, document order is preserved. Priority is a property of when a host is _requested_, never of where its 译文节点 lands.
_Avoid_: 排序, 权重, 打分, 区域过滤

**进度徽标 (Progress Badge)**:
A viewport-fixed overlay at the bottom-right corner showing live session progress: `<pct>% <done>/<total>(<totalAll>)(<errors>)`. The fraction counts only hosts outside 边缘区域 (tiers 0/1), so the percentage tracks main-content progress and can never exceed 100%; `<totalAll>` counts every discovered host including 边缘区域; the `<errors>` bracket is shown only while at least one host request (any tier) has failed. The percentage floors. The badge appears on Translate, stays at 100% as the completion signal, and 还原 removes it. As an injected element it never becomes a 宿主 and never triggers a rescan.
_Avoid_: progress bar, status bar, spinner（那是 加载动画）

## Rules

- **译文节点 and 进度徽标 are the only mutations.** Translation never modifies, replaces, or removes original page content; it only inserts translation nodes at host boundaries, plus the single 进度徽标 overlay. Injected elements never become 宿主 and never trigger rescans.
- **One node per host.** A host has exactly one translation node, holding its entire translation; no temporary streaming residue may remain in the DOM.
- **Revert removes every injected element.** All 译文节点 and the 进度徽标 are removed; the original DOM must be exactly as it was before translation.
- **翻译优先级 only reorders requests.** Sorting by priority changes the order hosts are sent to the endpoint, never the position of any 译文节点 and never the page layout. Every discovered host is still translated; no tier is skipped.
- **Requests are independent.** A failed request shows an italic error message in that host's translation node; every other host still completes.
- **空即未设置 (Empty Means Unset).** An empty config field is unset, not a value: 保存 rewrites the whole `config` blob, so an empty field's key is deleted (an all-empty form deletes the `config` key itself); reading starts from the full defaults and overlays only the non-empty stored values; the options page shows an empty box whose placeholder is the field's default — for a field with a non-empty default the placeholder is that default itself (in string form), while an empty-string default may carry a descriptive fake example instead (the three zero-trace API fields do); examples are optional field knowledge, not a required companion of an empty default. 「恢复默认」 = 清空 + 保存 = 删键 — clicking it only clears the group's inputs, and the following 保存 deletes those keys, so the group keeps following the version default instead of freezing on the default of the day. Emptiness is decided per default-value type (string / positive integer / template containing `{host}`) by the config module's single normalization entry point (`sanitizeStored`); no other component may decide it.
