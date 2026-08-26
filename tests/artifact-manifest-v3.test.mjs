import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalRegistryRelativePath = "docs/decisions/maintainer-gate-registry.v2.json";
const UNBOUND_MESSAGE = "manifest v3 rejected: unbound artifact";
const MIGRATION_MESSAGE = "legacy registry migration missing provenance or recorded acceptance";
const AUTHORED_STATE_MESSAGE = "manifest v3 rejected: authored effective state";
const DUPLICATE_MESSAGE = "manifest v3 rejected: duplicate artifact";
const UNSAFE_PATH_MESSAGE = "manifest v3 rejected: unsafe artifact path";
const MALFORMED_MESSAGE = "manifest v3 rejected: malformed record";
const AMBIGUOUS_MESSAGE = "manifest v3 rejected: ambiguous provenance";
const DETERMINISTIC_MESSAGE = "manifest v3 is not deterministic";
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const NODE_22_18_CANDIDATE_DIGEST = "f".repeat(64);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const loadValidator = async () => {
  try {
    return await import("../scripts/validate-artifact-manifest.mjs");
  } catch {
    return {};
  }
};

const thrownMessage = (fn) => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const otherwiseValidArtifact = (overrides = {}) => ({
  path: "docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md",
  sha256: HEX_A,
  kind: "ADR",
  source_record_id: "accepted-self-authored-row",
  source_record_sha256: HEX_B,
  migration_provenance: "legacy-v2-migration",
  ...overrides
});

const otherwiseValidManifest = (overrides = {}) => ({
  schema_version: 3,
  manifest_id: "legacy-v2-unauthenticated-migration",
  artifacts: [otherwiseValidArtifact()],
  ...overrides
});

const liveRegistryInput = () => {
  const sourceBytes = readFileSync(resolve(root, canonicalRegistryRelativePath));
  return {
    source_registry: JSON.parse(sourceBytes.toString("utf8")),
    source_bytes: sourceBytes,
    source_sha256: sha256(sourceBytes)
  };
};

const hasAcceptanceOrFreeze = (value) => {
  if (value === null || typeof value !== "object") return false;
  return [
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
  ].some((key) => Object.hasOwn(value, key));
};

const provenanceCopiesApprovalProse = (value) => {
  const text = String(value ?? "");
  return (
    text.includes("MongLong0214") ||
    text.includes("independent-maintainer") ||
    text.includes("approved_by") ||
    text.includes("approved_at") ||
    text.includes("recorded_by")
  );
};

test("manifest-v3-rejects-unbound-artifact", async () => {
  const { validateArtifactManifestV3 } = await import("../scripts/validate-artifact-manifest.mjs");
  assert.equal(typeof validateArtifactManifestV3, "function", UNBOUND_MESSAGE);
  const unbound = otherwiseValidManifest({
    artifacts: [
      otherwiseValidArtifact({
        source_record_id: undefined,
        source_record_sha256: undefined
      })
    ]
  });
  delete unbound.artifacts[0].source_record_id;
  delete unbound.artifacts[0].source_record_sha256;
  assert.equal(
    thrownMessage(() => validateArtifactManifestV3({ manifest: unbound })),
    UNBOUND_MESSAGE,
    UNBOUND_MESSAGE
  );
});

