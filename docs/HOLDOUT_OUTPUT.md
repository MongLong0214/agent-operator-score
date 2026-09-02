# `aos holdout --json`: what the shape is, and what changed

`aos holdout --json` prints one object and it is now named. Before this change it printed a
different object with no name on it, so a reader had no way to notice the difference except by
watching their own code start reading `undefined`. This page is the record of that break.

```text
schema_id   aos-holdout-lane-a.v1
```

## Why it changed rather than staying compatible

The old object was the local acceptance report, and its precision gate has no floor. It answered a
question the owner is entitled to ask -- *do I accept this on my own machine, over whatever I have
judged so far?* -- and it answered it with a rate over however few decisions existed. Printed, that
became `FAIL  high-severity precision — 0` for one false positive and `pass … — 1` for one true
positive: a product claim computed from a single decision.

There is no compatible way to keep that field. The one thing an old consumer read from it -- a
number at `precision.precision` -- is the thing that must not be there below the floor, and a
compatibility field carrying it would reintroduce the defect under a second name. So the shape is
replaced rather than extended, and named so that the next replacement is visible.

## What the old fields are now

| Old field | Read instead | Note |
|---|---|---|
| `accepted` | `status === "PASS"` | `status` is `PASS`, `FAIL` or `UNDECIDED`; the third is neither of the other two and must not be collapsed into them |
| `holdout_sessions` | `sessions` | unchanged meaning |
| `tuning_sessions` | `tuning_sessions` | unchanged |
| `judged` | `judged` | unchanged |
| `precision.precision` | `precision` | **now `null` whenever `precision_withheld` is true**, which is the point of the change; `withheld_reason` says which part of the floor was short |
| `precision.true_positive` | `tp` | unchanged meaning |
| `precision.false_positive` | `fp` | unchanged meaning |
| `precision.unclear` | `unclear` | unchanged meaning |
| `precision.decided` | `decided_high` | unchanged meaning |
| `gates[0]` (`high-severity precision`) | `precision`, `precision_withheld`, `withheld_reason`, `floor` | the precision gate is gone: below the floor there is no rate to have failed |
| `gates[1..2]` | `gates` | the two gates that are counts, each with `pass`; the failing ones are also in `violations` |

New in this shape and not derivable from the old one: `decided_sessions`, `floor`
(`decided_sessions_required`, `decided_sessions_met`, `abstention_met` among them), `violations`,
`moved_sessions`, `dataset_digest`.

## Exit codes

`aos holdout --json` exits `0` only when `status` is `PASS`. It previously exited `0` whenever the
unfloored gates passed, which included a one-session ledger. `aos holdout --lanes --json` exits `0`
only when the claim is `PRODUCTION_QUALITY`.

## What a reader should not do with it

`precision: null` means the rate is absent, not zero and not small. Substituting a default,
computing `tp / (tp + fp)` from the counts beside it, or reporting the floor's shortfall as a score
puts back exactly the number this shape exists to withhold. The counts are published so that the
evidence is visible, not so that the rate can be reconstructed from them.
