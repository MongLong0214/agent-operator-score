# Operational-state fixtures

Fixture-backed inputs for `scripts/resolve-execution-state.mjs` (D0-004B).

- `current-baseline/facts.json` — frozen baseline: D0-001 `verified`, D0-002 `gate_preparation`/`blocked`, `readySet=[]`.
- Mutants are constructed in `tests/execution-state.test.mjs` by cloning and patching the baseline facts (stale digest, ownership overlap, external unavailable, wrong target, review/authorization, candidate CI, bootstrap).

Projection surfaces (`roadmap`, `board`, `ledger`) may appear in facts for non-input regression only; the resolver never reads them for readiness.
