import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { checkEcdContract, comparability, evaluate, loadEcdContract, sealEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";

// verify:interpretation-use-argument
//
// The chain is scoring, generalization within the cycle, extrapolation, use. What matters is not
// that the four exist but that the ones with no evidence say so: an argument whose every link reads
// SUPPORTED is an argument nobody wrote down honestly.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);
const allPass = () => METRIC_IDS.map((id) => observationOf({
  metric_id: id,
  verifier_id: "test.v1",
  subchecks: METRICS[id].subchecks.map((one) => ({ id: one, pass: true })),
  reason: "test"
}));
const complete = { forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] };

/** A valid contract that is not the shipped one. Only the digest has to differ. */
const contractWithADifferentDigest = () => {
  const doc = clone();
  doc.interpretation_use.release_note = `${doc.interpretation_use.release_note} Scored under a second copy of this contract.`;
  return sealEcdContract(doc);
};
const facets = { language: "en", interface: "cli", model: "m1", runtime: "r1", harness: "h1", operator: "alice", occasion: 1 };

test("the four inferences are present, ordered, and each carries assumptions, evidence and rebuttals", () => {
  const { inferences } = loadEcdContract().interpretation_use;
  assert.deepEqual(inferences.map((one) => one.inference_id), ["scoring", "within_cycle_generalization", "extrapolation", "use"]);
  assert.deepEqual(inferences.map((one) => one.order), [1, 2, 3, 4]);
  for (const inference of inferences) {
    assert.ok(inference.assumptions.length > 0, inference.inference_id);
    assert.ok(inference.evidence.length > 0, inference.inference_id);
    assert.ok(inference.rebuttals.length > 0, inference.inference_id);
  }
});

test("extrapolation is unsupported and every piece of its evidence is unestablished", () => {
  const extrapolation = loadEcdContract().interpretation_use.inferences.find((one) => one.inference_id === "extrapolation");
  assert.equal(extrapolation.status, "UNSUPPORTED");
  for (const evidence of extrapolation.evidence) assert.equal(evidence.status, "UNESTABLISHED", evidence.evidence_id);
});

test("no validation category is claimed as passing", () => {
  // Green CI is implementation evidence. Nothing in this repository has produced a validation study,
  // and the registry is the place that would quietly say otherwise.
  for (const entry of loadEcdContract().interpretation_use.validation_registry) {
    assert.equal(entry.status, "UNESTABLISHED", entry.category);
  }
});

test("the claim ceiling is PROFILE_BOUND and generalizability is unestablished", () => {
  const use = loadEcdContract().interpretation_use;
  assert.equal(use.default_claim_stage, "PROFILE_BOUND");
  assert.equal(use.maximum_claim_stage, "PROFILE_BOUND");
  assert.equal(use.generalizability_status, "UNESTABLISHED");
  assert.equal(use.standard_setting, null);
  assert.equal(use.categories, null);
  assert.equal(use.cut_scores, null);
});

test("hiring, certification and ranking are named as forbidden uses on the result itself", () => {
  const result = evaluate(allPass(), complete);
  for (const forbidden of ["hiring", "promotion", "certification", "population ranking"]) {
    assert.ok(result.forbidden_uses.includes(forbidden), forbidden);
  }
  assert.equal(result.generalizability_status, "UNESTABLISHED");
  assert.equal(result.uncertainty.status, "INSUFFICIENT_DATA");
  assert.equal(result.uncertainty.method, null);
  assert.equal(result.standard_setting, null);
});

test("a complete cycle claims PROFILE_BOUND and an incomplete one drops to RUN_DIAGNOSTIC", () => {
  assert.equal(evaluate(allPass(), complete).claim_stage, "PROFILE_BOUND");
  const partial = evaluate(allPass(), { forms_completed: ["FAM-1", "FAM-2"] });
  assert.equal(partial.claim_stage, "RUN_DIAGNOSTIC");
  assert.deepEqual(partial.incomplete_forms, ["FAM-3", "FAM-4", "FAM-5", "FAM-6"]);
  assert.deepEqual(partial.unsupported_forms, []);
});

