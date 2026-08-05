# ADR-0001: AgentOps Score identity and operational vocabulary

- Status: Accepted (2026-08-05, owner-supplied FINAL north-star)
- Owner: CEO

## Context

Identity must be stable before repository and package surfaces exist. Availability checks returned HTTP 404 for both `agentops-score` on npm and `MongLong0214/AgentOps-Score` on GitHub. npm package `aos` exists but declares no CLI binary, and no local `aos` executable is present.

## Decision

- Product: **AgentOps Score**; abbreviation: **AOS**.
- Repository: `AgentOps-Score`; package: `agentops-score`; CLI: `aos`; local state: `.aos/`.
- Public sentence: “We score how well you operate agents in a declared environment—not the model alone.”
- The design is independent. External systems supply evidence, not inherited protocol vocabulary.

| Term | Meaning | Value grammar | Consumer route |
|---|---|---|---|
| Opportunity Profile | Declared environment available to the operator | versioned object with runtime/model/harness/tool/permission/budget digests | comparison guard and report header |
| Evidence coverage | Eligible scored evidence divided by required evidence | `[0,1]`, report as whole percent | score issuance gate |
| Safety state | Least-privilege and external-action outcome | `S0|S1|S2|S3` | hard score gate |
| Evidence status | Strength of result claim | `ESTIMATE|PROVISIONAL|INSUFFICIENT_EVIDENCE|UNSAFE|INVALID|CALIBRATED` | report renderer and export policy |
| Opportunity | A sealed chance to observe a metric | scenario ID + metric ID + eligibility facts | metric denominator |
| One lever | Single registered treatment chosen for retest | metric ID + treatment ID + cost | sprint and Form B |

## Rejected

- `AgentOps Benchmark`: implies model/system benchmarking rather than a human operator assessment.
- `AI Operator Score`: broader than the frozen coding-agent domain and easier to confuse with vendor products.
- `aos` as the npm package name: already occupied; the binary remains usable because that package exposes no bin.

## Consequences

Any rename requires a superseding ADR. Existing decision history is never mechanically rewritten.
