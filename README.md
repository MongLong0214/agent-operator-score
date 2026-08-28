# Agent Operator Score (AOS)

**Review the coding-agent sessions you already ran.**

`aos review` reads a Codex or Claude Code transcript that is already on your disk and tells you what
went wrong in it: a success reported after an edit nothing re-checked, a session that ended on
evidence older than its last change, writes that left the directory you were working in,
irreversible commands, key material in the transcript, long stretches with no input from you.

No score, no model quota, seconds to run, on work you actually did. The controlled suite
below is the half that does produce a number, and it says what that number is bound to.

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
| `long-uninterrupted-tool-run` | a long stretch with no input from you; a finding only when something inside it failed or repeated |

Each finding names the step that produced it, so you can check it against your own memory of the
session rather than trusting the tool.

`--since` is the more useful view. One session tells you what happened; twelve tell you what you
keep doing.

## The controlled suite

```bash
node bin/aos.mjs assess --template aos-plan.json          # write a plan
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

Six task families — intent, context, orchestration, loop and state, false completion, recovery —
run against your registered agent CLIs in isolated workspaces, and a hidden verifier grades what
the agents actually produced. The terminal prints how many of the twenty metrics were observed.

**A run nobody watched does not get a score, and that is deliberate.** One of the six dimensions
asks what you did while the run was happening, and there is no way to answer it from a transcript.
With `--checkpoints`, a failed stage stops and shows you what it saw:

```text
AOS checkpoint (1 of 3) — repeated-failure
  1. retry unchanged   2. modify instruction <text>   3. reroute <agent>
  4. inspect evidence  5. stop blocked
```

The choice is never the score. What is graded is the state your answer produced and whether the
work that followed was the same thing again — picking the cautious-looking option and then
retrying unchanged is the exact thing a checkpoint exists to catch. Without the flag the run
finishes unattended, reports `INCOMPLETE`, and says what it would have scored.

Nothing checks whether you are at a terminal. You say you are here by passing the flag.

### Three runs, one number

```bash
node bin/aos.mjs cycle start                         # three seeds, fixed now
node bin/aos.mjs cycle run --plan aos-plan.json --checkpoints
node bin/aos.mjs cycle                               # the operator score
node bin/aos.mjs dashboard                           # read-only, loopback, tokened
```

The seeds are drawn once and never again — otherwise "run twenty and keep the best three" is one
loop away. The Operator Score is the median of every valid run, including the low ones; the only
runs excluded are the ones that measured nothing, and each is printed with its reason. Repetition
across three runs on one machine is reported as *local repeat evidence*, never as confidence.

That number is **profile-bound**: it measures performance in the environment and task pack it was
produced in, and its status is `EXPERIMENTAL / PROVISIONAL`. It is withheld entirely when the run
is unsafe or when too few metrics were observed. Comparing two numbers produced under different
agents, models or machines is comparing two different measurements.

The plan you write is not a scoring input. It once set seventeen of the twenty metrics from static
shape checks on JSON you wrote about yourself — a plan of literal junk scored 17/17 — and that is
why a metric is now observed from the run or it is `NOT_OBSERVED`.

The answers to these families are in `lib/suite.mjs`. That is fine for practice and it is why this
is not an exam.

## What this is not

- Not a measurement of your ability. The score is conditional on a declared environment and task
  pack. No calibration study, no independent reproduction and no qualified review exists, and
  nothing here claims otherwise.
- Not a hiring, promotion or surveillance instrument.
- Not a percentile, rank or certification.
- Not a model or harness benchmark.

## How accurate is `aos review`?

Measured once, on sessions held back from the work that wrote the rules: **4 of 10 high-severity
findings were right.** Every one of the six errors was a recognizer with an incomplete vocabulary,
and none of them failed loudly — each invented a finding.

All six are fixed. That is not a second measurement, and `docs/LIMITATIONS.md` says so: a fix
measured on the sessions that revealed it is a tuning number. `aos holdout` keeps the ledger — a
digest of each session, the identity of each finding, your verdict and your reason, and never a
transcript.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # the three acceptance gates
```

## Local and private

Everything stays on your machine. Nothing is uploaded, telemetry is off and there is nothing to
turn on. Secret values are never stored, and where key material is detected the finding says so
without repeating it.

## Development

```bash
npm ci
npm test                 # the suite
npm run test:mutation    # break each named guard, check the named test dies
npm run smoke:package    # pack, install elsewhere, use it as an operator would
npm run verify:mvp       # the contract, the caps and the bands still mean what they say
```

MIT. Contributions under the [DCO](CONTRIBUTING.md); `git commit -s`.
