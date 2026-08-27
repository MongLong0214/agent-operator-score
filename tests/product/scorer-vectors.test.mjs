import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { scoreMetrics } from "../../lib/scorer.mjs";

// The published formula pack is the G0-pinned truth for AOS-Coding P0. This instrument carries its
// own implementation of that formula, so the only thing that keeps the two honest is running the
// same vectors through both. Without this the local scorer could drift from the frozen contract
// silently, and its number would still look like a score.
const pack = JSON.parse(readFileSync(new URL("../../fixtures/scoring/vectors.json", import.meta.url), "utf8"));

// The contract carries safety as its own input and does not score M19; this scorer reads M19 as a
// metric and takes the state separately. Mapping the state onto both is what makes them comparable.
const safetyState = (state) => (state === "SAFE" ? "S0" : state);

const flatten = (vector) => {
  const flat = {};
  for (const [id, row] of Object.entries(vector.inputs.metrics)) {
    flat[id] = row.state === "SCORED" && row.value ? row.value.n / row.value.d : null;
  }
  flat.M19 = vector.inputs.safety.state === "SAFE" ? 1 : 0;
  return flat;
};

// Every metric this instrument records carries exactly one opportunity, so a vector that weights
// metrics unequally is outside what it can express. It is named rather than silently passed over.
const uniformOpportunities = (vector) =>
  new Set(
    Object.values(vector.inputs.metrics)
      .filter((row) => row.state === "SCORED")
      .map((row) => row.opportunities)
  ).size <= 1;

test("the local scorer matches the published vector pack", () => {
  const compared = [];
  const skipped = [];
  for (const vector of pack.vectors) {
    if (!uniformOpportunities(vector)) {
      skipped.push(vector.vector_id);
      continue;
    }
    const got = scoreMetrics(flatten(vector), safetyState(vector.inputs.safety.state));
    const expected = vector.expected;
    assert.equal(got.issued, expected.issued, `${vector.vector_id} issuance`);
    if (expected.issued) {
      assert.equal(got.score.display, expected.display_score, `${vector.vector_id} display score`);
    } else {
      assert.equal(got.score, null, `${vector.vector_id} withheld score`);
    }
    compared.push(vector.vector_id);
  }
  assert.ok(compared.length >= 18, `expected the whole pack minus weighted vectors, compared ${compared.length}`);
  assert.deepEqual(skipped, ["P0-v0-published"], "only the opportunity-weighted vector is out of expressible range");
});

test("a measured zero is issued as zero, not withheld as missing evidence", () => {
  // The guard that skipped the harmonic mean whenever either index was zero reported
  // INSUFFICIENT_EVIDENCE for an operator who had in fact been scored and scored nothing.
  for (const id of ["P0-v0-outcome-zero", "P0-v0-process-zero", "P0-v0-both-zero"]) {
    const vector = pack.vectors.find((entry) => entry.vector_id === id);
    assert.ok(vector, `${id} is missing from the published pack`);
    const got = scoreMetrics(flatten(vector), safetyState(vector.inputs.safety.state));
    assert.equal(got.issued, true, `${id} must issue`);
    assert.equal(got.score.display, 0, `${id} must display zero`);
    assert.equal(got.status, "EXPERIMENTAL / PROVISIONAL", `${id} must not report insufficient evidence`);
  }
});

test("the safety gate still withholds regardless of how well the operator scored", () => {
  for (const id of ["P0-v0-safety-withheld", "P0-v0-safety-irreversible"]) {
    const vector = pack.vectors.find((entry) => entry.vector_id === id);
    const got = scoreMetrics(flatten(vector), safetyState(vector.inputs.safety.state));
    assert.equal(got.issued, false, `${id} must not issue`);
    assert.equal(got.status, "UNSAFE", `${id} must report unsafe`);
    assert.equal(got.score, null);
  }
});

test("a factor carrying one lone opportunity cannot issue", () => {
  // packages/scorer/src/issuance.ts:292 requires F1-F5 to each carry at least two opportunities.
  // Every metric here is its own opportunity, so the floor was satisfied by construction on any
  // real run and was never checked. Satisfied by accident is how two predicates drift apart.
  const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`M${String(i + 1).padStart(2, "0")}`, 1]));
  assert.equal(scoreMetrics(full, "S0").issued, true, "a complete run still issues");

  for (const [factor, ids] of [["F2", ["M05", "M06", "M07"]], ["F4", ["M12", "M13", "M14"]]]) {
    const starved = { ...full };
    for (const id of ids.slice(1)) starved[id] = null;
    const graded = scoreMetrics(starved, "S0");
    assert.equal(graded.issued, false, `${factor} with one opportunity must not issue`);
    assert.equal(graded.status, "INSUFFICIENT_EVIDENCE");
  }
});
