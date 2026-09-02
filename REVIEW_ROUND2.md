- Missing facet declarations now yield `FACETS_UNDECLARED` ([line 691](</private/tmp/rv-598b/lib/ecd-contract.mjs:691>)).
- The 80-subcheck invariant checks declared length, distinct length, and owner-map size ([line 353](</private/tmp/rv-598b/lib/ecd-contract.mjs:353>)).
- `CONTRACT_SPECIFIED` minimums must resolve to a clause with the same numeric value ([line 310](</private/tmp/rv-598b/lib/ecd-contract.mjs:310>)).
- The two over-wide claims are deferred and forced unpopulated ([line 321](</private/tmp/rv-598b/lib/ecd-contract.mjs:321>)).
- The legacy band surface and FAIL entry exist.

But the verifier introduced two additional custom-contract holes:

- Changing only `cells.contract_version` to `"9.9.9"` still gives `checkEcdContract(...).ok === true`; schemas merely require semver ([schema](</private/tmp/rv-598b/contracts/schemas/aos-observable-cell.v1.schema.json:11>)). `evaluate` then reports the hard-coded API version instead of the mixed artifact version ([line 748](</private/tmp/rv-598b/lib/ecd-contract.mjs:748>)).
- Replacing `claim_stages` with three PROFILE_BOUND clones passes schema and sealing because the schema requires only `minItems: 3`, not the exact unique stages ([schema](</private/tmp/rv-598b/contracts/schemas/aos-interpretation-use-argument.v1.schema.json:16>)). `evaluate([], ...)` then crashes when `.find(...).definition` is undefined ([line 751](</private/tmp/rv-598b/lib/ecd-contract.mjs:751>)).

## 6. Release-contract attempts

The results were:

- No bands/cut scores: violated by the legacy scorer and CLI.
- `PROFILE_BOUND` ceiling: held for outputs that complete normally; `evaluate` emits only `RUN_DIAGNOSTIC` or `PROFILE_BOUND` ([line 746](</private/tmp/rv-598b/lib/ecd-contract.mjs:746>)).
- `UNESTABLISHED` generalizability: held, though it is hard-coded rather than derived ([line 753](</private/tmp/rv-598b/lib/ecd-contract.mjs:753>)).
- Below-minimum → null/`INSUFFICIENT_OPPORTUNITIES`: held with genuine arrays, but was violated with the branded Proxy described above ([line 590](</private/tmp/rv-598b/lib/ecd-contract.mjs:590>)).
- Stronger-model-only counterfactual: held; changing only `context.facets.model` does not change operator-process arithmetic. That guarantee is not yet evidentially useful because unauthenticated observation booleans can populate the operator-process cells.

Comparability has a separate direct violation. The artifact marks operator and occasion as an `ENFORCED` profile-identity rule ([line 89](</private/tmp/rv-598b/contracts/aos-interpretation-use-argument.v1.json:89>)), but the implementation considers only rules whose status is `UNESTABLISHED` ([line 689](</private/tmp/rv-598b/lib/ecd-contract.mjs:689>). Two results identical on language/interface/model/runtime/harness but with `operator: "alice", occasion: 1` versus `operator: "bob", occasion: 2` returned `comparable: true`.

Results from two different contract digests also compare true when their gated facets match. Moreover, the final result is mutable: changing `result.facet_coverage.declared.model` after evaluation can flip comparability from false to true ([result construction](</private/tmp/rv-598b/lib/ecd-contract.mjs:748>)).

## 7. Downstream API readiness

The API is not stable enough for the four named dependents:

- #559 owns result schema/profile aggregation and requires a result-schema digest ([governance](</private/tmp/rv-598b/governance/v0.2.0-execution-plan.json:322>)). The current result lacks the promised profile digest and `validation_evidence_digest`; the latter is already shown in the validity contract ([VALIDITY_ARGUMENT](</private/tmp/rv-598b/docs/VALIDITY_ARGUMENT.md:148>)).
- #560 requires `opportunity_binding` ([governance](</private/tmp/rv-598b/governance/v0.2.0-execution-plan.json:363>)), but `opportunitiesOf` strips the evidence and verifier identity it would have to bind.
- #564 owns suite forms ([governance](</private/tmp/rv-598b/governance/v0.2.0-execution-plan.json:510>)), but must reach below whole-cell form counts to recover actual subcheck ownership.
- #584 owns facet/generalizability gates ([governance](</private/tmp/rv-598b/governance/v0.2.0-execution-plan.json:1145>)), but must work around ignored ENFORCED facets, mutable results, and absent contract/profile identity comparison.

## 8. Tests and documentation

All 92 focused tests pass. I also injected every one of the 24 `lib/ecd-contract.mjs` mutations from the manifest in memory; every named test failed. There is no manifest `to` mutation that survives its named test.

Several test names and documentation claims remain stronger than their assertions:

- “No estimate can be produced from a contract nobody checked” tests only plain unbranded objects ([test](</private/tmp/rv-598b/tests/product/ecd-aggregation.test.mjs:274>)); it misses Symbol forgery.
- “Derived rows cannot be edited” tests direct mutation only ([line 316](</private/tmp/rv-598b/tests/product/ecd-aggregation.test.mjs:316>)); it misses Proxy substitution.
- The band test proves that every declared module contains the word `band`, not that every emitting module is declared ([test](</private/tmp/rv-598b/tests/product/ecd-shortcuts.test.mjs:71>)). Removing `lib/cli.mjs` from the disclosure while leaving `lib/scorer-v1.mjs` makes the test and verifier pass even though the CLI still emits the band.
- The interpretation argument says there are six counterfactual tests ([line 126](</private/tmp/rv-598b/contracts/aos-interpretation-use-argument.v1.json:126>)); there are five named counterfactual tests.
- “Completed exactly once” is an assumption ([line 171](</private/tmp/rv-598b/contracts/aos-interpretation-use-argument.v1.json:171>)), but `forms_completed` is checked only with `.includes`; duplicates are accepted ([line 730](</private/tmp/rv-598b/lib/ecd-contract.mjs:730>)).
- The docs’ claims that no call order can issue the index and that unsealed artifacts cannot reach arithmetic are disproved by the Proxy and Symbol inputs ([ECD_CONTRACT](</private/tmp/rv-598b/docs/ECD_CONTRACT.md:65>), [seal description](</private/tmp/rv-598b/docs/ECD_CONTRACT.md:109>)).
- “Profile digest and contract digest are recorded” is marked PASS ([line 178](</private/tmp/rv-598b/contracts/aos-interpretation-use-argument.v1.json:178>)), but only the contract digest is emitted.
- “The thirteen fields” lists fourteen ([docs](</private/tmp/rv-598b/docs/ECD_CONTRACT.md:20>)).

The blockers before merge are: replace property brands with identity-based capabilities, validate and bind observations, enforce exact artifact versions and claim-stage membership, correct subcheck-to-form ownership, enforce all comparability rules plus contract/profile identity, and align the evidence/document claims with what is actually checked.

[exited with code 0]
