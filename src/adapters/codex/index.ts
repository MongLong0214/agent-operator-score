import { createHash } from "node:crypto";
import { ADAPTER_REFUSAL } from "../types.ts";
import type {
  AdapterCapabilities,
  AdapterError,
  AdapterEvent,
  AdapterFailure,
  AdapterResult,
  AdapterSession,
  RuntimeAdapter
} from "../types.ts";

type Source = { transport: string; schemaDigest: string };
type Control = { terminate: () => unknown; observe: () => unknown };
type Settings = {
  capabilities: AdapterCapabilities;
  eventSinkLimit: number;
  control: Control;
};
type StoredSession = AdapterSession & { correlationId: string; events: AdapterEvent[] };

const fail = (code: AdapterError["code"], terminal?: "TIMED_OUT" | "CANCELLED"): AdapterFailure => ({
  ok: false,
  reason: ADAPTER_REFUSAL,
  error: { code },
  ...(terminal === undefined ? {} : { terminal })
});

const succeed = <Value>(value: Value): AdapterResult<Value> => ({ ok: true, value });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

const stringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const entry of value) {
    if (!isFilledString(entry)) return null;
    values.push(entry);
  }
  values.sort();
  return new Set(values).size === values.length ? values : null;
};

const sourceOf = (value: unknown): Source | null => {
  if (!isPlainRecord(value) || !isFilledString(value.transport) || !isDigest(value.schemaDigest)) return null;
  return { transport: value.transport, schemaDigest: value.schemaDigest };
};

const controlOf = (value: unknown): Control | null => {
  if (!isPlainRecord(value) || typeof value.terminate !== "function" || typeof value.observe !== "function") return null;
  return { terminate: value.terminate as () => unknown, observe: value.observe as () => unknown };
};

const settingsOf = (input: unknown): Settings | AdapterFailure => {
  if (!isPlainRecord(input)) return fail("INVALID_REQUEST");
  if (!isDigest(input.installedSchemaDigest)) return fail("INVALID_REQUEST");
  const source = sourceOf(input.source);
  if (source === null) return fail("INVALID_REQUEST");
  if (source.transport !== "app-server-stdio-json-rpc") return fail("UNSUPPORTED_SOURCE");
  if (source.schemaDigest !== input.installedSchemaDigest) return fail("SCHEMA_MISMATCH");

  const supported = stringList(input.supportedEventGroups);
  const missing = stringList(input.knownMissingEvents);
  const control = controlOf(input.control);
  if (
    !isFilledString(input.runtimeVersion) ||
    !isFilledString(input.protocolOrSchemaVersion) ||
    !isFilledString(input.adapterVersion) ||
    supported === null ||
    missing === null ||
    !Number.isSafeInteger(input.eventSinkLimit) ||
    input.eventSinkLimit < 1 ||
    control === null
  ) {
    return fail("INVALID_REQUEST");
  }

  return {
    capabilities: {
      runtime_version: input.runtimeVersion,
      protocol_or_schema_version: input.protocolOrSchemaVersion,
      adapter_version: input.adapterVersion,
      source_class: "PRIMARY",
      supported_event_groups: supported,
      known_missing_events: missing
    },
    eventSinkLimit: input.eventSinkLimit,
    control
  };
};

const copyCapabilities = (capabilities: AdapterCapabilities): AdapterCapabilities => ({
  runtime_version: capabilities.runtime_version,
  protocol_or_schema_version: capabilities.protocol_or_schema_version,
  adapter_version: capabilities.adapter_version,
  source_class: capabilities.source_class,
  supported_event_groups: [...capabilities.supported_event_groups],
  known_missing_events: [...capabilities.known_missing_events]
});

const copySession = (session: AdapterSession): AdapterSession => ({ id: session.id, state: session.state });

const capabilityDigest = (capabilities: AdapterCapabilities): string =>
  createHash("sha256")
    .update(JSON.stringify({
      runtime_version: capabilities.runtime_version,
      protocol_or_schema_version: capabilities.protocol_or_schema_version,
      adapter_version: capabilities.adapter_version,
      source_class: capabilities.source_class,
      supported_event_groups: capabilities.supported_event_groups,
      known_missing_events: capabilities.known_missing_events
    }))
    .digest("hex");

