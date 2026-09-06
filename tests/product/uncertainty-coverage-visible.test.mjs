import assert from "node:assert/strict";
import test from "node:test";

import { sha256Value } from "../../lib/core.mjs";
import { contractDigests, evaluate, subcheckMapping } from "../../lib/ecd-contract.mjs";
import { bindFacetRecords } from "../../lib/facet-calibration.mjs";
import { renderProfileTerminal } from "../../lib/profile-report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { buildResult, projectResult } from "../../lib/result-schema.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";

// verify:uncertainty-visible · verify:coverage-visible
//
// #568 replaces the band with what a band pretended to summarise: how sure the measurement is and
// what it covered. That replacement only means something if two results with the same number and
// different uncertainty -- or the same number and different coverage -- are visibly two different
// results on every surface, and if the strings that distinguish them are in the headline subset
// every surface is held to, not just on the pages. A reader who sees `100.0` twice and cannot
// tell the calibrated run from the uncalibrated one has been handed the hero this release
// removed, reconstructed by omission.

const digest = (value) => `sha256:${sha256Value(value)}`;
const contract = contractWithAPopulatedIndex();
const mapping = subcheckMapping(contract);
const cellsByMetric = Object.fromEntries(observationsWith().map((row) => [row.metric_id,
  [...new Set(mapping.filter((entry) => entry.metric_id === row.metric_id).map((entry) => entry.cell_id))]
]));
const familyByMetric = Object.fromEntries(observationsWith().map((row) => [row.metric_id,
  mapping.find((entry) => entry.metric_id === row.metric_id)?.form_id ?? "FAM-1"
]));
const bound = () => bindFacetRecords(observationsWith(), {
  contract_digest: contractDigests(contract).combined,
  cells_by_metric: cellsByMetric,
  family_by_metric: familyByMetric,
  difficulty_version: digest("operational-form.v1"),
  model_profile_digest: identified.profile_digest,
  runtime_harness_digest: digest({ harness: "h1", runtime: "r1" }),
  occasion_id: "occasion-1",
  sequence_position: 1,
  language: "en",
  interface: "cli"
});
// Kept short on purpose: the card prints `universe … · interval …` on one clipped line, and a
// universe long enough to push the interval past the clip would hide exactly what this file
// exists to keep visible.
const CALIBRATION = Object.freeze({
  population: { prospective_empirical: true, universe_declaration: "local fixture universe" },
  method: "g-theory-bootstrap",
  method_version: "1.0.0",
  interval: [82.1, 91.4],
  variance_components: { person: 0.4 }
});
const build = (observations, context = {}) => buildResult({
  contract,
  evaluation: evaluate(observations, { ...identified, ...context }, contract),
  observations
});
const renderings = (result) => ({
  markdown: renderMarkdown(result),
  html: renderHtml(result),
  card: renderCard(result),
  terminal: renderProfileTerminal(result).join("\n")
});

test("same value, different uncertainty: every surface tells the two results apart by status and interval", () => {
  const uncalibrated = build(bound(), { require_facet_records: true });
  const calibrated = build(bound(), { require_facet_records: true, calibration_evidence: CALIBRATION });
  const before = projectResult(uncalibrated);
  const after = projectResult(calibrated);
  // The number is identical; the measurement claim is not.
  assert.equal(before.process.index, after.process.index);
  assert.equal(before.claim.uncertainty, "INSUFFICIENT_DATA");
  assert.equal(after.claim.uncertainty, "COMPUTED");
  assert.equal(before.claim.uncertainty_interval, "null");
  assert.equal(after.claim.uncertainty_interval, "82.1–91.4");
  const uncalibratedPages = renderings(uncalibrated);
  const calibratedPages = renderings(calibrated);
  // The reliance rows legitimately say NOT_COMPUTED, so the status word is matched with its own
  // boundary rather than as a substring of a different word.
  const saysComputed = (output) => /(?<!NOT_)COMPUTED/u.test(output);
  for (const [name, output] of Object.entries(uncalibratedPages)) {
    assert.ok(output.includes("INSUFFICIENT_DATA"), `${name} hides the uncalibrated status`);
    assert.equal(saysComputed(output), false, `${name} claims a computed uncertainty nobody computed`);
    assert.equal(output.includes("82.1–91.4"), false, `${name} claims an interval nobody computed`);
  }
  for (const [name, output] of Object.entries(calibratedPages)) {
    assert.ok(saysComputed(output), `${name} hides the computed status`);
    assert.ok(output.includes("82.1–91.4"), `${name} hides the interval`);
    assert.notEqual(output, uncalibratedPages[name], `${name} renders the two results identically`);
  }
});

test("same value, different coverage: every surface tells the two results apart by the coverage counts", () => {
  const withRecords = build(bound(), { require_facet_records: true });
  const without = build(observationsWith());
  const covered = projectResult(withRecords);
  const uncovered = projectResult(without);
  assert.equal(covered.process.index, uncovered.process.index);
  assert.notEqual(covered.claim.facet_coverage, uncovered.claim.facet_coverage);
  assert.equal(covered.claim.uncertainty_counts, "forms 6 · tasks 20 · occasions 1");
  assert.equal(uncovered.claim.uncertainty_counts, "forms 0 · tasks 20 · occasions 0");
  const coveredPages = renderings(withRecords);
  const uncoveredPages = renderings(without);
  for (const [name, output] of Object.entries(coveredPages)) {
    assert.ok(output.includes(covered.claim.uncertainty_counts), `${name} hides the coverage counts`);
    assert.ok(output.includes(covered.claim.facet_coverage), `${name} hides the facet coverage`);
    assert.notEqual(output, uncoveredPages[name], `${name} renders the two results identically`);
  }
  for (const [name, output] of Object.entries(uncoveredPages)) {
    assert.ok(output.includes(uncovered.claim.uncertainty_counts), `${name} hides the zero coverage`);
  }
});

test("the interval and the coverage counts are headline phrases, held to every surface", () => {
  // `view.headline` is the subset a surface may not drop -- the terminal summary is held to it by
  // verify:projection-consistency. Status alone was in it; the interval and the counts were only
  // page phrases, so a surface could say COMPUTED and drop the interval that makes COMPUTED mean
  // anything. Distinguishability is a property of every surface or it is not a property.
  const view = projectResult(build(bound(), { require_facet_records: true, calibration_evidence: CALIBRATION }));
  for (const phrase of [view.claim.uncertainty_interval, view.claim.uncertainty_counts, view.claim.facet_coverage]) {
    assert.ok(view.headline.includes(phrase), `headline omits ${phrase}`);
  }
});

test("uncertainty and coverage cannot be hidden by deleting them from a stored result", () => {
  // The schema requires both, and projectResult refuses a result the schema rejects -- so there is
  // no rendering path on which a stored result simply loses its uncertainty block.
  const result = build(bound(), { require_facet_records: true });
  const { uncertainty, ...withoutUncertainty } = structuredClone(result);
  assert.throws(() => projectResult(withoutUncertainty), /AOS_RESULT_SCHEMA_INVALID/u);
  const { facet_coverage, ...withoutCoverage } = structuredClone(result);
  assert.throws(() => projectResult(withoutCoverage), /AOS_RESULT_SCHEMA_INVALID/u);
});
