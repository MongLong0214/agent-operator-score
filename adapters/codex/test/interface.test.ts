import assert from "node:assert/strict";
import { describe, test } from "node:test";

const ABSENT = "runner and adapter have no total lifecycle/error/capability contract.";

type FailureCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_SOURCE"
  | "SCHEMA_MISMATCH"
  | "INVALID_STATE"
  | "TIMED_OUT"
  | "SINK_FULL";
type Failure = {
  ok: false;
  reason: string;
  error: { code: FailureCode };
  terminal?: "TIMED_OUT" | "CANCELLED";
};
type Success<Value> = { ok: true; value: Value };
type Result<Value> = Success<Value> | Failure;
type Session = { id: string; state: "RUNNING" | "STOPPED" | "CANCELLED" | "TIMED_OUT" };
type Capability = {
  runtime_version: string;
  protocol_or_schema_version: string;
  adapter_version: string;
  source_class: "PRIMARY";
  supported_event_groups: string[];
  known_missing_events: string[];
};
type Adapter = {
  discover: () => Result<Capability>;
  start: (input: unknown) => Result<Session>;
  event: (input: unknown) => Result<{ correlationId: string; sequence: number }>;
  stop: (input: unknown) => Result<Session>;
  cancel: (input: unknown) => Result<Session>;
  capabilities: () => Result<Capability>;
  digest: () => Result<string>;
};
type CodexFactory = (input: unknown) => Result<Adapter>;

// A missing contract must fail at each named case instead of stopping discovery before its oracle runs.
const loadCodex = async () => {
  try {
    return await import("../src/index.ts");
  } catch {
    return {};
  }
};

const codexFactory = async (): Promise<CodexFactory> => {
  const mod = await loadCodex();
  assert.equal(typeof mod.CodexAdapter, "function", ABSENT);
  return mod.CodexAdapter as CodexFactory;
};

const accepted = <Value>(result: Result<Value>): Value => {
  assert.equal(result.ok, true, ABSENT);
  if (!result.ok) throw new Error(ABSENT);
  return result.value;
};

const total = (adapter: Adapter): Adapter => {
  assert.equal(typeof adapter.discover, "function", ABSENT);
  assert.equal(typeof adapter.start, "function", ABSENT);
  assert.equal(typeof adapter.event, "function", ABSENT);
  assert.equal(typeof adapter.stop, "function", ABSENT);
  assert.equal(typeof adapter.cancel, "function", ABSENT);
  assert.equal(typeof adapter.capabilities, "function", ABSENT);
  assert.equal(typeof adapter.digest, "function", ABSENT);
  return adapter;
};

const refused = (result: Result<unknown>, code: FailureCode): Failure => {
  assert.equal(result.ok, false, ABSENT);
  if (result.ok) throw new Error(ABSENT);
  assert.equal(result.error.code, code, ABSENT);
  return result;
};

const schemaDigest = "a".repeat(64);
const source = (overrides: Record<string, unknown> = {}) => ({
  transport: "app-server-stdio-json-rpc",
  schemaDigest,
  ...overrides
});
const controls = (terminates = true) => {
  let terminated = false;
  let terminateCalls = 0;
  return {
    control: {
      terminate: () => {
        terminateCalls += 1;
        if (terminates) terminated = true;
      },
      observe: () => (terminated ? "TERMINATED" : "RUNNING")
    },
    terminateCalls: () => terminateCalls
  };
};
const adapterInput = (control: ReturnType<typeof controls>["control"], overrides: Record<string, unknown> = {}) => ({
  installedSchemaDigest: schemaDigest,
  source: source(),
  runtimeVersion: "0.1.0",
  protocolOrSchemaVersion: "app-server-v1",
  adapterVersion: "0.0.0",
  supportedEventGroups: ["run_lifecycle", "tool_call"],
  knownMissingEvents: ["plan_state"],
  eventSinkLimit: 2,
  control,
  ...overrides
});

