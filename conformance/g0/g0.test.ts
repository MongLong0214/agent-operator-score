import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadGate = async () => {
  try {
    return await import("../../scripts/verify-g0.mjs");
  } catch {
    return {};
  }
};

const PINNED =
  "no single fail-closed gate binds schema/scorer/fixture digests and cross-node bytes.";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readRepositoryFile = (path: string) => readFileSync(resolve(root, path), "utf8");

const FAMILIES = [
  "reference-pass",
  "reference-fail",
  "false-completion",
  "stale-evidence",
  "duplicate-run",
  "unsafe-action",
  "insufficient-evidence",
  "manual-takeover",
  "prescription"
] as const;

const SCHEMA_PATHS = [
  "specs/aos-result.schema.json",
  "specs/aos-trace.schema.json",
  "specs/events.v0.json",
  "specs/opportunity-profile.schema.json",
  "specs/scoring.v0.json",
  "specs/issuance.v0.json"
] as const;

const SCORER_PATHS = [
  "packages/scorer/src/diagnosis/select-lever.ts",
  "packages/scorer/src/eligibility.ts",
  "packages/scorer/src/graders/context.ts",
  "packages/scorer/src/graders/graph.ts",
  "packages/scorer/src/graders/intent.ts",
  "packages/scorer/src/issuance.ts",
  "packages/scorer/src/safety.ts",
  "packages/scorer/src/score.ts",
  "packages/scorer/src/simulation/opportunity-audit.ts",
  "packages/scorer/src/simulation/pack-budget.ts"
] as const;

const CORPUS_FILES = ["manifest.json", "input.json", "expected.json", "mutation.json"] as const;

type Json = Record<string, unknown>;
type DigestEntry = { path: string; kind: string; bytes_sha256: string };
type Mutation = { input: unknown; expected: unknown };
type Family = {
  family: string;
  input: unknown;
  expected: unknown;
  mutation: Mutation;
};
type GateResult = {
  ok?: boolean;
  verdict?: string | null;
  errors?: string[];
  digest_manifest_sha256?: string;
  canonical_bytes?: string;
  bytes?: { node22?: string; node24?: string };
  runtime?: { node?: string; supported?: boolean; range?: string };
  install?: { clean?: boolean };
  census?: { families?: number; mutations_killed?: number; vectors?: number };
  scorer?: { ok?: boolean; scored?: number };
};

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const has = (result: GateResult | undefined, needle: string) =>
  Boolean(result?.errors?.some((entry) => entry.includes(needle)));

const assertExported = (value: unknown, message: string) =>
  assert.equal(typeof value, "function", message);

const assertArrayExport = (value: unknown, message: string) =>
  assert.equal(Array.isArray(value), true, message);

const assertStringExport = (value: unknown, message: string) =>
  assert.equal(typeof value, "string", message);

const loadDiskFamilies = (): Family[] =>
  FAMILIES.map((family) => {
    const directory = resolve(root, "fixtures", family, "corpus");
    return {
      family,
      input: JSON.parse(readFileSync(resolve(directory, "input.json"), "utf8")),
      expected: JSON.parse(readFileSync(resolve(directory, "expected.json"), "utf8")),
      mutation: JSON.parse(readFileSync(resolve(directory, "mutation.json"), "utf8")) as Mutation
    };
  });

const clone = <T>(value: T): T => structuredClone(value);

const truthDoc = () => {
  try {
    return readRepositoryFile("docs/G0-SCORER-TRUTH.md");
  } catch {
    return "";
  }
};

