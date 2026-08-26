import { CODEX_CONTROLLED_EVENT_REFUSAL, normalizeCodexEvent } from "./normalize.ts";

type Failure = { ok: false; reason: typeof CODEX_CONTROLLED_EVENT_REFUSAL };
type Success = { ok: true; events: Record<string, unknown>[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const refuse = (): Failure => ({ ok: false, reason: CODEX_CONTROLLED_EVENT_REFUSAL });

export const runCodexControlled = (input: unknown): Success | Failure => {
  if (!isRecord(input) || !isRecord(input.capability_snapshot)) return refuse();
  const runId = stringValue(input.run_id);
  const correlationId = stringValue(input.correlation_id);
  const identity = stringValue(input.identity);
  const timestamp = stringValue(input.timestamp);
  const taskId = input.task_id;
  if (
    runId === null || correlationId === null || identity === null || timestamp === null ||
    !(taskId === undefined || taskId === null || stringValue(taskId) !== null)
  ) {
    return refuse();
  }

  const common = {
    source: "wrapper",
    run_id: runId,
    task_id: taskId ?? null,
    correlation_id: correlationId,
    identity,
    timestamp,
    parent_id: null
  };
  const nativeEvents = [
    { type: "assessment.started" },
    { type: "adapter.capability_declared", payload: input.capability_snapshot },
    { type: "assessment.ended" }
  ];
  const events: Record<string, unknown>[] = [];
  for (const native of nativeEvents) {
    const result = normalizeCodexEvent({ ...common, native });
    if (!result.ok) return refuse();
    events.push(result.event);
  }
  return { ok: true, events };
};
