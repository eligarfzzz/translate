# 03: Extract entry assembler + protocol tests

**Status:** ready-for-agent

**Blocked by:** 01

**What to build:** A behavior-preserving refactor: the [i]-marker entry state machine moves out of the content script into a pure lib module exposing feed/finish with finalize/preview callbacks; the content script becomes a consumer that owns DOM writes and sanitization. Translation, streaming, and revert behave exactly as before, and the six protocol scenarios from the March debugging session are now automated regression tests.

- [ ] `npm test` green: standard three-entry split, cross-chunk assembly, missing leading marker, overflow entry dropped, char-by-char streaming, multi-line entry bodies
- [ ] Browser spot check: translate → streaming preview → revert behaves identically to pre-refactor
- [ ] Lib module works in both environments (extension globals, node require)
- [ ] No DOM or sanitize code inside the assembler module
