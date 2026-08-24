import { createHash } from "node:crypto";

export const CODEX_DISCOVERY_REFUSAL =
  "Codex discovery refuses sources other than app-server stdio JSON-RPC and the exact installed generated schema.";

export const CODEX_ADAPTER_VERSION = "aos-adapter-codex-0.0.0";

type DiscoveryFailure = { ok: false; reason: typeof CODEX_DISCOVERY_REFUSAL };
type DiscoverySuccess = {
  ok: true;
  status: "exact" | "limited" | "unknown";
  runtime: string | null;
  model: string | null;
  harness: string | null;
  identity_id: string | null;
  profile_digest: string | null;
  source_class: "PRIMARY";
  limits: string[];
};

type AppServerProbe = {
  response: Record<string, unknown>;
  schemaDigest: string;
  protocolVersion: string;
};

const CODEX_LIMITS = [
  CODEX_DISCOVERY_REFUSAL,
  "raw secret is never stored",
  "hidden reasoning is never stored",
  "native gaps are emitted as unavailable and never guessed"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dataValue = (record: Record<string, unknown>, key: string): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

const stringSet = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const entry of value) {
    const item = filledString(entry);
    if (item === null || values.includes(item)) return null;
    values.push(item);
  }
  return values;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const probeFrom = (surface: unknown): AppServerProbe | null => {
  if (!isRecord(surface)) return null;
  const appServer = dataValue(surface, "appServer");
  const schema = dataValue(surface, "installedGeneratedSchema");
  if (!isRecord(appServer) || !isRecord(schema)) return null;
  if (dataValue(appServer, "transport") !== "app-server-stdio-json-rpc") return null;

  const schemaDigest = dataValue(appServer, "schemaDigest");
  const installedDigest = dataValue(schema, "digest");
  const appProtocol = filledString(dataValue(dataValue(appServer, "response") as Record<string, unknown>, "protocolVersion"));
  const schemaProtocol = filledString(dataValue(schema, "protocolVersion"));
  const response = dataValue(appServer, "response");
  if (
    !isDigest(schemaDigest) ||
    schemaDigest !== installedDigest ||
    !isRecord(response) ||
    appProtocol === null ||
    appProtocol !== schemaProtocol
  ) {
    return null;
  }
  return { response, schemaDigest, protocolVersion: appProtocol };
};

const profileDigest = (
  runtime: string,
  model: string,
  harness: string,
  tools: string[]
): string => sha256(JSON.stringify({ harness, model, runtime, tools: [...tools].sort() }));

export const discoverCodexIdentity = (surface: unknown): DiscoverySuccess | DiscoveryFailure => {
  const probe = probeFrom(surface);
  if (probe === null) {
    return {
      ok: true,
      status: "unknown",
      runtime: null,
      model: null,
      harness: null,
      identity_id: null,
      profile_digest: null,
      source_class: "PRIMARY",
      limits: [...CODEX_LIMITS, "app-server stdio JSON-RPC and exact installed generated schema were unavailable"]
    };
  }

  const runtime = filledString(dataValue(probe.response, "runtime"));
  const model = filledString(dataValue(probe.response, "model"));
  const harness = filledString(dataValue(probe.response, "harness"));
  const tools = stringSet(dataValue(probe.response, "tools"));
  const limits = [...CODEX_LIMITS];
  if (runtime === null) limits.push("runtime is missing from app-server stdio JSON-RPC");
  if (model === null) limits.push("model is missing from app-server stdio JSON-RPC");
  if (harness === null) limits.push("harness is missing from app-server stdio JSON-RPC");
  if (tools === null) limits.push("tool profile is missing from app-server stdio JSON-RPC");

  if (runtime === null && model === null && harness === null) {
    return {
      ok: true,
      status: "unknown",
      runtime,
      model,
      harness,
      identity_id: null,
      profile_digest: null,
      source_class: "PRIMARY",
      limits
    };
  }

  if (runtime === null || model === null || harness === null || tools === null) {
    return {
      ok: true,
      status: "limited",
      runtime,
      model,
      harness,
      identity_id: null,
      profile_digest: null,
      source_class: "PRIMARY",
      limits
    };
  }

  return {
    ok: true,
    status: "exact",
    runtime,
    model,
    harness,
    identity_id: `${runtime}|${model}|${harness}`,
    profile_digest: profileDigest(runtime, model, harness, tools),
    source_class: "PRIMARY",
    limits
  };
};
