# `verify --run` acceptance semantics — both sides of the boundary

Written because six remediation passes specified this verifier by counterexample: each round added a
narrower prohibition against the latest forgery, and round 6 crossed into rejecting honest artifacts.
Two independent outside reviews reached the same diagnosis — the loop had one obligation (reject
unsupported claims) and not its pair (accept supported ones). This table is the missing half.

## The rule the table encodes

    A claim is ACCEPTED when it is supported by evidence this verifier can recompute.
    A claim is REJECTED when it asserts more than the recomputable evidence supports.
    A record from a superseded generation is NAMED, never accused.
    A legitimate non-success outcome is a supported claim, not a missing one.

"Not successful" and "not supported" are different facts. The verifier's job is the second.

## #584 evidence-to-issuance path

The authoritative consumer is `aos assess`: it creates the scored observations before it calls
`evaluate`, persists the canonical result, and is the only path whose result the report and
`aos verify --run` read. The implementation therefore carries evidence in this direction:

    run manifest + locked form binding + resolved model/profile + runtime/verifier facts
      -> one contract-digest-bound facet record on every scored observation
      -> re-derived profile, uncertainty, and generalizability decisions
      -> persisted result -> shared projection -> verifier and exit outcome

At the issuance entry point, the contract digest is derived from the sealed ECD contract, the
profile digest from the resolved run profile, and each observation receives its form/family, cell,
model, runtime, verifier, language, interface and non-private identity facts. Raw operator identity
is never emitted; an unavailable operator or occasion remains `null`. A facet record also carries
the contract digest under which it was made. Its presence alone is not authority: the issuer and
verifier re-check that digest against the contract being used.

`evaluate` derives three decisions from those records and calibration evidence, rather than taking
a stored verdict: exact-profile eligibility; whether registered uncertainty prerequisites support
an interval; and whether a declared universe has prospective empirical calibration. `buildResult`
persists the evidence and only the derived public consequences. The shared report projection prints
those consequences. `aos verify --run` derives them again from the stored observations, their facet
records, calibration evidence, and the shipped contract; it does not endorse the stored stage,
interval, or generalizability word merely because it is present. Its `ok` and exit outcome are
derived from the re-derived three-state decision.

The entry-point counterfactual is explicit: an absent or contract-mismatched required facet record
withholds `PROFILE_BOUND`; a missing statistical prerequisite yields `interval: null` and
`INSUFFICIENT_DATA`; absent universe or prospective calibration evidence refuses the elevated
generalizability claim. Those outcomes are evidence-preserving results, not errors to be filled
with a plausible number.

## Cases that MUST be accepted

