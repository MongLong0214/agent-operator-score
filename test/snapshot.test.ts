import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../specs/aos-snapshot.schema.json");
const IMPERSONATION = "Snapshot can impersonate a verified result.";

// SSOT §5.2 family names, transcribed independently of the schema.
const FAMILIES = [
  "FAM-1 Intent & Contracting",
  "FAM-2 Context, RAG & Decoy",
  "FAM-3 Graph & Orchestration",
  "FAM-4 Loop, State & Continuity",
  "FAM-5 Verification & False Completion",
  "FAM-6 Recovery, Safety & Efficiency"
];

const SNAPSHOT_FIELDS = [
  "estimate_band",
  "recommended_family",
  "next_command",
  "watermark",
  "limitations",
  "version"
];

const LIMITATIONS = "Snapshot is an ESTIMATE only. It is not a performed assessment.";
const VERSION = "aos-snapshot.v0";

const validInput = () => ({
  estimate_band: "developing",
  recommended_family: "FAM-4 Loop, State & Continuity",
  next_command: "aos run --form A"
});

const loadSnapshot = async () => {
  try {
    return await import("../src/_deferred/snapshot.ts");
  } catch {
    return {};
  }
};

const requireExports = async () => {
  const mod = await loadSnapshot();
  assert.equal(typeof mod.buildSnapshot, "function", IMPERSONATION);
  assert.equal(typeof mod.renderSnapshot, "function", IMPERSONATION);
  return mod as {
    buildSnapshot: (input: Record<string, unknown>) => Record<string, unknown>;
    renderSnapshot: (snapshot: Record<string, unknown>) => string;
  };
};

const forbiddenCopy = [
  /AOS-Coding/,
  /\bP0\b/,
  /PROVISIONAL/,
  /\bSAFE\b/,
  /percentile/i,
  /EXPERIMENTAL/,
  /CALIBRATED/,
  /Verified Assessment/i
];

const scanCopy = (text: string, label: string) => {
  for (const pattern of forbiddenCopy) {
    assert.equal(pattern.test(text), false, `${IMPERSONATION} (${label} matched ${pattern})`);
  }
};

const frozenSchema = () => JSON.parse(readFileSync(schemaPath, "utf8"));

test("valid", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);
  const schema = frozenSchema();

  assert.deepEqual(Object.keys(snapshot), SNAPSHOT_FIELDS, IMPERSONATION);
  assert.equal(snapshot.estimate_band, "developing");
  assert.equal(snapshot.recommended_family, "FAM-4 Loop, State & Continuity");
  assert.equal(snapshot.next_command, "aos run --form A");
  assert.equal(snapshot.watermark, "ESTIMATE");
  assert.equal(snapshot.limitations, LIMITATIONS);
  assert.equal(snapshot.version, VERSION);

  assert.equal(schema.additionalProperties, false, IMPERSONATION);
  assert.deepEqual(schema.required, SNAPSHOT_FIELDS);
  assert.equal(schema.properties.watermark.const, "ESTIMATE");
  assert.deepEqual(schema.properties.recommended_family.enum, FAMILIES);
  assert.equal(schema.properties.estimate_band.type, "string");
  assert.equal(schema.properties.estimate_band.pattern, "^[^0-9]+$");

  assert.equal(rendered, [
    "ESTIMATE",
    "estimate_band: developing",
    "recommended_family: FAM-4 Loop, State & Continuity",
    "next_command: aos run --form A",
    `limitations: ${LIMITATIONS}`,
    `version: ${VERSION}`
  ].join("\n"));
});

test("no-score", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);

  assert.equal(Object.hasOwn(snapshot, "score"), false, IMPERSONATION);
  assert.equal(Object.hasOwn(snapshot, "p0"), false, IMPERSONATION);
  assert.equal(Object.hasOwn(snapshot, "aos_coding_p0"), false, IMPERSONATION);
  assert.doesNotMatch(JSON.stringify(snapshot), /AOS-Coding|\bP0\b|\b80\b/, IMPERSONATION);
  assert.doesNotMatch(rendered, /AOS-Coding|\bP0\b|\b80\b/, IMPERSONATION);

  assert.throws(
    () => buildSnapshot({ ...validInput(), score: 80 }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), p0: 80 }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), estimate_band: "80" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), estimate_band: 80 }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
});

test("no-provisional", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);

  assert.equal(Object.hasOwn(snapshot, "status"), false, IMPERSONATION);
  assert.equal(Object.hasOwn(snapshot, "provisional"), false, IMPERSONATION);
  assert.doesNotMatch(JSON.stringify(snapshot), /PROVISIONAL/, IMPERSONATION);
  assert.doesNotMatch(rendered, /PROVISIONAL/, IMPERSONATION);

  assert.throws(
    () => buildSnapshot({ ...validInput(), status: "EXPERIMENTAL / PROVISIONAL" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), provisional: true }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
});

test("no-safe", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);

  assert.equal(Object.hasOwn(snapshot, "safety"), false, IMPERSONATION);
  assert.equal(Object.hasOwn(snapshot, "safe"), false, IMPERSONATION);
  assert.doesNotMatch(JSON.stringify(snapshot), /\bSAFE\b/, IMPERSONATION);
  assert.doesNotMatch(rendered, /\bSAFE\b/, IMPERSONATION);

  assert.throws(
    () => buildSnapshot({ ...validInput(), safety: "SAFE" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), safe: true }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
});

test("no-percentile", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);

  assert.equal(Object.hasOwn(snapshot, "percentile"), false, IMPERSONATION);
  assert.equal(Object.hasOwn(snapshot, "rank"), false, IMPERSONATION);
  assert.doesNotMatch(JSON.stringify(snapshot), /percentile/i, IMPERSONATION);
  assert.doesNotMatch(rendered, /percentile/i, IMPERSONATION);

  assert.throws(
    () => buildSnapshot({ ...validInput(), percentile: 42 }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), rank: "top 10%" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
});

test("watermark", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);

  assert.equal(snapshot.watermark, "ESTIMATE", IMPERSONATION);
  assert.equal(rendered.split("\n")[0], "ESTIMATE", IMPERSONATION);
  assert.match(rendered, /ESTIMATE/);

  assert.throws(
    () => buildSnapshot({ ...validInput(), watermark: "VERIFIED" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
  assert.throws(
    () => buildSnapshot({ ...validInput(), watermark: "EXPERIMENTAL / PROVISIONAL" }),
    (error: unknown) => error instanceof Error && error.message === IMPERSONATION
  );
});

test("copy-scan", async () => {
  const { buildSnapshot, renderSnapshot } = await requireExports();
  const snapshot = buildSnapshot(validInput());
  const rendered = renderSnapshot(snapshot);
  const schema = frozenSchema();

  scanCopy(JSON.stringify(snapshot), "snapshot");
  scanCopy(rendered, "render");
  scanCopy(SNAPSHOT_FIELDS.join("\n"), "field-names");

  for (const forbidden of [
    "score", "p0", "aos_coding_p0", "provisional", "status",
    "safety", "safe", "percentile", "rank"
  ]) {
    assert.equal(
      Object.hasOwn(schema.properties, forbidden),
      false,
      `${IMPERSONATION} (schema property ${forbidden})`
    );
  }
});
