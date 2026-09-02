// Fixtures shared by every test that scores through the #582 contract.
//
// Lifted out of ecd-aggregation.test.mjs when #559 needed the same populated contract. The helper
// is deliberately the only way these tests obtain an issuable process index: the shipped contract
// withholds it by construction, and six hand-written construct rows once issued 0.75 against a
// module documenting the index as withheld -- a fixture that bypasses the contract is a test of
// nothing.

import { sha256Value } from "../../lib/core.mjs";
import { loadEcdContract, sealEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";

export const complete = { forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] };

// The identity `comparability` compares. A run that names every identity facet and a profile digest
// is what PROFILE_BOUND is defined over; `complete` alone stops at RUN_DIAGNOSTIC.
export const facets = Object.freeze({ language: "en", interface: "cli", model: "m1", runtime: "r1", harness: "h1", operator: "alice", occasion: 1 });
// A digest, not a label. `sha256:aaa` is three nibbles and cannot bind an exact profile, which is
// what a profile-bound claim rests on; the fixture states a real one so the tests exercise the
// shape the product requires rather than a shorthand only the tests accept.
export const FIXTURE_PROFILE_DIGEST = `sha256:${sha256Value({ fixture: "aos-profile-fixture.v1" })}`;
export const identified = Object.freeze({ ...complete, facets, profile_digest: FIXTURE_PROFILE_DIGEST });

/** `overrides` maps a metric id to a verdict, a subcheck map, or null for "not observed at all". */
export const observationsWith = (overrides = {}) => METRIC_IDS.map((id) => {
  const override = Object.hasOwn(overrides, id) ? overrides[id] : true;
  if (override === null) return observationOf({ metric_id: id, reason: "not observed in this run" });
  // `??` would turn a deliberate null into false, which is the difference between "the run did not
  // answer this" and "the run got it wrong" -- the exact distinction these tests exist to check.
  const verdict = (subcheck) => (typeof override === "object" && Object.hasOwn(override, subcheck) ? override[subcheck] : typeof override === "object" ? false : override);
  return observationOf({
    metric_id: id,
    verifier_id: "test.v1",
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: verdict(subcheck) })),
    reason: "test"
  });
});

/**
 * A contract in which every construct in the index has a populated operator-process cell.
 *
 * The shipped contract cannot issue the index, and that is the finding rather than a gap. But it
 * leaves the only state the aggregation arithmetic computes in untested, and the first version of
 * the aggregation test bought that coverage by handing `processIndex` six rows written by hand.
 * Those rows issued 0.75 while the module documented the index as withheld by construction -- the
 * helper had a test proving it would bypass the contract.
 *
 * The coverage is bought here the only way that means anything: a different contract, built by
 * moving one declared subcheck into each unpopulated operator-process cell, and put through the
 * same verifier and the same seal as the shipped one. If any of these edits broke a rule,
 * `sealEcdContract` throws and the test fails rather than measuring an arrangement the contract
 * forbids.
 */
export const POPULATED = [
  { target: "C1.OF.01", donor: "C1.GF.01", form: "FAM-1" },
  { target: "C2.OD.01", donor: "C2.CS.01", form: "FAM-2" },
  { target: "C5.VD.01", donor: "C5.FO.01", form: "FAM-5" },
  { target: "C6.OG.01", donor: "C6.BP.01", form: "FAM-6" }
];

export const contractWithAPopulatedIndex = () => {
  const doc = JSON.parse(JSON.stringify(loadEcdContract()));
  const cellById = new Map(doc.cells.cells.map((one) => [one.cell_id, one]));
  for (const { target, donor, form: formId } of POPULATED) {
    const from = cellById.get(donor);
    const to = cellById.get(target);
    const moved = from.subcheck_ids.pop();
    from.minimum_opportunities = from.subcheck_ids.length;
    // The subcheck keeps the family that administers it; what moves is which cell it stands for.
    const administration = from.subcheck_administered_by.find((entry) => entry.subcheck_id === moved);
    from.subcheck_administered_by = from.subcheck_administered_by.filter((entry) => entry.subcheck_id !== moved);
    to.subcheck_administered_by = [administration];
    to.subcheck_ids = [moved];
    to.population_status = "SUBCHECK_BACKED";
    to.scoring_rule_id = "subcheck-mean.v1";
    to.minimum_opportunities = 1;
    to.minimum_opportunities_basis = "DECLARED_COVERAGE";
    to.minimum_opportunities_source = null;
    // The cell may be scored only once its authority can observe the whole claim, so populating it
    // means answering the deferred half rather than dropping the field.
    to.deferred_claim = null;
    to.task_opportunity.form_ids = [formId];
    const form = doc.task_model.forms.find((one) => one.form_id === formId);
    form.construct_opportunity_cell_ids.push(target);
    form.required_cell_ids.push(target);
  }
  doc.task_model.unadministered_opportunity_sources = doc.task_model.unadministered_opportunity_sources
    .filter((source) => source.source_id !== "operator-authored-plan");
  return sealEcdContract(doc);
};

/**
 * The shipped contract with two outcome cells moved between domains.
 *
 * Not a different instrument: the same cells, the same estimates, grouped differently. It exists so
 * a test can prove the outcome grouping is read from the contract rather than held in lib/ -- move
 * it here and the domains and the index follow, which a hardcoded list could not do.
 */
export const contractWithSwappedDomains = () => {
  const doc = JSON.parse(JSON.stringify(loadEcdContract()));
  const swap = (id) => (id === "C5.FO.01" ? "C6.SL.01" : id === "C6.SL.01" ? "C5.FO.01" : id);
  for (const domain of doc.construct_map.outcome_domains.domains) domain.cell_ids = domain.cell_ids.map(swap);
  return sealEcdContract(doc);
};

/** The shipped contract with the outcome grouping taken out, so the refusal can be tested. */
export const contractWithoutDomains = () => {
  const doc = JSON.parse(JSON.stringify(loadEcdContract()));
  doc.construct_map.outcome_domains.domains = [];
  // Sealed past its own schema on purpose: what is under test is the reader refusing a contract
  // that declares no grouping, not the contract checker refusing to seal one.
  return { ...sealEcdContract(loadEcdContract()), construct_map: doc.construct_map };
};
