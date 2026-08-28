# 01: Config foundation + options page skeleton

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

**What to build:** A user can left-click the extension icon to open a plain-styled options page showing every scalar setting (API endpoint, key, model, target language, batch size, max chars per batch, max concurrency — thinking is NOT configurable, always off). Editing and saving persists to sync storage; the very next translation run uses the new values. Invalid stored values fall back to in-code defaults on load, and a restore-defaults button clears overrides. Under the hood this introduces the async config loader and its pure, type-defensive merge function (fulfilling the seam reserved by ADR-0003), plus the test runner skeleton with jsdom as the single devDependency.

- [ ] Left-clicking the toolbar icon opens the options page (no popup)
- [ ] Changing the endpoint and saving makes the next translation use the new endpoint
- [ ] Deleting/corrupting stored config falls back to defaults on next load; numbers reject zero/negative/non-numeric, strings reject empty
- [ ] Restore-defaults clears the stored override and refills the form
- [ ] Settings survive extension reload (sync storage, single namespaced key)
- [ ] `npm test` runs merge-function tests green (type defense, defaults passthrough) via node's built-in runner
- [ ] jsdom installed as the single devDependency; `.gitignore` covers `node_modules/`
- [ ] Pure-logic loading pattern established: dual-environment modules (extension globals + node module exports) matching the existing config.js convention
