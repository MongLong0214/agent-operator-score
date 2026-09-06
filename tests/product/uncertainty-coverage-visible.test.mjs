import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256Value } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { contractDigests, evaluate, subcheckMapping } from "../../lib/ecd-contract.mjs";
import { bindFacetRecords } from "../../lib/facet-calibration.mjs";
import { renderProfileTerminal } from "../../lib/profile-report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { buildResult, projectResult } from "../../lib/result-schema.mjs";
import { createRun, initHome, writeResult } from "../../lib/store.mjs";
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

// The dashboard row, rendered the way an operator actually reads it: through a home directory and a
// live server, not a projection called directly. #568 round 2 found this surface byte-identical for
// two results that differ only in uncertainty or coverage -- a table that prints the number but not
// what distinguishes it is the hero this release removed, handed back by omission. A fresh home per
// call keeps each result's row from colliding with another test's.
const renderDashboardRow = async (result) => {
  const home = mkdtempSync(join(tmpdir(), "aos-uncertainty-visible-"));
  try {
    initHome(home);
    const { runId } = createRun(home, { mode: "TEST", run_id: "run-1" });
    writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
    const dashboard = await startDashboard({ home });
    try {
      return await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    } finally {
      await dashboard.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const renderings = async (result) => ({
  markdown: renderMarkdown(result),
  html: renderHtml(result),
  card: renderCard(result),
  terminal: renderProfileTerminal(result).join("\n"),
  dashboard: await renderDashboardRow(result)
});

test("same value, different uncertainty: every surface tells the two results apart by status and interval", async () => {
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
  const uncalibratedPages = await renderings(uncalibrated);
  const calibratedPages = await renderings(calibrated);
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

test("same value, different coverage: every surface tells the two results apart by the coverage counts", async () => {
  const withRecords = build(bound(), { require_facet_records: true });
  const without = build(observationsWith());
  const covered = projectResult(withRecords);
  const uncovered = projectResult(without);
  assert.equal(covered.process.index, uncovered.process.index);
  assert.notEqual(covered.claim.facet_coverage, uncovered.claim.facet_coverage);
  assert.equal(covered.claim.uncertainty_counts, "forms 6 · tasks 20 · occasions 1");
  assert.equal(uncovered.claim.uncertainty_counts, "forms 0 · tasks 20 · occasions 0");
  const coveredPages = await renderings(withRecords);
  const uncoveredPages = await renderings(without);
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

// The universe declaration is operator-authored free text this file does not own the length of.
// The card used to print it and the interval on one clipped line, so a declaration long enough to
// fill the clip pushed the interval past the ellipsis and off the card -- the exact number this
// file exists to keep visible, lost to a supported input the earlier fixture was kept short to
// avoid. The fixture below is longer than the card's own clip width, on purpose.
const LONG_UNIVERSE_DECLARATION =
  "held-out enterprise support conversations from paid-tier customers writing in English, drawn " +
  "from the same population as the training corpus but excluding every conversation that appeared " +
  "in a labeled training or validation split, restricted to conversations opened in the twelve " +
  "months before this run and never reused across cycles";

test("a long universe declaration does not clip the interval off the profile card", () => {
  const calibrated = build(bound(), {
    require_facet_records: true,
    calibration_evidence: {
      ...CALIBRATION,
      population: { ...CALIBRATION.population, universe_declaration: LONG_UNIVERSE_DECLARATION }
    }
  });
  const view = projectResult(calibrated);
  assert.equal(view.claim.universe, LONG_UNIVERSE_DECLARATION);
  const card = renderCard(calibrated);
  assert.ok(
    card.includes(`interval ${view.claim.uncertainty_interval}`),
    "the card drops the interval when the universe declaration is long"
  );
});
