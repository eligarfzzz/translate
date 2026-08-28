# Translations are inserted, not replacing the original

The extension inserts a **translation node** beneath each translated text node; the original text is never replaced or modified. This lets the reader compare original and translation side by side, and makes revert trivial (remove the inserted nodes). The trade-off is visual: inserting block-level nodes after inline elements (buttons, links) can disturb layout slightly, accepted for v1.

---

**v3 revision (HTML-entry protocol):** the entry payload is now the host's **serialized innerHTML**, sent to the LLM with tags intact; the model keeps `<pre>/<code>/<a>` markup and decides what to translate. Entries are delimited by `[i]` line-start markers (multi-line entries allowed), finalized as sanitized innerHTML on entry boundaries. A host consisting wholly of pre/code is pruned by the stripped-of-code emptiness test.

---

**v2 revision:** the insertion unit was upgraded from per-text-node `<div>` to **per-block-host aggregation**. `findTranslationHost` walks up from a text node to the nearest safe block ancestor (whitelisted displays: block / flow-root / list-item / table-cell / table-caption / inline-block); if it meets a flex/grid container first, the host falls back to that container's deepest direct item, so translations are appended *inside* an existing flex item and never add one. All fragments sharing a host translate as one unit and render into a single dashed-underline container at the end of that host — inline flows (links, buttons, spans) are never split.
