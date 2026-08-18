import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = 3;
const LEGACY_MIGRATION_MANIFEST_ID = "legacy-v2-unauthenticated-migration";
const LEGACY_MIGRATION_PROVENANCE = "legacy-v2-migration";
const KIND_SET = new Set(["ADR", "PRD", "TICKET"]);
const MANIFEST_KEYS = new Set(["schema_version", "manifest_id", "artifacts"]);
const ARTIFACT_KEYS = new Set([
  "path",
  "sha256",
  "kind",
  "source_record_id",
  "source_record_sha256",
  "migration_provenance"
]);
const ARTIFACT_KEY_ORDER = [
  "path",
  "sha256",
  "kind",
  "source_record_id",
  "source_record_sha256",
  "migration_provenance"
];
const FORBIDDEN_STATE_KEYS = new Set([
  "accepted",
  "acceptance",
  "effective_state",
  "effective_gate_state",
  "artifact_freeze",
  "freeze",
  "freeze_inputs",
  "ready_for_red",
  "READY_FOR_RED",
  "red_authorized",
  "authorization",
  "status"
]);
const CANONICAL_SCHEMA_RELATIVE = "docs/decisions/maintainer-gate-artifact-manifest.schema.v3.json";
const CANONICAL_MANIFEST_RELATIVE = "docs/decisions/maintainer-gate-artifact-manifest.v3.json";
const CANONICAL_REGISTRY_RELATIVE = "docs/decisions/maintainer-gate-registry.v2.json";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash64 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const manifestIdOk = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const safeRelativePath = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9._/-]+$/.test(value) &&
  !value.startsWith("/") &&
  !value.split("/").includes("..") &&
  !value.split("/").includes("");

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const asSourceBytes = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return null;
};

const reject = (message) => {
  throw new Error(message);
};

const unbound = () => reject("manifest v3 rejected: unbound artifact");
const authored = () => reject("manifest v3 rejected: authored effective state");
const duplicate = () => reject("manifest v3 rejected: duplicate artifact");
const unsafePath = () => reject("manifest v3 rejected: unsafe artifact path");
const malformed = () => reject("manifest v3 rejected: malformed record");
const ambiguous = () => reject("manifest v3 rejected: ambiguous provenance");

const rejectForbiddenKeys = (value) => {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_STATE_KEYS.has(key)) authored();
  }
};

const rejectUnknownKeys = (value, allowed) => {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_STATE_KEYS.has(key)) continue;
    if (!allowed.has(key)) malformed();
  }
};

const canonicalizeArtifact = (artifact) => {
  const canonical = {};
  for (const key of ARTIFACT_KEY_ORDER) canonical[key] = artifact[key];
  return canonical;
};

const compareArtifacts = (left, right) => {
  const path = left.path.localeCompare(right.path);
  if (path !== 0) return path;
  const digest = left.sha256.localeCompare(right.sha256);
  if (digest !== 0) return digest;
  return left.source_record_id.localeCompare(right.source_record_id);
};

export const canonicalizeArtifactManifestV3 = (manifest) => ({
  schema_version: manifest.schema_version,
  manifest_id: manifest.manifest_id,
  artifacts: [...manifest.artifacts].map(canonicalizeArtifact).sort(compareArtifacts)
});

export const serializeArtifactManifestV3 = (manifest) =>
  `${JSON.stringify(canonicalizeArtifactManifestV3(manifest), null, 2)}\n`;

const sourceRecordsFromRegistry = (registry) => {
  const records = new Map();
  for (const batch of registry.batches) {
    if (!plainObject(batch) || typeof batch.id !== "string" || batch.id.length === 0) malformed();
    if (batch.status !== "ACCEPTED") continue;
    if (records.has(batch.id)) ambiguous();
    records.set(batch.id, sha256(Buffer.from(stableJson(batch), "utf8")));
  }
  return records;
};

const verifyOptionalSourceBinding = (input) => {
  if (!own(input, "source_registry") && !own(input, "source_records")) return null;
  if (own(input, "source_records")) {
    if (!Array.isArray(input.source_records)) malformed();
    const records = new Map();
    for (const record of input.source_records) {
      if (!plainObject(record) || typeof record.source_record_id !== "string" || !hash64(record.source_record_sha256)) {
        malformed();
      }
      if (records.has(record.source_record_id)) ambiguous();
      records.set(record.source_record_id, record.source_record_sha256);
    }
    return records;
  }
  if (!plainObject(input.source_registry) || !Array.isArray(input.source_registry.batches)) malformed();
  if (own(input, "source_bytes") || own(input, "source_sha256")) {
    verifySourceIdentity(input);
  }
  return sourceRecordsFromRegistry(input.source_registry);
};

const verifySourceIdentity = (input) => {
  if (!plainObject(input.source_registry)) malformed();
  const claimed = input.source_sha256;
  if (typeof claimed !== "string" || !hash64(claimed)) malformed();
  if (own(input, "source_bytes")) {
    const bytes = asSourceBytes(input.source_bytes);
    if (!bytes) malformed();
    if (sha256(bytes) !== claimed) malformed();
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      malformed();
    }
    if (stableJson(parsed) !== stableJson(input.source_registry)) malformed();
  }
};

