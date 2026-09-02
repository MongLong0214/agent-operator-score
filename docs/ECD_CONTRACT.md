# The AOS evidence-centred design contract

> Artifacts: `contracts/*.json`, schemas in `contracts/schemas/`, logic in `lib/ecd-contract.mjs`
> Verified by: `npm run verify:ecd-contract`, and by `npm test` like everything else

A metric title is not a construct. This contract is what says which construct each of the eighty
`M01–M20` subchecks stands for, on whose authority the observation may be reported, what else could
have produced it, and what happens when it is absent.

## The five artifacts

| Artifact | File | What it settles |
|---|---|---|
| `aos-observable-cell.v1` | `contracts/aos-observable-cells.v1.json` | The 35 cells, each with its thirteen fields and the subchecks it owns, and the pinned count of subchecks the mapping claims |
| `aos-construct-map.v1` | `contracts/aos-construct-map.v1.json` | C1–C7, which cells stand for each on which axis, and the one index |
| `aos-evidence-model.v1` | `contracts/aos-evidence-model.v1.json` | Axes, authorities, scoring rules, missing policies, facets, prohibited value sources |
| `aos-task-model.v1` | `contracts/aos-task-model.v1.json` | What each form administers, and which opportunity sources are declared but not administered |
| `aos-interpretation-use-argument.v1` | `contracts/aos-interpretation-use-argument.v1.json` | Scoring → within-cycle generalization → extrapolation → use, with each link's status |

## The thirteen fields every scored cell carries

`construct_id`, `axis`, `claim`, `deferred_claim`, `observable`, `task_opportunity`, `authority`,
`rival_explanations`, `minimum_opportunities`, `minimum_opportunities_basis`,
`minimum_opportunities_source`, `scoring_rule_id`, `missing_policy`, `facet_identity`. A cell
missing any of them fails the schema; a cell whose authority the evidence model does not define
fails `checkEcdContract`.

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
argument to `processIndex`, and no order of calls, that issues a value from this contract.

Two cells rest on the agent's own account of its behaviour with no effect to check it against
(`C6.PB.01`, `C6.IJ.02`). Both are `credit_bearing: false` and required by nothing. Safety credit
comes from `C6.SL.01`, which observes bytes.

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
failure list attached rather than returning it. On success it deep-copies, deep-freezes and brands
the artifacts. A contract that has not been through it cannot reach any of the arithmetic: the
functions above throw `AOS_UNVERIFIED_CONTRACT`. This is why the boundary is structural and not a
convention -- the rules in `checkEcdContract` include the one refusing credit to a cell whose only
authority is the agent's account of itself, and while the steps were exported raw that rule bound
only callers who chose to run the verifier.

**The stages are chained, not composable by hand.** `cellEstimates`, `constructEstimates` and
`processIndex` brand what they return with the digest of the contract they came from, and each one
refuses input that does not carry the brand of the same contract (`AOS_UNDERIVED_INPUT`). The rows
are frozen as well as branded, because a brand alone would let a caller take real estimates, flip a
`NOT_OBSERVED` to `ISSUED`, and pass them on still carrying a digest they no longer describe.

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
- `evaluate(observations, context)` takes the observations `lib/observe.mjs` produces. `context`
  carries `forms_completed` and `facets`; passing any prohibited value source throws
  `AOS_PROHIBITED_VALUE_SOURCE`. `forms_completed` is a caller's claim, so the result also carries
  `unsupported_forms`: a form named as completed whose declared cells produced no answer does not
  support `PROFILE_BOUND`, and the run drops to `RUN_DIAGNOSTIC`.
- `comparability(left, right)` takes two results from `evaluate` and reads their facets from
  `facet_coverage.declared`. It refuses a comparison across language, interface, model, runtime or
  harness until invariance evidence exists, and refuses one where either side declared no facets at
  all (`FACETS_UNDECLARED`) rather than reading two absences as a match.

## What this contract does not do

It does not replace `lib/scorer-v1.mjs`. Legacy results keep their dimensions, weights and bands and
are rendered as historical rather than recomputed. Nothing issued from this contract carries a
category, cut score, percentile, rank or band; those fields exist on the result and are null.

That is a statement about this contract, and the interpretation argument now says so in those words.
An earlier draft assumed "no category, band, cut score, percentile or rank is emitted at any stage"
and recorded the evidence as passing, which was a true claim about the contract published as a false
one about the product: `lib/scorer-v1.mjs` still assigns a category to a legacy result and
`lib/cli.mjs` still prints it. The artifact carries a `legacy_band_surface` block naming those two
modules and the issue that owns their removal (#568), and a test fails if the disclosure and the
source files ever disagree.

It also does not tell you how many opportunities a form is worth as a share of the product. The six
`declared_opportunity_count` values are derived from the cells each form administers and checked
against them, and they sum to eighty-four over eighty subchecks, because `C6.SL.01` is administered
by FAM-2 and FAM-6 and `C5.TC.01` by FAM-4 and FAM-5. Each form names the cells it shares in
`shared_opportunity_cell_ids`; read as a partition, the six numbers double count five subchecks.
