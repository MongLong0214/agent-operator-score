# F4 tickets — Runtime adapters

> PRD: `docs/prd/PRD-F4-runtime-adapters.md` · ADR: 0005, 0007 · Milestone: M2

## T-401 Define adapter interface and capability doctor (L)

- **Ownership:** `packages/runner/src/adapter.ts` — `RuntimeAdapter`; `packages/cli/src/commands/doctor.ts` — `doctorCapabilities`; `adapters/conformance`.
- **Preconditions/dependencies:** T-002, T-303.
- **Forbidden:** runtime-specific field in scorer, capability without source, `BEST_EFFORT` promoted to REQUIRED at runtime, empty doctor output as success.
- **RED:** fake adapter omits identity/safety source and doctor exits zero.
- **Minimum GREEN:** typed adapter lifecycle/event/capability contract; doctor lists every matrix row, status, source, effect, digest and exits nonzero on missing REQUIRED evidence.
- **AC ↔ tests:** AC-F4-1 ↔ complete, missing-row, source-unavailable, digest-change, zero-row, and output-schema tests.
- **Verification:** `npm test -w @aos/runner -- adapter`; `aos doctor --capabilities --runtime fixture`; full/build; manual output inspection.
- **Invalidation/stop/evidence:** interface/matrix change invalidates both adapter reviews; stop on capability ambiguity. Evidence includes doctor JSON/Markdown and exit codes.

## T-402 Implement Codex adapter v0 (L)

- **Ownership:** `adapters/codex/src/index.ts` — `CodexAdapter`; `sources.ts`; `normalize.ts`; adapter tests only.
- **Preconditions/dependencies:** T-401.
- **Forbidden:** dependency on private undocumented file as mandatory surface, guessed model identity, unredacted command output, claiming unavailable context/retrieval event.
- **RED:** captured reference events fail to normalize or missing identity still permits scoring.
- **Minimum GREEN:** wrapper/native/derived sources for matrix rows, capability snapshot, lifecycle/tool/approval/evidence/claim events, bounded redaction.
- **AC ↔ tests:** AC-F4-2/3 Codex half ↔ reference log normalization, unknown model, missing tool result, approval denial, redaction, unsupported event.
- **Verification:** focused adapter fixtures; doctor command against installed runtime; full/build; manual dry run in disposable fixture repo without external action.
- **Invalidation/stop/evidence:** runtime/query/normalizer change invalidates adapter and parity evidence; stop if exact identity cannot be obtained and report blocked state. Evidence includes runtime version and normalized trace digest.

## T-403 Implement Claude Code adapter v0 (L)

- **Ownership:** `adapters/claude-code/src/index.ts` — `ClaudeCodeAdapter`; `sources.ts`; `normalize.ts`; adapter tests only.
- **Preconditions/dependencies:** T-401.
- **Forbidden:** dependency on hidden reasoning, guessed permission event, raw hook secret, claiming delegation when join evidence is absent.
- **RED:** reference hook/log events fail normalization or unavailable group is scored as failure.
- **Minimum GREEN:** wrapper/hook/derived sources, capability snapshot, identity, lifecycle/tool/permission/evidence/claim events, bounded redaction.
- **AC ↔ tests:** AC-F4-2/3 Claude half ↔ reference log normalization, unknown identity, hook gap, permission denial, delegation without join, redaction.
- **Verification:** focused fixtures; doctor command against installed runtime; full/build; manual disposable fixture run without external action.
- **Invalidation/stop/evidence:** hook/normalizer change invalidates adapter and parity evidence; stop on absent REQUIRED source. Evidence includes runtime version and normalized trace digest.

## T-404 Prove semantic parity across adapters (L)

- **Ownership:** `adapters/conformance/parity/**`; `adapters/conformance/run-parity.ts` — `runParity`.
- **Preconditions/dependencies:** T-402, T-403.
- **Forbidden:** byte-compare native logs, drop differing required semantics, normalize by deleting actor/permission meaning, one-runtime golden authority.
- **RED:** semantically equivalent reference runs produce different normalized traces or a meaningful difference is erased.
- **Minimum GREEN:** shared semantic fixture DSL, adapter-specific native inputs, canonical normalized expected traces, positive parity and negative non-parity cases.
- **AC ↔ tests:** AC-F4-2/3 ↔ lifecycle, tool error, approval, stale evidence, delegation, unavailable-event, and meaningful-difference fixtures.
- **Verification:** `npm run adapters:parity` on Node 20/24; full/build; mutate one semantic field and prove failure.
- **Invalidation/stop/evidence:** either adapter/interface/schema change invalidates parity; stop if equivalence cannot be justified in fixture contract. Evidence includes per-fixture native and normalized digests.