const inspectArtifact = (artifact, seen, sourceRecords) => {
  if (!plainObject(artifact)) malformed();
  rejectForbiddenKeys(artifact);
  rejectUnknownKeys(artifact, ARTIFACT_KEYS);
  if (!own(artifact, "path") || typeof artifact.path !== "string") malformed();
  if (!safeRelativePath(artifact.path)) unsafePath();
  if (!own(artifact, "sha256") || !own(artifact, "kind") || !own(artifact, "migration_provenance")) malformed();
  if (typeof artifact.kind !== "string" || !KIND_SET.has(artifact.kind)) malformed();
  if (!hash64(artifact.sha256)) malformed();
  if (typeof artifact.migration_provenance !== "string" || artifact.migration_provenance.length === 0) malformed();
  if (!own(artifact, "source_record_id") || !own(artifact, "source_record_sha256")) unbound();
  if (typeof artifact.source_record_id !== "string" || artifact.source_record_id.length === 0) unbound();
  if (typeof artifact.source_record_sha256 !== "string" || artifact.source_record_sha256.length === 0) unbound();
  if (!hash64(artifact.source_record_sha256)) malformed();
  const identity = `${artifact.path}\0${artifact.sha256}\0${artifact.source_record_id}`;
  if (seen.identities.has(identity)) duplicate();
  seen.identities.add(identity);
  const previousDigest = seen.sourceDigests.get(artifact.source_record_id);
  if (previousDigest && previousDigest !== artifact.source_record_sha256) ambiguous();
  seen.sourceDigests.set(artifact.source_record_id, artifact.source_record_sha256);
  if (sourceRecords) {
    if (!sourceRecords.has(artifact.source_record_id)) ambiguous();
    if (sourceRecords.get(artifact.source_record_id) !== artifact.source_record_sha256) ambiguous();
  }
  return canonicalizeArtifact(artifact);
};

export const validateArtifactManifestV3 = (input) => {
  if (!plainObject(input)) malformed();
  rejectForbiddenKeys(input);
  if (!own(input, "manifest") || !plainObject(input.manifest)) malformed();
  const manifest = input.manifest;
  rejectForbiddenKeys(manifest);
  rejectUnknownKeys(manifest, MANIFEST_KEYS);
  if (manifest.schema_version !== SCHEMA_VERSION) malformed();
  if (!manifestIdOk(manifest.manifest_id)) malformed();
  if (!Array.isArray(manifest.artifacts)) malformed();
  const sourceRecords = verifyOptionalSourceBinding(input);
  const seen = { identities: new Set(), sourceDigests: new Map() };
  const artifacts = manifest.artifacts.map((artifact) => inspectArtifact(artifact, seen, sourceRecords));
  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    manifest_id: manifest.manifest_id,
    artifacts
  };
};

export const migrateLegacyRegistryToArtifactManifestV3 = (input) => {
  if (!plainObject(input) || !plainObject(input.source_registry)) malformed();
  rejectForbiddenKeys(input);
  const registry = input.source_registry;
  if (registry.version !== 2 || !Array.isArray(registry.batches)) malformed();
  if (own(input, "source_bytes") || own(input, "source_sha256")) verifySourceIdentity(input);
  const artifacts = [];
  const seen = { identities: new Set(), sourceDigests: new Map() };
  for (const batch of registry.batches) {
    if (!plainObject(batch) || typeof batch.id !== "string" || batch.id.length === 0) malformed();
    if (typeof batch.status === "string" && batch.status !== "ACCEPTED") continue;
    if (batch.status !== "ACCEPTED") malformed();
    const sourceDigest = sha256(Buffer.from(stableJson(batch), "utf8"));
    if (!Array.isArray(batch.artifacts)) malformed();
    for (const artifact of batch.artifacts) {
      if (!plainObject(artifact)) malformed();
      const migrated = {
        path: artifact.path,
        sha256: artifact.sha256,
        kind: artifact.kind,
        source_record_id: batch.id,
        source_record_sha256: sourceDigest,
        migration_provenance: LEGACY_MIGRATION_PROVENANCE
      };
      inspectArtifact(migrated, seen, null);
      artifacts.push(migrated);
    }
  }
  const manifest = canonicalizeArtifactManifestV3({
    schema_version: SCHEMA_VERSION,
    manifest_id: LEGACY_MIGRATION_MANIFEST_ID,
    artifacts
  });
  validateArtifactManifestV3({
    manifest,
    source_registry: registry,
    source_bytes: input.source_bytes,
    source_sha256: input.source_sha256
  });
  return manifest;
};

export const loadCanonicalArtifactManifestV3 = (root) => {
  const schemaBytes = readFileSync(resolve(root, CANONICAL_SCHEMA_RELATIVE));
  const manifestBytes = readFileSync(resolve(root, CANONICAL_MANIFEST_RELATIVE));
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return {
    schema,
    manifest,
    schema_digest: sha256(schemaBytes),
    manifest_digest: sha256(manifestBytes),
    schema_path: CANONICAL_SCHEMA_RELATIVE,
    manifest_path: CANONICAL_MANIFEST_RELATIVE
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const sourceBytes = readFileSync(resolve(root, CANONICAL_REGISTRY_RELATIVE));
  const migrated = migrateLegacyRegistryToArtifactManifestV3({
    source_registry: JSON.parse(sourceBytes.toString("utf8")),
    source_bytes: sourceBytes,
    source_sha256: sha256(sourceBytes)
  });
  process.stdout.write(serializeArtifactManifestV3(migrated));
}
