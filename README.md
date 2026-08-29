<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**It measures the driver, not the car.**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
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

Plenty of tools benchmark how capable an AI coding agent is. AOS looks at **the person operating it**.

Here, the operator is not the agent. It is the user who assigns the work, chooses what context to
provide, steps in when the run stalls, and decides whether the result is actually acceptable.

Give the same agent the same task and the outcome can still change. One operator states the goal
clearly, filters the context, changes course after a failure, and checks the agent's “done” claim.
Another lets the same failure repeat or accepts an unverified result.

**AOS is a local tool for examining that difference.**

<img src="docs/assets/aos-driver-vs-agent-en.svg" alt="The agent is the car, the user is the driver, and the scorecard points to the driver." width="960">

> [!WARNING]
> AOS is `EXPERIMENTAL / PROVISIONAL`. A result describes one agent, model, configuration, machine,
> and task pack. Do not use it for hiring, promotion, employee surveillance, or certification.

## Start here: review a Claude Code session

With Claude Code, you do not need to clone the repository or run `npm install`.

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

`/aos-review` revisits the session that just finished. The AOS review engine itself does not call a
model. `/aos-assess` is different: it launches registered agent CLIs, so it consumes their model
quota.

The plugin removes repository setup, manual agent registration, and hand-written plan files. It
still needs Node `>=22.18 <25`, and the Claude Code or Codex CLI you intend to use must already be
installed and signed in.

The plugin cannot answer assessment checkpoints for you. To receive an official score, follow its
instructions and take part in the checkpoint run yourself. An answer supplied by another agent
would measure that agent's policy, not yours.

To run AOS directly from the repository:

```bash
git clone --depth 1 --branch dev https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review
```

