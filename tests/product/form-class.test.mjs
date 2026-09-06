import assert from "node:assert/strict";
import test from "node:test";

import {
  EQUIVALENCE_STATUSES,
  EXPOSURE_POLICIES,
  FORM_BANK_RECORD_SCHEMA_ID,
  FORM_CLASS_REGISTRY,
  FORM_CLASSES,
  formBankRecord
} from "../../lib/form-class.mjs";
import { formManifest } from "../../lib/suite.mjs";

// ---------------------------------------------------------------------------------------------
// Form classes and the machine-readable registry (#585)
//
// The four classes are the specification's, by name. The registry is what makes them
// machine-readable: a consumer that wants to know whether a WARMUP administration may reach an
// official cycle reads the registry field, not a comment.

test("form class registry declares the four classes with their scoring and exposure policy", () => {
  assert.deepEqual([...FORM_CLASSES], ["WARMUP", "PRACTICE", "OPERATIONAL", "TRANSFER"]);
  assert.deepEqual(Object.keys(FORM_CLASS_REGISTRY).sort(), [...FORM_CLASSES].sort());
  for (const classId of FORM_CLASSES) {
    const entry = FORM_CLASS_REGISTRY[classId];
    assert.equal(entry.class_id, classId);
    assert.equal(typeof entry.scored, "boolean");
    assert.equal(typeof entry.official_cycle_eligible, "boolean");
    assert.equal(typeof entry.repeatable, "boolean");
    assert.equal(EXPOSURE_POLICIES.includes(entry.exposure_policy), true, `${classId} names an unknown exposure policy`);
  }
  // The specification's own table: warmup and practice are never scored, an operational form is
  // scored once, transfer is research-lane only.
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.official_cycle_eligible, true);
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy, "scored-once");
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.exposure_policy, "research-only");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.repeatable, false);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY), true);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY.OPERATIONAL), true);
});

test("a form bank record derives its policy from its class and refuses a contradiction", () => {
  const record = formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C3.RD.01"],
    language: "ko",
    interface: "agent-relay",
    model_profile_class: "cli-agent",
    oracle_digest: `sha256:${"a".repeat(64)}`
  });
  assert.equal(record.schema_id, FORM_BANK_RECORD_SCHEMA_ID);
  assert.equal(record.exposure_policy, "scored-once");
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(Object.isFrozen(record), true);
  // A record that declares a policy its class contradicts is refused rather than trusted: the
  // registry, not the stored artifact, owns the policy. A stored artifact that authorizes itself
  // is this repository's second-oldest defect class.
  assert.throws(() => formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "WARMUP",
    construct_opportunity_ids: [],
    oracle_digest: `sha256:${"a".repeat(64)}`,
    exposure_policy: "scored-once"
  }), /AOS_FORM_POLICY_CONTRADICTION/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "EXAM", construct_opportunity_ids: [], oracle_digest: `sha256:${"a".repeat(64)}` }), /AOS_FORM_CLASS_UNKNOWN/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "OPERATIONAL", construct_opportunity_ids: [], oracle_digest: "not-a-digest" }), /AOS_FORM_ORACLE_DIGEST/);
});

test("a form bank record cannot declare itself linked; equivalence stays unestablished without linking evidence", () => {
  // `equivalence_status` is derived, never accepted from the caller: a bank record that could say
  // LINKED about itself would be a stored artifact authorizing its own strongest claim.
  const record = formBankRecord({
    form_id: "FAM-1.form-2b",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C1.GF.01"],
    oracle_digest: `sha256:${"b".repeat(64)}`,
    equivalence_status: "LINKED"
  });
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(record.equivalence_status), true);
});

test("the shipped operational form manifest speaks the form class contract's own words", () => {
  const manifest = formManifest("2a");
  assert.equal(manifest.form_class, "OPERATIONAL");
  assert.equal(manifest.exposure_policy, FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy);
  // #585's enum, not the pre-#585 word. "UNCALIBRATED" was a status no contract declared; two
  // vocabularies for one tri-state question is the representation collapse this repository has
  // produced five times.
  assert.equal(manifest.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(manifest.equivalence_status), true);
  for (const family of Object.keys(manifest.family_manifests)) {
    const row = manifest.family_manifests[family];
    assert.equal(EQUIVALENCE_STATUSES.includes(row.equivalence_status), true, `${family} claims a form relation outside the #585 vocabulary`);
    assert.equal(row.equivalence_status, "UNESTABLISHED", `${family} claims a form relation this suite has no linking evidence for`);
  }
});
