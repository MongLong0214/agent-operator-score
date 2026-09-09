// verify:validity-registry · verify:claim-stage-gate · verify:forbidden-use
// verify:negative-evidence-preservation · verify:claim-projection-consistency
//
// #586. Three sentences this file exists to make structural rather than aspirational:
//
//   tests pass          ≠ interpretation valid
//   stable output       ≠ generalizable human ability
//   good system outcome ≠ operator ability isolated
//
// The registry is read off the sealed contract and never off a caller's input, the claim stage is
// derived in one place from that registry and from the run's own evaluation, and the forbidden-use
// gate answers with a reason code rather than with a paragraph in a document.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CLAIM_STAGES,
  EVIDENCE_CATEGORIES,
  PERMITTED_USES_BY_STAGE,
  USE_REFUSAL_REASONS,
  VALIDITY_EVIDENCE_SCHEMA_ID,
  assertUsePermitted,
  checkUse,
  publishValidityRecord,
  evidenceRegistryOf,
  validityEvidenceRecord,
  verifyValidityRecord
} from "../../lib/claim-governance.mjs";
import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { buildResult, projectResult } from "../../lib/result-schema.mjs";
import { createRun, initHome, writeResult } from "../../lib/store.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { complete, contractWithAPopulatedIndex, facets, FIXTURE_PROFILE_DIGEST, observationsWith } from "./ecd-fixtures.mjs";
import { run as runCli } from "./helpers.mjs";

// A boundary that held on a lane the release has observed, at the level PROFILE_BOUND is defined
// over. `BOUNDARY_HELD` in the shared fixtures says `official: true` and names no level, which is a
// different fact: a run can be official on BEST_EFFORT_CLI, and a claim about an exact profile
// cannot rest on an environment the kernel never enforced.
const STRICT_BOUNDARY = Object.freeze({
  official: true,
  reasons: Object.freeze([]),
  isolation_level: "STRICT",
  platform_lane: "darwin/macos-seatbelt/codex-cli.v1",
  support_status: "SUPPORTED_WITH_CONSTRAINTS",
  claim_stage_ceiling: "PROFILE_BOUND"
});
const strictRun = Object.freeze({ ...complete, facets, profile_digest: FIXTURE_PROFILE_DIGEST, boundary: STRICT_BOUNDARY });
const bestEffortRun = Object.freeze({ ...strictRun, boundary: { ...STRICT_BOUNDARY, isolation_level: "BEST_EFFORT_CLI" } });

// The registry is a property of the contract, so a test that wants a PASS category changes the
// contract and re-seals it. There is no other door: no argument of any exported function here takes
// an evidence status.
const withRegistry = (statuses) => contractWithAPopulatedIndex((doc) => {
  doc.interpretation_use.validation_registry = EVIDENCE_CATEGORIES.map((category) => ({
    category,
    status: statuses[category] ?? "UNESTABLISHED",
    detail: `a fixture entry declaring ${category} for this test`
  }));
});

const PROFILE_BOUND_MINIMUM = Object.freeze({ content: "PASS", response_process: "PASS", internal_structure: "PASS", consequences: "PASS" });
const EVERY_CATEGORY_PASS = Object.freeze(Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => [category, "PASS"])));

const recordFor = (contract, run = strictRun, overrides = {}) =>
  validityEvidenceRecord({ contract, evaluation: evaluate(observationsWith(overrides), run, contract) });

// The metric ids whose subchecks land on an operator-process cell, read from the contract rather
// than typed here: a hand-written list would go stale the first time a subcheck moved cells, and a
// stale list would silently stop being the thing this test claims to withhold evidence for.
const operatorProcessMetrics = (contract) => [...new Set(contract.cells.cells
  .filter((cell) => cell.axis === "operator_process")
  .flatMap((cell) => cell.subcheck_ids)
  .map((id) => id.split(".")[0]))];