The default branch is `dev`. For a reproducible snapshot, use a tag from
[GitHub Releases](https://github.com/MongLong0214/agent-operator-score/releases).

## What AOS measures: the driver, not the car

A conventional benchmark asks:

> Is this model faster or more accurate than that model?

AOS asks:

> Given the same tool, how well did the user assign, steer, and verify the work?

The agent is the **car**; the operator is the **driver**. AOS is not measuring top speed. It asks
whether the driver chose the destination, noticed a wrong turn, stopped before an unsafe move, and
confirmed that the car actually arrived.

<img src="docs/assets/aos-benchmark-vs-operator-en.svg" alt="A conventional benchmark measures the car; AOS measures how the operator drove it." width="960">

AOS provides two ways to examine that work.

## Two modes: `review` and `assess`

| | `aos review` | `aos assess` |
|---|---|---|
| What it does | Finds potentially risky patterns in real sessions and presents them for human review | Runs six controlled tasks and summarizes the observed operation and outcome |
| What it uses | Local Codex, Claude Code, and Grok CLI transcripts | Registered agent CLIs such as Codex and Claude Code |
| Model use | The review engine makes no model call; it reads existing records | Yes. It runs the registered agents |
| Result | The suspicious step and the evidence behind it | A score out of 100, or the reason no score was issued |

Start with `review`. It lets you see how AOS reasons about work you actually did before you spend
quota on an assessment.

### `review` — revisit work that already happened

```bash
node bin/aos.mjs review                         # most recent session
node bin/aos.mjs review --since 12              # patterns across the last 12 sessions
node bin/aos.mjs review --list                  # list reviewable session paths
node bin/aos.mjs review --session "<path>"      # review one listed session
node bin/aos.mjs review --json                  # machine-readable output
```

A finding is a **review candidate**, not a final verdict. Compare it with the original session.

| Rule | In plain language |
|---|---|
| `completion-claimed-without-verification` | The agent claimed completion without re-running a check after the last edit |
| `session-ended-on-stale-evidence` | The session ended with verification evidence older than the last edit |
| `edits-outside-the-working-directory` | The agent changed files outside the project it was working in |
| `destructive-command-executed` | A hard-to-reverse command with data-loss risk was executed |
| `secret-material-in-session` | A token, API key, or private key appeared in the session |
| `long-uninterrupted-tool-run` | A long unattended stretch contained a failure or repeated action |
| `completion-claimed-over-a-failed-check` | The agent said the work was done even though the preceding check failed |
| `verification-exit-status-discarded` | A check ran under `\|\| true`, discarding the failure status |

One session tells you what happened once. A group of sessions can show what you keep repeating.

The review rules have not yet met their target accuracy in an independent measurement. Until the
revised rules are measured on new, unused sessions, treat them as prompts for inspection rather
than a trusted automatic judge.

### `assess` — examine operation through controlled practice

`assess` gives the agent six controlled coding tasks. The agent's own “done” message is not the
grade. A separate verifier checks the actual artifacts and execution record, while AOS also
observes how the operator responds when work becomes blocked.

> [!CAUTION]
> When `aos init` finds Claude Code on `PATH`, it registers the non-interactive command with
> `--dangerously-skip-permissions`. This bypasses Claude Code's own permission prompts. AOS still
> uses a temporary workspace, a temporary `HOME`, and filtered environment variables, but you
> should understand the flag before starting an assessment.

```bash
node bin/aos.mjs init                   # auto-register Claude Code and Codex found on PATH
node bin/aos.mjs doctor                 # check the command and credential path first

node bin/aos.mjs assess                 # unattended diagnostic: no official score
node bin/aos.mjs assess --checkpoints   # attended run that can issue a score
```

`init` does not overwrite an agent you configured yourself. If no plan is supplied, AOS writes and
uses a runnable default `aos-plan.json`. The plan is not a self-rating form, and making it look
impressive does not raise the score.

`doctor` checks executable and credential-path readiness without calling a model. If a runtime
never starts, or different tasks fail in the same setup-related way, AOS stops instead of turning a
broken setup into a low operator score.

## Six things on the scorecard

<img src="docs/assets/aos-six-dimensions-en.svg" alt="The six areas AOS scores, explained as practical questions." width="960">

1. **What did you ask it to build?** (`Task Specification`) — goal, non-goals, and the definition of done
2. **What did you show it?** (`Context Engineering`) — relevant sources, freshness, provenance, and untrusted content
3. **How did you split the work?** (`Decomposition & Routing`) — ownership, dependencies, handoffs, and joins
4. **What did you do when it got stuck?** (`Human-in-the-Loop Control`) — detection, intervention, stopping, and resuming
5. **Did you check that it really worked?** (`Evaluation & Verification`) — independent checks, exact revision, and honest completion
6. **Was it safe and worth the cost?** (`Guardrails, Recovery & Cost`) — secrets, permissions, recovery, and invocation budget

Those six areas contain 20 metrics. Each metric is made of four explicit subchecks.

## Checkpoints: what did you do when work got stuck?

When a task reaches a blocker or repeats the same failed action, AOS pauses and shows the available
evidence. The current prompt asks four yes/no questions:

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

**The answer label is not the score.** AOS checks whether the instruction actually changed, the
route actually moved, the run actually stopped, or the same failure simply happened again.
Answering “no” to all four questions retries the stage unchanged.

Without `--checkpoints`, AOS cannot observe the operator's decisions. The agent result and a
diagnostic calculation remain, but the official score is withheld as `INCOMPLETE`. A plugin or
another agent answering on your behalf creates the same problem.

## Not observed is not zero

Imagine a driving examiner never saw you park. Recording a zero would treat “failed to park” and
“parking was never observed” as the same event.

<img src="docs/assets/aos-not-observed-en.svg" alt="Only 3 of 20 checks were observed, so AOS issues no score instead of treating missing evidence as failure." width="960">

AOS keeps the states separate:

- **Fail** — the condition was checked and not met.
- **`NOT_OBSERVED`** — there was not enough evidence to judge it.
- **`INCOMPLETE`** — too many important items were unobserved, so no official score is issued.

At least 18 of the 20 metrics must be observed, including the critical outcome, independent
verification, exact-revision, completion, recovery, and safety metrics. Empty artifacts and silent
runs do not earn points. **Silence is not a pass.**

`provisional_raw` is a troubleshooting value shown beside its limitations. It is not an official
score.

## The same 83 can mean different things

An 83 earned with a different car, route, and weather is not the same driving test.

<img src="docs/assets/aos-profile-bound-en.svg" alt="Two scores of 83 produced under different agents and conditions are not directly comparable." width="960">

AOS records the conditions that change what the number means:

- agent and model
- CLI version and command configuration
- machine and isolation level
- task pack, suite version, and seed

This is what `PROFILE-BOUND` means. Scores with different profiles are measurements of different
conditions and must not be compared as though they came from one test.

| AOS is not | Why |
|---|---|
| A general score of a person's AI ability | It describes one observed run under specific conditions |
| A general model, CLI, or harness leaderboard | Different profiles are different measurements |
| A percentile, rank, or certification | There is no reference population or norm |
| A hiring, promotion, or employee-surveillance tool | The intended-use policy explicitly forbids those uses |
| A SaaS or telemetry service | Run records and reports stay local; AOS has no collection backend |
| A validated scientific instrument | Calibration, independent reproduction, and qualified review are not complete |

An early version let the shape of an operator-authored JSON plan determine 17 of 20 metrics; even a
meaningless plan could receive `17/17`. That path has been removed. The plan is no longer a scoring
input: a metric is observed from the run or remains `NOT_OBSERVED`.

The task definitions and grading logic are public in `lib/suite.mjs`. AOS is a practice and
self-review tool, not a secret-answer exam.

## Why three runs become one score

A single agent run is noisy. A cycle locks three seeds at the start and combines results produced
under the same profile.

```bash
node bin/aos.mjs cycle start                                  # lock three seeds
node bin/aos.mjs cycle run --checkpoints                      # run them in order
node bin/aos.mjs cycle                                        # median of valid runs
node bin/aos.mjs dashboard                                    # local, read-only dashboard
```

At present, only three of the six task families vary with the seed. Three local repetitions are
therefore not population-level reliability evidence.

Aggregation includes only terminal, officially issued runs that match the locked seed, profile,
suite major version, and scorer major version. Every exclusion is shown with its reason. A valid
low score cannot be discarded or rerun; the same seed may be retried only after an infrastructure
failure that measured nothing.

If a cycle was started with the wrong setup, `--force --reason "<why>"` closes it and starts a new
one. The old seeds, runs, and scores remain in the abandoned record.

The Operator Score is the **median** of all valid runs. Variation on one machine is reported as
**local repeat evidence**, never as statistical confidence.

## When there is no score — and when a ceiling applies

AOS does not publish an official number merely because arithmetic is possible. If coverage,
critical observations, isolation, or evidence requirements are not met, the result stays
`INCOMPLETE`.

When a critical violation is actually observed, AOS limits the highest possible score instead of
letting strong performance elsewhere average it away:

- secret leakage, prohibited external action, or workspace escape: maximum **39**
- claiming a failed outcome as complete: maximum **49**
- continuing after an unhandled critical error: maximum **59**
- changing the result after verification so the final revision no longer matches: maximum **69**

A ceiling applies only to an observed violation. A missing artifact that prevents a safety judgment
is `INCOMPLETE`, not automatically `UNSAFE`.

The display bands are `90+ HIGH RELIABILITY`, `75+ ADVANCED`, `60+ OPERATIONAL`,
`40+ DEVELOPING`, and `0+ FRAGILE`. They summarize that run; they are not a population rank or a
label for the whole person.

## What has actually been measured

The following runs used real Codex on one machine. Each cycle locked three seeds and every run had
an operator present at checkpoints.

| Cycle | Agent sandbox | Operator Score | Run scores | Spread |
|---|---|---|---|---|
| 1 | On | **69** | 69, 69, 83 | 14 |
| 2 | Off | *Withdrawn* | 49, 59, 89 | — |
| 3 | Off | **90** | 90, 87, 92 | 5 |

“Agent sandbox” means Codex's own command sandbox. AOS's separate temporary workspace, temporary
`HOME`, and environment filtering remained in place in all three cycles.

Cycle 2's aggregate was withdrawn because one run's score was recorded against all three seeds,
effectively counting one run three times. The individual scores remain; the three defects they
exposed were fixed before cycle 3.

`aos review` was measured once on 320 sessions that had not been used to write its rules. Four of
10 high-severity findings were correct: precision **0.400**. The six false positives were fixed,
but measuring the fixes on the same sessions is tuning, not a second independent result.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # current acceptance gates
```

There are no unused tool-active sessions left in that corpus. Until new held-out sessions exist,
the current review rules do not have an established post-fix accuracy. The details are in
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

## Outputs, security, and privacy

An assessment produces:

- **`card.svg`** — one shareable scorecard with the score, six areas, run conditions, and the first improvement to make
- **Markdown and HTML reports** — evidence, passes, failures, unobserved metrics, ceilings, and withholding reasons
- **JSON result** — the machine-readable record

If no official score was issued, the card shows **NO SCORE** and the reason. It never promotes
`provisional_raw` into a shareable score.

The HTML report opens in Korean on a Korean locale and in English otherwise. Both languages are
stored in the file and switched with CSS, so changing the report language makes no external
request.

| Area | Actual behavior |
|---|---|
| AOS network | The dashboard binds to `127.0.0.1`, requires a token, and is read-only and GET-only. No route returns transcripts, and AOS has no collection backend |
| Agent network | Codex and Claude Code may contact their model providers during `assess`; this is not a fully offline run |
| Runtime requirements | There are no npm runtime dependencies, but supported Node is required |
| Agent process | The agent runs in a temporary workspace with a replaced `HOME` and filtered environment |
| Run context | Existing user `AOS_*` variables, including `AOS_HOME`, are removed; only `AOS_SESSION_ID`, `AOS_FAMILY`, `AOS_WORKSPACE`, and `AOS_TASK_FILE` are injected for the run |
| Credentials | Existing runtime credentials or explicitly allowed auth variables may be carried into the isolated process. AOS records names and sources, never values; `--no-auto-auth` disables discovery |
| Secrets and local storage | Secret values are redacted at the output boundary and never copied into findings, results, or events. `~/.aos` is `0700`; its files are `0600` |

Report vulnerabilities through [`SECURITY.md`](SECURITY.md).

## Run locally, develop, and contribute

Direct execution requires Node `>=22.18 <25`, macOS or native Linux, and x64 or arm64. WSL is not
currently supported. No package is published to the npm registry; run from the repository or a
GitHub Release source snapshot. `npm pack` builds a local tarball.

```bash
npm ci
npm test                 # full test suite
npm run verify:mvp       # score contract, ceilings, and bands
npm run test:mutation    # prove the named guards are load-bearing
npm run smoke:package    # pack, install elsewhere, and exercise the user path
```

CI runs seven lanes: tests on Ubuntu with Node 22 and Node 24, tests on macOS with Node 24,
`verify:mvp`, mutation testing, and package smoke tests on Ubuntu and macOS.

| Document | Contents |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | What has not been established and what each number is bound to |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | Permitted and prohibited uses |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch strategy, change requirements, and DCO |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting |

MIT licensed; see [`LICENSE`](LICENSE). Contributions follow the [DCO](CONTRIBUTING.md) and should
be signed with `git commit -s`. Third-party notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
