## DEFECTS

- Forgeable observations: [lib/ecd-contract.mjs:623](/private/tmp/rv-598c/lib/ecd-contract.mjs:623) trusts `validateObservations`, whose `NOT_OBSERVED` branch skips verifier/reason validation. Input:

  ```js
  {
    metric_id: "M01",
    state: "NOT_OBSERVED",
    value: null,
    verifier_id: null,
    reason: "",
    evidence_ids: [],
    subchecks: METRICS.M01.subchecks.map(id => ({ id, pass: true }))
  }
  ```

  produces four PASS opportunities. Repeating this for M01–M20 produced `PROFILE_BOUND`, 28 issued cells all estimated at `1`, and 29 bindings with `verifier_id: null`. This defeats the Round 2 observation-boundary fix.

- Comparison-policy substitution: [lib/ecd-contract.mjs:810](/private/tmp/rv-598c/lib/ecd-contract.mjs:810) discards the sealed contract’s digest, [line 815](/private/tmp/rv-598c/lib/ecd-contract.mjs:815) checks only a global result WeakSet, and [line 822](/private/tmp/rv-598c/lib/ecd-contract.mjs:822) applies whichever sealed contract’s rules the caller supplies. Concrete input: evaluate two shipped results with models `m1` and `m2`; remove `invariance-required` from a cloned contract; seal it; call `comparability(left, right, weakenedContract)`. The weakened contract passes `checkEcdContract`, and comparison returns `comparable: true`.

- Bound profile identity is ignored: [lib/ecd-contract.mjs:910](/private/tmp/rv-598c/lib/ecd-contract.mjs:910) records `profile_digest` outside the facets compared at [line 824](/private/tmp/rv-598c/lib/ecd-contract.mjs:824). Two otherwise identical emitted results with `profile_digest: "sha256:aaa"` and `"sha256:bbb"` return `comparable: true`. This is distinct from the documented decision to let #559 define the profile shape: it fails even after a non-null profile digest has been supplied.

- `PROFILE_BOUND` can be issued without any profile: [lib/ecd-contract.mjs:902](/private/tmp/rv-598c/lib/ecd-contract.mjs:902) considers only form completion/coverage. All valid observations plus all six form IDs, but no facets or `profile_digest`, yields `claim_stage: "PROFILE_BOUND"`, `profile_digest: null`, and only `contract_digest` under declared facets—while [the emitted interpretation](/private/tmp/rv-598c/lib/ecd-contract.mjs:912) claims an exact profile.

## NITS

- [ECD_CONTRACT.md:196](/private/tmp/rv-598c/docs/ECD_CONTRACT.md:196) still describes only the scorer and CLI, although the disclosure now names five modules.
- [ecd-task-model.test.mjs:171](/private/tmp/rv-598c/tests/product/ecd-task-model.test.mjs:171) and [manifest.mjs:235](/private/tmp/rv-598c/tests/mutation/manifest.mjs:235) retain the old “counts do not partition / 84 opportunities” wording; the implemented counts now partition 80.

All other concrete Round 2 reproductions are closed as described. The focused ECD suite passed 111/111 and mutation-manifest checks passed 5/5.

[exited with code 0]
