# AgentOps Score atomic ticket index

Every implementation issue maps to one section in a feature ticket file. The common contract below is normative for every ticket; a ticket-specific rule can only narrow it.

## Common execution contract

1. Pin the exact base SHA and governing ADR/PRD before RED.
2. Own only the listed files and symbols. Stop on overlap or an unlisted required file.
3. Capture the named RED and its expected failure before minimum GREEN.
4. Keep acceptance-to-test traceability one-to-one. Run focused, full, package/release, and manual/live lanes where listed.
5. A candidate-head change invalidates focused/full/build/artifact/manual/review/CI evidence affected by that change; rerun before completion.
6. Stop on ambiguity, wrong target, unobservable required evidence, unsafe permission, timeout without terminal state, partial state, or silent fallback.
7. Completion evidence is: exact head, diff paths, RED log, GREEN focused log, full log, artifact digest when applicable, manual/LIVE_NA justification, security/privacy result, review verdict, and CI URL.

## Dependency graph

```text
T-001 ─┬─> T-003 ─┬─> T-501 ─> T-502 ─┬─> T-505 ─> T-601 ─> T-603 ─> T-701 ─> T-703 ─> T-802 ─> T-803 ─> T-804 ─> T-805
       ├─> T-002 ─┼─> T-101 ─> T-102 ─> T-103 ─> T-201 ─> T-202 ─> T-203 ─> T-204 ─> T-301 ─> T-302 ─> T-303
       └─> T-004 ─┘                                  └─> T-401 ─┬─> T-402 ─┬─> T-404 ─> T-505
                                                                    └─> T-403 ─┘
T-501 ─> T-503 ─┐
T-501 ─> T-504 ─┴─> T-505
T-601 ─> T-602
T-601 ─> T-604
T-701 ─> T-702 ─> T-703
T-103 ─> T-801
```

Critical path: `T-001 → T-003 → T-101 → T-102 → T-103 → T-201 → T-202 → T-203 → T-204 → T-301 → T-302 → T-303 → T-401 → T-402/T-403 → T-404 → T-501 → T-502/T-503/T-504 → T-505 → T-601 → T-603 → T-701 → T-703 → T-802 → T-803 → T-804 → T-805`.

## Feature files

- [F0 Preflight contracts](F0-preflight-contracts.md)
- [F1 Schemas](F1-trace-result-schemas.md)
- [F2 Scorer and fixtures](F2-scorer-and-fixtures.md)
- [F3 Isolated runner](F3-isolated-runner.md)
- [F4 Runtime adapters](F4-runtime-adapters.md)
- [F5 Form A](F5-form-a.md)
- [F6 Reports and Snapshot](F6-report-and-snapshot.md)
- [F7 Form B and improvement](F7-form-b-and-improvement.md)
- [F8 Validation and public OSS](F8-validation-and-public-oss.md)

