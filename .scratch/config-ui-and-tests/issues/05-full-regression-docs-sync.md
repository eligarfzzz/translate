# 05: Full regression + docs sync

**Status:** ready-for-agent

**Blocked by:** 02, 03, 04

**What to build:** One command proves the whole feature: `npm test` runs every suite green. Docs tell the truth again — README (features, structure, config table incl. prompt template), CONTEXT.md terminology touch-ups, and a completion note on the ADR-0003 seam (config UI now fulfills it). Browser smoke checklist passes end to end.

- [ ] Single `npm test` run passes all suites
- [ ] Smoke: change endpoint → translation uses it; restore defaults → back to built-in behavior; prompt edit → style shift visible
- [ ] README/CONTEXT updated; no stale references to hardcoded-only config
- [ ] ADR-0003 annotated as fulfilled (UI seam consumed via the async loader)
