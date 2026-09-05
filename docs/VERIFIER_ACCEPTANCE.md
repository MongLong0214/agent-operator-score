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

## Cases that MUST be accepted

| # | artifact | why it is honest | verifier must |
|---|---|---|---|
| A1 | current generation, complete probe, capabilities scored | every binding recomputes | PASS, scored |
| A2 | current, probe ran and exhibited nothing (exit 0, 0 answers) | AOS observed a clean run with no exhibition | PASS as a record; capability question WITHHELD |
| A3 | current, probe cut off mid-trial (exit != 0, N of 8 answered) | AOS observed an incomplete trial | PASS as a record; WITHHELD; retryable |
| A4 | current, runtime refused before spawn | AOS observed its own refusal to spawn | PASS as a record; WITHHELD; **not** retryable by probing |
| A5 | previous probe generation (v2), internally consistent | written by a build that no longer exists | PASS, **named as superseded** — never "forged" |
| A6 | no probe at all, `aos-known` source | the default posture | PASS; capability question WITHHELD |

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
