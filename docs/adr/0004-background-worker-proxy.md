# All API calls go through the background service worker

In Manifest V3, content scripts no longer get the CORS exemption granted by `host_permissions`; only extension-privileged contexts (the background service worker) do. The page-level content script therefore cannot fetch third-party API endpoints directly — every cross-origin request fails CORS preflight. All HTTP/streaming traffic (`/chat/completions`, SSE parsing) lives in `background.js`; `content.js` communicates via a `runtime.connect` port per translation batch, receiving `delta`/`done`/`error` messages. Disconnecting the port aborts the underlying fetch (AbortController), which is also how Revert cancels in-flight work.

---

**Evolved: the worker loads its dependencies with static `import`, not `importScripts()`.** The decision above is unchanged — every API call still goes through the background service worker, still over one port per request — but the loading mechanism described here is gone. The worker is now declared `"type": "module"` in the manifest and pulls in its dependencies (`debug.js`, `prompt.js`, `config.js`) as ES modules, so the load-order convention that `importScripts()` required is no longer expressible or needed. See [ADR-0006](./0006-native-esm-modules.md).

---

**Evolved: the port protocol grew `restart` and an optional `cached` flag on `done`.** The message inventory above (`delta`/`done`/`error`) predates two backward-compatible additions. Session reuse ([ADR-0007](./0007-session-reuse.md)) added `restart`: a background-internal retry voids the current attempt, and content drops the echo accumulated so far before the retried attempt restarts the stream. The short-text cache ([ADR-0008](./0008-short-text-cache.md)) added `done{cached: true}`: a hit is answered inside the worker by replaying the stored raw echo as one `delta` followed by a flagged `done`, so content's preview/finalize/settle path observes an ordinary fast reply and the flag's only consumer is the session-reuse chain, which never admits cached segments. No new message types; the decision itself — every API call through the background service worker, one port per host — is unchanged.
