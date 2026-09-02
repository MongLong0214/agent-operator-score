import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, htmlEscape } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { evaluate } from "../../lib/ecd-contract.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { loadSchema, validateAgainstSchema } from "../../lib/execution-plan.mjs";
import { RESULT_SCHEMA_URL, SECTION_ORDER, buildResult, projectResult } from "../../lib/result-schema.mjs";
import { createRun, initHome, runPaths, writeResult } from "../../lib/store.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { run as runCli } from "./helpers.mjs";

// verify:projection-consistency
//
// One canonical result, every renderer, the same values and the same phrases. The renderers get a
// projection -- strings already formatted -- and print it; none of them owns an arithmetic. The test
// that makes that claim checkable is the forged result at the bottom: stored numbers that disagree
// with the rows they were computed from, rendered as stored. A renderer that recomputed would print
// the consistent number and fail here.

const populated = contractWithAPopulatedIndex();
const build = (overrides = {}, options = {}) => buildResult({
  contract: populated,
  evaluation: evaluate(observationsWith(overrides), identified, populated),
  run: { run_id: "run-projection", seed: "seed-1" },
  ...options
});

// Two mixed states: C4 at one half, C5.IV.01 at one half, O3 withheld for a cell nobody observed,
// so the projection carries issued numbers, a withheld index, a withheld composite, and reasons.
const mixed = () => build({
  M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true },
  M15: { "verifier-process-separate": false, "verifier-code-immutable": false, "verifier-exits-success": true, "verifier-evidence-complete": true },
  M17: null
});

const contains = (output, phrase) => output.includes(phrase) || output.includes(htmlEscape(phrase));
const positionOf = (output, phrase) => {
  const at = output.indexOf(phrase) >= 0 ? output.indexOf(phrase) : output.indexOf(htmlEscape(phrase));
  assert.ok(at >= 0, `missing: ${phrase}`);
  return at;
};

const fullRenderers = (result) => ({
  markdown: renderMarkdown(result),
  html: renderHtml(result),
  card: renderCard(result)
});

test("the projection is built from the stored numbers alone and survives a JSON round trip", () => {
  const result = mixed();
  const view = projectResult(result);
  assert.deepEqual(projectResult(JSON.parse(canonicalJson(result))), view);
  assert.ok(Object.isFrozen(view));
  assert.equal(view.process.index, "91.7");
  assert.equal(view.outcome.index, "withheld");
  assert.equal(view.composite.value, "withheld");
  assert.equal(view.process.rows.find((row) => row.id === "C4").value, "50.0");
  assert.equal(view.outcome.rows.find((row) => row.id === "O2").value, "75.0");
  assert.equal(view.outcome.rows.find((row) => row.id === "O3").value, "withheld");
  assert.equal(view.outcome.rows.find((row) => row.id === "O3").reason, "C5.CI.01 NOT_OBSERVED");
  assert.ok(view.phrases.includes(view.summary));
  assert.deepEqual(view.sections.map((section) => section.key), [...SECTION_ORDER]);
  assert.deepEqual(SECTION_ORDER, ["operator_process", "reliance_calibration", "system_outcome", "aos_composite", "claim"]);
});

test("every renderer prints every phrase of the projection -- the card included, and the reliance metrics with it", () => {
  // One list, three renderings. Holding the card to a smaller subset is how it came to omit all
  // ten reliance metrics and every forbidden use: a summary that leaves out what the result may not
  // be used for is not a summary of that result. `headline` remains as the subset a reader sees
  // first, and it is checked as a subset rather than as a lower bar.
  const result = mixed();
  const view = projectResult(result);
  assert.ok(view.phrases.length >= 40, `only ${view.phrases.length} phrases`);
  assert.ok(view.headline.length >= 8);
  for (const phrase of view.headline) assert.ok(view.phrases.includes(phrase), `headline phrase not in phrases: ${phrase}`);
  for (const [name, output] of Object.entries(fullRenderers(result))) {
    for (const phrase of view.phrases) assert.ok(contains(output, phrase), `${name} lacks: ${phrase}`);
  }
});

