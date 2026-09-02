```

and exits successfully, although `laneA` would be `UNDECIDED` with `precision: null`.

Plain output has the same defect: [lib/cli.mjs](/private/tmp/rv-594/lib/cli.mjs:794) prints the numeric gate first, then later says the rate “is not a measurement.” With one false positive it prints `FAIL high-severity precision — 0`; with one true positive it prints `PASS ... — 1`.

The existing one-session assertion in [holdout-command.test.mjs](/private/tmp/rv-594/tests/product/holdout-command.test.mjs:55) therefore preserves the original defect. Adding a notice beneath the number is not sufficient: WITHHELD must mean the number is absent. `acceptanceOf` should not remain an independent public result path, and JSON/plain output should be generated from the floored lane result.

2. Corpus order can change a withheld result into a published rate.

[incident-corpus.mjs](/private/tmp/rv-594/lib/incident-corpus.mjs:176) records only the first observed severity for a rule. It then assigns a floor of 10 only when that first value is `high`; otherwise the floor is 5 at [incident-corpus.mjs](/private/tmp/rv-594/lib/incident-corpus.mjs:241).

This is observable for `session-ended-on-stale-evidence`, whose severity varies with edit count at [review.mjs](/private/tmp/rv-594/lib/review.mjs:286). For the same five positive and five negative labelled items:

- Medium-severity item first: floor 5, precision 1, recall 1, `PASS`.
- High-severity item first: floor 10, both rates null, `UNDECIDED`.

The current alphabetical fixture order conveniently seeds this rule as medium: [holdout-320-completion-claim-after-an-edit.json](/private/tmp/rv-594/fixtures/known-incidents/holdout-320-completion-claim-after-an-edit.json:17) describes high-severity findings, but its evidence contains only one edit, which the implementation rates medium. Severity must be rule metadata or the maximum observed severity, never first-observation order.

3. Repetition and abstention can manufacture a production claim.

Corpus validation at [incident-corpus.mjs](/private/tmp/rv-594/lib/incident-corpus.mjs:53) has no uniqueness or independent-evidence requirement. Every item increments the denominators at [incident-corpus.mjs](/private/tmp/rv-594/lib/incident-corpus.mjs:216). The tests themselves clear floors using cloned sessions with changed IDs in [known-incident-corpus.test.mjs](/private/tmp/rv-594/tests/product/known-incident-corpus.test.mjs:58).

Concrete input: ten copies of one positive finding, ten copies of one negative finding, and 1,000 `UNDECIDED` copies yields `PASS`, precision 1 and recall 1—despite only two distinct evidence shapes and 98% abstention.

Lane A is similarly gameable: 50 sessions can be supplied while all 20 decided findings come from one session. Adding 1,000 `unclear` findings does not affect precision or status. Nothing limits abstention, requires reasons, measures coverage, or requires findings to span sessions. Counts are displayed by `--lanes`, but prominence does not prevent score gaming.

4. One corpus item appears deliberately convenient and is not a reconstruction of its cited incident.

[holdout-320-codex-calls-in-an-unread-shape.json](/private/tmp/rv-594/fixtures/known-incidents/holdout-320-codex-calls-in-an-unread-shape.json:33) contains an explicit:

```text
psql -c 'DROP TABLE runs'
```

inside a `local_shell_call`, yet labels `destructive-command-executed` as `UNDECIDED`. Given the fixture’s own evidence, that outcome is not ambiguous; it is an expected finding, so AOS’s silence should be a regression and immediate `FAIL`.

Worse, the repository’s source implementation says the actual 929/931 incident shape was `custom_tool_call`, at [session.mjs](/private/tmp/rv-594/lib/session.mjs:186), not `local_shell_call`. The fixture therefore invents a different unread shape while retaining the incident citation.

This matters because all 12 decided label/rule pairs in the shipped corpus declare themselves derived and are excluded. The only two eligible pairs are the two `UNDECIDED` labels in this fixture. Lane B consequently has zero eligible decided evidence—not merely “too little evidence.”

5. Leakage protection trusts the author of the evaluated rule and corpus.

`outcomeFor` correctly throws when a rule appears in `derived_rules`, but [incident-corpus.mjs](/private/tmp/rv-594/lib/incident-corpus.mjs:117) can only test the declaration. The same commit and author introduced the rules, fixtures, labels and declarations. Omitting one rule name makes that item eligible; neither provenance nor history is independently checked.

Several declarations are plausible, but they are not raw incident reconstructions. For example, the DROP TABLE fixture declares a Claude runtime while embedding a JavaScript `tools.apply_patch` call. The stale-CI fixture reduces the cited PR-body-plus-two-logs incident to one log and a PR body. Those are useful synthetic tests, but they should not be represented as an independently labelled known-incident corpus.

6. The floors are unsupported and internally weak.

No statistical, operational, or empirical basis is stated for 50 sessions, 20 decided high-severity findings, or 10 labels per direction. Twenty observations at measured precision 0.90 still give a very broad approximate 95% Wilson interval of 0.70–0.97. Fifty sessions add no protection when 49 may contribute no decision. Lane B’s nominal 10 can become 5 through the severity bug above, and duplicates count.

The Lane A floor of 20 was also introduced after the known ledger had 10 decisions and turns its historical 0.400 failure into `UNDECIDED`. That is a convenient post-hoc effect. I cannot establish motive, but it is not defensible as a preregistered or statistically justified threshold. Lane B’s present withholding is not caused by choosing 10—it has zero eligible decided labels and would be withheld under any positive floor.

7. Test and mutation coverage overstates what it proves.

The production-claim mutation in [manifest.mjs](/private/tmp/rv-594/tests/mutation/manifest.mjs:109) names a test about transcript provenance, while the actual killing assertion is only an incidental `EXPERIMENTAL` claim check. Likewise, “the corpus that ships says what it can” verifies the corpus against labels written in the same change; it does not validate those labels against incident sources.

I found no new mutation `to` that statically survives its named assertion, although the full mutation runner could not execute because this review environment forbids its temporary worktree creation.

I could not break violation-before-floor behavior: Lane A and Lane B both force `FAIL` on counted violations/regressions before applying sample floors, and I found no path that dilutes them into a rate. I also found no band, percentile or rank in the review-lane output, and the zero-runtime-dependency constraint remains intact.

[exited with code 0]
