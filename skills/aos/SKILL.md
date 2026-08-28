---
name: aos
description: Use when the operator asks what went wrong in a coding session, what they keep doing wrong across sessions, or how well they run their agents. Reads Codex and Claude Code transcripts already on disk (free, no model call), or runs a scored assessment against their agent CLIs (spends quota).
---

# Agent Operator Score

Two operators run the same model, on the same repository, with the same task. One ships. One burns
the budget and merges something that does not work. Benchmarks measure the half that was identical.
This measures the other half — and states the conditions every number is bound to.

There are no runtime dependencies, so `node bin/aos.mjs` works from a bare clone. Nothing is
uploaded, telemetry is off, and there is no switch to turn it on.

## Which half to run

| the operator asked | run |
|---|---|
| "what went wrong in that session?" | `review` |
| "what do I keep doing wrong?" | `review --since 12` |
| "how good am I at running this agent?" | `assess` |

`review` costs nothing and calls no model. `assess` spends model quota — confirm before running it.

## review

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" review              # the session that just finished
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" review --since 12   # what recurs
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" review --list       # pick one
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" review --json       # machine-readable
```

Six rules: a completion claimed without verification, a session ended on stale evidence, edits
outside the working directory, a destructive command, secret material, and a long stretch with no
operator input.

Reading the output:

- Every finding names the step that produced it. Carry that step into your answer — the operator
  should be able to check the finding against their own memory rather than trust the tool.
- `long-uninterrupted-tool-run` is only a problem when something inside the stretch failed or
  repeated. The evidence line names the call it went wrong at and how many calls were wasted after
  it. A stretch with nothing wrong inside it is `info`; do not report it as a defect.
- Never repeat secret material. The rule reports the kind on purpose.
- The tool has been measured once, on 320 held-out sessions: 4 of 10 high-severity findings were
  right. Say so if the operator is about to act on one without checking it.

## assess

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" init      # registers runtimes found on PATH
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" doctor    # can they authenticate?
node "${CLAUDE_PLUGIN_ROOT}/bin/aos.mjs" assess
```

Nothing needs configuring. Agents register themselves from PATH, a runtime's own credential is
resolved the way that runtime would have resolved it, and a plan is written if the operator has not
written one.

**Do not run `--checkpoints` on the operator's behalf, and never drive it with `expect`.** One of
the six dimensions measures what the operator did while the run was happening. Answering for them
makes the score describe you; faking presence with a pty is the exact defect the checkpoint exists
to catch. Hand them the command instead.

## Reporting a score honestly

These are the product's own rules, and it will contradict you if you break them:

- **Withheld is not failed.** Name the condition that withheld it.
- **A ceiling is not a deduction.** Doing everything else well cannot lift the score past it.
- **`NOT_OBSERVED` is not a zero.** It means the run could not see that metric.
- **The number is profile-bound.** It describes the declared environment and task pack, not an
  ability independent of them. Two numbers from different agents or machines are two different
  measurements — never compare them.
- Three runs on one machine are **local repeat evidence**, never *confidence*.

## What it refuses to be

Not a measure of ability, not a model benchmark, not a percentile or certification, and not a
hiring, promotion or surveillance instrument — that last one is written down in
`docs/INTENDED_USE.md` rather than left implied. Status is `EXPERIMENTAL / PROVISIONAL`: no
calibration study, no independent reproduction, no qualified review.
