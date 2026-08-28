---
description: Read the coding session that just finished and report what went wrong in it
---

Run the Agent Operator Score reviewer over the operator's own sessions. It costs nothing and calls
no model: it reads Codex and Claude Code transcripts that are already on this machine.

Run exactly this, from anywhere:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" review $ARGUMENTS
```

`$ARGUMENTS` may be empty (the session that just finished), `--since 12` (what recurs across the
last twelve), or `--list` (pick one). If the operator asked about a pattern rather than one session,
prefer `--since`.

There is nothing to install and nothing to configure. This repository has no runtime dependencies,
so `node bin/aos.mjs` works from a bare clone.

When you report the result:

- Lead with what recurs, not with the count. One session says what happened; twelve say what the
  operator keeps doing.
- Every finding names the step it came from. Quote that step, so the operator can check the finding
  against their own memory of the session instead of taking the tool's word.
- `long-uninterrupted-tool-run` on its own is an observation, not a problem. It is only worth
  raising when the finding says something inside the stretch failed or repeated — the evidence line
  names the call it went wrong at.
- Do not soften a `secret-material-in-session` finding, and do not repeat the secret. The tool
  reports the kind on purpose; keep it that way.