test("the categories and the stages are the ones the specification names, written out here", () => {
  // Written out rather than looped over. Every other test in this file reads `EVIDENCE_CATEGORIES`
  // and `CLAIM_STAGES` from the module under test, which makes them true of whatever those lists
  // happen to hold: renaming a category to `content_v2` or dropping `fairness_invariance` would
  // leave the whole file green. This is the one place the required values are stated independently.
  assert.deepEqual([...EVIDENCE_CATEGORIES], [
    "content", "response_process", "internal_structure", "relations_to_other_variables",
    "generalizability", "fairness_invariance", "consequences"
  ]);
  assert.deepEqual([...CLAIM_STAGES], ["EXPERIMENTAL", "INSTRUMENT_READY", "PROFILE_BOUND", "GENERALIZABILITY_SUPPORTED"]);
  assert.deepEqual([...PERMITTED_USES_BY_STAGE.PROFILE_BOUND], ["local-self-diagnosis", "same-profile-improvement-tracking"]);
  assert.deepEqual(Object.values(USE_REFUSAL_REASONS).sort(), [
    "AOS_USE_FORBIDDEN", "AOS_USE_INVARIANCE_UNESTABLISHED", "AOS_USE_NOT_PERMITTED_AT_STAGE",
    "AOS_USE_STANDARD_SETTING_REQUIRED", "AOS_USE_UNDECLARED"
  ]);
  assert.equal(VALIDITY_EVIDENCE_SCHEMA_ID, "aos-validity-evidence.v1");
});

test("the shipped registry carries all seven categories and not one of them reads as PASS", () => {
  const registry = evidenceRegistryOf(shippedEcdContract());
  assert.deepEqual(Object.keys(registry), [...EVIDENCE_CATEGORIES]);
  for (const category of EVIDENCE_CATEGORIES) {
    assert.equal(registry[category].status, "UNESTABLISHED", `${category} is not UNESTABLISHED`);
    assert.deepEqual(registry[category].items, []);
  }
});

test("a category the registry does not mention is UNESTABLISHED with no items, never PASS", () => {
  // The shipped contract schema requires all seven entries, so this shape cannot be sealed. It can
  // still arrive: `evidenceRegistryOf` is called on whatever a caller holds, and a reader that
  // returned `undefined` for a missing category would push the absence onto the next site to
  // interpret. An unrecognised status is the same case one field down.
  const partial = { interpretation_use: { validation_registry: [
    { category: "content", status: "PASS", detail: "a fixture entry" },
    { category: "response_process", status: "ESTABLISHED", detail: "a status this vocabulary does not have" }
  ] } };
  const registry = evidenceRegistryOf(partial);
  assert.deepEqual(Object.keys(registry), [...EVIDENCE_CATEGORIES]);
  assert.equal(registry.content.status, "PASS");
  assert.equal(registry.response_process.status, "UNESTABLISHED");
  assert.match(registry.response_process.detail, /reads as UNESTABLISHED/u);
  assert.equal(registry.consequences.status, "UNESTABLISHED");
  assert.deepEqual(registry.consequences.items, []);
  assert.match(registry.consequences.detail, /no registry entry/u);
  assert.equal(evidenceRegistryOf(null).content.status, "UNESTABLISHED");
});

test("all unit tests pass and the registry is empty: PROFILE_BOUND is not reachable", () => {
  // Every runtime condition satisfied -- every locked form completed, every facet declared, a
  // STRICT official lane, every subcheck answered -- and the run's own evaluation says
  // PROFILE_BOUND. The public claim still stops at INSTRUMENT_READY, because a green suite is not
  // validity evidence.
  const contract = contractWithAPopulatedIndex();
  const evaluation = evaluate(observationsWith(), strictRun, contract);
  assert.equal(evaluation.claim_stage, "PROFILE_BOUND");
  const record = validityEvidenceRecord({ contract, evaluation });
  assert.equal(record.stage, "INSTRUMENT_READY");
  assert.equal(record.decision, "WITHHOLD");
  for (const category of ["content", "response_process", "internal_structure", "consequences"]) {
    assert.ok(record.stage_reasons.some((reason) => reason.includes(category)), `no reason names ${category}`);
  }
});

test("the four PROFILE_BOUND categories at PASS on a STRICT run reach PROFILE_BOUND and allow the claim", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  assert.equal(record.schema_id, VALIDITY_EVIDENCE_SCHEMA_ID);
  assert.equal(record.stage, "PROFILE_BOUND");
  assert.equal(record.decision, "ALLOW");
});

