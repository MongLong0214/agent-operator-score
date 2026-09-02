import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Text, sha256Value } from "../../lib/core.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { normalizeSeed, scenarioParams, streamFor } from "../../lib/suite-seed.mjs";
import { SUITE_ID, prepareScenario, suiteDigest, suiteManifest } from "../../lib/suite.mjs";

const seeds = (count) => Array.from({ length: count }, (_, index) => (index + 1).toString(16));

test("the same seed produces the same scenario, byte for byte", () => {
  // A scenario that could not be replayed would make every result unreproducible, which is the
  // property a comparable number rests on.
  for (const seed of seeds(20)) {
    assert.deepEqual(scenarioParams(seed), scenarioParams(seed), seed);
  }
});

test("the generator reads nothing from the environment", () => {
  // A clock or a Math.random would make the seed a decoration.
  const before = scenarioParams("2a");
  const original = Math.random;
  Math.random = () => 0.5;
  try {
    assert.deepEqual(scenarioParams("2a"), before);
  } finally {
    Math.random = original;
  }
});

test("a different seed varies what the grader actually reads", () => {
  // Cosmetic variation would leave the second run measuring recall of the first.
  const spread = (read) => new Set(seeds(200).map((seed) => read(scenarioParams(seed)))).size;
  assert.equal(spread((p) => p["FAM-2"].port), 5, "port did not vary");
  assert.equal(spread((p) => p["FAM-2"].endpoint), 5, "endpoint did not vary");
  assert.equal(spread((p) => p["FAM-4"].goal), 4, "goal did not vary");
  assert.equal(spread((p) => p["FAM-4"].blocker), 4, "blocker did not vary");
  assert.equal(spread((p) => p["FAM-1"].subject), 5, "subject did not vary");
  assert.equal(spread((p) => String(p["FAM-5"].probe)) > 20, true, "the hidden probe did not vary");
});

test("the stale document never carries the authoritative port", () => {
  // If they collide, the family stops being a question about freshness.
  for (const seed of seeds(300)) {
    const fam2 = scenarioParams(seed)["FAM-2"];
    assert.notEqual(fam2.port, fam2.stale_port, seed);
  }
});

test("two families never share a canary, and a canary is not the seed's own digits", () => {
  // They are seeded into different scenarios and mean different things; one value in both would
  // make a leak in one look like a leak in the other.
  //
  // Drawing one from a slice of the seed's hex looked equivalent and is not: a small seed pads to
  // leading zeros, so every low seed produced the same canary and the two families collided.
  const fam2 = new Set();
  const fam6 = new Set();
  for (const seed of seeds(300)) {
    const params = scenarioParams(seed);
    assert.notEqual(params["FAM-2"].canary, params["FAM-6"].canary, seed);
    fam2.add(params["FAM-2"].canary);
    fam6.add(params["FAM-6"].canary);
  }
  assert.equal(fam2.size, 300, "the FAM-2 canary did not vary with the seed");
  assert.equal(fam6.size, 300, "the FAM-6 canary did not vary with the seed");
});

test("no two streams overlap, across seeds and across families", () => {
  // `state * 31 + char` left FAM-2 and FAM-4 two apart, and advancing by one then made one stream a
  // shifted copy of the other: every family drew the same values, one step out of phase.
  //
  // Two mechanisms prevent that now -- the label is folded through the mixer, and the advance is
  // the golden gamma rather than one -- and either alone is sufficient. They are both kept because
  // the failure was silent and produced a scenario that still looked varied. A mutation removing
  // one of them survives this test, which is what "redundant on purpose" means here.
  const draw = (seed, label) => {
    const stream = streamFor(seed, label);
    return Array.from({ length: 40 }, () => stream.token());
  };
  const streams = [];
  for (const seed of ["0x1", "0x2", "0x3", "0xff", "0x100"]) {
    for (const label of ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"]) {
      streams.push({ name: `${seed}/${label}`, values: draw(seed, label) });
    }
  }
  for (let i = 0; i < streams.length; i += 1) {
    for (let j = i + 1; j < streams.length; j += 1) {
      const shared = streams[i].values.filter((value) => streams[j].values.includes(value));
      assert.equal(shared.length, 0, `${streams[i].name} overlaps ${streams[j].name}`);
    }
  }
});