test("a reliance metric that was computed is printed with its value in every renderer, not summarised away", () => {
  // The reviewer's case: cair issued at 0.75 appeared in the markdown and the html and in neither
  // the card's rows nor its numbers, because the card printed the surface's status and stopped.
  const result = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith(), identified, populated),
    reliance: { status: "PARTIAL", metrics: { cair: { value: 0.75, status: "ISSUED", numerator: 3, denominator: 4 } } }
  });
  const view = projectResult(result);
  assert.equal(view.reliance.rows.length, 10);
  assert.equal(view.reliance.rows.find((row) => row.id === "cair").value, "0.75");
  for (const [name, output] of Object.entries(fullRenderers(result))) {
    for (const row of view.reliance.rows) {
      assert.ok(contains(output, `${row.id}: ${row.value}`), `${name} lacks reliance metric ${row.id}`);
    }
    assert.ok(contains(output, "0.75"), `${name} lacks the value cair was issued at`);
  }
});

test("every renderer shows the surfaces in the mandated order: process, reliance, outcome, composite, claim", () => {
  const result = mixed();
  const view = projectResult(result);
  const titles = view.sections.map((section) => section.title);
  for (const [name, output] of Object.entries(fullRenderers(result))) {
    const positions = titles.map((title) => positionOf(output, title));
    for (let index = 1; index < positions.length; index += 1) {
      assert.ok(positions[index] > positions[index - 1], `${name}: ${titles[index]} appears before ${titles[index - 1]}`);
    }
  }
});

test("a withheld index is shown with its reason in every renderer, never blank and never a number", () => {
  const result = mixed();
  const view = projectResult(result);
  const outcomeReason = view.outcome.rows.find((row) => row.id === "O3").reason;
  assert.equal(outcomeReason, "C5.CI.01 NOT_OBSERVED");
  for (const [name, output] of Object.entries(fullRenderers(result))) {
    assert.ok(contains(output, outcomeReason), `${name} hides the withheld reason`);
    assert.ok(contains(output, "withheld"), `${name} does not say withheld`);
  }
  assert.ok(contains(renderCard(result), view.outcome.withheld_summary));
  assert.equal(view.outcome.withheld_summary, "withheld · O3");
});