test("a good system outcome with no operator evidence withholds the operator claim", () => {
  const contract = withRegistry(PROFILE_BOUND_MINIMUM);
  const blind = Object.fromEntries(operatorProcessMetrics(contract).map((id) => [id, null]));
  const record = recordFor(contract, strictRun, blind);
  assert.notEqual(record.stage, "PROFILE_BOUND");
  assert.equal(record.decision, "WITHHOLD");
  assert.ok(record.stage_reasons.some((reason) => /operator/u.test(reason)), record.stage_reasons.join(" | "));
});

test("all locked forms completed on a lane that is not STRICT: PROFILE_BOUND is refused", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM), bestEffortRun);
  assert.equal(record.stage, "INSTRUMENT_READY");
  assert.ok(record.stage_reasons.some((reason) => /STRICT/u.test(reason)), record.stage_reasons.join(" | "));
});

test("PROFILE_BOUND minimum with generalizability UNESTABLISHED permits local self-diagnosis only", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  assert.equal(record.stage, "PROFILE_BOUND");
  assert.deepEqual(record.intended_uses, ["local-self-diagnosis", "same-profile-improvement-tracking"]);
  assert.deepEqual(record.intended_uses, [...PERMITTED_USES_BY_STAGE.PROFILE_BOUND]);
  assert.equal(checkUse("local-self-diagnosis", record).permitted, true);
  assert.equal(checkUse("universal prediction of coding-agent performance", record).permitted, false);
});

test("cross-language DIF unknown: the comparative claim is withheld with the invariance reason code", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  assert.equal(record.evidence.fairness_invariance.status, "UNESTABLISHED");
  const refusal = checkUse("cross-profile-superiority", record);
  assert.equal(refusal.permitted, false);
  assert.equal(refusal.reason_code, USE_REFUSAL_REASONS.INVARIANCE_UNESTABLISHED);
});

test("a hiring use is refused with a machine-readable reason code, at every stage", () => {
  for (const statuses of [{}, PROFILE_BOUND_MINIMUM, EVERY_CATEGORY_PASS]) {
    const record = recordFor(withRegistry(statuses));
    for (const use of ["hiring", "promotion", "certification", "population-ranking"]) {
      const refusal = checkUse(use, record);
      assert.equal(refusal.permitted, false, `${use} was permitted at ${record.stage}`);
      assert.equal(refusal.reason_code, USE_REFUSAL_REASONS.FORBIDDEN, `${use} at ${record.stage}`);
      assert.throws(() => assertUsePermitted(use, record), new RegExp(USE_REFUSAL_REASONS.FORBIDDEN, "u"));
    }
  }
});

test("a use nobody declared is refused rather than permitted by omission", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  for (const use of [null, undefined, "", "   ", 7, {}]) {
    const refusal = checkUse(use, record);
    assert.equal(refusal.permitted, false);
    assert.equal(refusal.reason_code, USE_REFUSAL_REASONS.UNDECLARED);
  }
});

test("a category, percentile or rank is refused while the standard-setting status is NONE", () => {
  const record = recordFor(withRegistry(EVERY_CATEGORY_PASS));
  assert.equal(record.standard_setting_status, "NONE");
  for (const use of ["category", "percentile", "rank", "band"]) {
    const refusal = checkUse(use, record);
    assert.equal(refusal.permitted, false);
    assert.equal(refusal.reason_code, USE_REFUSAL_REASONS.STANDARD_SETTING_REQUIRED);
  }
});

test("every category at PASS still stops at PROFILE_BOUND while the contract's own ceiling is PROFILE_BOUND", () => {
  // The higher stage is not reachable by filling the registry in: the contract states the ceiling,
  // `checkEcdContract` refuses a contract that raises it, and the engine reads the ceiling rather
  // than the wish.
  const record = recordFor(withRegistry(EVERY_CATEGORY_PASS));
  assert.equal(record.stage, "PROFILE_BOUND");
  assert.ok(record.stage_reasons.some((reason) => /ceiling/u.test(reason)), record.stage_reasons.join(" | "));
  assert.ok(!CLAIM_STAGES.slice(CLAIM_STAGES.indexOf(record.stage) + 1).includes(record.stage));
});

