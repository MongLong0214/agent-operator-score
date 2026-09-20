import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../../scripts/check-defect-classes.mjs", import.meta.url).pathname;
const root = new URL("../../", import.meta.url).pathname;

const run = () => spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 60000 });

// The scanner exists because these classes each cost a full review round the first time a human
// thought of them. Its own tests prove the rules bite, since a scanner that cannot fail is a
// scanner nobody has to satisfy.

test("the tree is clean against every rule, so the check can be required", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /defect classes: clean/);
});

test("each planted defect class is caught, and removing the plant restores clean", () => {
  const planted = join(root, "lib", "zz-planted-by-test.mjs");
  writeFileSync(
    planted,
    [
      'import { createHash } from "node:crypto";',
      'import { readFileSync } from "node:fs";',
      "const map = {};",
      "export const absorb = (key, value) => { map[key] = value; };",
      "export const when = (value) => Date.parse(value);",
      "export const pattern = (p) => new RegExp(p);",
      'export const dig = (p) => createHash("sha256").update(readFileSync(p, "utf8")).digest("hex");',
      ""
    ].join("\n")
  );
  try {
    const result = run();
    assert.equal(result.status, 1);
    for (const rule of ["plain-object-map", "date-parse-validator", "regex-no-unicode", "text-digest"]) {
      assert.match(result.stderr, new RegExp(`\\[${rule}\\] lib/zz-planted-by-test\\.mjs`, "u"), rule);
    }
  } finally {
    rmSync(planted);
  }
  assert.equal(run().status, 0);
});

test("a comment that quotes a bad shape to explain its absence is not a finding", () => {
  const planted = join(root, "lib", "zz-planted-comment-by-test.mjs");
  writeFileSync(
    planted,
    [
      'import { createHash } from "node:crypto";',
      // Split so the scanner does not read this file's own plant as the finding it plants.
      "// The old way was `createHash(\"sha256\").update(readFile" + "Sync(p, \"utf8\"))`; Date." + "parse(value)",
      "// and `new Reg" + "Exp(p)` were the other two classes named here.",
      "export const digest = (bytes) => createHash(\"sha256\").update(bytes).digest(\"hex\");",
      ""
    ].join("\n")
  );
  try {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(planted);
  }
});

test("an allowlist entry that matches nothing fails as stale, so a hole cannot outlive its code", () => {
  const path = join(root, "governance", "defect-class-allowlist.json");
  const original = readFileSync(path, "utf8");
  const doc = JSON.parse(original);
  doc["plain-object-map"] = [...(doc["plain-object-map"] ?? []), { file: "lib/never-existed.mjs", match: "const ghost = {};", note: "planted stale" }];
  writeFileSync(path, JSON.stringify(doc, null, 2));
  try {
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stale-allowlist.*never-existed/u);
  } finally {
    writeFileSync(path, original);
  }
});

test("an unbounded array added to a schema fails", () => {
  const dir = join(root, "schemas");
  const planted = join(dir, "zz-planted.v1.schema.json");
  writeFileSync(planted, JSON.stringify({ type: "object", properties: { things: { type: "array", items: { type: "integer" } } } }));
  try {
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unbounded-schema-array.*zz-planted/u);
  } finally {
    rmSync(planted);
  }
});

test("the attack corpus parses, and every class explains why it exists", () => {
  const corpus = JSON.parse(readFileSync(join(root, "fixtures", "attacks", "corpus.v1.json"), "utf8"));
  assert.equal(corpus.schema, "aos-attack-corpus.v1");
  const classes = Object.entries(corpus.classes);
  assert.ok(classes.length >= 6);
  for (const [name, klass] of classes) {
    assert.ok(typeof klass.why === "string" && klass.why.length > 40, `${name} does not say why it exists`);
    assert.ok(klass.cases || klass.cases_base64 || klass.generator, `${name} carries no cases`);
  }
  // The prototype cases must round-trip a null-prototype map and poison a plain one -- proving the
  // corpus describes the real mechanism rather than a folk memory of it.
  const plain = {};
  const safe = Object.create(null);
  for (const key of corpus.classes["prototype-keys"].cases) {
    plain[key] = "x";
    safe[key] = "x";
  }
  assert.notEqual(Object.keys(plain).length, corpus.classes["prototype-keys"].cases.length, "the plain object should have lost a key");
  assert.equal(Object.keys(safe).length, corpus.classes["prototype-keys"].cases.length);
  assert.equal({}.__proto__, Object.prototype);
});
