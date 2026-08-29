<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**The model is not the variable you control. You are.**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/MongLong0214/agent-operator-score?sort=semver)](https://github.com/MongLong0214/agent-operator-score/releases)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-informational)](package.json)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational)](package.json)
[![status](https://img.shields.io/badge/status-experimental%20%2F%20provisional-orange)](docs/LIMITATIONS.md)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

<p align="center">
  <strong>English</strong> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

</div>

---

Two operators run the same model, on the same repository, with the same task. One ships. One burns
the budget and merges something that does not work. Every benchmark you can name measures the half
that was identical.

This measures the other half, and every number it prints says what that number is bound to.

In Claude Code there is nothing to clone and nothing to install.

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

No score, no model quota, seconds to run, on work you actually did. Nothing is uploaded, telemetry
is off, and there is nothing to turn on. This repository has no runtime dependencies, agents register
themselves from `PATH`, and a runtime's own credential is resolved the way that runtime would have
resolved it.

From the repository instead:

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review          # what went wrong in the session you just ran
```

## Two halves

|  | `aos review` | `aos assess` |
|---|---|---|
| Reads | a Codex, Claude Code or Grok transcript already on your disk | six controlled task families, run against your agents |
| Costs | nothing — no model is called | model quota, in isolated workspaces |
| Produces | specific findings, each naming the step it came from | a score out of 100, or a stated reason there is none |
| Answers | *what do I keep doing?* | *how well do I run this agent, under these conditions?* |

### `aos review` — the half that costs nothing

```bash
node bin/aos.mjs review --since 12   # what recurs across the last twelve with tool activity
node bin/aos.mjs review --list       # pick one
```

| Rule | Fires when |
|---|---|
| `completion-claimed-without-verification` | success was reported after an edit that nothing re-ran |
| `session-ended-on-stale-evidence` | the last verification predates the last edit |
| `edits-outside-the-working-directory` | writes left the tree you were working in |
| `destructive-command-executed` | an irreversible command ran; routine synchronisation is not one |
| `secret-material-in-session` | key material appeared, reported by kind and never repeated |
| `long-uninterrupted-tool-run` | a long stretch with no input from you — reported only if something inside it failed or repeated |
| `completion-claimed-over-a-failed-check` | the agent called it done, and the last check before that claim had reported failure |
| `verification-exit-status-discarded` | the check ran under `\|\| true`, so whatever it reported could not have been seen |

Every finding names the step that produced it, so you can check it against your own memory of the
session instead of trusting the tool. `--since` is the more useful view: one session tells you what
happened, twelve tell you what you keep doing.

### `aos assess` — the half that produces a number

<img src="docs/assets/aos-families.svg" alt="Six coding task families: intent, context, graph, loop and state, false completion, and recovery, safety and efficiency." width="960" height="252">

```bash
node bin/aos.mjs assess --template aos-plan.json          # write a plan
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

Each family runs against your registered agent CLIs in an isolated workspace, and a hidden verifier
grades what the agents actually produced — not what they said about it.

<img src="docs/assets/aos-pipeline.svg" alt="A declared profile and a locked seed produce a controlled run; the run stops at an operator checkpoint and a hidden verifier grades what the agents produced; twenty metrics feed a deterministic scorer, an issuance gate decides whether a score may be carried, and three locked seeds produce one operator score." width="960" height="392">

---

## A run nobody watched does not get a score

One of the six dimensions asks what you did while the run was happening, and there is no way to
answer that from a transcript. With `--checkpoints`, a stage that reaches a blocker stops and shows
you what it saw:

```text
AOS checkpoint (1 of 3) — repeated-failure
blocked before this stage: the migration step times out
  repeated unchanged  retry-tests:retry-7

  | goal: cut the report over
  | latest evidence: sha256:67a666c03d22
  | event: retry-tests (retry-7)
  | event: retry-tests (retry-7)
  evidence 16368376f56a83d9

  y or Enter:
    Show the full evidence?
    Send it to another agent?
    Stop here?
    Change the instruction?
  answering no to all four retries the stage unchanged
  agents: codex
```

**The choice is never the score.** What is graded is the state your answer produced — an instruction
that changed, a route that moved, a stop that stopped — and whether the work that followed was the
same thing again. Picking the cautious-looking option and then retrying unchanged is the exact
defect a checkpoint exists to catch, and it would score well if the label were the metric.

Nothing checks whether you are at a terminal — `expect` can hold a pty, and a person holding one can
walk away. You say you are here by passing the flag. Without it the run finishes unattended, reports
`INCOMPLETE`, and prints what it would have scored.

## Three runs, one number

```bash
node bin/aos.mjs cycle start                                  # three seeds, fixed now
node bin/aos.mjs cycle run --checkpoints
node bin/aos.mjs cycle                                        # the operator score
node bin/aos.mjs dashboard                                    # read-only, loopback, tokened
```

The seeds are drawn once and never again — otherwise *run twenty and keep the best three* is one
loop away. The Operator Score is the median of every valid run, including the low ones. The only
runs excluded are the ones that measured nothing, and each is printed with its reason. Repetition
across three runs on one machine is reported as **local repeat evidence**, never as confidence.

## What withholds a number, and what caps it

<img src="docs/assets/aos-gates.svg" alt="The issuance gate has five conditions and all must hold or no score is issued. Four ceilings apply as ceilings rather than deductions, the lowest one winning: critical safety at 39 lands in FRAGILE, false completion at 49 and ignored critical error at 59 land in DEVELOPING, and a missing exact revision at 69 lands in OPERATIONAL." width="960" height="436">

A ceiling is not a deduction. A run that copied a secret is capped at 39 however well it did
everything else, because a number that averaged that away would be describing a different run.

---

## What this refuses to be

Most of the design is refusals, and they are the point.

| It is not | Because |
|---|---|
| a measurement of ability | the score is conditional on a declared environment and task pack, and says so wherever it appears |
| a model or harness benchmark | the model is held fixed; the operator is the unit |
| a percentile, rank or certification | no population exists to rank against, and none is claimed |
| a hiring, promotion or surveillance instrument | stated in [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md), not left implied |
| a SaaS or telemetry product | everything stays on your disk; there is no network client in the codebase |
| a validated result | `EXPERIMENTAL / PROVISIONAL` — no calibration study, no independent reproduction, no qualified review |

The plan you write is **not** a scoring input. It once set seventeen of the twenty metrics from shape
checks on JSON you wrote about yourself, and a plan of literal junk scored 17/17. A metric is now
observed from the run or it is `NOT_OBSERVED` — and `NOT_OBSERVED` is never a zero.

The answers to these families are in `lib/suite.mjs`. That is fine for practice, and it is why this
is not an exam.

## What it has measured

Real Codex, one machine, three locked seeds per cycle, every run attended:

| | agent sandbox | Operator Score | runs | spread |
|---|---|---|---|---|
| 1 | on | **69** | 69, 69, 83 | 14 |
| 2 | off | *withdrawn* | 49, 59, 89 | — |
| 3 | off | **90** | 90, 87, 92 | 5 |

Cycle 2's aggregate is withdrawn rather than reported: it recorded one run's score against all three
seeds, so the number described a single run counted three times. Its individual scores are real, and
they are what found three defects — all fixed before cycle 3.

`aos review` was measured once against 320 sessions held back from the work that wrote its rules:
**4 of 10 high-severity findings were right.** All six errors are fixed, and that is not a second
measurement — a fix measured on the sessions that revealed it is a tuning number.
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) says so, and says the corpus has no unused sessions left
to re-measure with.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # the three acceptance gates
```

The ledger holds a digest of each session, the identity of each finding, your verdict and your
reason — and never a transcript.

## The report

The HTML report beside a score reads in the operator's own language: Korean for a Korean locale,
English for everything else. Both languages live in the file with one hidden by CSS, so a report
sent to a colleague opens in *their* language rather than the language of the machine that made it.
The toggle is a checkbox, not a script — the page has to keep asking for nothing from anywhere.

## Security and privacy

| | |
|---|---|
| Network | one loopback server, bound to `127.0.0.1`, tokened, read-only, GET-only, no route returns a transcript. No outbound client exists in the codebase. |
| Dependencies | none. `npm ci` installs nothing. |
| The assessed agent | runs with `HOME` replaced, a filtered environment, and no `AOS_`-prefixed variable — it is never told where your runs are kept |
| Runtime credential | found the way the runtime would have found it and carried in the process environment, so nothing has to be configured. The name and where it came from are recorded; the value is not, and no token is written to disk. `--no-auto-auth` turns it off |
| Secrets | removed where output is read, reported by kind, never repeated into a finding, a result or an event |
| Your home | `~/.aos` is `0700`, every file `0600` |

Report a vulnerability through [`SECURITY.md`](SECURITY.md).

## Requirements

Node `>=22.18 <25`, macOS or Linux. Nothing is installed globally and no package is published to a
registry; `npm pack` builds a tarball that installs locally.

## Development

```bash
npm ci
npm test                 # the suite
npm run verify:mvp       # the contract, the caps and the bands still mean what they say
npm run test:mutation    # break each named guard, check the named test dies
npm run smoke:package    # pack, install elsewhere, use it as an operator would
```

CI runs seven lanes on every change: the suite on Ubuntu at Node 22 and Node 24 and on macOS at
Node 24, the mutation and `verify:mvp` lanes, and the package smoke on Ubuntu and macOS. Branches follow git flow; the
model is written down in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Documentation

| | |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | what has not been established, and what every number is bound to |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | what this may and may not be used for |
| [`docs/what-this-measures.html`](docs/what-this-measures.html) | a picture explainer of what is being scored — in Korean |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | the branch model, what a change has to carry, and the DCO |
| [`SECURITY.md`](SECURITY.md) | reporting a vulnerability |

## License

MIT — see [`LICENSE`](LICENSE). Contributions under the [DCO](CONTRIBUTING.md); sign off with
`git commit -s`. Third-party notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
