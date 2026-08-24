/**
 * Claude Code controlled wrapper lifecycle. The wrapper records start, the
 * capability snapshot, and end under one correlation id. Config values are
 * never copied into the result.
 */

import { CLAUDE_LIMITS } from "./identity.ts";
import { discoverClaudeCapabilities } from "./capabilities.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const runClaudeControlled = (input: unknown): Record<string, unknown> => {
  const record = isRecord(input) ? input : {};
  const run_id = filledString(record.run_id) ?? "run-unknown";
  const correlation_id = filledString(record.correlation_id) ?? `corr-${run_id}`;
  const surface = isRecord(record.surface) ? record.surface : {};
  const discovery = discoverClaudeCapabilities(surface);
  const digest = isRecord(discovery.digest) ? discovery.digest : {};
  const started = new Date();
  const ended = new Date(started.getTime() + 1);
  const startedAt = started.toISOString();
  const endedAt = ended.toISOString();
  const events = [
    {
      event_id: `${run_id}-start`,
      event_type: "assessment.started",
      run_id,
      correlation_id,
      actor: "wrapper",
      timestamp: startedAt,
      payload: null
    },
    {
      event_id: `${run_id}-snapshot`,
      event_type: "adapter.capability_declared",
      run_id,
      correlation_id,
      actor: "wrapper",
      timestamp: startedAt,
      payload: digest
    },
    {
      event_id: `${run_id}-end`,
      event_type: "assessment.ended",
      run_id,
      correlation_id,
      actor: "wrapper",
      timestamp: endedAt,
      payload: null
    }
  ];
  return {
    run_id,
    correlation_id,
    started_at: startedAt,
    ended_at: endedAt,
    capability_snapshot: digest,
    events,
    limits: CLAUDE_LIMITS.slice()
  };
};
