import assert from "node:assert/strict";
import { describe, test } from "node:test";

const TERMINAL = "timeout/interruption can leave nonterminal state or active child.";

type Fail = { ok: false; reason: string };
type TerminalReason =
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "TIMED_OUT"
  | "STALLED"
  | "CANCELLED"
  | "UNSAFE"
  | "INVALID"
  | "INSUFFICIENT_EVIDENCE";
type Checkpoint = { phase: "final"; id: string; digest: string; observedAt: number };
type Attribution = {
  actor: "agent" | "human/takeover" | "external_mutation" | "actor.attribution_unknown";
  event_type: string;
  provenance: string;
  path: string;
  confidence?: number;
  score_withheld?: boolean;
};
type Terminal = {
  reason: TerminalReason;
  final_checkpoint: Checkpoint;
  attribution: Attribution;
  score: "ELIGIBLE" | "WITHHELD";
  outcome: "SCORED" | "DIAGNOSTIC ONLY";
};
type MachineSnapshot = {
  state: "PENDING" | "RUNNING" | TerminalReason;
  terminal?: Terminal;
  checkpoints: Checkpoint[];
};
type Machine = {
  ok: true;
  transition: (input: unknown) => { ok: true; state: "PENDING" | "RUNNING" | TerminalReason } | Fail;
  finish: (input: unknown) => { ok: true; terminal: Terminal } | Fail;
  snapshot: () => MachineSnapshot;
};
type WatchdogVerdict = { ok: true; state: "RUNNING" | "STALLED" | "TIMED_OUT"; reason?: "STALLED" | "TIMED_OUT" };
type Watchdog = { ok: true; check: () => WatchdogVerdict | Fail };
type Process = { pid: number; groupId: string };
type Reconciliation = { ok: true; reconciled: number; remaining: number } | Fail;
type LifecycleApi = { RunStateMachine: (input: unknown) => Machine | Fail };
type WatchdogApi = { Watchdog: (input: unknown) => Watchdog | Fail };
type ReconcileApi = { reconcileProcesses: (input: unknown) => Reconciliation };

// Missing modules must leave named exports undefined. Each RED case then fails at its own pinned
// assertion instead of ending as a module-load error before the ticket contract is exercised.
const loadLifecycle = async () => {
  try {
    return await import("../src/runner/lifecycle.ts");
  } catch {
    return {};
  }
};

const loadWatchdog = async () => {
  try {
    return await import("../src/runner/watchdog.ts");
  } catch {
    return {};
  }
};

const loadReconcile = async () => {
  try {
    return await import("../src/_deferred/reconcile.ts");
  } catch {
    return {};
  }
};

const lifecycleApi = async (): Promise<LifecycleApi> => {
  const mod = await loadLifecycle();
  assert.equal(typeof mod.RunStateMachine, "function", TERMINAL);
  return mod as LifecycleApi;
};

const watchdogApi = async (): Promise<WatchdogApi> => {
  const mod = await loadWatchdog();
  assert.equal(typeof mod.Watchdog, "function", TERMINAL);
  return mod as WatchdogApi;
};

const reconcileApi = async (): Promise<ReconcileApi> => {
  const mod = await loadReconcile();
  assert.equal(typeof mod.reconcileProcesses, "function", TERMINAL);
  return mod as ReconcileApi;
};

const accepted = <Value extends { ok: boolean }>(result: Value): Exclude<Value, Fail> => {
  assert.equal(result.ok, true, TERMINAL);
  if (!result.ok) throw new Error(TERMINAL);
  return result as Exclude<Value, Fail>;
};

const refused = (result: { ok: boolean; reason?: string }): void => {
  assert.equal(result.ok, false, TERMINAL);
  if (result.ok) return;
  assert.equal(result.reason, TERMINAL, TERMINAL);
};

const started = (api: LifecycleApi, runId: string): Machine => {
  const machine = accepted(api.RunStateMachine({ runId }));
  accepted(machine.transition({ to: "RUNNING" }));
  return machine;
};

const checkpoint = (id: string, observedAt = 100): Checkpoint => ({
  phase: "final",
  id,
  digest: "a".repeat(64),
  observedAt
});

const agentAttribution = (): Attribution => ({
  actor: "agent",
  event_type: "tool.result",
  provenance: "runner-workspace-correlation",
  path: "src/app.ts"
});

const finish = (machine: Machine, reason: TerminalReason, id = `final-${reason}`) =>
  machine.finish({ reason, checkpoint: checkpoint(id), attribution: agentAttribution() });

