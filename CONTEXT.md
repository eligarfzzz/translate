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

## Rules

- **译文节点 is the only mutation.** Translation never modifies, replaces, or removes original page content; it only inserts translation nodes at host boundaries.
- **One node per host.** A host has exactly one translation node, holding its entire translation; no temporary streaming residue may remain in the DOM.
- **Revert removes only translation nodes.** The original DOM must be exactly as it was before translation.
- **Requests are independent.** A failed request shows an italic error message in that host's translation node; every other host still completes.
