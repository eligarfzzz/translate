# 02: Editable prompt template

**Status:** ready-for-agent

**Blocked by:** 01

**What to build:** The options page gains a multiline prompt-template editor (default template ships with the {entries} placeholder). Saving applies the custom template to subsequent translation requests; restore-defaults rolls the template back too. Prompt rendering becomes a pure lib function the background uses instead of its inline string, covered by tests.

- [ ] Editing the template (e.g. appending a style instruction) visibly changes translation output
- [ ] A stored template containing {entries} is accepted; one without is rejected back to default on load
- [ ] renderPrompt injects numbered entries at the placeholder exactly once, with correct [i] ordering
- [ ] Restore-defaults reverts the template to the built-in version
- [ ] `npm test` green: prompt rendering + template-acceptance merge tests
