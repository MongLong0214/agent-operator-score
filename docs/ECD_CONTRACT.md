# The AOS evidence-centred design contract

> Artifacts: `contracts/*.json`, schemas in `contracts/schemas/`, logic in `lib/ecd-contract.mjs`
> Verified by: `npm run verify:ecd-contract`, and by `npm test` like everything else

A metric title is not a construct. This contract is what says which construct each of the eighty
`M01–M20` subchecks stands for, on whose authority the observation may be reported, what else could
have produced it, and what happens when it is absent.

## The five artifacts

| Artifact | File | What it settles |
|---|---|---|
| `aos-observable-cell.v1` | `contracts/aos-observable-cells.v1.json` | The 35 cells, the subchecks each owns and the form that administers each of them, and the pinned count of subchecks the mapping claims |
| `aos-construct-map.v1` | `contracts/aos-construct-map.v1.json` | C1–C7, which cells stand for each on which axis, and the one index |
| `aos-evidence-model.v1` | `contracts/aos-evidence-model.v1.json` | Axes, authorities, scoring rules, missing policies, facets, prohibited value sources |
| `aos-task-model.v1` | `contracts/aos-task-model.v1.json` | What each form administers, and which opportunity sources are declared but not administered |
| `aos-interpretation-use-argument.v1` | `contracts/aos-interpretation-use-argument.v1.json` | Scoring → within-cycle generalization → extrapolation → use, with each link's status |

## The fields every scored cell carries

`construct_id`, `axis`, `claim`, `deferred_claim`, `observable`, `task_opportunity`, `authority`,
`rival_explanations`, `minimum_opportunities`, `minimum_opportunities_basis`,
`minimum_opportunities_source`, `scoring_rule_id`, `missing_policy`, `facet_identity`.

A cell missing any of them fails the schema; a cell whose authority the evidence model does not
define fails `checkEcdContract`. The heading used to carry a count and the list under it did not
match it, so the list is now checked against the schema by a test instead of counted in prose.

Two of those exist because a claim can be wider than the evidence behind it in two different ways.

`deferred_claim` names the part of the claim this cell's authority cannot observe, and a cell that
names one may not be scored. `C5.VD.01` rests on the operator's plan, digested before the run: a
plan cannot witness the operator later refusing an unsupported completion. `C6.OG.01`'s cannot
witness a permission widened mid-run. Both claimed it, and the honest form of that is to write down
which half nobody sees and refuse to score the cell until an authority for it exists.

`minimum_opportunities_source` names the clause that fixed a `CONTRACT_SPECIFIED` minimum, and the
clause carries the number. Without it the verifier asked only that the minimum be an integer, so
`C3.RA.01`'s four could have read ninety-nine and the contract would still have passed -- a decided
number with nothing behind it is indistinguishable from a measured one once it is in the file.

`declared_subcheck_count` sits above the cells and pins how many distinct subchecks the mapping
claims. It is pinned rather than inferred: duplicate a subcheck name inside one metric and the
inferred count stays eighty while the distinct count drops to seventy-nine, and every mapping check
is written over the distinct set.

`subcheck_administered_by` puts form ownership on the subcheck rather than on the cell. A cell can
hold subchecks two families produce -- `C6.SL.01` holds two of `M06`'s from FAM-2 and one of `M19`'s
from FAM-6 -- so a form list on the cell says "one of these forms" where a count needs "this one".
Each form declares `administered_metric_ids`, the verifier requires that the twenty metrics
partition across the six forms, and a test checks that partition against what `lib/observe.mjs`
actually attributes to each family. That check found the one error the guess had made: `C5.TC.01`
named FAM-4 as well as FAM-5, because FAM-4 writes the resume artifact `M17` reads, and FAM-4's
opportunity count included a subcheck FAM-4 never administers.

## Four axes, and why there are four

`operator_process` is read from operator turns and operator-authored documents the assessed agent
cannot write. `system_outcome` is read from verified effects. `reliance_calibration` needs a full
reliance episode with a known oracle. `delegated_artifact` is read from a file the agent wrote.

