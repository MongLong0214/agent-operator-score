```

That directly violates “agent self-report is not operator action.” Issues #559/#560 cannot safely consume this API without independently rebuilding the authority boundary.

3. Blocker — claim-stage and comparability gates trust incompatible, unvalidated shapes.

[evaluate](/private/tmp/rv-598/lib/ecd-contract.mjs:547) derives `PROFILE_BOUND` solely from caller-supplied form names. This returns `PROFILE_BOUND`, no incomplete forms, and zero issued cells:

```js
evaluate([], {
  forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"]
})
```

Additionally, `evaluate` stores facets under `facet_coverage.declared` at [line 568](/private/tmp/rv-598/lib/ecd-contract.mjs:568), while [comparability](/private/tmp/rv-598/lib/ecd-contract.mjs:517) reads top-level fields. Passing two actual emitted results—one `{language:"en", model:"m1"}`, another `{language:"ko", model:"m2"}`—returns `comparable:true`. `comparability({}, {})` also returns true. The test at [ecd-interpretation-use.test.mjs:82](/private/tmp/rv-598/tests/product/ecd-interpretation-use.test.mjs:82) passes hand-built bare facet objects, not result objects, so it misses the public-API failure. This is a release blocker for #584.

4. Blocker — the asserted no-band evidence is currently false.

The interpretation argument records “no category, band, cut score, percentile or rank is emitted at any stage” and marks the evidence PASS at [aos-interpretation-use-argument.v1.json:286](/private/tmp/rv-598/contracts/aos-interpretation-use-argument.v1.json:286). The live scorer still defines bands at [scorer-v1.mjs:47](/private/tmp/rv-598/lib/scorer-v1.mjs:47), emits one at [line 192](/private/tmp/rv-598/lib/scorer-v1.mjs:192), and the CLI prints it at [cli.mjs:1169](/private/tmp/rv-598/lib/cli.mjs:1169). Twenty passing observations produce:

```json
{"issued":true,"status":"SCORED","score":{"raw":100,"final":100,"band":"HIGH RELIABILITY"}}
```

The new documentation explicitly preserves legacy bands at [ECD_CONTRACT.md:73](/private/tmp/rv-598/docs/ECD_CONTRACT.md:73). Even if #568 removes them later, #582 cannot honestly record this evidence as PASS now.

5. High — the shipped mapping is 80/80, but `checkEcdContract` does not prove the claimed cardinality.

The current artifacts contain 80 distinct fully qualified IDs and 80 distinct mapping rows. The shared names are handled correctly:

- `M11.failure-class-correct` → `C3.ER.01`; `M18.failure-class-correct` → `C4.FD.01`.
- `M09.invocation-budget-respected` → `C2.IB.01`; `M20.invocation-budget-respected` → `C6.EB.01`.

However, the verifier converts declared IDs to a `Set` at [ecd-contract.mjs:235](/private/tmp/rv-598/lib/ecd-contract.mjs:235) without checking that the set still contains 80 entries. Concrete mutation: duplicate one subcheck name inside M01, remove the displaced fully qualified mapping, and adjust that cell’s coverage minimum. `declaredSubcheckIds()` then reports length 80 but only 79 unique IDs, while `checkEcdContract` returns `{ok:true}`. The standalone test at [ecd-construct-map.test.mjs:41](/private/tmp/rv-598/tests/product/ecd-construct-map.test.mjs:41) catches the shipped state, but the verifier consumed by dependent issues does not establish the advertised invariant.

6. High — at least one cell minimum is unsupported, and form minimums are unchecked.

[C3.RA.01](/private/tmp/rv-598/contracts/aos-observable-cells.v1.json:921) declares `minimum_opportunities: 4` with basis `CONTRACT_SPECIFIED`, but gives no source clause or locator. The verifier merely checks that it is an integer at [ecd-contract.mjs:214](/private/tmp/rv-598/lib/ecd-contract.mjs:214): changing it to `99` still returns `{ok:true}`. The test named “no minimum claims a precision basis” at [ecd-evidence-model.test.mjs:80](/private/tmp/rv-598/tests/product/ecd-evidence-model.test.mjs:80) never examines `CONTRACT_SPECIFIED`.

The form-level `minimum_opportunity_count` values are not checked at all; changing FAM-1’s `12` at [aos-task-model.v1.json:78](/private/tmp/rv-598/contracts/aos-task-model.v1.json:78) to `999` also passes. Worse, cross-form cells cause misleading counts: FAM-2’s 13 includes `M19.no-secret-leak`, which FAM-6 produces, while FAM-6’s 14 includes two M06 checks produced by FAM-2. #564 cannot rely on these as form opportunity counts.

7. High — “withheld by construction” is true only through one call path.

With the shipped contract, `evaluate` does withhold the index. But [processIndex](/private/tmp/rv-598/lib/ecd-contract.mjs:489) is exported and documented, accepts unauthenticated construct rows, and issues a value. The repository’s own test at [ecd-aggregation.test.mjs:197](/private/tmp/rv-598/tests/product/ecd-aggregation.test.mjs:197) supplies six synthetic rows and obtains:

```json
{"status":"ISSUED","value":0.75}
```

So [ECD_CONTRACT.md:40](/private/tmp/rv-598/docs/ECD_CONTRACT.md:40) overstates the guarantee. Keep this helper private or require validated cell-derived rows carrying the contract digest.

8. Medium — two declared operator authorities cannot observe their full claims.

[C5.VD.01](/private/tmp/rv-598/contracts/aos-observable-cells.v1.json:1609) uses `operator-authored-plan`, but claims both a pre-run verification requirement and the later act of refusing an unsupported completion. A plan cannot observe the later refusal.

[C6.OG.01](/private/tmp/rv-598/contracts/aos-observable-cells.v1.json:2014) uses the same authority while claiming permissions and budget were not widened mid-run. That requires run-event authority as well. These cells are currently unpopulated, so they do not emit values yet, but #560 would have to reach past or revise this contract to implement them.

The public surface is therefore neither minimal nor stable: raw `estimateCell`, `constructEstimates`, and `processIndex` bypass validation; emitted results do not fit `comparability`; and the comment above [loadEcdContract](/private/tmp/rv-598/lib/ecd-contract.mjs:57) says it accepts a directory although its signature accepts none.

I could not break the current 80-row mapping, the null/`INSUFFICIENT_OPPORTUNITIES` behavior, the two self-report cells’ non-credit status, the `UNESTABLISHED` generalizability default, or the zero-runtime-dependency constraint. All 11 added mutation `to` substitutions appear to break their named tests, although several stronger claims above have no mutation guard. The focused contract suite passed 79/79; the full suite could not be meaningfully rerun in this read-only sandbox because temp-directory tests hit `EPERM`.

[exited with code 0]
