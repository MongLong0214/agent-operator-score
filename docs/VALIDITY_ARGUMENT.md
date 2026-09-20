# AOS Interpretation and Use Argument

> Version: draft v1 for v0.2.0 implementation  
> Authority: Epic #573 and issues #582, #584, #585, #586

## Intended use

AOS v0.2.0 is intended for:

```text
local self-diagnosis
profile-bound feedback
tracking change under the same exact measurement profile and contract
identifying specific operating-process weaknesses
```

It is not intended for:

```text
hiring or promotion
certification
population ranking
cross-model or cross-language comparison without invariance evidence
universal prediction of coding-agent performance
```

## Inference chain

### 1. Scoring inference

**Claim:** Canonical events/effects and task oracles are converted into the declared observable cells correctly.

Required evidence:

- exact event and evidence schemas;
- trusted verifier boundary;
- raw-byte evidence;
- deterministic scorer contract;
- counterfactual and mutation tests;
- missing evidence represented as `NOT_OBSERVED`.

Principal rebuttals:

- agent self-report substituted for an observed effect;
- operator action forged by the agent;
- task oracle leaked or mismatched;
- verifier/rater bias;
- unsupported partial credit.

### 2. Generalization within the administered cycle

**Claim:** The completed locked forms summarize the sampled profile conditions.

Required evidence:

- every locked form completed exactly once;
- exact profile and measurement-contract identity;
- operational forms distinct from warmup/practice;
- form exposure tracked;
- opportunity/coverage/spread/uncertainty visible.

Principal rebuttals:

- cherry-picking successful forms;
- practice or memorization;
- materially unequal form difficulty;
- model/runtime drift;
- occasion effects.

Maximum stage without further evidence:

```text
PROFILE_BOUND
```

### 3. Extrapolation to a defined task universe

**Claim:** The profile predicts performance across a specified universe of coding-agent operating situations.

Required evidence:

- explicit universe definition;
- G-study or suitable hierarchical facet model;
- D-study design;
- task/form linking and anchors;
- task, model, occasion, verifier, language, and interface variance;
- sufficient calibration data;
- conditional uncertainty.

Principal rebuttals:

- narrow task-family coverage;
- person × task/model interactions;
- domain familiarity;
- interface or translation effects;
- sparse or unrepresentative calibration sample.

Without this evidence:

```text
generalizability_status = UNESTABLISHED
```

### 4. Use inference

**Claim:** The result supports the intended decision without unacceptable adverse consequences.

Required evidence:

- validation registry;
- fair/invariant interpretation for the target population and interface;
- classification evidence if categories are ever introduced;
- misuse and consequence audit;
- clear uncertainty and forbidden-use copy.

Principal rebuttals:

- score gaming;
- overconfidence induced by a high number;
- accessibility or language disadvantage;
- misuse in hiring/certification;
- cognitive-forcing burden changing the construct;
- privacy/security harm.

## Claim decision table

| Evidence state | Maximum public claim |
|---|---|
| Scoring contract incomplete | `EXPERIMENTAL` |
| Deterministic instrument and ECD contract complete | `INSTRUMENT_READY` |
| Exact profile, all locked operational forms, visible uncertainty | `PROFILE_BOUND` |
| Calibrated universe, facets, invariance, prospective validation | `GENERALIZABILITY_SUPPORTED` |
| Standard setting absent | No ability band, rank, percentile, or certification at any stage |

## Required result fields

```json
{
  "claim_stage": "PROFILE_BOUND",
  "permitted_interpretation": "...",
  "forbidden_uses": [],
  "generalizability_status": "UNESTABLISHED",
  "uncertainty": {
    "status": "INSUFFICIENT_DATA",
    "method": null
  },
  "facet_coverage": {},
  "validation_evidence_digest": "sha256:...",
  "standard_setting": null
}
```

## Release rule

A technically successful v0.2.0 may release at `PROFILE_BOUND` with `GENERALIZABILITY UNESTABLISHED`, provided:

- the use is restricted to local self-diagnosis;
- no unsupported band/rank/certification is emitted;
- all observed claims have traceable evidence;
- uncertainty and limitations are visible;
- the actual STRICT zero-context E2E is complete.

The last of these is what `fixtures/confinement/strict-canary.json` (`aos-strict-canary.v1`, #639)
and its gate exist to establish. `npm run verify:real-runtime-strict` is the measurement -- it needs
an authenticated darwin host with Seatbelt and the installed Codex runtime, and it writes the record
only under `AOS_STRICT_CANARY_UPDATE_FIXTURE=1` (`npm run verify:real-runtime-strict:update-fixture`),
so an ordinary re-run cannot silently replace a good record with a rate-limited one.
`npm run verify:release-canary` is the decision: it reads the committed record and refuses to call it
release evidence unless the record's headline claims -- the profile digest, the escape-attempt
result, the observation timestamp -- agree with the embedded evidence they were built from, and that
embedded evidence itself passes `issuanceGate`. It runs as the `release-canary` job in
`.github/workflows/ci.yml`, on `main` and on demand, for the same reason `execution-plan-live` is not
a required PR check: an ordinary PR does not update the canary, and running this only where a release
is actually cut is what makes it a check on the release rather than noise on every PR. Absent or
unaccepted blocks; nothing here attests that a sandbox-exec process ran on real hardware beyond who
was allowed to write the file (see `releaseCanaryGate`'s own doc comment in `lib/confinement.mjs`).

A release must not silently promote itself to a general human-ability test.
