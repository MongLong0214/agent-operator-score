/**
 * Claude Code identity discovery from official TypeScript SDK query()/SDKMessage
 * and stream-json only. Internal transcript, cache, and log surfaces are never read.
 */

export const ADAPTER_VERSION = "aos-adapter-claude-code-0.0.0";
export const PROTOCOL_VERSION = "sdk-query-stream-json";

export const CLAUDE_LIMITS = [
  "official TypeScript SDK query()/SDKMessage, stream-json, and official permission/tool surfaces are the only primary sources",
  "bounded wrapper and workspace artifacts are secondary only",
  "raw secret is never stored",
  "hidden reasoning is never stored",
  "native gaps are emitted as UNAVAILABLE and never guessed"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const officialMessages = (surface: unknown): Record<string, unknown>[] => {
  if (!isRecord(surface)) return [];
  const messages: Record<string, unknown>[] = [];
  const sdk = surface.sdkQuery;
  if (isRecord(sdk) && Array.isArray(sdk.messages)) {
    for (const message of sdk.messages) {
      if (isRecord(message)) messages.push(message);
    }
  }
  if (Array.isArray(surface.streamJson)) {
    for (const message of surface.streamJson) {
      if (isRecord(message)) messages.push(message);
    }
  }
  return messages;
};

const fieldFrom = (messages: Record<string, unknown>[], field: string): string | null => {
  for (const message of messages) {
    const direct = filledString(message[field]);
    if (direct) return direct;
  }
  return null;
};

export const officialRuntimeVersion = (surface: unknown): string =>
  fieldFrom(officialMessages(surface), "version") ?? "unknown";

export const hasOfficialPermissionTool = (surface: unknown): boolean =>
  isRecord(surface) && isRecord(surface.permissionTool);

export const hasBoundedWrapper = (surface: unknown): boolean =>
  isRecord(surface) && isRecord(surface.wrapper);

export const hasWorkspaceArtifact = (surface: unknown): boolean =>
  isRecord(surface) && isRecord(surface.workspace);

export const discoverClaudeIdentity = (surface: unknown): Record<string, unknown> => {
  const messages = officialMessages(surface);
  const runtime = fieldFrom(messages, "runtime");
  const model = fieldFrom(messages, "model");
  const harness = fieldFrom(messages, "harness");
  const present = [runtime, model, harness].filter((value) => value !== null).length;
  const status = present === 3 ? "complete" : present === 0 ? "unknown" : "limited";
  const limits = [...CLAUDE_LIMITS];
  if (runtime === null) limits.push("runtime is missing from official TypeScript SDK query()/SDKMessage and stream-json");
  if (model === null) limits.push("model is missing from official TypeScript SDK query()/SDKMessage and stream-json");
  if (harness === null) limits.push("harness is missing from official TypeScript SDK query()/SDKMessage and stream-json");
  if (present === 0) {
    limits.push("official TypeScript SDK query()/SDKMessage, stream-json, and official permission/tool surfaces were empty");
  }
  return {
    status,
    runtime,
    model,
    harness,
    identity_id: status === "complete" ? `${runtime}|${model}|${harness}` : null,
    source_class: "PRIMARY",
    limits
  };
};
