
The shipped arithmetic is also honest: there are 11 items, 13 decided label/rule pairs, all 13 excluded as derived, zero eligible decided pairs, Lane B UNDECIDED, and claim EXPERIMENTAL. JSON exposes `eligible_decided_pairs: 0`; plain output shows `eligible 0` per rule and says “no eligible decided evidence,” not “below the floor.” Lane A UNDECIDED is honest for the current code provided the historical 0.400 remains on record, which it does.

I found no band, percentile, or rank in either lane result or renderer, and no mutation `to` that statically survives its named test. Test names still overclaim: the “neither report” test omits `--lanes --json` ([holdout-command.test.mjs](/private/tmp/rv-594b/tests/product/holdout-command.test.mjs:94)), and the “lane report” vocabulary test serializes only `laneA` ([review-holdout-floor.test.mjs](/private/tmp/rv-594b/tests/product/review-holdout-floor.test.mjs:235)). The shipped-corpus test still validates author-written labels against themselves rather than incident truth.

The read-only review sandbox prevented all temporary-directory and mutation-worktree tests; the pure relevant tests passed, and the failures observed were `mkdtemp … EPERM`, not assertions.
tokens used
407,772
Not ready to merge.

The pushback on mandatory reasons is sound. Reasons improve auditability but do not prevent an owner from gaming their own ledger, and issue #565 requires holdout floors, precision/recall, the UNDECIDED gate, and mutation evidence—not a ledger migration ([v0.2.0-execution-plan.json](/private/tmp/rv-594b/governance/v0.2.0-execution-plan.json:573)). Making reasons mandatory now would invalidate the existing ten rows; making them mandatory prospectively creates a versioned-ledger contract. Track that separately with an explicit migration. It should not block #565.

Remaining findings:

1. Lane B abstention gaming remains. Undecided items are counted at [incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:268) and excluded from every denominator at [incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:286), but unlike Lane A there is no abstention floor before `PASS` at [incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:305). The test explicitly establishes that an undecided item coexists with precision 1, recall 1, and `PASS` ([known-incident-corpus.test.mjs](/private/tmp/rv-594b/tests/product/known-incident-corpus.test.mjs:90)).

   Concrete input: use the existing `many`, `fires`, and `silent` helpers to supply ten uniquely tagged expected items, ten uniquely tagged forbidden items, and 1,000 uniquely tagged `undecided_rules` items. Duplicate-evidence refusal does not trigger because every command differs. The result is still `PASS`, precision 1, recall 1, `undecided: 1000`. The Lane A half of the abstention fix is correct; the Lane B half is absent.

2. Duplicate fixture IDs can manufacture a Lane B pass. Validation checks only that each ID is nonempty ([incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:80)). Reviews are then stored in a `Map` keyed by ID, where the last item silently replaces the earlier evidence, and that one review is reused for every item with the ID ([incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:230), [incident-corpus.mjs](/private/tmp/rv-594b/lib/incident-corpus.mjs:243)).

   Concrete input:

   - Nine distinct silent expected items plus one firing expected item, all with `fixture_id: "p"`.
   - Nine distinct firing forbidden items plus one silent forbidden item, all with `fixture_id: "n"`.

   Put the matching item last for each ID. All evidence digests are distinct, but all ten positives are scored using the final firing review and all ten negatives using the final silent review. The result is ten TP, ten TN, no regression, precision 1, recall 1, `PASS`, although 18 of the 20 underlying items contradict their labels. Reject duplicate `fixture_id` values before constructing the map.

3. Two fixture provenance statements remain false.

   - [holdout-320-ci-logs-written-under-tmp.json](/private/tmp/rv-594b/fixtures/known-incidents/holdout-320-ci-logs-written-under-tmp.json:17) says its reconstruction contains “three scratch writes”: a PR body and two CI logs. Its evidence contains only `/tmp/red.log` and `/tmp/pr-body.md`—two writes ([same fixture](/private/tmp/rv-594b/fixtures/known-incidents/holdout-320-ci-logs-written-under-tmp.json:73)). The cited source test repeats the three-write claim but also reconstructs only those two writes ([review.test.mjs](/private/tmp/rv-594b/tests/product/review.test.mjs:489)).
   - [holdout-320-test-runner-named-by-path.json](/private/tmp/rv-594b/fixtures/known-incidents/holdout-320-test-runner-named-by-path.json:15) attributes all five false positives to interpreters named by path. The cited implementation says those five covered three shapes: path-named interpreters, runners with valued options, and timeout prefixes ([review.mjs](/private/tmp/rv-594b/lib/review.mjs:15)). Its single `./.venv/bin/python` reconstruction cannot truthfully represent all five.

   The replacement Codex `custom_tool_call`, corrected DROP TABLE runtime, and one-edit/medium-severity disclosure are faithful.

4. Making `laneA` the default JSON object introduced an unversioned machine-output schema break. [cli.mjs](/private/tmp/rv-594b/lib/cli.mjs:793) now serializes the lane object at [holdout.mjs](/private/tmp/rv-594b/lib/holdout.mjs:350). Existing consumers of `accepted`, `holdout_sessions`, or nested `precision.precision` now receive `undefined` or the wrong type. The exit-code change itself is correct, but before merging this needs either an explicitly documented/versioned breaking change or compatibility fields derived from `laneA`.

5. The documentation overstates UNDECIDED behavior. [LIMITATIONS.md](/private/tmp/rv-594b/docs/LIMITATIONS.md:86) says falling below any floor always means UNDECIDED, but violations intentionally decide first. A one-session ledger with `reported_status: "COMPLETE"` and `actual_evidence: "INCOMPLETE"` is `FAIL` with a withheld precision, as asserted at [review-holdout-floor.test.mjs](/private/tmp/rv-594b/tests/product/review-holdout-floor.test.mjs:191). Qualify the documentation with “in the absence of a counted violation.”

The main closure is otherwise correct: both CLI reports use `laneA`; default JSON and lanes JSON exit 1 on UNDECIDED; no CLI path prints a withheld numeric rate; the hypothetical 0.70–0.97 interval is clearly threshold commentary rather than a current measurement. Worst-observed severity, Lane A session spread, Lane A abstention, exact duplicate-evidence refusal, the leakage concession, and the two documented parser misses are all implemented as described.

The shipped arithmetic is also honest: there are 11 items, 13 decided label/rule pairs, all 13 excluded as derived, zero eligible decided pairs, Lane B UNDECIDED, and claim EXPERIMENTAL. JSON exposes `eligible_decided_pairs: 0`; plain output shows `eligible 0` per rule and says “no eligible decided evidence,” not “below the floor.” Lane A UNDECIDED is honest for the current code provided the historical 0.400 remains on record, which it does.

I found no band, percentile, or rank in either lane result or renderer, and no mutation `to` that statically survives its named test. Test names still overclaim: the “neither report” test omits `--lanes --json` ([holdout-command.test.mjs](/private/tmp/rv-594b/tests/product/holdout-command.test.mjs:94)), and the “lane report” vocabulary test serializes only `laneA` ([review-holdout-floor.test.mjs](/private/tmp/rv-594b/tests/product/review-holdout-floor.test.mjs:235)). The shipped-corpus test still validates author-written labels against themselves rather than incident truth.

The read-only review sandbox prevented all temporary-directory and mutation-worktree tests; the pure relevant tests passed, and the failures observed were `mkdtemp … EPERM`, not assertions.

[exited with code 0]