const startInput = (input: unknown): { taskId: string; correlationId: string } | null => {
  if (!isPlainRecord(input) || !isFilledString(input.taskId) || !isFilledString(input.correlationId)) return null;
  return { taskId: input.taskId, correlationId: input.correlationId };
};

const sessionIdOf = (input: unknown): string | null =>
  isPlainRecord(input) && isFilledString(input.sessionId) ? input.sessionId : null;

const eventInput = (input: unknown): { sessionId: string; correlationId: string; group: string } | null => {
  if (!isPlainRecord(input) || !isFilledString(input.sessionId) || !isFilledString(input.correlationId) || !isFilledString(input.group)) {
    return null;
  }
  return { sessionId: input.sessionId, correlationId: input.correlationId, group: input.group };
};

const terminalState = (control: Control): "TERMINATED" | "RUNNING" | null => {
  try {
    control.terminate();
    const observed = control.observe();
    return observed === "TERMINATED" || observed === "RUNNING" ? observed : null;
  } catch {
    return null;
  }
};

const controlledAdapter = (settings: Settings): RuntimeAdapter => {
  let nextSession = 1;
  const sessions = new Map<string, StoredSession>();

  const discover = (): AdapterResult<AdapterCapabilities> => succeed(copyCapabilities(settings.capabilities));

  const start = (input: unknown): AdapterResult<AdapterSession> => {
    const request = startInput(input);
    if (request === null) return fail("INVALID_REQUEST");
    const session: StoredSession = {
      id: `codex-${nextSession}`,
      state: "RUNNING",
      correlationId: request.correlationId,
      events: []
    };
    nextSession += 1;
    sessions.set(session.id, session);
    return succeed(copySession(session));
  };

  const event = (input: unknown): AdapterResult<AdapterEvent> => {
    const request = eventInput(input);
    if (request === null) return fail("INVALID_REQUEST");
    const session = sessions.get(request.sessionId);
    if (session === undefined || session.state !== "RUNNING") return fail("INVALID_STATE");
    if (request.correlationId !== session.correlationId || !settings.capabilities.supported_event_groups.includes(request.group)) {
      return fail("INVALID_REQUEST");
    }
    if (session.events.length >= settings.eventSinkLimit) return fail("SINK_FULL");
    const recorded: AdapterEvent = { correlationId: request.correlationId, sequence: session.events.length + 1 };
    session.events.push(recorded);
    return succeed({ ...recorded });
  };

  const stop = (input: unknown): AdapterResult<AdapterSession> => {
    const sessionId = sessionIdOf(input);
    if (sessionId === null) return fail("INVALID_REQUEST");
    const session = sessions.get(sessionId);
    if (session === undefined || session.state !== "RUNNING") return fail("INVALID_STATE");
    if (terminalState(settings.control) !== "TERMINATED") {
      session.state = "TIMED_OUT";
      return fail("TIMED_OUT", "TIMED_OUT");
    }
    session.state = "STOPPED";
    return succeed(copySession(session));
  };

  const cancel = (input: unknown): AdapterResult<AdapterSession> => {
    const sessionId = sessionIdOf(input);
    if (sessionId === null) return fail("INVALID_REQUEST");
    const session = sessions.get(sessionId);
    if (session === undefined || session.state !== "RUNNING") return fail("INVALID_STATE");
    if (terminalState(settings.control) !== "TERMINATED") {
      session.state = "TIMED_OUT";
      return fail("TIMED_OUT", "TIMED_OUT");
    }
    session.state = "CANCELLED";
    return succeed(copySession(session));
  };

  const capabilities = (): AdapterResult<AdapterCapabilities> => succeed(copyCapabilities(settings.capabilities));

  const digest = (): AdapterResult<string> => succeed(capabilityDigest(settings.capabilities));

  return { discover, start, event, stop, cancel, capabilities, digest };
};

export const CodexAdapter = (input: unknown): AdapterResult<RuntimeAdapter> => {
  const settings = settingsOf(input);
  if ("ok" in settings) return settings;
  return succeed(controlledAdapter(settings));
};