test("legacy-registry-migrates-with-provenance-and-no-acceptance", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.migrateLegacyRegistryToArtifactManifestV3, "function", MIGRATION_MESSAGE);
  assert.equal(typeof validator.validateArtifactManifestV3, "function", MIGRATION_MESSAGE);

  const input = liveRegistryInput();
  const accepted = (input.source_registry.batches ?? []).filter((batch) => batch?.status === "ACCEPTED");
  assert.notEqual(accepted.length, 0, MIGRATION_MESSAGE);

  const migrated = validator.migrateLegacyRegistryToArtifactManifestV3(input);
  assert.equal(migrated?.schema_version, 3, MIGRATION_MESSAGE);
  assert.equal(typeof migrated?.manifest_id, "string", MIGRATION_MESSAGE);
  assert.notEqual(migrated.manifest_id.length, 0, MIGRATION_MESSAGE);
  assert.equal(Array.isArray(migrated?.artifacts), true, MIGRATION_MESSAGE);
  assert.notEqual(migrated.artifacts.length, 0, MIGRATION_MESSAGE);
  assert.equal(hasAcceptanceOrFreeze(migrated), false, MIGRATION_MESSAGE);

  const boundIds = new Set(migrated.artifacts.map((artifact) => artifact.source_record_id));
  for (const batch of accepted) {
    assert.equal(boundIds.has(batch.id), true, MIGRATION_MESSAGE);
  }

  for (const artifact of migrated.artifacts) {
    assert.equal(typeof artifact.path, "string", MIGRATION_MESSAGE);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, MIGRATION_MESSAGE);
    assert.equal(typeof artifact.kind, "string", MIGRATION_MESSAGE);
    assert.equal(typeof artifact.source_record_id, "string", MIGRATION_MESSAGE);
    assert.match(artifact.source_record_sha256, /^[a-f0-9]{64}$/, MIGRATION_MESSAGE);
    assert.equal(typeof artifact.migration_provenance, "string", MIGRATION_MESSAGE);
    assert.notEqual(artifact.migration_provenance.length, 0, MIGRATION_MESSAGE);
    assert.equal(provenanceCopiesApprovalProse(artifact.migration_provenance), false, MIGRATION_MESSAGE);
    assert.equal(hasAcceptanceOrFreeze(artifact), false, MIGRATION_MESSAGE);
  }

  const validated = validator.validateArtifactManifestV3({
    manifest: migrated,
    source_registry: input.source_registry,
    source_bytes: input.source_bytes,
    source_sha256: input.source_sha256
  });
  assert.equal(validated?.ok, true, MIGRATION_MESSAGE);
  assert.equal(hasAcceptanceOrFreeze(validated), false, MIGRATION_MESSAGE);
  assert.equal(validated?.ready_for_red, undefined, MIGRATION_MESSAGE);

  const nodeCandidate = otherwiseValidManifest({
    manifest_id: "node-22-18-correction-candidate",
    artifacts: [
      otherwiseValidArtifact({
        path: "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
        sha256: NODE_22_18_CANDIDATE_DIGEST,
        source_record_id: "node-22-18-correction-candidate",
        source_record_sha256: HEX_C,
        migration_provenance: "unapproved-distinct-candidate"
      })
    ]
  });
  assert.notEqual(nodeCandidate.manifest_id, migrated.manifest_id, MIGRATION_MESSAGE);
  assert.equal(
    migrated.artifacts.some((artifact) => artifact.sha256 === NODE_22_18_CANDIDATE_DIGEST),
    false,
    MIGRATION_MESSAGE
  );
  assert.equal(
    migrated.artifacts.some((artifact) => artifact.source_record_id === "node-22-18-correction-candidate"),
    false,
    MIGRATION_MESSAGE
  );
  const candidateValidated = validator.validateArtifactManifestV3({ manifest: nodeCandidate });
  assert.equal(candidateValidated?.ok, true, MIGRATION_MESSAGE);
  assert.equal(hasAcceptanceOrFreeze(candidateValidated), false, MIGRATION_MESSAGE);
});

test("manifest-v3-rejects-authored-effective-state", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.validateArtifactManifestV3, "function", AUTHORED_STATE_MESSAGE);
  const authoredArtifact = otherwiseValidManifest({
    artifacts: [otherwiseValidArtifact({ effective_state: "ACCEPTED" })]
  });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: authoredArtifact })),
    AUTHORED_STATE_MESSAGE,
    AUTHORED_STATE_MESSAGE
  );
  const authoredManifest = otherwiseValidManifest({ accepted: true });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: authoredManifest })),
    AUTHORED_STATE_MESSAGE,
    AUTHORED_STATE_MESSAGE
  );
  const authoredReady = otherwiseValidManifest({ ready_for_red: true });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: authoredReady })),
    AUTHORED_STATE_MESSAGE,
    AUTHORED_STATE_MESSAGE
  );
  const authoredFreeze = otherwiseValidManifest({ artifact_freeze: { path: "docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md" } });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: authoredFreeze })),
    AUTHORED_STATE_MESSAGE,
    AUTHORED_STATE_MESSAGE
  );
});