The fourth exists because of the first counterfactual: a stronger model must not move an operator's
process cell. A cell scored from an agent-written artifact does move when the model changes, so it
cannot be operator process, and the process index is computed over the `operator_process` axis
alone.

## What the shipped contract says about v0.2.0

Two of the six index constructs have an operator-process evidence source (C3 and C4, from the
recorded checkpoint window). The other four declare their cells and mark them unpopulated, so the
process index is **withheld by construction**. That is the finding, not a gap in the implementation:
the operator plan is validated and digested but no scored opportunity is derived from it, and no
form administers an independent initial judgment, so no reliance opportunity exists at all.

"By construction" is a structural statement and not a description of one call path. There is no
argument to `processIndex`, and no order of calls, that issues a value from this contract -- and
that now rests on object identity rather than on a property, because a property brand can be forged
with a `Symbol` and a frozen row can be substituted by a `Proxy`. A review did both.

One cell rests on the agent's own account of its behaviour with no effect to check it against
(`C6.IJ.02`). It is `credit_bearing: false` and required by nothing.

`C6.PB.01` used to be the second. Its three subchecks --
`M19.no-prohibited-external-action`, `M19.permissions-are-allowed-enum` and
`M19.no-workspace-escape` -- were read out of `response.json`, so the agent could earn or avoid a
safety answer by typing one. Since #557 they are answered from what the run was observed to have
done: the boundary canary's record of what the kernel refused, the descendant scan, the settlement
of the graded workspaces, and the environment policy each child was actually built with. The cell
now declares `authority: "boundary-kernel-effect"` on the `system_outcome` axis, is
`credit_bearing` and required, and sits in outcome domain O3 -- so an escape the kernel let through
reaches the O3 estimate rather than being reported beside it. Safety credit comes from `C6.SL.01`,
which observes bytes, and from `C6.PB.01`, which observes what the kernel did.

`credit_bearing` answers a question about credit and not about provenance: a cell that earns no
credit still tells a reader where its answer came from, and leaving `authority: "agent-declaration"`
on a cell three verifiers had moved would have been a false statement in the one artifact that
declares what an answer rests on. The contract version is `1.2.0` for that reason -- the cell id did
not change and the digest did, so a stored result can be told apart by which authority backed its
safety subchecks. It is `1.2.0` rather than `1.1.0` because `1.1.0` was already taken, by #558's
move of `C2.RF.01` and `C2.IB.01` onto the routing oracle. Two contract meaning-changes that reach
the same base need two versions; sharing one would leave the version unable to say which authority
a stored result was scored under, which is the only job it has here.

## Exported API

The surface is in two tiers, and the split is the point rather than a convenience. Everything in the
first tier reads or checks artifacts and promises nothing about them. Nothing in the second tier
will run against a contract the first tier has not passed.

```js
import {
  // constants
  ECD_CONTRACT_ID, ECD_CONTRACT_VERSION, AXES, CLAIM_STAGES, CELL_STATUSES, ARTIFACT_KEYS,

  // tier 1 -- unchecked artifacts in, description out
  loadEcdContract,                  // () -> the five artifacts, parsed, unverified
  loadEcdSchema,                    // (artifactKey) -> the JSON Schema for it
  contractDigests,                  // (contract?) -> { <artifact>: "sha256:...", combined }
  checkEcdContract,                 // (contract?) -> { ok, failures: [{ check, detail, subject }] }
  subcheckId, declaredSubcheckIds,

  // the gate
  sealEcdContract,                  // (contract?) -> sealed, or throws AOS_CONTRACT_INVALID
  shippedEcdContract,               // () -> the shipped contract, sealed once and memoised

  // tier 2 -- sealed contract required, or throws AOS_UNVERIFIED_CONTRACT
  subcheckMapping,                  // (sealed?) -> the flat table
  opportunitiesOf,                  // (observations, sealed?) -> opportunities
  estimateCell,                     // (cellId, opportunities, sealed?) -> one cell estimate
  cellEstimates,                    // (observations, sealed?) -> cells
  constructEstimates,               // (cells, sealed?) -> constructs
  processIndex,                     // (constructs, sealed?) -> the index
  comparability,                    // (leftResult, rightResult, sealed?) -> { comparable, ... }
  evaluate                          // (observations, context, sealed?) -> the whole result
} from "../lib/ecd-contract.mjs";
```

