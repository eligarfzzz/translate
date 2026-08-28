# All API calls go through the background service worker

In Manifest V3, content scripts no longer get the CORS exemption granted by `host_permissions`; only extension-privileged contexts (the background service worker) do. The page-level content script therefore cannot fetch third-party API endpoints directly — every cross-origin request fails CORS preflight. All HTTP/streaming traffic (`/chat/completions`, SSE parsing) lives in `background.js`; `content.js` communicates via a `runtime.connect` port per translation batch, receiving `delta`/`done`/`error` messages. Disconnecting the port aborts the underlying fetch (AbortController), which is also how Revert cancels in-flight work.

---

**Evolved: the worker loads its dependencies with static `import`, not `importScripts()`.** The decision above is unchanged — every API call still goes through the background service worker, still over one port per request — but the loading mechanism described here is gone. The worker is now declared `"type": "module"` in the manifest and pulls in its dependencies (`debug.js`, `prompt.js`, `config.js`) as ES modules, so the load-order convention that `importScripts()` required is no longer expressible or needed. See [ADR-0006](./0006-native-esm-modules.md).
