# 04: Extract text utils + batching + host discovery + tests

**Status:** ready-for-agent

**Blocked by:** 01

**What to build:** Behavior-preserving refactor: Chinese-ratio detection, tag-stripping text preview, and the URL/letter translatable-text test move into a text-utils lib module; batch construction moves into its own lib module preserving max-item limit, cumulative char limit, and the unbreakable-host rule from the streaming-batch decision. Host discovery also becomes testable: the code-stripped text extraction, host qualification, DFS discovery, and snapshot serialization move behind a seam that jsdom tests can drive (element trees built in fixtures, inline styles for display values, getBoundingClientRect stubbed). Content script consumes all of it. Can run in parallel with 03 — touches disjoint modules.

- [ ] `npm test` green: Chinese-ratio boundaries (0.3 threshold), URL stripping, letter-presence gating, batch item limit, cumulative char limit, unbreakable host not split, empty input
- [ ] jsdom tests green: code-stripped extraction (pre/code subtrees pruned, mixed containers keep prose)
- [ ] jsdom tests green: host qualification — an all-code host (`<pre><code>…</code></pre>`) is skipped; a normal host (`<p>Use <code>x</code></p>`) is kept with its HTML passed through tags-intact to the entry payload
- [ ] jsdom tests green: DFS discovery — safe-block whitelist hit, flex/grid descent to deepest item, hard-skip pruning, all-code wrapper pruned
- [ ] jsdom tests green: snapshot serialization excludes own inserted nodes; sanitization removes script/iframe and on* attributes
- [ ] Browser spot check: page translation batches and skip behavior unchanged
- [ ] Lib modules dual-environment; production code unchanged by the test fixture (stub lives in tests only)