Every tier-2 function defaults its contract argument to `shippedEcdContract()`, so the ordinary call
is the short one: `evaluate(observations, context)`.

**The seal.** `sealEcdContract(contract)` runs `checkEcdContract`, and on a failure throws with the
failure list attached rather than returning it. On success it deep-copies, deep-freezes and registers
the artifacts. A contract that has not been through it cannot reach any of the arithmetic: the
functions above throw `AOS_UNVERIFIED_CONTRACT`. This is why the boundary is structural and not a
convention -- the rules in `checkEcdContract` include the one refusing credit to a cell whose only
authority is the agent's account of itself, and while the steps were exported raw that rule bound
only callers who chose to run the verifier.

**The capability is the object, not a mark on it.** The first version of this boundary wrote a
`Symbol`-keyed property onto the sealed contract and onto each derived array. Both halves are
forgeable: a caller can mint a `Symbol` with the same description and define the property, and a
`Proxy` answers every property read the check performs while substituting whatever it likes
underneath. A review used a branded `Proxy` to make a below-minimum cell issue a value, which is a
release-contract invariant. Membership now lives in module-private `WeakMap`s, so a lookalike has
nothing to forge and a `Proxy` is a different object from the one that was registered.

**The stages are chained, not composable by hand.** `cellEstimates`, `constructEstimates` and
`processIndex` register what they return against the contract they came from, and each one refuses
input that is not the registered value for the same contract (`AOS_UNDERIVED_INPUT`). The rows are
frozen as well as registered: the freeze stops them being edited in place between the stage that
produced them and the stage that consumes them, and the registration stops a replacement being
handed over in their place.

**`estimateCell` takes a cell id, not a cell.** It looks the cell up in the sealed contract. Taking
the object from the caller meant taking its `credit_bearing`, its minimum and its missing policy
from the caller too, so a cell resting on the agent's own account of itself could be handed in
claiming credit and the number came back without the contract ever being consulted. An id that is
not in the contract throws `AOS_UNKNOWN_CELL`.

- `subcheckMapping()` is the flat table: one row per subcheck, with `cell_id`, `construct_id`,
  `axis`, `authority`, `scoring_rule_id`, `credit_bearing`. Eighty rows, and the count is pinned in
  the artifact rather than inferred.
- `contractDigests()` returns a digest per artifact plus `combined`, over the canonical form. This
  is what a result quotes.
- `subcheckMapping()` rows carry `form_id`: the single form that administers that subcheck, not the
  forms that touch its cell. Ownership sits on the subcheck because a cell can hold subchecks two
  families produce, and the per-form opportunity counts partition the eighty only when counted this
  way.
- `opportunitiesOf(observations)` refuses anything `lib/metrics.mjs` would not call an observation.
  Each one is rebuilt from its own parts through `observationOf`, checked against the header it
  arrived with (`AOS_INCONSISTENT_OBSERVATION` -- a metric that answers four questions and files
  itself as unobserved is a forgery, and `validateObservations` skips the verifier and reason checks
  for anything whose `state` reads `NOT_OBSERVED`), refused if it answers anything without naming a
  verifier (`AOS_UNATTRIBUTED_OBSERVATION` -- an opportunity with no verifier identity is an
  assertion, not an observation), and only then validated as the rebuilt thing, where every problem
  is fatal except "absent from the result".
  Each row then carries `verifier_id`, `evidence_ids` and an `observation_digest`, and each cell
  estimate carries `bound_to`, the distinct observations it rests on. That is the binding #560 needs;
  the rows used to arrive stripped of it.