test("naming every form as completed does not make a run that observed nothing PROFILE_BOUND", () => {
  // `forms_completed` is a list of names a caller hands in. On its own it was the whole basis of the
  // claim stage, so this call reported performance observed across every locked form over zero
  // observed opportunities.
  const empty = evaluate([], complete);
  assert.equal(empty.claim_stage, "RUN_DIAGNOSTIC");
  assert.deepEqual(empty.incomplete_forms, []);
  assert.deepEqual(empty.unsupported_forms, ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"]);

  // Nor does claiming a form the run touched nowhere. M11 and M12 are FAM-4's operator-process
  // opportunities; without them the form was not administered as claimed.
  const partial = evaluate(allPass().filter((one) => !["M11", "M12"].includes(one.metric_id)), complete);
  assert.equal(partial.claim_stage, "RUN_DIAGNOSTIC");
  assert.ok(partial.unsupported_forms.includes("FAM-4"));
  assert.equal(partial.unsupported_forms.includes("FAM-1"), false);
});

test("nothing this contract issues is ever GENERALIZABILITY_SUPPORTED", () => {
  for (const context of [complete, {}, { forms_completed: [] }]) {
    assert.notEqual(evaluate(allPass(), context).claim_stage, "GENERALIZABILITY_SUPPORTED");
  }
});

test("two results differing only in language or interface may not be compared", () => {
  // The inputs are the results this module emits, which is where the first version of this test
  // went wrong: it passed hand-built bare facet objects, and `evaluate` puts the facets under
  // `facet_coverage.declared`. Two real results, one English on one model and one Korean on
  // another, came back comparable because every gate is an inequality over a field that was not
  // there on either side.
  const result = (overrides) => evaluate(allPass(), { ...complete, facets: { ...facets, ...overrides } });
  assert.equal(comparability(result({}), result({})).comparable, true);

  const language = comparability(result({}), result({ language: "ko" }));
  assert.equal(language.comparable, false);
  assert.equal(language.reason, "INVARIANCE_UNESTABLISHED");
  assert.deepEqual(language.facets, ["language"]);

  const surface = comparability(result({}), result({ interface: "ide" }));
  assert.equal(surface.comparable, false);
  assert.deepEqual(surface.facets, ["interface"]);

  const model = comparability(result({}), result({ model: "other" }));
  assert.equal(model.comparable, false);
  assert.deepEqual(model.facets, ["model"]);

  const both = comparability(result({}), result({ language: "ko", model: "other" }));
  assert.equal(both.comparable, false);
  assert.deepEqual(both.facets, ["language", "model"]);
});

test("every declared comparability rule is enforced, not only the ones with no invariance evidence", () => {
  // The artifact marks operator and occasion ENFORCED and the implementation filtered on
  // UNESTABLISHED, so the one rule the contract says it does enforce enforced nothing: two runs by
  // two different people, identical on every facet with an open invariance question, compared as
  // one measurement.
  const result = (overrides) => evaluate(allPass(), { ...complete, facets: { ...facets, ...overrides } });
  const people = comparability(result({}), result({ operator: "bob", occasion: 2 }));
  assert.equal(people.comparable, false);
  assert.equal(people.reason, "PROFILE_IDENTITY_DIFFERS");
  assert.deepEqual(people.facets, ["operator", "occasion"]);
  assert.deepEqual(people.rules.map((one) => one.rule_id), ["profile-identity"]);

  const statuses = loadEcdContract().interpretation_use.comparability_rules.map((one) => one.status);
  assert.ok(statuses.includes("ENFORCED") && statuses.includes("UNESTABLISHED"), "the fixture no longer covers both statuses");
});

test("two results scored under different contracts are two instruments and are not compared", () => {
  const shipped = evaluate(allPass(), { ...complete, facets });
  const other = evaluate(allPass(), { ...complete, facets }, contractWithADifferentDigest());
  const across = comparability(shipped, other);
  assert.equal(across.comparable, false);
  assert.equal(across.reason, "CONTRACT_IDENTITY_DIFFERS");
  assert.deepEqual(across.facets, ["contract_digest"]);
  // And the digest is derived, so a caller cannot declare its way past the gate.
  assert.throws(() => evaluate(allPass(), { ...complete, facets: { ...facets, contract_digest: "sha256:whatever" } }), /AOS_DERIVED_FACET/);
});

test("a result is frozen, so the facets it was scored under are the facets it is compared on", () => {
  const result = evaluate(allPass(), { ...complete, facets });
  assert.throws(() => { result.facet_coverage.declared.model = "other"; }, TypeError);
  assert.throws(() => { result.claim_stage = "GENERALIZABILITY_SUPPORTED"; }, TypeError);
  assert.equal(result.facet_coverage.declared.model, "m1");

  // A copy carrying every field is still not the result that was scored. Reading the shape off any
  // object was the other half of the same defect: edit the copy, ask again, get a different answer.
  const impostor = JSON.parse(JSON.stringify(result));
  assert.deepEqual(impostor.facet_coverage.declared, result.facet_coverage.declared);
  assert.throws(() => comparability(result, impostor), /AOS_UNEMITTED_RESULT/);
});

test("a comparison whose facets nobody declared is refused rather than allowed by default", () => {
  // Not a result at all is not a comparison that fails, it is a comparison that cannot be made.
  assert.throws(() => comparability({}, {}), /AOS_UNEMITTED_RESULT/);

  // A real result run without a facet context declares none of them, and that is not a match.
  const undeclared = evaluate(allPass(), complete);
  const declared = evaluate(allPass(), { ...complete, facets });
  const one = comparability(declared, undeclared);
  assert.equal(one.comparable, false);
  assert.equal(one.reason, "FACETS_UNDECLARED");
  assert.deepEqual(one.facets, ["language", "interface", "model", "runtime", "harness", "operator", "occasion"]);

  // Half a facet identity is still not one.
  const partial = evaluate(allPass(), { ...complete, facets: { language: "en", interface: "cli" } });
  assert.equal(comparability(declared, partial).comparable, false);
  assert.deepEqual(comparability(declared, partial).facets, ["model", "runtime", "harness", "operator", "occasion"]);
});

// --- negative --------------------------------------------------------------------------------

test("raising the claim ceiling above PROFILE_BOUND fails", () => {
  const doc = clone();
  doc.interpretation_use.maximum_claim_stage = "GENERALIZABILITY_SUPPORTED";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("claim-stage-ceiling"));
});

