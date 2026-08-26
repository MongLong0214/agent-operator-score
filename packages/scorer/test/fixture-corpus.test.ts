import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

// Ticket RED contract: required failure classes lack unique canonical inputs/outputs.
const ABSENT = "required failure classes lack unique canonical inputs/outputs";

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

const CORPUS_FILES = ["manifest.json", "input.json", "expected.json", "mutation.json"] as const;

const REASON_CODE = /^[A-Z][A-Z0-9_]*$/;

const FORBIDDEN_KEYS = new Set([
  "answer",
  "chain_of_thought",
  "gold_answer",
  "hidden_answer",
  "hidden_cot",
  "hidden_reasoning",
  "hidden_solution",
  "scored_answer",
  "solution",
  "task_answer",
  "task_solution"
]);

type Json = Record<string, unknown>;
type FamilyId = (typeof FAMILIES)[number];
type CorpusFile = {
  bytes: string;
  digest: string;
  value: unknown;
};
type FamilyCorpus = {
  family: FamilyId;
  directory: string;
  manifest: CorpusFile;
  input: CorpusFile;
  expected: CorpusFile;
  mutation: CorpusFile;
};
type FixtureCorpus = { families: FamilyCorpus[] };

const sha256 = (bytes: string): string => createHash("sha256").update(bytes, "utf8").digest("hex");

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const canonicalBytes = (value: unknown): string => {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    const record = asObject(entry);
    if (!record) return entry;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sort(record[key])]));
  };
  return JSON.stringify(sort(value));
};

const readCorpusFile = (directory: string, name: string): CorpusFile | null => {
  try {
    const bytes = readFileSync(resolve(directory, name), "utf8");
    return { bytes, digest: sha256(bytes), value: JSON.parse(bytes) };
  } catch {
    return null;
  }
};

// Reads the on-disk corpus. A missing or unreadable family is null so each named
// case can fail with the ticket's pinned sentence instead of a loader internal.
const loadFamily = (family: FamilyId): FamilyCorpus | null => {
  const directory = resolve(root, "fixtures", family, "corpus");
  const files = Object.fromEntries(
    CORPUS_FILES.map((name) => [name, readCorpusFile(directory, name)])
  ) as Record<(typeof CORPUS_FILES)[number], CorpusFile | null>;
  if (CORPUS_FILES.some((name) => files[name] === null)) return null;
  return {
    family,
    directory,
    manifest: files["manifest.json"] as CorpusFile,
    input: files["input.json"] as CorpusFile,
    expected: files["expected.json"] as CorpusFile,
    mutation: files["mutation.json"] as CorpusFile
  };
};

const loadCorpus = (): FixtureCorpus | null => {
  const families = FAMILIES.map(loadFamily);
  if (families.some((entry) => entry === null)) return null;
  return { families: families as FamilyCorpus[] };
};

const requireCorpus = (): FixtureCorpus => {
  const corpus = loadCorpus();
  assert.ok(corpus, ABSENT);
  return corpus;
};

const reasonOf = (family: FamilyCorpus): string | null => {
  const manifest = asObject(family.manifest.value);
  const expected = asObject(family.expected.value);
  const reason = manifest ? asString(manifest.reason_code) : null;
  const expectedReason = expected ? asString(expected.reason_code) : null;
  if (!reason || reason !== expectedReason) return null;
  if (!REASON_CODE.test(reason)) return null;
  return reason;
};

const manifestBinding = (family: FamilyCorpus, name: "input" | "expected" | "mutation"): string | null => {
  const manifest = asObject(family.manifest.value);
  const files = manifest ? asObject(manifest.files) : null;
  const row = files ? asObject(files[name]) : null;
  return row ? asString(row.sha256) : null;
};

const collectForbiddenKeys = (value: unknown, found: string[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectForbiddenKeys(entry, found);
    return;
  }
  const record = asObject(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (FORBIDDEN_KEYS.has(key)) found.push(key);
    collectForbiddenKeys(child, found);
  }
};

const mutationPayload = (family: FamilyCorpus): { input: unknown; expected: unknown } | null => {
  const record = asObject(family.mutation.value);
  if (!record) return null;
  if (!Object.hasOwn(record, "input") || !Object.hasOwn(record, "expected")) return null;
  return { input: record.input, expected: record.expected };
};

describe("fixture-corpus", () => {
  test("fixture-census", () => {
    const corpus = requireCorpus();
    assert.deepEqual(
      corpus.families.map((entry) => entry.family),
      [...FAMILIES],
      ABSENT
    );
    const inputs = corpus.families.map((entry) => entry.input.digest);
    const outputs = corpus.families.map((entry) => entry.expected.digest);
    assert.equal(new Set(inputs).size, FAMILIES.length, ABSENT);
    assert.equal(new Set(outputs).size, FAMILIES.length, ABSENT);
    const reasons = corpus.families.map(reasonOf);
    assert.equal(reasons.every((reason) => reason !== null), true, ABSENT);
    assert.equal(new Set(reasons).size, FAMILIES.length, ABSENT);
  });

  test("each-family", () => {
    const corpus = requireCorpus();
    for (const family of corpus.families) {
      const manifest = asObject(family.manifest.value);
      const expected = asObject(family.expected.value);
      const input = asObject(family.input.value);
      assert.ok(manifest, ABSENT);
      assert.ok(expected, ABSENT);
      assert.ok(input, ABSENT);
      assert.equal(asString(manifest.family), family.family, ABSENT);
      assert.equal(asString(expected.family), family.family, ABSENT);
      assert.equal(asString(input.family), family.family, ABSENT);
      const reason = reasonOf(family);
      assert.ok(reason, ABSENT);
      assert.equal(typeof expected.issued, "boolean", ABSENT);
      assert.ok(asString(expected.status), ABSENT);
      assert.ok(asObject(input.canonical), ABSENT);
    }
  });

  test("mutation-survives", () => {
    const corpus = requireCorpus();
    for (const family of corpus.families) {
      const mutation = mutationPayload(family);
      assert.ok(mutation, ABSENT);
      const expected = asObject(mutation.expected);
      assert.ok(expected, ABSENT);
      assert.notEqual(
        canonicalBytes(mutation.input),
        canonicalBytes(asObject(family.input.value)?.canonical),
        ABSENT
      );
      assert.notEqual(canonicalBytes(mutation.expected), canonicalBytes(family.expected.value), ABSENT);
      assert.equal(asString(expected.reason_code), reasonOf(family), ABSENT);
    }
  });

  test("digest-manifest", () => {
    const corpus = requireCorpus();
    for (const family of corpus.families) {
      assert.equal(manifestBinding(family, "input"), family.input.digest, ABSENT);
      assert.equal(manifestBinding(family, "expected"), family.expected.digest, ABSENT);
      assert.equal(manifestBinding(family, "mutation"), family.mutation.digest, ABSENT);
    }
  });

  test("no-answer-leak", () => {
    const corpus = requireCorpus();
    for (const family of corpus.families) {
      const found: string[] = [];
      collectForbiddenKeys(family.manifest.value, found);
      collectForbiddenKeys(family.input.value, found);
      collectForbiddenKeys(family.expected.value, found);
      collectForbiddenKeys(family.mutation.value, found);
      assert.deepEqual(found, [], ABSENT);
    }
  });
});