test("a seed is normalized, and an unusable one is refused", () => {
  assert.equal(normalizeSeed("1"), "0000000000000001");
  assert.equal(normalizeSeed(" ff "), "00000000000000ff");
  assert.equal(normalizeSeed("00000000000000FF"), "00000000000000ff");
  for (const bad of ["", "zz", "0x1", "-1", "1.5", null, undefined, {}]) {
    assert.equal(normalizeSeed(bad), null, String(bad));
  }
  assert.throws(() => scenarioParams("nope"), /AOS_INVALID_SEED/);
});

test("the manifest binds the grader, the verifier and the metric contract", () => {
  // The old digest covered family names and task text, so a change to a grader, a hidden verifier,
  // a threshold or the metric set moved none of it -- two runs could carry the same suite digest
  // and have been marked by different rules.
  const manifest = suiteManifest("1");
  assert.equal(manifest.suite_id, SUITE_ID);
  assert.match(manifest.generator_digest, /^[a-f0-9]{64}$/);
  assert.match(manifest.metric_contract_digest, /^[a-f0-9]{64}$/);
  assert.match(manifest.verifier_digests["fam5-independent-verifier.v1"], /^sha256:[a-f0-9]{64}$/);

  // The verifier digest is the verifier's own bytes: editing it moves the manifest whether or not
  // anybody remembered to bump a version.
  //
  // The bytes, not a decoding of them. This used to assert
  // `sha256Text(verifier.replace(/\r\n/g, "\n"))`, which is the defect stated as a test: under it a
  // verifier rewritten with CRLF line endings, or carrying one byte the UTF-8 decoder replaces,
  // hashes to what it hashed before and two runs marked by different code claim the same suite.
  const verifier = readFileSync(new URL("../../lib/verifiers/fam5.mjs", import.meta.url));
  assert.equal(manifest.verifier_digests["fam5-independent-verifier.v1"], sha256Bytes(verifier));

  // And the fixture this seed actually produces, not just the seed that names it. Binding the label
  // alone would let the generator change what a seed means while the manifest stayed still.
  assert.equal(manifest.fixture_manifest_digest, sha256Value(scenarioParams("1")));
});

test("the suite digest moves with the seed and with nothing else at rest", () => {
  assert.equal(suiteDigest("1"), suiteDigest("1"));
  assert.notEqual(suiteDigest("1"), suiteDigest("2"));
  assert.equal(suiteManifest("1").seed, "0000000000000001");
});

test("the suite digest is not part of its own input", () => {
  const manifest = suiteManifest("7");
  const { suite_digest: digest, ...rest } = manifest;
  assert.equal(typeof digest, "string");
  assert.equal(Object.hasOwn(rest, "suite_digest"), false);
});

test("the seed reaches the files on disk, not only the manifest", () => {
  // A manifest that records a seed the scenario ignored is the worst of both: the result claims to
  // name a scenario, and names one nobody was given.
  const read = (seed) => {
    const root = mkdtempSync(join(tmpdir(), "aos-seeded-"));
    try {
      const prepared = prepareScenario("FAM-2", root, seed);
      const docs = readdirSync(join(root, "docs")).sort();
      return {
        docs,
        text: docs.map((name) => readFileSync(join(root, "docs", name), "utf8")).join("\n"),
        task: readFileSync(join(root, "task.md"), "utf8"),
        params: prepared.params
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const a = read("2a");
  const b = read("2b");
  assert.notDeepEqual(a.docs, b.docs, "the document names did not change with the seed");
  assert.notEqual(a.text, b.text, "the document contents did not change with the seed");
  assert.equal(a.text.includes(String(a.params.port)), true, "the scenario does not carry its own port");
  assert.equal(a.text.includes(String(b.params.port)), false, "another seed's port appeared in this scenario");

  // And the same seed twice is the same bytes.
  assert.deepEqual(read("2a").text, a.text);
});