test("declaring generalizability supported without calibration evidence fails", () => {
  const doc = clone();
  doc.interpretation_use.generalizability_status = "SUPPORTED";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("generalizability-claimed"));
});

test("a cut score or a category without a standard-setting record fails", () => {
  for (const field of ["categories", "cut_scores", "standard_setting"]) {
    const doc = clone();
    doc.interpretation_use[field] = { added: "by hand" };
    const report = checkEcdContract(doc);
    assert.equal(report.ok, false, field);
    // The schema types these null, so the shape check catches it before the semantic one does.
    assert.ok(checks(report).includes("schema-invalid") || checks(report).includes("standard-setting-present"), field);
  }
});

test("a claim-stage list that is not the three stages fails rather than crashing the scorer", () => {
  // The schema asks for `minItems: 3`, so three copies of PROFILE_BOUND passed it and passed
  // sealing, and evaluate then read `.definition` off a stage it could not find. A verifier that
  // accepts a contract it cannot afterwards evaluate moves the failure to the caller and takes the
  // reason with it.
  const doc = clone();
  const bound = doc.interpretation_use.claim_stages.find((one) => one.stage_id === "PROFILE_BOUND");
  doc.interpretation_use.claim_stages = [bound, { ...bound }, { ...bound }];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("claim-stage-membership"), JSON.stringify(checks(report)));
  assert.throws(() => sealEcdContract(doc), /AOS_CONTRACT_INVALID/);

  const reordered = clone();
  reordered.interpretation_use.claim_stages.reverse();
  assert.ok(checks(checkEcdContract(reordered)).includes("claim-stage-membership"));
});

test("a comparability rule that gates an undeclared facet or contradicts its status fails", () => {
  const ghost = clone();
  ghost.interpretation_use.comparability_rules[1].facets.push("mood");
  assert.ok(checks(checkEcdContract(ghost)).includes("comparability-facet-unknown"));

  const mismatched = clone();
  mismatched.interpretation_use.comparability_rules
    .find((one) => one.rule_id === "profile-identity").refusal_reason = "INVARIANCE_UNESTABLISHED";
  assert.ok(checks(checkEcdContract(mismatched)).includes("comparability-refusal-mismatch"));
});

test("a form named twice or named at all without being declared is refused", () => {
  // "Every locked operational form was completed exactly once" is an assumption in this artifact,
  // and it was checked with `.includes`, which one form named six times satisfies.
  assert.throws(() => evaluate(allPass(), { forms_completed: ["FAM-1", "FAM-1"] }), /AOS_DUPLICATE_FORM/);
  assert.throws(() => evaluate(allPass(), { forms_completed: ["FAM-9"] }), /AOS_UNKNOWN_FORM/);
  assert.throws(() => evaluate(allPass(), { forms_completed: "FAM-1" }), /AOS_INVALID_CONTEXT/);

  const assumption = loadEcdContract().interpretation_use.inferences
    .find((one) => one.inference_id === "within_cycle_generalization").assumptions
    .find((one) => /exactly once/.test(one));
  assert.ok(assumption, "the assumption this test enforces is no longer in the artifact");
});

test("the result carries the contract digest and an empty slot for the profile digest", () => {
  // The argument recorded "the profile digest and the contract digest are recorded" as passing
  // evidence while only one of them was emitted. #559 owns the profile; this contract emits the
  // slot and says in the artifact that it is unestablished until something binds one.
  const plain = evaluate(allPass(), complete);
  assert.equal(plain.contract.digests.combined, plain.facet_coverage.declared.contract_digest);
  assert.equal(plain.profile_digest, null);
  assert.equal(evaluate(allPass(), { ...complete, profile_digest: "sha256:abc" }).profile_digest, "sha256:abc");

  const evidence = loadEcdContract().interpretation_use.inferences.flatMap((one) => one.evidence);
  assert.equal(evidence.find((one) => one.evidence_id === "contract-identity-recorded").status, "PASS");
  assert.equal(evidence.find((one) => one.evidence_id === "profile-identity-recorded").status, "UNESTABLISHED");
  assert.equal(evidence.some((one) => one.evidence_id === "profile-and-contract-identity"), false);
});

test("the contract counts its own counterfactual tests against the file that holds them", () => {
  const declared = loadEcdContract().interpretation_use.counterfactual_tests;
  const source = readFileSync(new URL(`../../${declared.file}`, import.meta.url), "utf8");
  const found = [...source.matchAll(/^test\("(.+?)"/gm)].map((match) => match[1])
    .filter((name) => name.startsWith(declared.name_prefix));
  assert.equal(found.length, declared.count, found.join(" | "));
});