describe("interface", () => {
test("lifecycle-happy", async () => {
  const create = await codexFactory();
  const worker = controls();
  const adapter = total(accepted(create(adapterInput(worker.control))));

  accepted(adapter.discover());
  const session = accepted(adapter.start({ taskId: "task-1", correlationId: "correlation-1" }));
  refused(adapter.event({ sessionId: session.id, correlationId: "wrong", group: "tool_call" }), "INVALID_REQUEST");
  refused(adapter.event({ sessionId: session.id, correlationId: "correlation-1", group: "unsupported" }), "INVALID_REQUEST");
  accepted(adapter.event({ sessionId: session.id, correlationId: "correlation-1", group: "tool_call" }));
  accepted(adapter.event({ sessionId: session.id, correlationId: "correlation-1", group: "tool_call" }));
  refused(adapter.event({ sessionId: session.id, correlationId: "correlation-1", group: "tool_call" }), "SINK_FULL");

  const cancelled = accepted(adapter.cancel({ sessionId: session.id }));
  assert.equal(cancelled.state, "CANCELLED", ABSENT);
  refused(adapter.event({ sessionId: session.id, correlationId: "correlation-1", group: "tool_call" }), "INVALID_STATE");
});

test("start-fail", async () => {
  const create = await codexFactory();
  const worker = controls();
  const adapter = total(accepted(create(adapterInput(worker.control))));

  refused(adapter.start({ taskId: "", correlationId: "correlation-1" }), "INVALID_REQUEST");
  const session = accepted(adapter.start({ taskId: "task-1", correlationId: "correlation-1" }));
  assert.equal(session.state, "RUNNING", ABSENT);
});

test("stop-timeout", async () => {
  const create = await codexFactory();
  const stoppedWorker = controls();
  const stoppingAdapter = total(accepted(create(adapterInput(stoppedWorker.control))));
  const stoppingSession = accepted(stoppingAdapter.start({ taskId: "task-stop", correlationId: "correlation-stop" }));
  const stopped = accepted(stoppingAdapter.stop({ sessionId: stoppingSession.id }));
  assert.equal(stopped.state, "STOPPED", ABSENT);
  assert.equal(stoppedWorker.terminateCalls(), 1, ABSENT);

  const timedOutWorker = controls(false);
  const timingOutAdapter = total(accepted(create(adapterInput(timedOutWorker.control))));
  const timingOutSession = accepted(timingOutAdapter.start({ taskId: "task-timeout", correlationId: "correlation-timeout" }));
  const timeout = refused(timingOutAdapter.stop({ sessionId: timingOutSession.id }), "TIMED_OUT");
  assert.equal(timeout.terminal, "TIMED_OUT", ABSENT);
  refused(timingOutAdapter.stop({ sessionId: timingOutSession.id }), "INVALID_STATE");
  assert.equal(timedOutWorker.terminateCalls(), 1, ABSENT);
});

test("double-stop", async () => {
  const create = await codexFactory();
  const worker = controls();
  const adapter = total(accepted(create(adapterInput(worker.control))));
  const session = accepted(adapter.start({ taskId: "task-1", correlationId: "correlation-1" }));

  const stopped = accepted(adapter.stop({ sessionId: session.id }));
  assert.equal(stopped.state, "STOPPED", ABSENT);
  refused(adapter.stop({ sessionId: session.id }), "INVALID_STATE");
  assert.equal(worker.terminateCalls(), 1, ABSENT);
});

test("capability-digest", async () => {
  const create = await codexFactory();
  const worker = controls();
  const complete = total(accepted(create(adapterInput(worker.control, { knownMissingEvents: [] }))));
  const missing = total(accepted(create(adapterInput(worker.control, { knownMissingEvents: ["plan_state"] }))));
  const changedRuntime = total(accepted(create(adapterInput(worker.control, {
    runtimeVersion: "0.1.1",
    knownMissingEvents: []
  }))));
  const changedProtocol = total(accepted(create(adapterInput(worker.control, {
    protocolOrSchemaVersion: "app-server-v2",
    knownMissingEvents: []
  }))));
  const changedAdapter = total(accepted(create(adapterInput(worker.control, {
    adapterVersion: "0.0.1",
    knownMissingEvents: []
  }))));
  const changedGroups = total(accepted(create(adapterInput(worker.control, {
    supportedEventGroups: ["run_lifecycle"],
    knownMissingEvents: []
  }))));

  assert.deepEqual(accepted(complete.capabilities()), {
    runtime_version: "0.1.0",
    protocol_or_schema_version: "app-server-v1",
    adapter_version: "0.0.0",
    source_class: "PRIMARY",
    supported_event_groups: ["run_lifecycle", "tool_call"],
    known_missing_events: []
  }, ABSENT);
  assert.deepEqual(accepted(missing.capabilities()), {
    runtime_version: "0.1.0",
    protocol_or_schema_version: "app-server-v1",
    adapter_version: "0.0.0",
    source_class: "PRIMARY",
    supported_event_groups: ["run_lifecycle", "tool_call"],
    known_missing_events: ["plan_state"]
  }, ABSENT);
  const completeDigest = accepted(complete.digest());
  assert.equal(completeDigest, "e0db13ac531aa5c6e87386e792cddb4e1ed5b98fddc7843bc33f0301c9abf561", ABSENT);
  assert.notEqual(completeDigest, accepted(missing.digest()), ABSENT);
  assert.notEqual(completeDigest, accepted(changedRuntime.digest()), ABSENT);
  assert.notEqual(completeDigest, accepted(changedProtocol.digest()), ABSENT);
  assert.notEqual(completeDigest, accepted(changedAdapter.digest()), ABSENT);
  assert.notEqual(completeDigest, accepted(changedGroups.digest()), ABSENT);
});

test("primary-source-boundary", async () => {
  const create = await codexFactory();
  const worker = controls();
  const permitted = total(accepted(create(adapterInput(worker.control))));
  accepted(permitted.discover());

  refused(create(adapterInput(worker.control, { source: source({ transport: "websocket" }) })), "UNSUPPORTED_SOURCE");
  refused(create(adapterInput(worker.control, { source: source({ schemaDigest: "b".repeat(64) }) })), "SCHEMA_MISMATCH");
  refused(create(adapterInput(worker.control, { installedSchemaDigest: "not-a-digest" })), "INVALID_REQUEST");
});
});