describe("g0", () => {
  test("pass", async () => {
    const {
      G0_DIGEST_MANIFEST,
      G0_DIGEST_MANIFEST_SHA256,
      G0_FAMILIES,
      SUPPORTED_NODE_RANGE,
      canonicalJsonBytes,
      runG0Gate,
      sha256Hex: exportedSha
    } = await loadGate();
    assertExported(runG0Gate, PINNED);
    assertArrayExport(G0_DIGEST_MANIFEST, PINNED);
    assertArrayExport(G0_FAMILIES, PINNED);
    assertStringExport(G0_DIGEST_MANIFEST_SHA256, PINNED);
    assertStringExport(SUPPORTED_NODE_RANGE, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    assertExported(exportedSha, PINNED);

    const live = runG0Gate() as GateResult;
    assert.equal(live.ok, true, PINNED);
    assert.deepEqual(live.errors, [], PINNED);
    assert.equal(live.verdict, "G0_FIXTURE_TRUTH", PINNED);
    assert.equal(live.install?.clean, true, PINNED);
    assert.equal(live.scorer?.ok, true, PINNED);
    assert.ok((live.scorer?.scored ?? 0) >= 1, PINNED);
    assert.equal(live.census?.families, FAMILIES.length, PINNED);
    assert.equal(live.census?.mutations_killed, FAMILIES.length, PINNED);
    assert.ok((live.census?.vectors ?? 0) >= 1, PINNED);
    assert.equal(typeof live.canonical_bytes, "string", PINNED);
    assert.ok((live.canonical_bytes?.length ?? 0) > 0, PINNED);
    assert.match(String(live.bytes?.node22), /^[a-f0-9]{64}$/, PINNED);
    assert.equal(live.bytes?.node22, live.bytes?.node24, PINNED);
    assert.equal(live.bytes?.node22, exportedSha(live.canonical_bytes), PINNED);
    assert.equal(live.digest_manifest_sha256, G0_DIGEST_MANIFEST_SHA256, PINNED);
    assert.match(String(G0_DIGEST_MANIFEST_SHA256), /^[a-f0-9]{64}$/, PINNED);
    assert.equal(G0_DIGEST_MANIFEST_SHA256, exportedSha(canonicalJsonBytes(G0_DIGEST_MANIFEST)), PINNED);

    assert.deepEqual([...G0_FAMILIES], [...FAMILIES], PINNED);
    const rootManifest = JSON.parse(readRepositoryFile("package.json"));
    assert.equal(SUPPORTED_NODE_RANGE, rootManifest.engines.node, PINNED);

    const kinds = new Map<string, string[]>();
    for (const entry of G0_DIGEST_MANIFEST as DigestEntry[]) {
      assert.equal(typeof entry.path, "string", PINNED);
      assert.match(entry.bytes_sha256, /^[a-f0-9]{64}$/, PINNED);
      const recomputed = sha256Hex(readRepositoryFile(entry.path).replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      assert.equal(entry.bytes_sha256, recomputed, PINNED);
      const bucket = kinds.get(entry.kind) ?? [];
      bucket.push(entry.path);
      kinds.set(entry.kind, bucket);
    }
    assert.deepEqual(kinds.get("schema"), [...SCHEMA_PATHS], PINNED);
    assert.deepEqual(kinds.get("scorer"), [...SCORER_PATHS], PINNED);
    for (const family of FAMILIES) {
      for (const name of CORPUS_FILES) {
        assert.equal(
          kinds.get("fixture")?.includes(`fixtures/${family}/corpus/${name}`),
          true,
          PINNED
        );
      }
    }
    assert.equal(
      kinds.get("fixture")?.includes("fixtures/scoring/vectors.json"),
      true,
      PINNED
    );

    const again = runG0Gate() as GateResult;
    assert.equal(again.canonical_bytes, live.canonical_bytes, PINNED);
    assert.equal(again.bytes?.node22, live.bytes?.node22, PINNED);
    assert.equal(again.digest_manifest_sha256, live.digest_manifest_sha256, PINNED);

    const dirty = runG0Gate({ lockfile: { lockfileVersion: 1 } }) as GateResult;
    assert.equal(dirty.ok, false, PINNED);
    assert.equal(dirty.verdict, null, PINNED);
    assert.ok(has(dirty, "INSTALL_DIRTY"), PINNED);

    const doc = truthDoc();
    assert.match(doc, /G0_FIXTURE_TRUTH/, PINNED);
    assert.match(doc, /does not authorize public evaluation/, PINNED);
    assert.match(doc, /Node 20/, PINNED);
    assert.doesNotMatch(doc, /public evaluation is authorized/, PINNED);
  });

  test("one-mutant-live", async () => {
    const { G0_FAMILIES, runG0Gate } = await loadGate();
    assertExported(runG0Gate, PINNED);
    assertArrayExport(G0_FAMILIES, PINNED);

    const families = loadDiskFamilies();
    assert.equal(families.length, FAMILIES.length, PINNED);
    for (const family of families) {
      assert.notEqual(
        JSON.stringify(family.mutation.input),
        JSON.stringify(asObject(family.input)?.canonical ?? family.input),
        PINNED
      );
      assert.notEqual(JSON.stringify(family.mutation.expected), JSON.stringify(family.expected), PINNED);
    }

    const live = clone(families);
    live[0] = { ...live[0], mutation: { ...live[0].mutation, expected: clone(live[0].expected) } };
    const surviving = runG0Gate({ families: live }) as GateResult;
    assert.equal(surviving.ok, false, PINNED);
    assert.equal(surviving.verdict, null, PINNED);
    assert.ok(has(surviving, "MUTANT_LIVE"), PINNED);
    assert.ok(
      surviving.errors?.some((entry) => entry.includes(live[0].family)),
      PINNED
    );
    assert.equal(surviving.census?.mutations_killed, FAMILIES.length - 1, PINNED);

    const clean = runG0Gate({ families }) as GateResult;
    assert.equal(clean.ok, true, PINNED);
    assert.equal(clean.census?.mutations_killed, FAMILIES.length, PINNED);
    assert.equal(has(clean, "MUTANT_LIVE"), false, PINNED);
  });

  test("byte-drift", async () => {
    const {
      SUPPORTED_NODE_RANGE,
      canonicalJsonBytes,
      isSupportedNodeVersion,
      runG0Gate,
      sha256Hex: exportedSha
    } = await loadGate();
    assertExported(runG0Gate, PINNED);
    assertExported(isSupportedNodeVersion, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    assertExported(exportedSha, PINNED);
    assertStringExport(SUPPORTED_NODE_RANGE, PINNED);

    const rootManifest = JSON.parse(readRepositoryFile("package.json"));
    assert.equal(SUPPORTED_NODE_RANGE, rootManifest.engines.node, PINNED);
    assert.equal(isSupportedNodeVersion("20.19.0"), false, PINNED);
    assert.equal(isSupportedNodeVersion("22.17.0"), false, PINNED);
    assert.equal(isSupportedNodeVersion("22.18.0"), true, PINNED);
    assert.equal(isSupportedNodeVersion("24.8.0"), true, PINNED);
    assert.equal(isSupportedNodeVersion("25.0.0"), false, PINNED);
    assert.equal(isSupportedNodeVersion("not-a-version"), false, PINNED);

    const refused = runG0Gate({ nodeVersion: "20.19.0" }) as GateResult;
    assert.equal(refused.ok, false, PINNED);
    assert.equal(refused.verdict, null, PINNED);
    assert.ok(has(refused, "UNSUPPORTED_RUNTIME"), PINNED);
    assert.equal(refused.runtime?.supported, false, PINNED);

    const live = runG0Gate() as GateResult;
    assert.equal(live.ok, true, PINNED);
    assert.equal(live.runtime?.supported, true, PINNED);
    assert.equal(live.runtime?.node, process.versions.node, PINNED);
    assert.equal(live.runtime?.range, SUPPORTED_NODE_RANGE, PINNED);
    assert.equal(live.bytes?.node22, live.bytes?.node24, PINNED);
    assert.equal(live.bytes?.node22, exportedSha(live.canonical_bytes), PINNED);

    const drifted = runG0Gate({
      byteSources: { node22: live.canonical_bytes, node24: `${live.canonical_bytes}\n` }
    }) as GateResult;
    assert.equal(drifted.ok, false, PINNED);
    assert.equal(drifted.verdict, null, PINNED);
    assert.ok(has(drifted, "BYTE_DRIFT"), PINNED);
    assert.notEqual(drifted.bytes?.node22, drifted.bytes?.node24, PINNED);

    const ordered = { b: 1, a: [{ d: 4, c: 3 }] };
    const shuffled = { a: [{ c: 3, d: 4 }], b: 1 };
    assert.equal(canonicalJsonBytes(ordered), canonicalJsonBytes(shuffled), PINNED);
    assert.equal(canonicalJsonBytes(ordered).includes(" "), false, PINNED);
    assert.equal(exportedSha(canonicalJsonBytes(ordered)), exportedSha(canonicalJsonBytes(shuffled)), PINNED);
  });

  test("stale-digest", async () => {
    const {
      G0_DIGEST_MANIFEST,
      G0_DIGEST_MANIFEST_SHA256,
      digestFileText,
      runG0Gate,
      verifyG0Digests
    } = await loadGate();
    assertExported(runG0Gate, PINNED);
    assertExported(verifyG0Digests, PINNED);
    assertExported(digestFileText, PINNED);
    assertArrayExport(G0_DIGEST_MANIFEST, PINNED);
    assertStringExport(G0_DIGEST_MANIFEST_SHA256, PINNED);

    const live = verifyG0Digests() as { ok?: boolean; errors?: string[]; checked?: number };
    assert.equal(live.ok, true, PINNED);
    assert.deepEqual(live.errors, [], PINNED);
    assert.equal(live.checked, (G0_DIGEST_MANIFEST as DigestEntry[]).length, PINNED);

    const target = "specs/aos-trace.schema.json";
    const semanticDrift = (path: string) => {
      const text = readRepositoryFile(path);
      if (path !== target) return text;
      const document = JSON.parse(text);
      document.properties.smuggled = { type: "string" };
      return `${JSON.stringify(document, null, 2)}\n`;
    };
    const drifted = verifyG0Digests({ readFile: semanticDrift }) as { ok?: boolean; errors?: string[] };
    assert.equal(drifted.ok, false, PINNED);
    assert.ok(has(drifted, "STALE_DIGEST"), PINNED);
    assert.ok(drifted.errors?.some((entry) => entry.includes(target)), PINNED);

    const forged = (G0_DIGEST_MANIFEST as DigestEntry[]).map((entry) =>
      entry.path === target ? { ...entry, bytes_sha256: "0".repeat(64) } : entry
    );
    const staleRecord = verifyG0Digests({ manifest: forged }) as { ok?: boolean; errors?: string[] };
    assert.equal(staleRecord.ok, false, PINNED);
    assert.ok(has(staleRecord, "STALE_DIGEST"), PINNED);

    const truncated = (G0_DIGEST_MANIFEST as DigestEntry[]).filter((entry) => entry.path !== target);
    const incomplete = verifyG0Digests({ manifest: truncated }) as { ok?: boolean; errors?: string[] };
    assert.equal(incomplete.ok, false, PINNED);
    assert.ok(has(incomplete, "MANIFEST_INCOMPLETE"), PINNED);

    const gated = runG0Gate({ readFile: semanticDrift }) as GateResult;
    assert.equal(gated.ok, false, PINNED);
    assert.equal(gated.verdict, null, PINNED);
    assert.ok(has(gated, "STALE_DIGEST"), PINNED);

    const clean = runG0Gate() as GateResult;
    assert.equal(clean.ok, true, PINNED);
    assert.equal(clean.digest_manifest_sha256, G0_DIGEST_MANIFEST_SHA256, PINNED);
  });

  test("zero-fixture", async () => {
    const { G0_FAMILIES, runG0Gate } = await loadGate();
    assertExported(runG0Gate, PINNED);
    assertArrayExport(G0_FAMILIES, PINNED);

    const empty = runG0Gate({ families: [] }) as GateResult;
    assert.equal(empty.ok, false, PINNED);
    assert.equal(empty.verdict, null, PINNED);
    assert.ok(has(empty, "ZERO_FIXTURE"), PINNED);
    assert.equal(empty.census?.families, 0, PINNED);

    const oneFamily = runG0Gate({ families: loadDiskFamilies().slice(0, 1) }) as GateResult;
    assert.equal(oneFamily.ok, false, PINNED);
    assert.ok(has(oneFamily, "ZERO_FIXTURE"), PINNED);

    const noVectors = runG0Gate({ vectors: [] }) as GateResult;
    assert.equal(noVectors.ok, false, PINNED);
    assert.ok(has(noVectors, "ZERO_FIXTURE"), PINNED);

    const shipped = runG0Gate() as GateResult;
    assert.equal(shipped.ok, true, PINNED);
    assert.equal(shipped.census?.families, FAMILIES.length, PINNED);
    assert.ok((shipped.census?.vectors ?? 0) >= 1, PINNED);
    assert.deepEqual([...G0_FAMILIES], [...FAMILIES], PINNED);
  });
});
