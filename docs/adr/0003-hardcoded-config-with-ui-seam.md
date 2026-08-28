# Hardcoded config with a config-UI seam

All API settings (endpoint, key, model, target language) are hardcoded in `config.js`, with a clearly marked seam for a future config UI (a `getConfig()` accessor every consumer calls, never raw constants). This keeps v1 shippable without a UI while making the future migration mechanical. The API key is visible to anyone who installs the extension — accepted for v1, but the key must never be a production credential.

---

**Fulfilled.** The config UI shipped (options page, opened by left-clicking the toolbar icon): consumers now call the async `loadConfig()`, which type-defensively merges `chrome.storage.sync` overrides over the in-code defaults via the pure `mergeConfig()`. The seam held as designed — the migration was mechanical and no consumer ever touched raw constants.

---

**Evolved: zero-trace defaults.** The in-code defaults for endpoint, key, and model were cleared to empty placeholders — the repo now carries no real endpoint, key, or model name in code, tests, or docs, so a fresh clone yields no usable credentials. Real configuration is entered on the options page and lives only in `chrome.storage.sync`; it never produces a repo file. An unconfigured translate click rejects each batch up front through the existing batch-error channel with a "open the config page" pointer instead of a vague network error. Scrubbing the values from git history remains the owner's separate task.
