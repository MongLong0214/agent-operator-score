# Agent Operator Score (AOS)

**Review the coding-agent sessions you already ran.**

`aos review` reads a Codex or Claude Code transcript that is already on your disk and tells you what
went wrong in it: a success reported after an edit nothing re-checked, a session that ended on
evidence older than its last change, writes that left the directory you were working in,
irreversible commands, key material in the transcript, long stretches with no input from you.

No score. No model quota. Seconds to run, on work you actually did.

## Use it

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review              # the session you just finished
node bin/aos.mjs review --since 12   # what recurs across the last twelve
node bin/aos.mjs review --list       # pick one
```

Requires Node `>=22.18 <25`, macOS or Linux. Nothing is installed, nothing is uploaded, and no
model is called.

## What it looks for

| | |
|---|---|
| `completion-claimed-without-verification` | success reported after an edit that nothing re-ran |
| `session-ended-on-stale-evidence` | the last verification predates the last edit |
| `edits-outside-the-working-directory` | writes that left the tree you were working in |
| `destructive-command-executed` | irreversible commands; routine synchronisation is not one |
| `secret-material-in-session` | key material in the transcript, reported without repeating it |
| `long-unattended-stretch` | consecutive tool calls with no input from you |

Each finding names the step that produced it, so you can check it against your own memory of the
session rather than trusting the tool.

`--since` is the more useful view. One session tells you what happened; twelve tell you what you
keep doing.

## The practice suite

```bash
node bin/aos.mjs assess --template aos-plan.json   # write a plan
node bin/aos.mjs assess --plan aos-plan.json       # run six controlled families
```

Six task families — intent, context, orchestration, loop and state, false completion, recovery —
run against your registered agent CLIs in isolated workspaces. It reports which of the twenty
metrics were observed and which fell short. It does **not** report a 0-100.

The number was removed because it did not mean what it looked like it meant: seventeen of the
twenty metrics were set by static shape checks on the plan file you wrote about yourself, so a plan
whose every string was literal junk scored 17/17. A metric is now observed from the run or it is
`NOT_OBSERVED`.

The answers to these families are in `lib/suite.mjs`. That is fine for practice and it is why this
is not an exam.

## What this is not

- Not a measurement of your ability. No calibration study, no independent reproduction and no
  qualified review exists, and nothing here claims otherwise.
- Not a hiring, promotion or surveillance instrument.
- Not a percentile, rank or certification.
- Not a model or harness benchmark.

## Local and private

Everything stays on your machine. Nothing is uploaded, telemetry is off and there is nothing to
turn on. Secret values are never stored, and where key material is detected the finding says so
without repeating it.

## Development

```bash
npm ci
npm test
```

MIT. Contributions under the [DCO](CONTRIBUTING.md); `git commit -s`.