| # | artifact | why it is honest | verifier must |
|---|---|---|---|
| A1 | current generation, complete probe, capabilities scored | every binding recomputes | PASS, scored |
| A2 | current, probe ran and exhibited nothing (exit 0, 0 answers) | AOS observed a clean run with no exhibition | PASS as a record; capability question WITHHELD |
| A3 | current, probe cut off mid-trial (exit != 0, N of 8 answered) | AOS observed an incomplete trial | PASS as a record; WITHHELD; retryable |
| A4 | current, runtime refused before spawn | AOS observed its own refusal to spawn | PASS as a record; WITHHELD; **not** retryable by probing |
| A5 | previous probe generation (v2), internally consistent | written by a build that no longer exists | ACCEPT as a record, **named as superseded**, and report its claims **UNVERIFIABLE-by-this-build** — never "forged", and never "verified" |
| A6 | no probe at all, `aos-known` source | the default posture | PASS; capability question WITHHELD |
| A7 | all scored observations carry exact, contract-digest-bound facet records; locked forms and exact profile are complete, but population calibration is absent | this build observed a profile, not a population | accept `PROFILE_BOUND`; report `UNESTABLISHED`, `INSUFFICIENT_DATA`, and `interval: null` (implements #584) |
| A8 | a registered calibration scaffold has no population data | the scaffold is present without pretending to be an empirical result | accept the artifact; variance components and interval are `null`, and generalizability remains `UNESTABLISHED` (implements #584) |
| A9 | no D-study recommendation is available | the configured operational count is an operational default | accept it when labelled `operational default`, never a psychometric minimum (implements #584) |

A2, A3 and A4 are three different facts and must stay distinguishable in the record. A4 is the one
that must not be called retryable: probing again cannot fix a runtime that will not start.

## Cases that MUST be rejected

| # | tamper | why it is unsupported |
|---|---|---|
| R1 | `capabilities[].source` `aos-known` -> `detected` | claims an observation that never happened |
| R2 | `capabilities[].basis` `unmeasured-owner` -> `measured` | same, one field over |
| R3 | `observables[].pass` `null` -> `true` | claims an answer the oracle did not give |
| R4 | `minimum.status` -> `SOLVED` | claims a route computation that did not run |
| R5 | stored probe outcome edited to claim completion | claims A1 while the evidence says A2/A3/A4 |
| R6 | stored delegation output edited to claim a state | same shape, delegation subtree |
| R7 | an estimate inserted into a withheld `C2.RF.01` | claims a number the cell withheld |
| R8 | O4 / Outcome Index / Composite flipped to issued alone | claims issuance without its predicate |
| R9 | `NO_SCORABLE_OWNER` reason deleted | removes the record of why, leaving a bare withhold |
| R10 | remove a required facet record or replace its contract digest | a persisted record cannot authorize itself or a different instrument | withhold `PROFILE_BOUND`; verification re-derives the refusal (implements #584) |
| R11 | same operator paired with an easier task, or with a stronger model | task and model variation is not a person effect | retain distinct task/model facets; reject an elevated person/general claim (implements #584) |
| R12 | second occasion/practice, stricter verifier for the same response, or the same translated form | occasion, verifier drift, and language invariance are distinct prerequisites | retain the facet difference and withhold the direct comparison or elevated claim (implements #584) |
| R13 | three perfect uncalibrated forms, or a declared universe with no population data | perfection in local forms is not prospective empirical calibration | refuse `GENERALIZABILITY_SUPPORTED`; retain `UNESTABLISHED` (implements #584) |
| R14 | insert an interval, reliability coefficient, or variance component without a registered method and its prerequisites | a made-up precision claim is not a conservative default | reject the artifact; the honest value is `null` with `INSUFFICIENT_DATA` (implements #584) |
| R15 | an LLM rater self-report is the only claimed calibration authority | a rater cannot certify itself | withhold the rater-derived claim (implements #584) |
| R16 | prompt/token length, turn count, wall-clock/model latency, tool count, or agent autonomy reaches operator Process credit | these are O4 descriptive outcomes, not operator Process evidence | reject the credit path while retaining descriptive reporting (implements #584) |
| R17 | label `operational_default_form_count` as a psychometric minimum | an operational fallback is not a calibration result | reject the emitted label (implements #584) |

## A5 x R5 — the row this table was missing

A superseded record that has been **tampered with** is indistinguishable from an honest one, because
this build cannot recompute the bindings of a generation it no longer speaks. Round 2 found exactly
that: with A5 accepting superseded records, a superseded probe could authorize its own persisted
status and completion claim after editing.

That is my omission, not the implementer's. The table had A5 and R5 and never said what happens where
they meet.

The answer is the discipline this release has already applied three times — **verified / contradicted
/ not-checked** — one level up:

    a superseded record is NOT-CHECKED, never VERIFIED

So it is accepted as a record and named as superseded, and **none of its claims are endorsed**. It
cannot authorize a status, a completion, or a scored capability, because nothing this build can run
supports them. Tampering with it changes nothing, which is the point: a record that authorizes
nothing cannot be forged into authorizing something.

This is not a rejection. A superseded record is still readable, still reportable, and still says what
it says — it simply does not carry authority into a build that cannot check it. "We cannot check
this" and "this is a forgery" stay different sentences, and so do "we cannot check this" and "this is
fine".

## The aggregate — the second cell this table was missing

Naming a per-claim answer is not enough if the run-level answer collapses it. Round 2 found that a
superseded artifact still authorizes itself to any consumer reading the verifier's **exit status** or
**top-level `ok`**, because those did not carry the third state.

This is the same trap #624 hit one level down: `NOT_CHECKED` is a truthy string, and an `every(...)`
over the claims read it as confirmed. Here it is the aggregation rather than the reduction, and the
consequence is worse, because exit status is what a script reads.

    state: verified       ok / exit 0    every claim VERIFIED
    state: contradicted   not ok / exit 5 any claim CONTRADICTED
    state: unresolved     not ok / exit 4 any claim NOT-CHECKED and none contradicted

The third state must be distinguishable from both, at the exit status and in the payload. It is not
success: nothing was established. It is not failure: nothing was refuted. A verifier that answers
this question with two values will always report one of those two lies. In particular, a run whose
probe record is from a superseded generation returns `state: "unresolved"`, `ok: false`, and exit 4.

**NOT-CHECKED must never aggregate as verification success.** That single sentence is the rule; the
rest of this section is why.

Consequence to state plainly rather than bury: a run whose probe record is from a superseded
generation does not verify. That is correct and it is the price of A5 — the record is still readable
and still named, and this build simply cannot vouch for it. Reporting that honestly is the whole
point of accepting it as a record in the first place.

## The distinction that decides every row

    recomputable binding disagrees with the claim  -> REJECT
    recomputable binding is absent for this generation -> NAME the generation, do not reject
    record is internally consistent and reports a non-success outcome -> ACCEPT and report the outcome

Round 6's two regressions were both the middle row treated as the first: a v2 record whose bindings
this build cannot recompute was rejected as forged (A5), and a refusal-before-spawn whose fact the
persisted projection had dropped was rejected because it could not be reconstructed (A4). In both,
the verifier lacked the evidence rather than the artifact lacking support.

## What this constrains in the fix

- A4 needs a persisted, independently checkable refusal fact. It must satisfy G12: no provider stderr
  body, no absolute path, no transcript. AOS refused to spawn — that is AOS's own observation and can
  be recorded as a class without quoting anything the provider said.
- A5 needs the verification to be generation-aware. `capabilityProbeGeneration` already returns
  CURRENT / SUPERSEDED / UNKNOWN, and #624/#626 established the "named, not accused" shape for result
  generations. Reuse it rather than inventing a second answer.
- Every accepted row must be a test. Every rejected row already is. The absence of the accept-side
  tests is why six passes could each be locally correct and jointly wrong.

## Removal condition

This document exists because the verifier was specified by counterexample. It can go once the accept
and reject rows are both covered by tests in the repository — at that point the tests are the
specification and this is a duplicate.
