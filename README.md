# Agent Operator Score

Agent Operator Score (AOS) is a local-first CLI that evaluates **how a human operates one or more AI coding agents** during a controlled assessment.

It does not score Codex, Claude Code, Gemini, Grok, Hermes, Buzz, or any other provider as a model leaderboard. Those are interchangeable agent profiles or collaboration surfaces inside the operator's declared environment. One agent can earn a high score; adding more agents does not earn points by itself.

> **Measurement status:** AOS-Coding P0 is `EXPERIMENTAL / PROVISIONAL`. It is not a certification, hiring signal, percentile, global rank, or industry standard.

## Supported environment

- macOS or native Linux
- x64 or arm64
- Node.js `>=22.18 <25`
- Windows and WSL are intentionally unsupported

AOS executes trusted local agent CLIs. It is not a hostile-code sandbox.

## Install

From npm after publication:

```bash
npm install --global agent-operator-score
```

Directly from this repository:

```bash
npm install --global github:MongLong0214/agent-operator-score#main
```

Verify the installation:

```bash
aos --version
aos verify --json
```

## Quick start

Initialize AOS in a disposable or dedicated assessment directory:

```bash
mkdir aos-assessment && cd aos-assessment
aos init
```

Register any local agent CLI. `{promptFile}` is replaced with a private temporary file containing the operator instruction; the file is removed after the process exits.

```bash
aos agent add codex \
  --command codex \
  --arg exec \
  --arg --full-auto \
  --arg --prompt-file \
  --arg '{promptFile}'

aos agent add claude \
  --command claude \
  --arg --print \
  --arg '{prompt}'
```

The command and arguments depend on the installed agent version. AOS never stores credentials in its config; secret-looking arguments are rejected.

Check availability:

```bash
aos doctor
aos agent doctor
```

Create an operator plan template:

```bash
aos assess --template aos-plan.json
```

Complete the plan. It records the operator's own:

- goal, constraints, and non-goals;
- fact-research versus human-decision clarification policy;
- acceptance criteria and evidence;
- context selection and rejected sources;
- task decomposition and dependency graph;
- agent routes, distinct per-agent roles, handoffs, and join;
- checkpoint, idempotency, and stop conditions;
- recovery, permissions, external actions, and invocation budget.

The unchanged template is intentionally invalid and cannot earn a score.

Run the controlled assessment:

```bash
aos assess --plan aos-plan.json
```

Use one agent for all six families, different agents by family, or a bounded multi-agent route:

```json
{
  "FAM-1": { "route": "hermes" },
  "FAM-2": { "route": "gemini" },
  "FAM-3": { "route": "codex|claude>hermes" },
  "FAM-4": { "route": "claude" },
  "FAM-5": { "route": "grok" },
  "FAM-6": { "route": "codex" }
}
```

`codex|claude>hermes` means Codex and Claude execute in isolated workspace copies, then Hermes performs the explicit join. Every multi-agent route requires a distinct role instruction for each participant. Handoffs are bound to actual artifact digests; an empty handoff cannot receive M11 credit.

## Output

A controlled run writes under `.aos/runs/<run-id>/`:

- `manifest.json`
- per-producer canonical NDJSON events
- isolated controlled workspaces
- `result.json`
- `report.md`
- static `report.html`
- exactly-once `terminal.json`

Read a result:

```bash
aos session list
aos session status <run-id>
aos session graph <run-id>
aos report --run <run-id> --format markdown
```

Recover an interrupted run:

```bash
aos session recover <run-id>
```

A result written before its terminal is digest-checked and committed exactly once. A run with no result becomes `ABORTED`. Existing terminal states are never relabelled.

## Collaboration surfaces and imported evidence

Buzz and similar systems are collaboration surfaces, not model scores:

```bash
aos surface add buzz --kind buzz --transport ndjson
aos surface list
```

Import or bridge canonical events:

```bash
aos import --producer buzz --file events.ndjson
aos bridge --producer buzz --file events.ndjson
# or: cat events.ndjson | aos bridge --producer buzz
```

Imported and bridged evidence is `DIAGNOSTIC_ONLY`; it does not silently become an official AOS-Coding P0 score.

## Scoring

AOS preserves M01-M20 across six factors:

1. Intent & Contract
2. Context & Information
3. Graph & Orchestration
4. Loop & State
5. Verification & Recovery
6. Safety & Value

The primary formula is:

```text
Outcome O = 0.50×M15 + 0.25×M16 + 0.25×M17
Process P = opportunity-weighted mean(M01..M14, M18, M20)
AOS-Coding P0 = 100 × 2OP / (O + P)
```

M19 is a hard safety gate. Missing evidence is `NOT_OBSERVED`, not zero.

The following are not direct score inputs:

- number of agents or providers;
- model price;
- prompt length;
- token volume;
- subagent count;
- graph size;
- generated code volume.

## Privacy and process safety

By default AOS stores bounded metadata and digests, not raw prompts, responses, tool arguments, environment values, secrets, or hidden reasoning.

Controlled agent processes run in their own Unix process groups. On timeout, interruption, or leaked descendants AOS performs `SIGTERM`, escalates to `SIGKILL`, verifies survivors, and refuses success when descendants were left behind.

Parallel work uses isolated directory copies. Symlink artifacts are refused before handoff or join.

## Development verification

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify
npm run pack:check
npm audit --omit=dev --audit-level=high
```

The permanent CI runs Linux Node 22.18 and Node 24, macOS Node 22.18, and a clean packaged-consumer install.

See [docs/PRODUCTION.md](docs/PRODUCTION.md), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
