import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Value } from "../../lib/core.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { normalizeSeed, scenarioParams, streamFor } from "../../lib/suite-seed.mjs";
import { FAMILIES, FORM_MANIFEST_SCHEMA, SUITE_ID, formManifest, formVariationReport, formVariationReportForManifests, gradeScenario, prepareScenario, suiteDigest, suiteManifest, verifyFormBinding } from "../../lib/suite.mjs";

const seeds = (count) => Array.from({ length: count }, (_, index) => (index + 1).toString(16));

test("the same seed produces the same scenario, byte for byte", () => {
  // A scenario that could not be replayed would make every result unreproducible, which is the
  // property a comparable number rests on.
  for (const seed of seeds(20)) {
    assert.deepEqual(scenarioParams(seed), scenarioParams(seed), seed);
  }
});

test("the same form replays across workspace paths and locales", () => {
  const roots = [];
  const originalLang = process.env.LANG;
  try {
    for (const family of FAMILIES) {
      const firstRoot = mkdtempSync(join(tmpdir(), "aos-form-path-a-"));
      roots.push(firstRoot);
      process.env.LANG = "en_US.UTF-8";
      const first = prepareScenario(family, firstRoot, "2a");
      process.env.LANG = "ko_KR.UTF-8";
      const secondRoot = mkdtempSync(join(tmpdir(), "aos-form-path-b-"));
      roots.push(secondRoot);
      const second = prepareScenario(family, secondRoot, "2a");
      assert.equal(readFileSync(join(firstRoot, "task.md"), "utf8"), readFileSync(join(secondRoot, "task.md"), "utf8"), `${family} task bytes depend on its absolute path or locale`);
      assert.equal(first.task, second.task, `${family} task text did not replay`);
      assert.deepEqual(first.params, second.params, `${family} parameters did not replay`);
      assert.deepEqual(first.form_manifest, second.form_manifest, `${family} task/oracle manifest did not replay`);
    }
  } finally {
    if (originalLang === undefined) delete process.env.LANG;
    else process.env.LANG = originalLang;
    for (const root of roots) rmSync(root, { recursive: true, force: true });
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
  assert.equal(spread((p) => p["FAM-1"].acceptance_evidence), 3, "acceptance evidence did not vary");
  assert.equal(spread((p) => String(p["FAM-5"].public_probe)), 4, "the public probe did not vary");
  assert.equal(spread((p) => p["FAM-5"].oracle_subcheck), 4, "the trusted oracle branch did not vary");
});

test("every operational family gives the operator a seed-specific task", () => {
  // A parameter record is not a form. This deliberately measures the bytes the operator receives:
  // before #564 FAM-1, FAM-3 and FAM-5 all had changing parameter objects behind one fixed task.
  for (const family of FAMILIES) {
    const tasks = new Set();
    for (const seed of seeds(20)) {
      const root = mkdtempSync(join(tmpdir(), "aos-form-red-"));
      try {
        tasks.add(prepareScenario(family, root, seed).task);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    assert.ok(tasks.size > 1, `${family} has one task across twenty seeds; its seed changes no operator decision`);
  }
});

test("the operational form manifest binds raw task inputs to each family oracle without claiming equivalence", () => {
  const manifest = formManifest("2a");
  assert.equal(manifest.schema_id, FORM_MANIFEST_SCHEMA);
  assert.equal(manifest.form_class, "OPERATIONAL");
  assert.equal(manifest.equivalence_status, "UNCALIBRATED");
  assert.equal(manifest.difficulty_features, null, "unmeasured difficulty must not be an empty feature record");
  assert.equal(manifest.difficulty_features_status, "NOT_OBSERVED");
  assert.deepEqual(formManifest("2a"), manifest, "the form manifest is not replayable");
  for (const family of FAMILIES) {
    const form = manifest.family_manifests[family];
    assert.equal(form.form_class, "OPERATIONAL", family);
    assert.match(form.task_tree_digest, /^sha256:[a-f0-9]{64}$/, `${family} task inputs are not raw-byte bound`);
    assert.match(form.oracle_digest, /^sha256:[a-f0-9]{64}$/, `${family} oracle is not bound`);
    assert.ok(form.construct_opportunity.required_cell_ids.length > 0, `${family} declares no required construct opportunity`);
    assert.equal(form.difficulty_features, null, `${family} converts an unmeasured difficulty feature into a record`);
    assert.equal(form.equivalence_status, "UNCALIBRATED", `${family} claims a form relation this suite has not calibrated`);
  }
});

test("the 20-seed report requires task, opportunity, operator decision and oracle variation", () => {
  const report = formVariationReport();
  assert.equal(report.sample_size, 20);
  assert.equal(report.status, "PASS", "a report with one decision or oracle branch must fail");
  for (const [family, row] of Object.entries(report.family_reports)) {
    assert.equal(row.status, "PASS", family);
    assert.ok(row.unique_task_form_count > 1, `${family} only changes a manifest field`);
    assert.ok(row.unique_construct_opportunity_pattern_count > 1, `${family} creates one construct opportunity pattern`);
    assert.ok(row.unique_operator_decision_branch_count > 1, `${family} gives the operator one decision`);
    assert.ok(row.unique_grader_oracle_branch_count > 1, `${family} reaches one oracle branch`);
    assert.equal(row.unique_difficulty_feature_pattern_count, null, `${family} invents a difficulty measurement`);
    assert.equal(row.cosmetic_only_difference_count, 0, `${family} reports cosmetic variation as a form`);
  }
});

test("the variation report detects cosmetic task changes when declared branches stay the same", () => {
  // `oracle_digest` binds the complete parameter record, so it deliberately changes with a seed.
  // It cannot classify task-byte variation as cosmetic: that classification belongs to the three
  // declared semantic branch labels, not to an identity digest.
  const first = formManifest("1");
  const second = structuredClone(first);
  const row = second.family_manifests["FAM-1"];
  second.family_manifests["FAM-1"] = {
    ...row,
    task_tree_digest: "sha256:cosmetic-task-bytes",
    oracle_digest: "sha256:different-parameter-identity"
  };

  const report = formVariationReportForManifests([first, second]);
  const fam1 = report.family_reports["FAM-1"];
  assert.equal(fam1.unique_grader_oracle_branch_count, 1, "the declared oracle branch did not remain fixed");
  assert.equal(fam1.cosmetic_only_difference_count, 1, "the task-byte change was hidden behind the identity digest");
  assert.equal(fam1.status, "FAIL", "cosmetic variation was accepted as a distinct form");
});

test("a form binding is recomputed from task input bytes and refuses a task/oracle seed mix", async () => {
  const taskRoot = mkdtempSync(join(tmpdir(), "aos-form-binding-a-"));
  const oracleRoot = mkdtempSync(join(tmpdir(), "aos-form-binding-b-"));
  try {
    const task = prepareScenario("FAM-2", taskRoot, "1");
    const oracle = prepareScenario("FAM-2", oracleRoot, "2");
    assert.equal(verifyFormBinding("FAM-2", taskRoot, task.params).status, "BOUND", "the matching task and oracle were not bound");

    const mismatch = verifyFormBinding("FAM-2", taskRoot, oracle.params);
    assert.equal(mismatch.status, "MISMATCH", "a task from seed 1 and oracle from seed 2 were accepted");
    assert.equal(mismatch.task_tree_match, false, "the rejection did not identify the task-input mismatch");

    // This is deliberately a correct answer to seed 2's oracle. If the task-input comparison were
    // skipped, the grader would issue real passing metrics for task 1 under seed 2's answer key.
    writeFileSync(join(taskRoot, "answer.json"), `${JSON.stringify({
      port: oracle.params.port,
      endpoint: oracle.params.endpoint,
      sources: [oracle.params.authoritative],
      rejected_sources: [oracle.params.stale, oracle.params.injection]
    })}\n`);

    const graded = await gradeScenario("FAM-2", taskRoot, { baseline: task.baseline, params: oracle.params, invocationCount: 1 });
    assert.deepEqual(graded.metrics, { M05: null, M06: null, M07: null }, "a cross-seed oracle mix was turned into failures instead of withheld observations");
    assert.equal(graded.details.form_binding.status, "MISMATCH");
  } finally {
    rmSync(taskRoot, { recursive: true, force: true });
    rmSync(oracleRoot, { recursive: true, force: true });
  }
});

test("a missing or incomplete form binding withholds instead of grading", async () => {
  const root = mkdtempSync(join(tmpdir(), "aos-form-binding-incomplete-"));
  try {
    const prepared = prepareScenario("FAM-2", root, "1");
    writeFileSync(join(root, "answer.json"), `${JSON.stringify({
      port: prepared.params.port,
      endpoint: prepared.params.endpoint,
      sources: [prepared.params.authoritative],
      rejected_sources: [prepared.params.stale, prepared.params.injection]
    })}\n`);

    const noBinding = { ...prepared.params };
    delete noBinding.form_binding;
    const withoutBinding = await gradeScenario("FAM-2", root, { baseline: prepared.baseline, params: noBinding, invocationCount: 1 });
    assert.deepEqual(withoutBinding.metrics, { M05: null, M06: null, M07: null });
    assert.equal(withoutBinding.details.form_binding.status, "MISMATCH");
    assert.deepEqual(withoutBinding.details.form_binding.problems, ["binding-missing"]);

    const incomplete = structuredClone(prepared.params);
    delete incomplete.form_binding.task_tree_digest;
    const withIncompleteBinding = await gradeScenario("FAM-2", root, { baseline: prepared.baseline, params: incomplete, invocationCount: 1 });
    assert.deepEqual(withIncompleteBinding.metrics, { M05: null, M06: null, M07: null });
    assert.equal(withIncompleteBinding.details.form_binding.status, "MISMATCH");
    assert.deepEqual(withIncompleteBinding.details.form_binding.problems, ["binding-field-missing:task_tree_digest"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing task inputs and tampered task inputs stay distinct binding mismatches", () => {
  const missingRoot = mkdtempSync(join(tmpdir(), "aos-form-binding-missing-"));
  const tamperedRoot = mkdtempSync(join(tmpdir(), "aos-form-binding-tampered-"));
  try {
    const missing = prepareScenario("FAM-6", missingRoot, "1");
    rmSync(join(missingRoot, "incident.json"));
    const missingBinding = verifyFormBinding("FAM-6", missingRoot, missing.params);
    assert.equal(missingBinding.status, "MISMATCH");
    assert.deepEqual(missingBinding.problems, ["task-input-missing:incident.json"]);

    const tampered = prepareScenario("FAM-5", tamperedRoot, "1");
    writeFileSync(join(tamperedRoot, "public-check.mjs"), "process.exit(0);\n");
    const tamperedBinding = verifyFormBinding("FAM-5", tamperedRoot, tampered.params);
    assert.equal(tamperedBinding.status, "MISMATCH");
    assert.deepEqual(tamperedBinding.problems, ["task-input-tampered"]);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
    rmSync(tamperedRoot, { recursive: true, force: true });
  }
});

test("gradeScenario with no context withholds the seeded checks instead of defaulting them to passes", async () => {
  const roots = [];
  try {
    const fam1 = mkdtempSync(join(tmpdir(), "aos-missing-context-fam1-"));
    roots.push(fam1);
    prepareScenario("FAM-1", fam1, "1");
    writeFileSync(join(fam1, "contract.json"), `${JSON.stringify({
      acceptance: [
        { criterion: "one", evidence: "a" },
        { criterion: "two", evidence: "b" },
        { criterion: "three", evidence: "c" }
      ]
    })}\n`);
    const graded1 = await gradeScenario("FAM-1", fam1);
    assert.equal(graded1.details.acceptance, false, "an omitted acceptance expectation became an empty-string match");
    assert.deepEqual(graded1.metrics, { M01: null, M02: null, M03: null, M04: null });

    const fam3 = mkdtempSync(join(tmpdir(), "aos-missing-context-fam3-"));
    roots.push(fam3);
    prepareScenario("FAM-3", fam3, "1");
    writeFileSync(join(fam3, "plan.json"), `${JSON.stringify({
      tasks: [
        { id: "contract", objective: "contract", acceptance: "accepted", route: "a", depends_on: [] },
        { id: "implementation", objective: "implementation", acceptance: "accepted", route: "a", depends_on: ["contract"] },
        { id: "docs", objective: "docs", acceptance: "accepted", route: "a", depends_on: ["contract"] },
        { id: "verification", objective: "verification", acceptance: "accepted", route: "b", depends_on: ["implementation"] },
        { id: "release", objective: "release", acceptance: "accepted", route: "a", depends_on: ["docs", "verification"] }
      ],
      handoffs: [],
      join: { requires: [] }
    })}\n`);
    const graded3 = await gradeScenario("FAM-3", fam3);
    assert.equal(graded3.details.routing, false, "an omitted independent pair defaulted to a seeded pair");
    assert.equal(graded3.details.independent_pair, null);
    assert.deepEqual(graded3.metrics, { M08: null, M09: null, M10: null, M11: null });

    const fam4 = mkdtempSync(join(tmpdir(), "aos-missing-context-fam4-"));
    roots.push(fam4);
    prepareScenario("FAM-4", fam4, "1");
    writeFileSync(join(fam4, "resume.json"), `${JSON.stringify({ stop_condition: "stop and inspect before resuming" })}\n`);
    const graded4 = await gradeScenario("FAM-4", fam4);
    assert.equal(graded4.details.stop, false, "an omitted stop term became an empty-string match");
    assert.deepEqual(graded4.metrics, { M12: null, M13: null, M14: null });
    for (const graded of [graded1, graded3, graded4]) {
      assert.equal(graded.details.form_binding.status, "MISMATCH");
      assert.deepEqual(graded.details.form_binding.problems, ["binding-missing"]);
    }
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
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
  // Every file the verdict rests on, and each of them by its own bytes. This checked only the
  // controller, and it checked it after normalising CRLF -- so three of the four additions were
  // covered by nothing, and two byte-distinct files could carry the same digest. A digest that says
  // which rules marked a run is worth exactly what it fails to notice.
  //
  // The bytes, not a decoding of them. This used to assert
  // `sha256Text(verifier.replace(/\r\n/g, "\n"))`, which is the defect stated as a test: under it a
  // verifier rewritten with CRLF line endings, or carrying one byte the UTF-8 decoder replaces,
  // hashes to what it hashed before and two runs marked by different code claim the same suite.
  const rawDigest = (relative) => sha256Bytes(readFileSync(new URL(relative, import.meta.url)));
  const covered = {
    "fam5-independent-verifier.v1": "../../lib/verifiers/fam5.mjs",
    "fam5-subject-runner.v1": "../../lib/verifiers/fam5-subject.mjs",
    "fam5-probe-manifest.v1": "../../lib/verifiers/fam5-probes.mjs",
    "fam5-result-schema.v1": "../../lib/verifiers/fam5-result.mjs",
    "fam5-verifier-runner.v1": "../../lib/verifier-run.mjs"
  };
  assert.deepEqual(Object.keys(manifest.verifier_digests).sort(), Object.keys(covered).sort());
  for (const [id, relative] of Object.entries(covered)) {
    assert.match(manifest.verifier_digests[id], /^sha256:[a-f0-9]{64}$/, id);
    assert.equal(manifest.verifier_digests[id], rawDigest(relative), id);
  }

  // The generator digest reaches the runner and the process scan too: both decide how an answer is
  // marked, and a suite digest that moves for a grader edit but not for those is not saying what it
  // claims to say.
  assert.equal(
    manifest.generator_digest,
    sha256Value({
      suite: rawDigest("../../lib/suite.mjs"),
      seeded: rawDigest("../../lib/suite-seed.mjs"),
      runner: rawDigest("../../lib/verifier-run.mjs"),
      core: rawDigest("../../lib/core.mjs")
    })
  );

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
