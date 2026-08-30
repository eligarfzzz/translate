# Hardcoded config with a config-UI seam

All API settings (endpoint, key, model, target language) are hardcoded in `config.js`, with a clearly marked seam for a future config UI (a `getConfig()` accessor every consumer calls, never raw constants). This keeps v1 shippable without a UI while making the future migration mechanical. The API key is visible to anyone who installs the extension — accepted for v1, but the key must never be a production credential.

---

**Fulfilled.** The config UI shipped (options page, opened by left-clicking the toolbar icon): consumers now call the async `loadConfig()`, which type-defensively merges `chrome.storage.sync` overrides over the in-code defaults via the pure `mergeConfig()`. The seam held as designed — the migration was mechanical and no consumer ever touched raw constants.

---

**Evolved: zero-trace defaults.** The in-code defaults for endpoint, key, and model were cleared to empty placeholders — the repo now carries no real endpoint, key, or model name in code, tests, or docs, so a fresh clone yields no usable credentials. Real configuration is entered on the options page and lives only in `chrome.storage.sync`; it never produces a repo file. An unconfigured translate click rejects each batch up front through the existing batch-error channel with a "open the config page" pointer instead of a vague network error. Scrubbing the values from git history remains the owner's separate task.

---

**Evolved: `promptTemplate` is a plain default key — frozen-template users exist.** When the prompt template became an ordinary entry in the defaults table (ESM refactor, ticket 06), anyone who had *saved* the then-current default template in `chrome.storage.sync` before that change keeps overriding every future default with their stored copy — they are frozen on the old default. Anyone who never saved a template gets each new default automatically. Consequence for the future: changing the default template does not reach frozen users; to reach them they must clear the field on the options page (or remove the stored `config`). Affects only the template key; other keys whose defaults changed have the same property, but the template is the one likely to evolve.

---

**Evolved: the options page is TAB-grouped, and "恢复默认" became a per-group form fill.** The page now has three TABs (API / 提示词 / 通用), each with its own "恢复默认" button. That button fills only its own TAB's inputs with the in-code defaults and writes nothing; 保存 still writes every field of every TAB as one `config` blob, so the storage key remains a single whole-blob write from one place. The per-group scope is what forced the change: a group-scoped button that deleted the shared `config` key would reset the other TABs too.

Two consequences for the note above. The escape hatch "(or remove the stored `config`)" no longer has any UI affordance — no button deletes the key, so that route is now DevTools-only. Worse, the intuitive gesture 提示词 → 恢复默认 → 保存 *freezes* the user onto today's default template, the exact state the note warns about, because it writes the default's literal text into storage. The un-freeze route is unchanged and remains the only one: clear the textarea, then 保存 (an empty string falls back to the default at runtime while `mergeConfigRaw` keeps showing it empty).