test("manifest-v3-rejects-duplicate-artifact", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.validateArtifactManifestV3, "function", DUPLICATE_MESSAGE);
  const duplicate = otherwiseValidManifest({
    artifacts: [otherwiseValidArtifact(), otherwiseValidArtifact()]
  });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: duplicate })),
    DUPLICATE_MESSAGE,
    DUPLICATE_MESSAGE
  );
});

test("manifest-v3-rejects-unsafe-artifact-path", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.validateArtifactManifestV3, "function", UNSAFE_PATH_MESSAGE);
  const traversal = otherwiseValidManifest({
    artifacts: [otherwiseValidArtifact({ path: "../docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md" })]
  });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: traversal })),
    UNSAFE_PATH_MESSAGE,
    UNSAFE_PATH_MESSAGE
  );
  const absolute = otherwiseValidManifest({
    artifacts: [otherwiseValidArtifact({ path: "/etc/passwd" })]
  });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: absolute })),
    UNSAFE_PATH_MESSAGE,
    UNSAFE_PATH_MESSAGE
  );
});

test("manifest-v3-rejects-malformed-record", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.validateArtifactManifestV3, "function", MALFORMED_MESSAGE);
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3("not-a-manifest")),
    MALFORMED_MESSAGE,
    MALFORMED_MESSAGE
  );
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({})),
    MALFORMED_MESSAGE,
    MALFORMED_MESSAGE
  );
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: { schema_version: 2, manifest_id: "x", artifacts: [] } })),
    MALFORMED_MESSAGE,
    MALFORMED_MESSAGE
  );
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({
      manifest: otherwiseValidManifest({ artifacts: [otherwiseValidArtifact({ sha256: "not-a-digest" })] })
    })),
    MALFORMED_MESSAGE,
    MALFORMED_MESSAGE
  );
});

test("manifest-v3-rejects-ambiguous-provenance", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.validateArtifactManifestV3, "function", AMBIGUOUS_MESSAGE);
  const ambiguous = otherwiseValidManifest({
    artifacts: [
      otherwiseValidArtifact({ path: "docs/prd/PRD-D0-GOV-authenticated-governance-repair.md", kind: "PRD", sha256: HEX_A }),
      otherwiseValidArtifact({
        path: "docs/tickets/D0/D0-007-artifact-manifest-v3-and-legacy-migration.md",
        kind: "TICKET",
        sha256: HEX_C,
        source_record_id: "accepted-self-authored-row",
        source_record_sha256: HEX_C
      })
    ]
  });
  assert.equal(
    thrownMessage(() => validator.validateArtifactManifestV3({ manifest: ambiguous })),
    AMBIGUOUS_MESSAGE,
    AMBIGUOUS_MESSAGE
  );
});

test("manifest-v3-is-deterministic", async () => {
  const validator = await loadValidator();
  assert.equal(typeof validator.migrateLegacyRegistryToArtifactManifestV3, "function", DETERMINISTIC_MESSAGE);
  const input = liveRegistryInput();
  const first = validator.migrateLegacyRegistryToArtifactManifestV3(input);
  const second = validator.migrateLegacyRegistryToArtifactManifestV3(input);
  assert.deepEqual(first, second, DETERMINISTIC_MESSAGE);
  assert.equal(JSON.stringify(first), JSON.stringify(second), DETERMINISTIC_MESSAGE);
  const third = validator.migrateLegacyRegistryToArtifactManifestV3({
    source_registry: JSON.parse(input.source_bytes.toString("utf8")),
    source_bytes: Buffer.from(input.source_bytes),
    source_sha256: input.source_sha256
  });
  assert.equal(JSON.stringify(first), JSON.stringify(third), DETERMINISTIC_MESSAGE);
});
