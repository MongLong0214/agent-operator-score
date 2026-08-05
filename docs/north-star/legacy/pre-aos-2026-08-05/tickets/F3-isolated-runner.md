# F3 tickets — Isolated runner

> PRD: `docs/prd/PRD-F3-isolated-runner.md` · ADR: 0004, 0007 · Milestone: M2

## T-301 Implement fresh workspace lifecycle (L)

- **Ownership:** `packages/runner/src/workspace.ts` — `prepareWorkspace`, `verifyWorkspace`, `disposeWorkspace`; tests under `packages/runner/test/workspace`.
- **Preconditions/dependencies:** T-204.
- **Forbidden:** user working-tree mutation, symlink escape, inherited untracked files, cleanup outside the allocated root, mutable base after digest.
- **RED:** injected symlink and dirty-base cases are accepted or touch the wrong target.
- **Minimum GREEN:** explicit-root temp workspace, canonical-path containment, base digest, immutable source snapshot, pre/post census, recoverable cleanup policy.
- **AC ↔ tests:** AC-F3-1 ↔ clean clone, dirty base, symlink escape, wrong root, interrupted setup, cross-run residue.
- **Verification:** focused runner workspace tests; full/build; manual filesystem census before/after. No destructive cleanup outside test temp roots.
- **Invalidation/stop/evidence:** path or lifecycle change invalidates all isolation evidence; stop on unresolved realpath or partial setup. Evidence includes temp-root census and no-touch canary.

## T-302 Separate worker, oracle, and secrets (L)

- **Ownership:** `packages/runner/src/process-boundary.ts` — `spawnWorker`, `spawnOracle`; `packages/runner/src/policy.ts` — `buildWorkerPolicy`.
- **Preconditions/dependencies:** T-301.
- **Forbidden:** oracle path/env in worker, inherited credentials, shared writable IPC, oracle verdict from worker payload, silent sandbox downgrade.
- **RED:** worker can read oracle canary or inherited secret and still receive a valid run.
- **Minimum GREEN:** separate process env/cwd/descriptor allowlists, oracle-only mount/path, secret redaction canaries, typed `INVALID` on boundary breach.
- **AC ↔ tests:** AC-F3-1 ↔ oracle-read denied, env secret absent, descriptor closed, IPC spoof rejected, sandbox-unavailable fail-closed.
- **Verification:** focused boundary tests on macOS/Linux CI; full/build; manual adversarial path and env probes.
- **Invalidation/stop/evidence:** process/policy change invalidates security lane; any oracle/secret access is S3 and blocks release. Evidence includes denial events with values redacted.

## T-303 Enforce budgets, faults, retry, and terminal states (L)

- **Ownership:** `packages/runner/src/budget.ts` — `BudgetLedger`; `faults.ts` — `FaultPlan`; `state-machine.ts` — `transitionRun`; `idempotency.ts`.
- **Preconditions/dependencies:** T-302.
- **Forbidden:** silent fallback, label “enforced” for observed-only budget, duplicate terminal event, retry without idempotency key, timeout without process reconciliation.
- **RED:** duplicate retry creates two effects; killed worker remains RUNNING; same seed yields different fault opportunities.
- **Minimum GREEN:** versioned seeded faults, atomic ledger, watchdog, process reconciliation, exactly-one terminal transition, idempotent effect registry.
- **AC ↔ tests:** AC-F3-2/3 ↔ duplicate effect, timeout-kill, stall/resume, cancel race, partial checkpoint, same-seed replay, observed-only token budget label.
- **Verification:** focused state-machine property tests; fault replay twice; full/build; manual process-tree no-leak check.
- **Invalidation/stop/evidence:** state/fault/idempotency change invalidates runner and Form timing evidence; stop on orphan process or ambiguous terminal reason. Evidence includes ledger and replay digest.
