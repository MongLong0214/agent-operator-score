import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadCompatibility = async () => {
  try {
    return await import("../src/_deferred/compatibility.ts");
  } catch {
    return {};
  }
};

const loadConformance = async () => {
  try {
    return await import("../scripts/schema-conformance.mjs");
  } catch {
    return {};
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(root, path), "utf8");

const ZERO_FIXTURE_MESSAGE = "schema conformance rejected: zero-fixture corpus";
const VALID_CORPUS_MESSAGE = "schema conformance assertion failed: positive corpus must validate";
const NEGATIVE_CORPUS_MESSAGE = "schema conformance rejected: negative corpus must be refused";
const BREAKING_MINOR_MESSAGE =
  "schema compatibility assertion failed: breaking and minor changes must be classified";
const DIGEST_MISMATCH_MESSAGE = "schema conformance rejected: digest mismatch";
const CROSS_NODE_MESSAGE =
  "schema conformance assertion failed: canonical bytes and manifest digest must be runtime-independent";

// The four frozen documents E1-001 and E1-002 landed. The digest gate covers exactly these.
const GATED_SPEC_PATHS = [
  "specs/aos-result.schema.json",
  "specs/aos-trace.schema.json",
  "specs/events.v0.json",
  "specs/opportunity-profile.schema.json"
];

// Exact census. A corpus that silently shrinks is a zero-fixture pass with extra steps.
const EXPECTED_CENSUS = {
  total: 24,
  positive: 5,
  negative: 19,
  by_schema: {
    "aos-result": { total: 12, positive: 2, negative: 10 },
    "aos-trace": { total: 10, positive: 2, negative: 8 },
    "opportunity-profile": { total: 2, positive: 1, negative: 1 }
  }
};

// Every rejection keyword the four frozen documents can raise must be exercised by the
// negative corpus. A keyword with no negative fixture is an unproven gate.
const EXPECTED_REJECTION_CODES = [
  "ADDITIONAL_PROPERTY",
  "CONST",
  "ENUM",
  "EXCLUSIVE_MAXIMUM",
  "MAXIMUM",
  "MAX_LENGTH",
  "MINIMUM",
  "MIN_ITEMS",
  "MIN_LENGTH",
  "MULTIPLE_OF",
  "ONE_OF",
  "PATTERN",
  "REQUIRED_MISSING",
  "TYPE"
];

const DIGEST = "a".repeat(64);

const assertExported = (value: unknown, message: string) =>
  assert.equal(typeof value, "function", message);

const assertArrayExport = (value: unknown, message: string) =>
  assert.equal(Array.isArray(value), true, message);

const assertStringExport = (value: unknown, message: string) =>
  assert.equal(typeof value, "string", message);

const has = (result: { errors?: string[] } | undefined, needle: string) =>
  Boolean(result?.errors?.some((entry) => entry.includes(needle)));

const frozenSpec = (path: string) => JSON.parse(readRepositoryFile(path));

const validTraceEvent = (extra: Record<string, unknown> = {}) => ({
  event_id: "evt-1",
  run_id: "run-e1-003",
  task_id: null,
  timestamp: "2026-08-19T00:00:00.000Z",
  actor: "agent",
  event_type: "assessment.started",
  event_group: "run_lifecycle",
  parent_id: null,
  correlation_id: "corr-e1-003",
  identity: "codex|gpt-5.6-sol|aos-controlled-wrapper-v0",
  evidence_digest: DIGEST,
  redaction_state: "none",
  payload: null,
  ...extra
});

const validTrace = (extra: Record<string, unknown> = {}) => ({
  schema_id: "aos-trace",
  schema_version: "aos-trace.schema.v0",
  run_id: "run-e1-003",
  events: [validTraceEvent()],
  ...extra
});

describe("conformance", () => {
test("zero-fixture", async () => {
  const { runSchemaConformance, CONFORMANCE_CORPUS, CORPUS_CENSUS } = await loadConformance();
  assertExported(runSchemaConformance, ZERO_FIXTURE_MESSAGE);
  assertArrayExport(CONFORMANCE_CORPUS, ZERO_FIXTURE_MESSAGE);

  // An empty corpus never passes. "No fixture failed" is not evidence.
  const empty = runSchemaConformance({ corpus: [] });
  assert.equal(empty.ok, false, ZERO_FIXTURE_MESSAGE);
  assert.ok(has(empty, "ZERO_FIXTURE"), ZERO_FIXTURE_MESSAGE);

  // Half a corpus is still a zero-fixture pass for the half that is missing.
  const positivesOnly = runSchemaConformance({
    corpus: CONFORMANCE_CORPUS.filter((fixture) => fixture.expect === "accept")
  });
  assert.equal(positivesOnly.ok, false, ZERO_FIXTURE_MESSAGE);
  assert.ok(has(positivesOnly, "ZERO_FIXTURE"), ZERO_FIXTURE_MESSAGE);

  const negativesOnly = runSchemaConformance({
    corpus: CONFORMANCE_CORPUS.filter((fixture) => fixture.expect === "reject")
  });
  assert.equal(negativesOnly.ok, false, ZERO_FIXTURE_MESSAGE);
  assert.ok(has(negativesOnly, "ZERO_FIXTURE"), ZERO_FIXTURE_MESSAGE);

  // A gated schema with no fixture at all is the same defect one level down.
  const traceless = runSchemaConformance({
    corpus: CONFORMANCE_CORPUS.filter((fixture) => fixture.schema !== "aos-trace")
  });
  assert.equal(traceless.ok, false, ZERO_FIXTURE_MESSAGE);
  assert.ok(has(traceless, "ZERO_FIXTURE"), ZERO_FIXTURE_MESSAGE);

  // The shipped corpus is not empty on either side and the run reports it.
  assert.deepEqual(CORPUS_CENSUS, EXPECTED_CENSUS, ZERO_FIXTURE_MESSAGE);
  assert.equal(CONFORMANCE_CORPUS.length, EXPECTED_CENSUS.total, ZERO_FIXTURE_MESSAGE);
  const shipped = runSchemaConformance();
  assert.equal(shipped.ok, true, ZERO_FIXTURE_MESSAGE);
  assert.deepEqual(shipped.errors, [], ZERO_FIXTURE_MESSAGE);
});

test("valid-corpus", async () => {
  const { runSchemaConformance, validateDocument, loadSpecRegistry, CONFORMANCE_CORPUS } =
    await loadConformance();
  assertExported(runSchemaConformance, VALID_CORPUS_MESSAGE);
  assertExported(validateDocument, VALID_CORPUS_MESSAGE);
  assertExported(loadSpecRegistry, VALID_CORPUS_MESSAGE);
  assertArrayExport(CONFORMANCE_CORPUS, VALID_CORPUS_MESSAGE);

  const registry = loadSpecRegistry();
  const positives = CONFORMANCE_CORPUS.filter((fixture) => fixture.expect === "accept");
  assert.equal(positives.length, EXPECTED_CENSUS.positive, VALID_CORPUS_MESSAGE);

  for (const fixture of positives) {
    const schema = registry.byTitle[fixture.schema];
    assert.ok(schema, `${VALID_CORPUS_MESSAGE}: ${fixture.id}`);
    const verdict = validateDocument(fixture.document, schema, registry);
    assert.equal(verdict.ok, true, `${VALID_CORPUS_MESSAGE}: ${fixture.id}`);
    assert.deepEqual(verdict.errors, [], `${VALID_CORPUS_MESSAGE}: ${fixture.id}`);
  }

  // The registry is the frozen specs on disk, not a copy the gate keeps to itself.
  assert.deepEqual(
    Object.keys(registry.byTitle).sort(),
    ["aos-result", "aos-trace", "events.v0", "opportunity-profile"],
    VALID_CORPUS_MESSAGE
  );
  assert.deepEqual(registry.byTitle["aos-trace"], frozenSpec("specs/aos-trace.schema.json"), VALID_CORPUS_MESSAGE);
  assert.deepEqual(registry.byTitle["aos-result"], frozenSpec("specs/aos-result.schema.json"), VALID_CORPUS_MESSAGE);
  assert.deepEqual(
    registry.byTitle["opportunity-profile"],
    frozenSpec("specs/opportunity-profile.schema.json"),
    VALID_CORPUS_MESSAGE
  );

  const run = runSchemaConformance();
  assert.equal(run.ok, true, VALID_CORPUS_MESSAGE);
  assert.deepEqual(run.errors, [], VALID_CORPUS_MESSAGE);
  assert.deepEqual(run.census, EXPECTED_CENSUS, VALID_CORPUS_MESSAGE);
  assert.equal(run.census.total, run.census.positive + run.census.negative, VALID_CORPUS_MESSAGE);
  assert.deepEqual(
    Object.keys(run.census.by_schema).sort(),
    ["aos-result", "aos-trace", "opportunity-profile"],
    VALID_CORPUS_MESSAGE
  );

  // A declared census that disagrees with the corpus is refused rather than recomputed away.
  const miscounted = runSchemaConformance({
    corpus: CONFORMANCE_CORPUS,
    census: { ...EXPECTED_CENSUS, total: EXPECTED_CENSUS.total + 1 }
  });
  assert.equal(miscounted.ok, false, VALID_CORPUS_MESSAGE);
  assert.ok(has(miscounted, "CENSUS_MISMATCH"), VALID_CORPUS_MESSAGE);
});

test("negative-corpus", async () => {
  const { runSchemaConformance, validateDocument, loadSpecRegistry, CONFORMANCE_CORPUS } =
    await loadConformance();
  assertExported(runSchemaConformance, NEGATIVE_CORPUS_MESSAGE);
  assertExported(validateDocument, NEGATIVE_CORPUS_MESSAGE);
  assertExported(loadSpecRegistry, NEGATIVE_CORPUS_MESSAGE);
  assertArrayExport(CONFORMANCE_CORPUS, NEGATIVE_CORPUS_MESSAGE);

  const registry = loadSpecRegistry();
  const negatives = CONFORMANCE_CORPUS.filter((fixture) => fixture.expect === "reject");
  assert.equal(negatives.length, EXPECTED_CENSUS.negative, NEGATIVE_CORPUS_MESSAGE);

  const exercised = new Set<string>();
  for (const fixture of negatives) {
    const schema = registry.byTitle[fixture.schema];
    assert.ok(schema, `${NEGATIVE_CORPUS_MESSAGE}: ${fixture.id}`);
    const verdict = validateDocument(fixture.document, schema, registry);
    assert.equal(verdict.ok, false, `${NEGATIVE_CORPUS_MESSAGE}: ${fixture.id}`);
    assert.ok(
      verdict.errors.some((entry: string) => entry.startsWith(`${fixture.reason} `)),
      `${NEGATIVE_CORPUS_MESSAGE}: ${fixture.id}`
    );
    exercised.add(fixture.reason);
  }
  assert.deepEqual([...exercised].sort(), EXPECTED_REJECTION_CODES, NEGATIVE_CORPUS_MESSAGE);

  // A negative fixture that quietly starts validating fails the run; it does not pass by silence.
  const smuggled = runSchemaConformance({
    corpus: [
      ...CONFORMANCE_CORPUS,
      { id: "smuggled", schema: "aos-trace", expect: "reject", reason: "PATTERN", document: validTrace() }
    ],
    census: null
  });
  assert.equal(smuggled.ok, false, NEGATIVE_CORPUS_MESSAGE);
  assert.ok(has(smuggled, "NEGATIVE_FIXTURE_ACCEPTED"), NEGATIVE_CORPUS_MESSAGE);
  assert.ok(smuggled.errors.some((entry: string) => entry.includes("smuggled")), NEGATIVE_CORPUS_MESSAGE);

  // A positive fixture that starts failing is equally fatal.
  const broken = runSchemaConformance({
    corpus: [
      ...CONFORMANCE_CORPUS,
      { id: "broken", schema: "aos-trace", expect: "accept", reason: null, document: { schema_id: "aos-trace" } }
    ],
    census: null
  });
  assert.equal(broken.ok, false, NEGATIVE_CORPUS_MESSAGE);
  assert.ok(has(broken, "POSITIVE_FIXTURE_REJECTED"), NEGATIVE_CORPUS_MESSAGE);
  assert.ok(broken.errors.some((entry: string) => entry.includes("broken")), NEGATIVE_CORPUS_MESSAGE);

  // Rejected for the wrong reason is not evidence that the intended guard fired.
  const wrongReason = runSchemaConformance({
    corpus: [
      ...CONFORMANCE_CORPUS,
      {
        id: "wrong-reason",
        schema: "aos-trace",
        expect: "reject",
        reason: "MIN_ITEMS",
        document: validTrace({ events: [validTraceEvent({ actor: "nobody" })] })
      }
    ],
    census: null
  });
  assert.equal(wrongReason.ok, false, NEGATIVE_CORPUS_MESSAGE);
  assert.ok(has(wrongReason, "NEGATIVE_FIXTURE_REASON_MISMATCH"), NEGATIVE_CORPUS_MESSAGE);
  assert.ok(wrongReason.errors.some((entry: string) => entry.includes("wrong-reason")), NEGATIVE_CORPUS_MESSAGE);

  // A fixture naming a schema the registry does not hold fails closed.
  const unknownSchema = runSchemaConformance({
    corpus: [
      ...CONFORMANCE_CORPUS,
      { id: "unknown-schema", schema: "aos-nonexistent", expect: "accept", reason: null, document: {} }
    ],
    census: null
  });
  assert.equal(unknownSchema.ok, false, NEGATIVE_CORPUS_MESSAGE);
  assert.ok(has(unknownSchema, "UNKNOWN_SCHEMA"), NEGATIVE_CORPUS_MESSAGE);
});

test("breaking-minor", async () => {
  const { classifySchemaChange } = await loadCompatibility();
  assertExported(classifySchemaChange, BREAKING_MINOR_MESSAGE);

  const base = () => frozenSpec("specs/aos-trace.schema.json");

  const identical = classifySchemaChange(base(), base());
  assert.equal(identical.ok, true, BREAKING_MINOR_MESSAGE);
  assert.equal(identical.verdict, "patch", BREAKING_MINOR_MESSAGE);
  assert.equal(identical.breaking, false, BREAKING_MINOR_MESSAGE);
  assert.deepEqual(identical.reasons, [], BREAKING_MINOR_MESSAGE);

  const mutations: [string, (schema: any) => void, "major" | "minor" | "patch", string][] = [
    [
      "description-only",
      (schema) => { schema.description = "Reworded description with no contract change."; },
      "patch",
      "DESCRIPTION_CHANGED"
    ],
    [
      "optional-property-added",
      (schema) => { schema.properties.trace_note = { type: "string", minLength: 1 }; },
      "minor",
      "PROPERTY_ADDED"
    ],
    [
      "required-relaxed",
      (schema) => { schema.required = schema.required.filter((name: string) => name !== "run_id"); },
      "minor",
      "REQUIRED_REMOVED"
    ],
    [
      "enum-widened",
      (schema) => { schema.$defs.traceEvent.properties.redaction_state.enum.push("partial"); },
      "minor",
      "ENUM_WIDENED"
    ],
    [
      "type-widened",
      (schema) => { schema.properties.run_id.type = ["string", "null"]; },
      "minor",
      "TYPE_WIDENED"
    ],
    [
      "bound-relaxed",
      (schema) => { schema.$defs.traceEvent.properties.payload.maxLength = 4096; },
      "minor",
      "CONSTRAINT_RELAXED"
    ],
    [
      "unknown-fields-opened",
      (schema) => { schema.additionalProperties = true; },
      "minor",
      "ADDITIONAL_PROPERTIES_OPENED"
    ],
    [
      "property-removed",
      (schema) => { delete schema.$defs.traceEvent.properties.provenance; },
      "major",
      "PROPERTY_REMOVED"
    ],
    [
      "required-added",
      (schema) => { schema.required.push("produced_at"); },
      "major",
      "REQUIRED_ADDED"
    ],
    [
      "enum-narrowed",
      (schema) => { schema.$defs.traceEvent.properties.actor.enum = ["agent"]; },
      "major",
      "ENUM_NARROWED"
    ],
    [
      "type-narrowed",
      (schema) => { schema.$defs.traceEvent.properties.task_id.type = "string"; },
      "major",
      "TYPE_NARROWED"
    ],
    [
      "bound-tightened",
      (schema) => { schema.$defs.traceEvent.properties.payload.maxLength = 512; },
      "major",
      "CONSTRAINT_TIGHTENED"
    ],
    [
      "const-changed",
      (schema) => { schema.properties.schema_version.const = "aos-trace.schema.v1"; },
      "major",
      "CONST_CHANGED"
    ],
    [
      "identity-changed",
      (schema) => { schema.title = "aos-trace-v1"; },
      "major",
      "IDENTITY_CHANGED"
    ],
    [
      "pattern-changed",
      (schema) => { schema.$defs.traceEvent.properties.evidence_digest.pattern = "^[a-f0-9]{32}$"; },
      "major",
      "PATTERN_CHANGED"
    ]
  ];

  for (const [label, mutate, expectedVerdict, expectedCode] of mutations) {
    const after = base();
    mutate(after);
    const classified = classifySchemaChange(base(), after);
    assert.equal(classified.ok, true, `${BREAKING_MINOR_MESSAGE}: ${label}`);
    assert.equal(classified.verdict, expectedVerdict, `${BREAKING_MINOR_MESSAGE}: ${label}`);
    assert.equal(classified.breaking, expectedVerdict === "major", `${BREAKING_MINOR_MESSAGE}: ${label}`);
    assert.ok(
      classified.reasons.some((reason: { code: string }) => reason.code === expectedCode),
      `${BREAKING_MINOR_MESSAGE}: ${label}`
    );
    for (const reason of classified.reasons) {
      assert.equal(typeof reason.pointer, "string", `${BREAKING_MINOR_MESSAGE}: ${label}`);
      assert.ok(reason.pointer.startsWith("#"), `${BREAKING_MINOR_MESSAGE}: ${label}`);
      assert.equal(typeof reason.detail, "string", `${BREAKING_MINOR_MESSAGE}: ${label}`);
    }
  }

  // A breaking change hidden behind a compatible one is still breaking. The verdict is the
  // maximum severity, never the first or the friendliest.
  const mixed = base();
  mixed.properties.trace_note = { type: "string", minLength: 1 };
  delete mixed.$defs.traceEvent.properties.provenance;
  const mixedVerdict = classifySchemaChange(base(), mixed);
  assert.equal(mixedVerdict.verdict, "major", BREAKING_MINOR_MESSAGE);
  assert.equal(mixedVerdict.breaking, true, BREAKING_MINOR_MESSAGE);
  assert.ok(
    mixedVerdict.reasons.some((reason: { code: string }) => reason.code === "PROPERTY_ADDED"),
    BREAKING_MINOR_MESSAGE
  );
  assert.ok(
    mixedVerdict.reasons.some((reason: { code: string }) => reason.code === "PROPERTY_REMOVED"),
    BREAKING_MINOR_MESSAGE
  );

  // The classifier refuses a non-schema input instead of returning a comfortable verdict.
  const refused = classifySchemaChange(base(), "not a schema");
  assert.equal(refused.ok, false, BREAKING_MINOR_MESSAGE);
  assert.equal(refused.verdict, null, BREAKING_MINOR_MESSAGE);
  assert.ok(refused.errors.length > 0, BREAKING_MINOR_MESSAGE);

  // The frozen result schema is classified by the same rules, not only the trace schema.
  const result = frozenSpec("specs/aos-result.schema.json");
  const resultAfter = frozenSpec("specs/aos-result.schema.json");
  resultAfter.properties.status.enum = resultAfter.properties.status.enum.filter(
    (value: string) => value !== "DIAGNOSTIC ONLY"
  );
  const resultVerdict = classifySchemaChange(result, resultAfter);
  assert.equal(resultVerdict.verdict, "major", BREAKING_MINOR_MESSAGE);
  assert.equal(resultVerdict.breaking, true, BREAKING_MINOR_MESSAGE);
  assert.ok(
    resultVerdict.reasons.some((reason: { code: string }) => reason.code === "ENUM_NARROWED"),
    BREAKING_MINOR_MESSAGE
  );
});

test("digest-mismatch", async () => {
  const {
    SPEC_DIGEST_MANIFEST,
    SPEC_DIGEST_MANIFEST_SHA256,
    canonicalJsonBytes,
    digestSpecText,
    runSchemaConformance,
    sha256Hex,
    verifySpecDigests
  } = await loadConformance();
  assertArrayExport(SPEC_DIGEST_MANIFEST, DIGEST_MISMATCH_MESSAGE);
  assertStringExport(SPEC_DIGEST_MANIFEST_SHA256, DIGEST_MISMATCH_MESSAGE);
  assertExported(canonicalJsonBytes, DIGEST_MISMATCH_MESSAGE);
  assertExported(digestSpecText, DIGEST_MISMATCH_MESSAGE);
  assertExported(runSchemaConformance, DIGEST_MISMATCH_MESSAGE);
  assertExported(sha256Hex, DIGEST_MISMATCH_MESSAGE);
  assertExported(verifySpecDigests, DIGEST_MISMATCH_MESSAGE);

  // The manifest covers exactly the four documents E1-001 and E1-002 froze.
  assert.deepEqual(
    SPEC_DIGEST_MANIFEST.map((entry: { path: string }) => entry.path),
    GATED_SPEC_PATHS,
    DIGEST_MISMATCH_MESSAGE
  );

  // A schema whose bytes moved without its recorded digest moving is the failure this gate exists
  // for. Recomputing over the live tree must reproduce every recorded digest.
  for (const entry of SPEC_DIGEST_MANIFEST) {
    assert.match(entry.bytes_sha256, /^[a-f0-9]{64}$/, `${DIGEST_MISMATCH_MESSAGE}: ${entry.path}`);
    assert.match(entry.canonical_sha256, /^[a-f0-9]{64}$/, `${DIGEST_MISMATCH_MESSAGE}: ${entry.path}`);
    const recomputed = digestSpecText(readRepositoryFile(entry.path));
    assert.equal(recomputed.bytes_sha256, entry.bytes_sha256, `${DIGEST_MISMATCH_MESSAGE}: ${entry.path}`);
    assert.equal(
      recomputed.canonical_sha256,
      entry.canonical_sha256,
      `${DIGEST_MISMATCH_MESSAGE}: ${entry.path}`
    );
  }

  assert.match(SPEC_DIGEST_MANIFEST_SHA256, /^[a-f0-9]{64}$/, DIGEST_MISMATCH_MESSAGE);
  assert.equal(
    SPEC_DIGEST_MANIFEST_SHA256,
    sha256Hex(canonicalJsonBytes(SPEC_DIGEST_MANIFEST)),
    DIGEST_MISMATCH_MESSAGE
  );

  const live = verifySpecDigests();
  assert.equal(live.ok, true, DIGEST_MISMATCH_MESSAGE);
  assert.deepEqual(live.errors, [], DIGEST_MISMATCH_MESSAGE);
  assert.equal(live.checked, GATED_SPEC_PATHS.length, DIGEST_MISMATCH_MESSAGE);
  assert.equal(live.manifest_sha256, SPEC_DIGEST_MANIFEST_SHA256, DIGEST_MISMATCH_MESSAGE);

  // Schema bytes change, recorded digest does not.
  const target = "specs/aos-trace.schema.json";
  const semanticDrift = (path: string) => {
    const text = readRepositoryFile(path);
    if (path !== target) return text;
    const document = JSON.parse(text);
    document.properties.smuggled = { type: "string" };
    return `${JSON.stringify(document, null, 2)}\n`;
  };
  const drifted = verifySpecDigests({ readSpec: semanticDrift });
  assert.equal(drifted.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(drifted, "DIGEST_MISMATCH"), DIGEST_MISMATCH_MESSAGE);
  assert.ok(drifted.errors.some((entry: string) => entry.includes(target)), DIGEST_MISMATCH_MESSAGE);

  // A whitespace-only edit moves the byte digest even though the parsed document is unchanged.
  const whitespaceDrift = (path: string) => {
    const text = readRepositoryFile(path);
    return path === target ? `${text}\n` : text;
  };
  const reformatted = verifySpecDigests({ readSpec: whitespaceDrift });
  assert.equal(reformatted.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(reformatted, "DIGEST_MISMATCH"), DIGEST_MISMATCH_MESSAGE);

  // Recorded digest changes, schema does not.
  const forgedBytes = verifySpecDigests({
    manifest: SPEC_DIGEST_MANIFEST.map((entry: { path: string }) =>
      entry.path === target ? { ...entry, bytes_sha256: "0".repeat(64) } : entry
    )
  });
  assert.equal(forgedBytes.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(forgedBytes, "DIGEST_MISMATCH"), DIGEST_MISMATCH_MESSAGE);
  assert.ok(forgedBytes.errors.some((entry: string) => entry.includes(target)), DIGEST_MISMATCH_MESSAGE);

  const forgedCanonical = verifySpecDigests({
    manifest: SPEC_DIGEST_MANIFEST.map((entry: { path: string }) =>
      entry.path === target ? { ...entry, canonical_sha256: "0".repeat(64) } : entry
    )
  });
  assert.equal(forgedCanonical.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(forgedCanonical, "DIGEST_MISMATCH"), DIGEST_MISMATCH_MESSAGE);

  // Dropping a document from the manifest is not a way to stop gating it.
  const truncated = verifySpecDigests({
    manifest: SPEC_DIGEST_MANIFEST.filter((entry: { path: string }) => entry.path !== target)
  });
  assert.equal(truncated.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(truncated, "MANIFEST_INCOMPLETE"), DIGEST_MISMATCH_MESSAGE);

  // An unreadable document fails closed rather than counting as unchanged.
  const unreadable = verifySpecDigests({
    readSpec: (path: string) => {
      if (path === target) throw new Error("unreadable");
      return readRepositoryFile(path);
    }
  });
  assert.equal(unreadable.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(unreadable, "SPEC_UNREADABLE"), DIGEST_MISMATCH_MESSAGE);

  // The conformance run is gated on the digests, not merely accompanied by them.
  const gated = runSchemaConformance({ readSpec: semanticDrift });
  assert.equal(gated.ok, false, DIGEST_MISMATCH_MESSAGE);
  assert.ok(has(gated, "DIGEST_MISMATCH"), DIGEST_MISMATCH_MESSAGE);
  const clean = runSchemaConformance();
  assert.equal(clean.ok, true, DIGEST_MISMATCH_MESSAGE);
  assert.equal(clean.digest_manifest_sha256, SPEC_DIGEST_MANIFEST_SHA256, DIGEST_MISMATCH_MESSAGE);
});

test("cross-node", async () => {
  const {
    SPEC_DIGEST_MANIFEST,
    SPEC_DIGEST_MANIFEST_SHA256,
    SUPPORTED_NODE_RANGE,
    canonicalJsonBytes,
    digestSpecText,
    isSupportedNodeVersion,
    runSchemaConformance,
    sha256Hex
  } = await loadConformance();
  assertStringExport(SUPPORTED_NODE_RANGE, CROSS_NODE_MESSAGE);
  assertExported(canonicalJsonBytes, CROSS_NODE_MESSAGE);
  assertExported(digestSpecText, CROSS_NODE_MESSAGE);
  assertExported(isSupportedNodeVersion, CROSS_NODE_MESSAGE);
  assertExported(runSchemaConformance, CROSS_NODE_MESSAGE);
  assertExported(sha256Hex, CROSS_NODE_MESSAGE);

  // The supported runtime set is the repository's declared engines range, not a second opinion.
  const rootManifest = JSON.parse(readRepositoryFile("package.json"));
  assert.equal(SUPPORTED_NODE_RANGE, rootManifest.engines.node, CROSS_NODE_MESSAGE);

  // Node 20 cannot execute this repository's TypeScript and its runner skips `.ts` silently,
  // so it is refused rather than allowed to report a green run over nothing.
  assert.equal(isSupportedNodeVersion("20.19.0"), false, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion("22.17.0"), false, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion("22.18.0"), true, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion("24.8.0"), true, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion("25.0.0"), false, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion("not-a-version"), false, CROSS_NODE_MESSAGE);

  const refused = runSchemaConformance({ nodeVersion: "20.19.0" });
  assert.equal(refused.ok, false, CROSS_NODE_MESSAGE);
  assert.ok(has(refused, "UNSUPPORTED_RUNTIME"), CROSS_NODE_MESSAGE);

  const live = runSchemaConformance();
  assert.equal(live.ok, true, CROSS_NODE_MESSAGE);
  assert.equal(live.runtime.node, process.versions.node, CROSS_NODE_MESSAGE);
  assert.equal(live.runtime.supported, true, CROSS_NODE_MESSAGE);
  assert.equal(isSupportedNodeVersion(process.versions.node), true, CROSS_NODE_MESSAGE);

  // Canonical bytes depend on the value, never on key insertion order, and the ordering is
  // codepoint order rather than a locale collation that differs between builds.
  const ordered = { b: 1, a: [{ d: 4, c: 3 }], "é": "ü", Z: null, a10: 1, a9: 2 };
  const shuffled = { a9: 2, a10: 1, Z: null, "é": "ü", a: [{ c: 3, d: 4 }], b: 1 };
  assert.equal(canonicalJsonBytes(ordered), canonicalJsonBytes(shuffled), CROSS_NODE_MESSAGE);
  assert.equal(canonicalJsonBytes(ordered).includes(" "), false, CROSS_NODE_MESSAGE);
  assert.equal(
    canonicalJsonBytes(ordered),
    '{"Z":null,"a":[{"c":3,"d":4}],"a10":1,"a9":2,"b":1,"é":"ü"}',
    CROSS_NODE_MESSAGE
  );
  assert.equal(
    sha256Hex(canonicalJsonBytes(ordered)),
    sha256Hex(canonicalJsonBytes(shuffled)),
    CROSS_NODE_MESSAGE
  );

  // Line endings are a checkout property, not a schema property. Both digests normalize them,
  // so a Windows checkout and a Linux checkout produce the same manifest.
  const lf = readRepositoryFile("specs/aos-trace.schema.json");
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.notEqual(crlf, lf, CROSS_NODE_MESSAGE);
  assert.deepEqual(digestSpecText(crlf), digestSpecText(lf), CROSS_NODE_MESSAGE);

  // An independent re-implementation of both digests agrees with the gate's.
  assert.equal(
    digestSpecText(lf).bytes_sha256,
    createHash("sha256").update(lf.replace(/\r\n/g, "\n"), "utf8").digest("hex"),
    CROSS_NODE_MESSAGE
  );
  assert.equal(
    sha256Hex("abc"),
    createHash("sha256").update("abc", "utf8").digest("hex"),
    CROSS_NODE_MESSAGE
  );
  assert.equal(
    SPEC_DIGEST_MANIFEST_SHA256,
    createHash("sha256").update(canonicalJsonBytes(SPEC_DIGEST_MANIFEST), "utf8").digest("hex"),
    CROSS_NODE_MESSAGE
  );

  // Repeating the run does not move a single byte of its evidence.
  const again = runSchemaConformance();
  assert.deepEqual(again.census, live.census, CROSS_NODE_MESSAGE);
  assert.equal(again.digest_manifest_sha256, live.digest_manifest_sha256, CROSS_NODE_MESSAGE);
  assert.equal(canonicalJsonBytes(again.census), canonicalJsonBytes(live.census), CROSS_NODE_MESSAGE);
});
});