test("the dashboard run page and index row are the same projection", async () => {
  const result = mixed();
  const view = projectResult(result);
  const home = mkdtempSync(join(tmpdir(), "aos-projection-"));
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST", run_id: "run-projection" });
  writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
  const dashboard = await startDashboard({ home });
  try {
    const page = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/run/${runId}?t=${dashboard.token}`)).text();
    assert.equal(page, renderHtml(result));
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    assert.equal(view.summary, "process 91.7 · outcome withheld · composite withheld");
    assert.ok(contains(index, view.summary), "dashboard index row lacks the projection summary");
    assert.ok(contains(index, view.claim.stage));
    assert.equal(index.includes("HIGH RELIABILITY"), false);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the CLI report and recover commands serve and regenerate the same rendering of a stored result", () => {
  const result = mixed();
  const cwd = mkdtempSync(join(tmpdir(), "aos-projection-cli-"));
  const home = join(cwd, ".aos");
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST", run_id: "run-projection" });
  writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
  try {
    const shown = runCli(cwd, ["report", "--run", runId]);
    assert.equal(shown.stdout.trimEnd(), renderMarkdown(result).trimEnd());
    const recovered = JSON.parse(runCli(cwd, ["session", "recover", runId, "--json"]).stdout);
    assert.equal(recovered.action, "COMMIT_TERMINAL_ONCE");
    assert.deepEqual(recovered.reports, { regenerated: false, reason: "reports match the result" });
    assert.equal(readFileSync(runPaths(home, runId).reportMd, "utf8"), renderMarkdown(result));
    assert.equal(readFileSync(runPaths(home, runId).reportHtml, "utf8"), renderHtml(result));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("renderers print the stored numbers rather than recomputing them, and refuse a stored result whose own fields disagree", () => {
  // Two properties, and the second is what the first cost before: a renderer that prints what is
  // stored will print whatever is stored, so the reading has to be refused at the point where the
  // stored fields contradict each other rather than trusted because the arithmetic was checked once
  // at build time.
  //
  // Recomputes nothing: the composite is what the file says, not the mean of the two indices
  // beside it. All three moved together here so the result still says one consistent thing.
  const forged = JSON.parse(canonicalJson(build()));
  forged.aos_composite.value = 12.3;
  forged.operator_process_profile.index = 55.5;
  forged.system_outcome_profile.index = 66.5;
  const view = projectResult(forged);
  assert.equal(view.composite.value, "12.3");
  assert.equal(view.process.index, "55.5");
  assert.equal(view.outcome.index, "66.5");
  assert.equal(view.process.rows.every((row) => row.value === "100.0"), true);
  for (const [name, output] of Object.entries(fullRenderers(forged))) {
    assert.ok(contains(output, "12.3"), `${name} recomputed the composite`);
    assert.ok(contains(output, "55.5"), `${name} recomputed the process index`);
    assert.ok(contains(output, "66.5"), `${name} recomputed the outcome index`);
    assert.equal(contains(output, "61.0"), false, `${name} printed the mean of the stored indices`);
  }

  // And refuses: a withheld surface with a number written over its index is the one reading this
  // instrument may never produce, whatever the file says.
  const withheld = JSON.parse(canonicalJson(buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M12: null }), identified, populated) })));
  assert.equal(withheld.operator_process_profile.index, null);
  assert.equal(typeof withheld.operator_process_profile.withheld_reason, "string");
  const zeroed = JSON.parse(JSON.stringify(withheld));
  zeroed.operator_process_profile.index = 0;
  for (const call of [() => projectResult(zeroed), () => renderMarkdown(zeroed), () => renderHtml(zeroed), () => renderCard(zeroed)]) {
    assert.throws(call, /AOS_ISSUANCE_STATE/);
  }
  // The same, the other way round and one row down.
  const unreasoned = JSON.parse(JSON.stringify(withheld));
  unreasoned.operator_process_profile.withheld_reason = null;
  assert.throws(() => projectResult(unreasoned), /AOS_ISSUANCE_STATE/);
  const zeroedRow = JSON.parse(JSON.stringify(withheld));
  zeroedRow.operator_process_profile.constructs.C4.value = 0;
  assert.throws(() => projectResult(zeroedRow), /AOS_ISSUANCE_STATE/);
  const issuedWithoutNumber = JSON.parse(canonicalJson(build()));
  issuedWithoutNumber.system_outcome_profile.index = null;
  assert.throws(() => projectResult(issuedWithoutNumber), /AOS_ISSUANCE_STATE/);
  // And the schema says it too, for the consumer who is not this repository.
  assert.equal(validateAgainstSchema(zeroed, loadSchema(RESULT_SCHEMA_URL)).ok, false);
  assert.equal(validateAgainstSchema(unreasoned, loadSchema(RESULT_SCHEMA_URL)).ok, false);
  assert.equal(validateAgainstSchema(withheld, loadSchema(RESULT_SCHEMA_URL)).ok, true);
});

test("a withheld surface carries its reason wherever it is printed, whatever its stored index says", () => {
  const withheld = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M12: null }), identified, populated) });
  const view = projectResult(withheld);
  assert.match(view.process.withheld_summary, /^withheld · /u);
  assert.equal(view.process.index, "withheld");
  assert.match(view.composite.withheld_summary, /^withheld · /u);
  assert.equal(view.process.rows.find((row) => row.id === "C4").reason.length > 0, true);
  for (const [name, output] of Object.entries(fullRenderers(withheld))) {
    assert.ok(contains(output, view.process.withheld_summary), `${name} printed a withheld process index without its reason`);
    assert.ok(contains(output, view.composite.withheld_summary), `${name} printed a withheld composite without its reason`);
  }
});

test("a legacy result is not projected", () => {
  assert.throws(() => projectResult({ schema_id: "aos-mvp-result.v1", score: { final: 88 } }), /AOS_LEGACY_RESULT_NOT_PROJECTED/);
  // And a record of neither instrument is refused as unknown rather than read as either.
  assert.throws(() => projectResult({ status: "SCORED" }), /AOS_UNKNOWN_RESULT_SCHEMA/);
  assert.throws(() => projectResult({ schema_id: "attacker-result.v99", score: { final: 100 } }), /AOS_UNKNOWN_RESULT_SCHEMA/);
});
