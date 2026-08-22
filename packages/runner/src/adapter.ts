export const ADAPTER_REFUSAL = "runtime adapter refused the request.";

export type AdapterError = {
  code:
    | "INVALID_REQUEST"
    | "UNSUPPORTED_SOURCE"
    | "SCHEMA_MISMATCH"
    | "INVALID_STATE"
    | "TIMED_OUT"
    | "SINK_FULL";
};

export type AdapterFailure = {
  ok: false;
  reason: typeof ADAPTER_REFUSAL;
  error: AdapterError;
  terminal?: "TIMED_OUT" | "CANCELLED";
};

export type AdapterSuccess<Value> = { ok: true; value: Value };

export type AdapterResult<Value> = AdapterSuccess<Value> | AdapterFailure;

export type AdapterSession = {
  id: string;
  state: "RUNNING" | "STOPPED" | "CANCELLED" | "TIMED_OUT";
};

export type AdapterEvent = { correlationId: string; sequence: number };

export type AdapterCapabilities = {
  runtime_version: string;
  protocol_or_schema_version: string;
  adapter_version: string;
  source_class: "PRIMARY";
  supported_event_groups: string[];
  known_missing_events: string[];
};

export interface RuntimeAdapter {
  discover: () => AdapterResult<AdapterCapabilities>;
  start: (input: unknown) => AdapterResult<AdapterSession>;
  event: (input: unknown) => AdapterResult<AdapterEvent>;
  stop: (input: unknown) => AdapterResult<AdapterSession>;
  cancel: (input: unknown) => AdapterResult<AdapterSession>;
  capabilities: () => AdapterResult<AdapterCapabilities>;
  digest: () => AdapterResult<string>;
}
