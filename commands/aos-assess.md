---
description: Score how well the operator runs their agents, under conditions the score states
---

Run a scored Agent Operator Score assessment. Unlike `/aos-review`, this **spends model quota**:
it runs six controlled task families against the operator's registered agent CLIs in isolated
workspaces, and a hidden verifier grades what those agents actually produced.

Before doing anything else, tell the operator that this costs quota and ask them to confirm.

Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" init      # registers the runtimes it finds on PATH
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" doctor    # says whether they can authenticate
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" assess $ARGUMENTS
```

Nothing needs configuring: agents register themselves, credentials resolve themselves, and a plan
is written for the operator if they have not written one.

**`--checkpoints` cannot be run for the operator.** One of the six dimensions measures what the
operator did while the run was happening, so the run stops and asks them. Answering it on their
behalf would make the score describe you, not them — and driving it with `expect` is the exact
defect the checkpoint exists to catch. Tell them to run it themselves in their own terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" assess --checkpoints
```

Without that flag the run finishes unattended, reports `INCOMPLETE`, and prints what it would have
scored. That is a real result; report it as one.

When you report:

- A withheld score is not a failure. Say which condition withheld it.
- A ceiling is not a deduction. If one applied, say what it was and that doing everything else well
  cannot lift the score past it.
- `NOT_OBSERVED` is not a zero. Never present it as one.
- The score is bound to the declared environment and task pack. Say so wherever you give the number.