describe("lifecycle", () => {
  test("all-terminal-states", async () => {
    const api = await lifecycleApi();
    const reasons: TerminalReason[] = [
      "PASSED",
      "FAILED",
      "BLOCKED",
      "TIMED_OUT",
      "STALLED",
      "CANCELLED",
      "UNSAFE",
      "INVALID",
      "INSUFFICIENT_EVIDENCE"
    ];

    for (const reason of reasons) {
      const terminal = accepted(finish(started(api, `terminal-${reason}`), reason));
      assert.equal(terminal.terminal.reason, reason, TERMINAL);
    }

    const once = started(api, "one-terminal-reason");
    accepted(finish(once, "PASSED"));
    refused(finish(once, "FAILED", "second-final-checkpoint"));
  });

  test("illegal-transition", async () => {
    const api = await lifecycleApi();
    const machine = accepted(api.RunStateMachine({ runId: "illegal-transition" }));
    refused(machine.transition({ to: "PENDING" }));
    accepted(machine.transition({ to: "RUNNING" }));
  });

  test("stall", async () => {
    const api = await lifecycleApi();
    const watchdogModule = await watchdogApi();
    let now = 0;
    const observation = { sequence: 1, evidenceDigest: "artifact-1", observedAt: 0 };
    const watchdog = accepted(
      watchdogModule.Watchdog({
        now: () => now,
        observeProgress: () => observation,
        stallAfterMs: 10,
        timeoutAt: 100
      })
    );

    accepted(watchdog.check());
    now = 9;
    const running = accepted(watchdog.check());
    assert.equal(running.state, "RUNNING", TERMINAL);
    now = 10;
    const stalled = accepted(watchdog.check());
    assert.equal(stalled.state, "STALLED", TERMINAL);
    assert.equal(stalled.reason, "STALLED", TERMINAL);

    const machine = started(api, "stall-observation");
    accepted(finish(machine, "STALLED"));
    refused(finish(machine, "TIMED_OUT", "late-timeout"));
  });

  // Progress must be OBSERVED, not reported. A future-dated observation is a claim the watchdog
  // cannot have seen, and accepting it lets a stalled run keep its deadline alive forever by
  // reporting progress that has not happened. Without this the timestamp guard is deletable.
  test("stall-refuses-progress-from-the-future", async () => {
    const watchdogModule = await watchdogApi();
    let now = 50;
    const ahead = { sequence: 1, evidenceDigest: "artifact-ahead", observedAt: 60 };
    const watchdog = accepted(
      watchdogModule.Watchdog({
        now: () => now,
        observeProgress: () => ahead,
        stallAfterMs: 10,
        timeoutAt: 1000
      })
    );
    refused(watchdog.check());

    // The control: the same observation at a time the watchdog could have seen is accepted, so the
    // refusal above is not satisfied by a watchdog that refuses every observation.
    const seen = accepted(
      watchdogModule.Watchdog({
        now: () => now,
        observeProgress: () => ({ sequence: 1, evidenceDigest: "artifact-seen", observedAt: 50 }),
        stallAfterMs: 10,
        timeoutAt: 1000
      })
    );
    accepted(seen.check());
  });

  test("timeout", async () => {
    const api = await lifecycleApi();
    const watchdogModule = await watchdogApi();
    let now = 0;
    let observation = { sequence: 1, evidenceDigest: "artifact-1", observedAt: 0 };
    const watchdog = accepted(
      watchdogModule.Watchdog({
        now: () => now,
        observeProgress: () => observation,
        stallAfterMs: 50,
        timeoutAt: 20
      })
    );

    accepted(watchdog.check());
    now = 19;
    observation = { sequence: 2, evidenceDigest: "artifact-2", observedAt: 19 };
    const running = accepted(watchdog.check());
    assert.equal(running.state, "RUNNING", TERMINAL);
    now = 20;
    const timedOut = accepted(watchdog.check());
    assert.equal(timedOut.state, "TIMED_OUT", TERMINAL);
    assert.equal(timedOut.reason, "TIMED_OUT", TERMINAL);

    const machine = started(api, "timeout-observation");
    accepted(finish(machine, "TIMED_OUT"));
    refused(finish(machine, "STALLED", "late-stall"));
  });

  test("cancel-race", async () => {
    const api = await lifecycleApi();
    const watchdogModule = await watchdogApi();
    const reconcileModule = await reconcileApi();
    let now = 0;
    const watchdog = accepted(
      watchdogModule.Watchdog({
        now: () => now,
        observeProgress: () => ({ sequence: 1, evidenceDigest: "artifact-1", observedAt: 0 }),
        stallAfterMs: 100,
        timeoutAt: 10
      })
    );
    const processes: Process[] = [{ pid: 41, groupId: "run-cancel" }];
    const signals: number[] = [];
    const machine = started(api, "cancel-race");

    accepted(finish(machine, "CANCELLED"));
    const reconciled = accepted(
      reconcileModule.reconcileProcesses({
        runGroupId: "run-cancel",
        listProcesses: () => processes,
        terminate: (pid: number) => {
          signals.push(pid);
          const index = processes.findIndex((process) => process.pid === pid);
          if (index >= 0) processes.splice(index, 1);
        }
      })
    );
    assert.equal(reconciled.reconciled, 1, TERMINAL);
    assert.equal(processes.length, 0, TERMINAL);

    now = 10;
    const timedOut = accepted(watchdog.check());
    assert.equal(timedOut.reason, "TIMED_OUT", TERMINAL);
    refused(finish(machine, "TIMED_OUT", "race-timeout"));
    assert.deepEqual(signals, [41], TERMINAL);
  });

  test("orphan", async () => {
    const api = await reconcileApi();
    const processes: Process[] = [
      { pid: 51, groupId: "run-owned" },
      { pid: 52, groupId: "outside-run-group" }
    ];
    const signals: number[] = [];
    const result = accepted(
      api.reconcileProcesses({
        runGroupId: "run-owned",
        listProcesses: () => processes,
        terminate: (pid: number) => {
          signals.push(pid);
          const index = processes.findIndex((process) => process.pid === pid);
          if (index >= 0) processes.splice(index, 1);
        }
      })
    );

    assert.equal(result.reconciled, 1, TERMINAL);
    assert.equal(result.remaining, 0, TERMINAL);
    assert.deepEqual(signals, [51], TERMINAL);
    assert.deepEqual(processes, [{ pid: 52, groupId: "outside-run-group" }], TERMINAL);
  });

  test("final-checkpoint", async () => {
    const api = await lifecycleApi();
    const missing = started(api, "missing-final-checkpoint");
    refused(missing.finish({ reason: "PASSED", attribution: agentAttribution() }));

    const complete = started(api, "complete-final-checkpoint");
    const terminal = accepted(finish(complete, "PASSED", "sealed-final-checkpoint"));
    const snapshot = complete.snapshot();
    assert.equal(terminal.terminal.final_checkpoint.id, "sealed-final-checkpoint", TERMINAL);
    assert.deepEqual(snapshot.checkpoints, [checkpoint("sealed-final-checkpoint")], TERMINAL);

    // Exactly one terminal reason means a second is REFUSED, not merely that one is recorded.
    // Without this the guard can be deleted and every other case still passes: the machine would
    // accept a second finish and the last writer would decide the run's outcome.
    const second = complete.finish({
      reason: "FAILED",
      checkpoint: checkpoint("second-final-checkpoint"),
      attribution: agentAttribution()
    });
    refused(second);
    const after = complete.snapshot();
    assert.equal(after.terminal?.reason, "PASSED", TERMINAL);
    assert.deepEqual(after.checkpoints, [checkpoint("sealed-final-checkpoint")], TERMINAL);
  });

  test("unknown-attribution-terminal-outcome", async () => {
    const api = await lifecycleApi();
    const unknown = started(api, "unknown-attribution");
    const terminal = accepted(
      unknown.finish({
        reason: "FAILED",
        checkpoint: checkpoint("unknown-final"),
        attribution: {
          actor: "actor.attribution_unknown",
          event_type: "actor.attribution_unknown",
          provenance: "runner-workspace-correlation",
          path: "src/app.ts",
          confidence: 0.69,
          score_withheld: true
        }
      })
    );
    assert.equal(terminal.terminal.score, "WITHHELD", TERMINAL);
    assert.equal(terminal.terminal.outcome, "DIAGNOSTIC ONLY", TERMINAL);
    assert.equal(unknown.snapshot().terminal?.attribution.actor, "actor.attribution_unknown", TERMINAL);

    const malformed = started(api, "unknown-attribution-without-withhold");
    refused(
      malformed.finish({
        reason: "FAILED",
        checkpoint: checkpoint("malformed-unknown-final"),
        attribution: {
          actor: "actor.attribution_unknown",
          event_type: "actor.attribution_unknown",
          provenance: "runner-workspace-correlation",
          path: "src/app.ts",
          confidence: 0.69
        }
      })
    );
  });
});
