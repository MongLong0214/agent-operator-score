# The AOS evidence-centred design contract

> Artifacts: `contracts/*.json`, schemas in `contracts/schemas/`, logic in `lib/ecd-contract.mjs`
> Verified by: `npm run verify:ecd-contract`, and by `npm test` like everything else

A metric title is not a construct. This contract is what says which construct each of the eighty
`M01–M20` subchecks stands for, on whose authority the observation may be reported, what else could
have produced it, and what happens when it is absent.

## The five artifacts

| Artifact | File | What it settles |
|---|---|---|
| `aos-observable-cell.v1` | `contracts/aos-observable-cells.v1.json` | The 35 cells, each with its eleven fields and the subchecks it owns |
| `aos-construct-map.v1` | `contracts/aos-construct-map.v1.json` | C1–C7, which cells stand for each on which axis, and the one index |
| `aos-evidence-model.v1` | `contracts/aos-evidence-model.v1.json` | Axes, authorities, scoring rules, missing policies, facets, prohibited value sources |
| `aos-task-model.v1` | `contracts/aos-task-model.v1.json` | What each form administers, and which opportunity sources are declared but not administered |
| `aos-interpretation-use-argument.v1` | `contracts/aos-interpretation-use-argument.v1.json` | Scoring → within-cycle generalization → extrapolation → use, with each link's status |

## The eleven fields every scored cell carries

`construct_id`, `axis`, `claim`, `observable`, `task_opportunity`, `authority`,
`rival_explanations`, `minimum_opportunities`, `scoring_rule_id`, `missing_policy`,
`facet_identity`. A cell missing any of them fails the schema; a cell whose authority the evidence
model does not define fails `checkEcdContract`.

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

Two cells rest on the agent's own account of its behaviour with no effect to check it against
(`C6.PB.01`, `C6.IJ.02`). Both are `credit_bearing: false` and required by nothing. Safety credit
comes from `C6.SL.01`, which observes bytes.

## Exported API

```js
import {
  ECD_CONTRACT_ID, ECD_CONTRACT_VERSION, AXES, CLAIM_STAGES, CELL_STATUSES, ARTIFACT_KEYS,
  loadEcdContract, loadEcdSchema, contractDigests,
  checkEcdContract,                 // { ok, failures: [{ check, detail, subject }] }
  subcheckId, declaredSubcheckIds, subcheckMapping,
  opportunitiesOf, estimateCell, cellEstimates, constructEstimates, processIndex,
  comparability, evaluate
} from "../lib/ecd-contract.mjs";
```

- `subcheckMapping()` is the flat table: one row per subcheck, with `cell_id`, `construct_id`,
  `axis`, `authority`, `scoring_rule_id`, `credit_bearing`.
- `contractDigests()` returns a digest per artifact plus `combined`, over the canonical form. This
  is what a result quotes.
- `evaluate(observations, context)` takes the observations `lib/observe.mjs` produces. `context`
  carries `forms_completed` and `facets`; passing any prohibited value source throws
  `AOS_PROHIBITED_VALUE_SOURCE`.
- `comparability(left, right)` refuses a comparison across language, interface, model, runtime or
  harness until invariance evidence exists.

## What this contract does not do

It does not replace `lib/scorer-v1.mjs`. Legacy results keep their dimensions, weights and bands and
are rendered as historical rather than recomputed. Nothing issued from this contract carries a
category, cut score, percentile, rank or band; those fields exist on the result and are null.