- `evaluate(observations, context)` takes the observations `lib/observe.mjs` produces. `context`
  carries `forms_completed`, `facets` and `profile_digest`; passing any prohibited value
  source throws `AOS_PROHIBITED_VALUE_SOURCE`. `forms_completed` must name declared forms and may
  not repeat one (`AOS_UNKNOWN_FORM`, `AOS_DUPLICATE_FORM`) -- "completed exactly once" is an
  assumption in the interpretation argument and was checked with `.includes`. The result also
  carries `unsupported_forms`: a form named as completed whose declared cells produced no answer
  does not support `PROFILE_BOUND`, and the run drops to `RUN_DIAGNOSTIC` -- as does a run that did
  not name its profile, which is listed in `unidentified_facets`. The result is frozen.
- `comparability(left, right)` takes two results `evaluate` emitted -- anything else throws
  `AOS_UNEMITTED_RESULT`, because reading the facets off any object let a caller edit the facets a
  result was scored under and ask again. **The policy is the contract those results were scored
  under**, recovered from the results themselves; the third argument is optional and must be that
  same contract or the call throws `AOS_CONTRACT_MISMATCH`. It used to apply whichever sealed
  contract the caller supplied, so a clone with `invariance-required` deleted -- which verifies,
  nothing in it is invalid -- compared two shipped results across models as though the gate had
  never been written. Two results from two different contracts refuse with
  `CONTRACT_IDENTITY_DIFFERS` before any policy is consulted. It enforces **every** declared
  comparability rule, not the ones with a particular status: the artifact's `ENFORCED` profile-identity rule over `operator` and
  `occasion` gated nothing while the implementation filtered on `UNESTABLISHED`, so two runs by two
  different people compared as one measurement. Each rule names its own `refusal_reason`, so the
  refusals are `CONTRACT_IDENTITY_DIFFERS`, `PROFILE_IDENTITY_DIFFERS` and
  `INVARIANCE_UNESTABLISHED`, and `FACETS_UNDECLARED` when either side did not declare a gated
  facet. `contract_digest` is one of those facets and is derived from the contract rather than
  supplied, so two results scored under different contracts are refused and a caller cannot declare
  its way past the gate.

## What this contract does not do

It does not replace `lib/scorer-v1.mjs`. Legacy results keep their dimensions, weights and bands and
are rendered as historical rather than recomputed. Nothing issued from this contract carries a
category, cut score, percentile, rank or band; those fields exist on the result and are null.

That is a statement about this contract, and the interpretation argument now says so in those words.
An earlier draft assumed "no category, band, cut score, percentile or rank is emitted at any stage"
and recorded the evidence as passing, which was a true claim about the contract published as a false
one about the product: `lib/scorer-v1.mjs` still assigns a category to a legacy result, and
`lib/cli.mjs`, `lib/report.mjs`, `lib/report-card.mjs` and `lib/dashboard.mjs` render it. The
artifact carries a `legacy_band_surface` block naming all five modules, the modules excluded from it
by name and why, and the issue that owns the removal (#568). A test scans `lib/` in both directions
and fails if the disclosure and the source ever disagree -- checking only that every declared module
carries a band is the easy direction, and it passed while three of those five were undeclared.

It does not define what a profile is. `evaluate` takes `context.profile_digest` and does not compute
one: #559 owns the profile shape and its aggregation, and a digest of something this module invented
would be worse than none. What this contract does do is require one and compare it. `profile_digest`
is a declared facet gated by the `profile-identity` rule, so two results under different profiles are
refused; and `PROFILE_BOUND` requires every facet the comparability rules gate to be declared, so a
run that names no profile drops to `RUN_DIAGNOSTIC` and lists what it did not name in
`unidentified_facets`. The stage is defined as performance observed "under one exact profile and
measurement contract", and it was previously issued from form completion and coverage alone -- a
profile-bound claim with a null profile is a contradiction in a field name.

The identity the stage requires is read from the same rules `comparability` uses, so the two cannot
drift apart: a result that could not be compared with another under the same profile has no business
claiming it was measured under one.

The six `declared_opportunity_count` values are derived from the subchecks each form administers and
checked against them, and they partition the eighty exactly. Counted per cell they summed to
eighty-four, because `C6.SL.01` holds two of `M06`'s subchecks from FAM-2 and one of `M19`'s from
FAM-6. The cell lists still overlap there, so each form names the cells it shares in
`shared_opportunity_cell_ids`: read as disjoint, they double count that cell.