test("a FAIL category is preserved as FAIL and drops the stage rather than being rounded away", () => {
  const record = recordFor(withRegistry({ ...PROFILE_BOUND_MINIMUM, content: "FAIL" }));
  assert.equal(record.evidence.content.status, "FAIL");
  assert.equal(record.stage, "EXPERIMENTAL");
  assert.equal(record.decision, "WITHHOLD");
});

test("open rebuttals travel on the record and are not deleted by a passing category", () => {
  const record = recordFor(withRegistry(EVERY_CATEGORY_PASS));
  assert.ok(record.rebuttals.length > 0);
  assert.ok(record.rebuttals.every((rebuttal) => rebuttal.status !== "MITIGATED"));
  assert.ok(record.rebuttals.some((rebuttal) => rebuttal.status === "OPEN"));
});

test("the record's digest is over its own content, and an edited record no longer verifies", () => {
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  assert.match(record.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(verifyValidityRecord(record), true);
  assert.equal(verifyValidityRecord({ ...record, stage: "GENERALIZABILITY_SUPPORTED" }), false);
  assert.equal(verifyValidityRecord({ ...record, decision: "ALLOW", digest: record.digest }), verifyValidityRecord(record));
  assert.equal(verifyValidityRecord({ ...record, evidence: { ...record.evidence, generalizability: { status: "PASS", items: [], detail: "x" } } }), false);
  assert.equal(verifyValidityRecord(null), false);
  assert.equal(verifyValidityRecord({ ...record, digest: "sha256:0" }), false);
});

test("the result carries the derived record and a caller cannot supply one", () => {
  const contract = withRegistry(PROFILE_BOUND_MINIMUM);
  const evaluation = evaluate(observationsWith(), strictRun, contract);
  const result = buildResult({ contract, evaluation, run: { run_id: "run-586", seed: "seed-1" } });
  assert.equal(result.validity_evidence.stage, "PROFILE_BOUND");
  assert.equal(verifyValidityRecord(result.validity_evidence), true);
  assert.throws(
    () => buildResult({ contract, evaluation, run: { run_id: "run-586", seed: "seed-1" }, validity_evidence: { ...result.validity_evidence, stage: "GENERALIZABILITY_SUPPORTED" } }),
    /AOS_VALIDITY_EVIDENCE_DERIVED/u
  );
});

test("the projection carries all eight fields and every surface is held to them", () => {
  const contract = withRegistry(PROFILE_BOUND_MINIMUM);
  const evaluation = evaluate(observationsWith(), strictRun, contract);
  const result = buildResult({ contract, evaluation, run: { run_id: "run-586", seed: "seed-1" } });
  const view = projectResult(result);
  // The eight fields the projection contract names, on one view, quoted from the record rather
  // than recomputed: the renderers get strings and own no arithmetic.
  assert.equal(view.claim.validity_stage, `validity stage ${result.validity_evidence.stage}`);
  assert.equal(view.claim.validity_interpretation, result.validity_evidence.intended_interpretation);
  assert.equal(view.claim.validity_permitted, `permitted: ${result.validity_evidence.intended_uses.join(", ")}`);
  assert.ok(view.claim.forbidden_uses.length > 0);
  for (const category of EVIDENCE_CATEGORIES) {
    assert.ok(view.claim.evidence_rows.includes(`${category} ${result.validity_evidence.evidence[category].status}`), `evidence rows omit ${category}`);
    assert.ok(view.claim.evidence_statuses.includes(category), `evidence statuses omit ${category}`);
  }
  assert.equal(view.claim.generalizability, String(result.generalizability_status));
  assert.equal(view.claim.uncertainty, String(result.uncertainty.status));
  assert.ok(view.claim.validity_digest.includes(result.validity_evidence.digest));
  assert.equal(view.claim.standard_setting, `standard setting ${result.validity_evidence.standard_setting_status}`);
  for (const phrase of [view.claim.validity_stage, view.claim.validity_decision, view.claim.validity_permitted, ...view.claim.evidence_rows, view.claim.validity_digest, view.claim.standard_setting]) {
    assert.ok(view.phrases.includes(phrase), `phrases omits ${phrase}`);
    assert.ok(view.headline.includes(phrase), `headline omits ${phrase}`);
  }
});

test("a result whose stored record disagrees with its own claim stage is refused", () => {
  const contract = withRegistry(PROFILE_BOUND_MINIMUM);
  const evaluation = evaluate(observationsWith(), strictRun, contract);
  const result = buildResult({ contract, evaluation, run: { run_id: "run-586", seed: "seed-1" } });
  const forged = { ...result, claim_stage: "RUN_DIAGNOSTIC" };
  assert.throws(() => projectResult(forged), /AOS_VALIDITY_STAGE_INCONSISTENT/u);
  const rewritten = { ...result, validity_evidence: { ...result.validity_evidence, stage: "GENERALIZABILITY_SUPPORTED" } };
  assert.throws(() => projectResult(rewritten), /AOS_VALIDITY_DIGEST/u);
});

test("the publication reseal accepts a redaction and refuses anything else", () => {
  // The redaction gate on the result may replace a string inside this record with a digest of
  // itself, so the record is resealed over its published bytes. That reseal is the one place a
  // digest is recomputed over a record somebody else's code touched, which makes it the one place
  // it could become a laundering tool: hand it an edited record and get a self-consistent one back.
  const record = recordFor(withRegistry(PROFILE_BOUND_MINIMUM));
  const redacted = { ...record, rebuttals: record.rebuttals.map((rebuttal, index) => (index === 0
    ? { ...rebuttal, rebuttal_id: `sha256:${"a".repeat(64)}` }
    : rebuttal)) };
  const resealed = publishValidityRecord(record, redacted);
  assert.equal(verifyValidityRecord(resealed), true);
  assert.equal(resealed.rebuttals[0].rebuttal_id, `sha256:${"a".repeat(64)}`);
  assert.notEqual(resealed.digest, record.digest);
  for (const forged of [
    { ...record, stage: "GENERALIZABILITY_SUPPORTED" },
    { ...record, decision: "ALLOW", standard_setting_status: "REGISTERED" },
    { ...record, evidence: { ...record.evidence, fairness_invariance: { ...record.evidence.fairness_invariance, status: "PASS" } } },
    { ...record, stage_reasons: [] },
    { ...record, evidence_bundle: { ...record.evidence_bundle, strict_official_lane: false } }
  ]) {
    assert.throws(() => publishValidityRecord(record, forged), /AOS_VALIDITY_PUBLISH_ALTERED/u, JSON.stringify(forged.stage));
  }
});


test("`aos use` refuses a forbidden use with a reason code and a non-zero exit", () => {
  // The gate at a boundary a consumer crosses rather than only in a library nobody imports. A
  // document's disclaimer is read by whoever opens the document; this answers with an exit status.
  const contract = withRegistry(PROFILE_BOUND_MINIMUM);
  const evaluation = evaluate(observationsWith(), strictRun, contract);
  const result = buildResult({ contract, evaluation, run: { run_id: "run-use", seed: "seed-1" } });
  const cwd = mkdtempSync(join(tmpdir(), "aos-use-cli-"));
  const home = join(cwd, ".aos");
  try {
    initHome(home);
    const { runId } = createRun(home, { mode: "TEST", run_id: "run-use" });
    writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
    const hiring = runCli(cwd, ["use", "--run", runId, "--for", "hiring"], 2);
    assert.match(`${hiring.stdout}${hiring.stderr}`, /AOS_USE_FORBIDDEN/u);
    const local = runCli(cwd, ["use", "--run", runId, "--for", "local-self-diagnosis", "--json"]);
    const decision = JSON.parse(local.stdout);
    assert.equal(decision.permitted, true);
    assert.equal(decision.claim_stage, "PROFILE_BOUND");
    const undeclared = runCli(cwd, ["use", "--run", runId], 2);
    assert.match(`${undeclared.stdout}${undeclared.stderr}`, /AOS_USE_UNDECLARED/u);
    const comparative = runCli(cwd, ["use", "--run", runId, "--for", "cross-profile-superiority", "--json"], 2);
    assert.equal(JSON.parse(comparative.stdout).reason_code, "AOS_USE_INVARIANCE_UNESTABLISHED");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
