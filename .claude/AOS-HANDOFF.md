# AOS handoff — 2026-08-22 (end of session)

## State

```
verified            52 / 74
open issues         26
readySet            E1-004, E14-003, E5-002, E5-003
complete epics      E4 (001-004), E9 (001-003), E3, E2, E0*, E8, E13, E14-001/002
lanes running       E5-002, E5-003 (terra)
open PR             none
```

Re-derive with `node scripts/resolve-execution-state.mjs --strict`.

## Read this before trusting a `verified` count

**A count taken immediately after a merge undercounts by two.** Twice today `verified` read one to
two low right after merging, and both causes are transient:

1. the just-merged ticket sits at `merged_pending_post_ci` until its merge commit's `event=push` CI
   completes — a minute or two;
2. **E8-004 loses `verified` after every merge** and regains it when the new tip's CI goes green.
   Its own completion merge (#259) has a **permanently queued** CI run, so it depends on the
   authenticated-descendant fallback, and the newest tip is the descendant it uses.

Wait for `gh run list --branch dev --limit 2` to show `completed/success` before believing a number.

## And `EXTERNAL_STATE_UNAVAILABLE` is not always GitHub

I lost two derivations to this today. `readySet=unavailable` with `head=unknown` is *usually* the
secondary rate limit, but it is also what a **malformed field in any merged PR body** produces:

```
errors=EXTERNAL_STATE_UNAVAILABLE: malformed Ticket field on merged PR #345
```

I had written `Ticket: none — control-plane fix, ...` in a body. `Ticket:` is grammar, not prose —
`/^Ticket:\s*(\S+)\s*$/` needs exactly one token — and one such line zeroed all 74 tickets. Always
read stderr before blaming GitHub, and check `gh api rate_limit`: 4982/5000 with an "unavailable"
result means the cause is in the data. Filed as #351, which also argues the two states deserve
different blocker codes and that one bad row should not fail all 74.

**For a PR with no owning ticket, do not start a line with `Ticket:`.** Say it in prose.

## Delegation

**terra implements from a written spec, sol reviews, I re-run everything.** grok is HTTP 402.

```
implement   codex exec -m gpt-5.6-terra -c 'model_reasoning_effort="xhigh"' -s danger-full-access --cd <worktree>
review      scratchpad/sol-review.sh <pr> [extra-prompt-file]
```

Every spec needs an **authority section with the measured resolver output pasted in**, the base SHA
pinned, and an explicit instruction not to run `ops:status`. Three lanes stopped on
`readySet=unavailable` before I started doing this; none has since.

Tell both **not** to run the full `npm test`.

## The test-file shape both requirements need

```js
import { describe, test } from "node:test";
describe("<focused-command argument>", () => {   // --test-name-pattern matches this
  test("<acceptance case name>", async () => {   // the planning validator's /\btest\(/ matches this
```

The workspace script is `node --test --test-name-pattern`, so the argument after `--` matches test
**names**. Without the `describe`, the focused command runs **zero** cases and reports pass. With
`it(` instead of `test(`, every acceptance binding fails. I broke the first way on E4-003 and terra
broke the second way; `packages/runner/test/isolation.test.ts:109` is the model.

**After any focused run, check the case names appear in the output.** A green run with no case names
is a green run of nothing.

## Mutation-testing rules that cost real time this week

1. **Probe each call site, not the shared helper.** Two collectors shared one helper; mutating it
   killed two tests and I read both call sites as covered. Deleting the modern collector's own line
   left 181/181 green.
2. **Probe inputs one at a time, not the rule in aggregate.** "Rule disabled → five cases died"
   hides that ten of twelve compared fields were individually unpinned (E9-003).
3. **A mutation that inserts a value the system never produces is inert.** I reported E4-004's
   verdict rule as a survivor using `"BLOCKED"`; the real vocabulary is `SCORE_BLOCKED`.
4. **Mutate rules, not shape declarations.** Removing one entry from an exact-key-set list makes the
   module refuse *everything* including valid input — "all cases died" then measures nothing.
5. **A guard probed with an input another rule already rejects reads as redundant when it is not.**
   The manifest type guard looked dead until I passed `undefined` rather than `""` — without it,
   `Buffer.from(undefined)` throws out of a fail-closed check.
6. **Check both directions.** Make each guard refuse *everything* and expect cases to die, or a
   pure-refusal implementation passes.

## Gate mechanics

- One `Gate-Batch:` per merged PR body; one batch per correction PR. `scratchpad/fix-command.py`
  does correction + renewal + census repin.
- **Commit the artifact correction and the registry renewal as two commits.** Amending them together
  orphans `reviewed_head`, which turns on the target-tip digest proof and fails against `dev`.
- A `required_artifacts` entry without `sha256` reports as `stale digest`, not as a missing field.
- Census pins are regenerated by measurement: `/tmp/repin.py <measured> tests/planning-contract.test.mjs`.
- #350 fixed the cause of the one-receipt-per-PR rule (duplicate CI rows read as ambiguity). Whether
  one PR may now carry a gate receipt *and* a completion receipt is untested — it needs its own
  change with its own live evidence.

## Owner decisions still open

**#301** the artifact freeze verifies caller-supplied facts; the collector gathers no live manifest
evidence.
**#303** `resolveGovernanceModeResult` is unwired **by a recorded decision** (`cdd4e667`): wiring it
empties `readySet` until D0-009 activation.
**#316** every ADR and PRD says `PROPOSED` while 30 batches are `ACCEPTED`. Both proposed fixes edit
33 gate-pinned documents and cost ~30 renewal PRs; nothing is blocked on it today.
**#330 / E1-004** its deliverable is already merged (#332) with no completion receipt, because the
ticket's gate was accepted after the work landed. Needs either a recorded historical-linkage
exception naming #332, or acceptance that `readySet` keeps nominating a ticket with nothing to do.
**#347** the completion check is aimed at every path the merge touched, not at the ticket's
deliverable — E8-004 passes on an unrelated incident document.
**#351** one malformed PR-body field fails all 74 tickets and reports as an availability error.
