# SSOT → ADR → PRD → ticket traceability

| SSOT contract | ADRs | PRDs | Tickets |
|---|---|---|---|
| Identity, OSS/local-first, claims | 0001, 0002, 0003 | D0, E13, E14 | D0-001…004, E13-001…002, E14-001…003 |
| Construct and Opportunity Profile | 0004 | E0-A, E1, E10 | E0A-001…003, E1-001…003, E10-001…003 |
| M01–M20, issuance, score, M19 | 0005, 0006 | E0-A, E2 | E0A-001…003, E2-001…005 |
| Adapter observability and session class | 0007 | E0-B, E4, E9 | E0B-001…003, E4-001…004, E9-001…003 |
| Isolation, privacy, integrity | 0008 | E3 | E3-001…004 |
| Pack budget and FAM-4/5/6-first sequence | 0009 | E0-C, E5–E8 | E0C-001…003, E5-001…E8-004 |
| One lever and retest attribution | 0010 | E0-D, E10, E11 | E0D-001…003, E10-003, E11-001…003 |
| G0–G4 validation and pivot | 0011 | E2, E7, E12, E14 | E2-005, E7-004, E12-001…003, E14-003 |
| Step gates and exact-head evidence | 0012 | all | all 65 tickets |
| Deterministic metric scoring contract | 0004, 0005, 0006 | E0-A, E2 | E0A-001…003, E2-001…005 |
| Post-run oracle and actor attribution | 0007, 0008 | E1, E3, E4, E9 | E1-001…003, E3-001…004, E4-001…004, E9-001…003 |

## Completeness rule

The target semantic graph is `PRD requirement → PRD acceptance criterion → ticket → ticket acceptance criterion → test file → named test case`, with one owning ADR/PRD and zero orphans. D0-004 owns future enforcement of that graph, issue-map/manifest agreement, and canonical identity consistency. The pre-implementation Gate Administration Control Plane owns gate-record lifecycle, exact-digest binding, and invalidation; D0-004 may consume its independently validated output but cannot administer or approve it.

The current `scripts/validate-planning.mjs` is deliberately narrower: it checks the authored ADR/PRD/ticket census, status shape, ticket IDs/dependencies, issue-manifest IDs, required planning surfaces, and a computed product-code census outside an explicit control-plane allowlist. It delegates gate-record structure to the independent Gate Administration checker. It **does not yet** semantically enforce the target graph, orphan count, or identity agreement; it reports those checks as `not_yet_enforced`.
