import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, htmlEscape } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { evaluate } from "../../lib/ecd-contract.mjs";
import { hardCapsFor } from "../../lib/hard-caps.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderProfileTerminal } from "../../lib/profile-report.mjs";
import { loadSchema, validateAgainstSchema } from "../../lib/execution-plan.mjs";
import { RESULT_SCHEMA_URL, SECTION_ORDER, buildResult, projectResult } from "../../lib/result-schema.mjs";
import { createRun, initHome, runPaths, writeResult } from "../../lib/store.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { observedCleanEffects, run as runCli } from "./helpers.mjs";
import { observeRun } from "../../lib/observe.mjs";
import { shippedEcdContract } from "../../lib/ecd-contract.mjs";

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

// Every surface a result is shown on, the operator's terminal included. `fullRenderers` above are
// the three that print a whole page and are held to `view.phrases`; the terminal is a summary and
// is held to `view.headline`, which is the subset every surface must carry. It was outside both
// until #566: the oracle named the ceiling lines and the enforcer enumerated three renderers, so
// the terminal could -- and did -- print a withheld index and no ceiling while the other three
// named the violation.
const everySurface = (result) => ({ ...fullRenderers(result), terminal: renderProfileTerminal(result).join("\n") });

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
  // The oracle has to name the content, or "every renderer prints every phrase" is a statement
  // about whatever the list happens to hold. The delegated-artifact rows were not in it, so the
  // card omitted all six and this test went green over the omission -- an oracle that excludes
  // what it should check. Every row of every surface is named here, and so is every line the
  // renderers are required to carry.
  for (const row of [...view.process.rows, ...view.outcome.rows, ...view.composite.artifact_rows]) {
    assert.ok(view.phrases.includes(`${row.id} ${row.title}`), `phrases omits the row ${row.id}`);
    assert.ok(view.phrases.includes(row.value), `phrases omits the value of ${row.id}`);
    if (row.reason) assert.ok(view.phrases.includes(row.reason), `phrases omits the reason on ${row.id}`);
  }
  assert.ok(view.composite.artifact_rows.length > 0, "the fixture has no artifact rows, so this checked nothing");
  for (const line of [view.summary, view.process.coverage, view.outcome.coverage, view.reliance.coverage,
    view.process.index, view.outcome.index, view.composite.value, view.composite.formula,
    view.claim.stage, view.claim.uncertainty, view.claim.generalizability]) {
    assert.ok(view.phrases.includes(line), `phrases omits ${line}`);
  }
  assert.ok(view.headline.length >= 8);
  for (const phrase of view.headline) assert.ok(view.phrases.includes(phrase), `headline phrase not in phrases: ${phrase}`);
  for (const [name, output] of Object.entries(fullRenderers(result))) {
    for (const phrase of view.phrases) assert.ok(contains(output, phrase), `${name} lacks: ${phrase}`);
  }
});

test("the card carries every declared facet and every forbidden use, not the ones that fitted", () => {
  // A card is the rendering somebody forwards on its own, and it was dropping whatever ran past a
  // fixed height: the ninth facet, and any forbidden use after the twelfth. The facets are the
  // conditions the whole result is bound to and the forbidden uses are what it may not be used
  // for, so "did not fit" is the wrong reason for either to be missing. The card grows instead.
  const facets = { ...identified.facets, workspace: "isolated", lane: "container", occasion: 2, seed: "s-1", pack: "aos-suite-v1" };
  const result = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith(), { ...identified, facets }, populated)
  });
  const view = projectResult(result);
  assert.ok(view.claim.facets.length >= 9, `only ${view.claim.facets.length} facets, so nothing was crowded out`);
  const card = renderCard(result);
  for (const facet of view.claim.facets) {
    assert.ok(contains(card, facet), `the card dropped the facet ${facet}`);
  }
  for (const use of view.claim.forbidden_uses) {
    assert.ok(contains(card, use), `the card dropped the forbidden use ${use}`);
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
  // Starting from reports that already match tests nothing about regeneration: it expects
  // `regenerated: false` and gets it whether or not anything is compared. So each projection is
  // damaged in turn -- including `card.svg`, which was outside both the comparison and the
  // recovery callback -- and the command has to serve the result rather than the bytes on disk.
  const result = mixed();
  const cwd = mkdtempSync(join(tmpdir(), "aos-projection-cli-"));
  const home = join(cwd, ".aos");
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST", run_id: "run-projection" });
  const paths = runPaths(home, runId);
  const fresh = () => writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
  fresh();
  try {
    const shown = runCli(cwd, ["report", "--run", runId]);
    assert.equal(shown.stdout.trimEnd(), renderMarkdown(result).trimEnd());
    const recovered = JSON.parse(runCli(cwd, ["session", "recover", runId, "--json"]).stdout);
    assert.equal(recovered.action, "COMMIT_TERMINAL_ONCE");
    assert.deepEqual(recovered.reports, { regenerated: false, reason: "reports match the result" });
    assert.equal(readFileSync(paths.reportMd, "utf8"), renderMarkdown(result));
    assert.equal(readFileSync(paths.reportHtml, "utf8"), renderHtml(result));

    // A report replaced with a number the result does not carry. `aos report` served it verbatim.
    writeFileSync(paths.reportMd, "# Operator Score: 100\n");
    const served = runCli(cwd, ["report", "--run", runId]);
    assert.equal(served.stdout.includes("Operator Score: 100"), false, "the CLI served a report the result does not project to");
    assert.equal(served.stdout.trimEnd(), renderMarkdown(result).trimEnd());
    assert.equal(readFileSync(paths.reportMd, "utf8"), renderMarkdown(result));

    // The same for the HTML, through the format that reads it.
    writeFileSync(paths.reportHtml, "<h1>Operator Score: 100</h1>");
    const servedHtml = runCli(cwd, ["report", "--run", runId, "--format", "html"]);
    assert.equal(servedHtml.stdout.includes("Operator Score: 100"), false);
    assert.equal(readFileSync(paths.reportHtml, "utf8"), renderHtml(result));

    // And the card, deleted and corrupted: recovery said "reports match the result" for both,
    // because the card was on neither list.
    for (const damage of [() => rmSync(paths.card, { force: true }), () => writeFileSync(paths.card, "<svg>100</svg>")]) {
      fresh();
      damage();
      const after = JSON.parse(runCli(cwd, ["session", "recover", runId, "--json"]).stdout);
      assert.equal(after.reports.regenerated, true, "a damaged card was reported as matching the result");
      assert.match(after.reports.reason, /card\.svg/);
      assert.equal(readFileSync(paths.card, "utf8"), renderCard(result));
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a stored result whose numbers disagree with its own rows is refused by name, in every renderer", () => {
  // The reading this test used to require: process 55.5 over six constructs at 100, outcome 66.5
  // over four domains at 100, a composite of 12.3 whose own inputs and raw value said 100 -- and
  // every renderer made to print them faithfully. Faithful to what? No run produces that record.
  //
  // "Renderers recompute nothing" is about the display: a renderer may not work out a number to
  // show, or the page and the record could differ and only the page would be read. It was never a
  // licence to accept a record that contradicts itself. So the reader checks the stored numbers
  // against the stored rows, weights, inputs, raw values and caps, and refuses when they disagree.
  const forgeries = [
    ["the process index against its constructs", (r) => { r.operator_process_profile.index = 55.5; }],
    ["the outcome index against its domains", (r) => { r.system_outcome_profile.index = 66.5; r.system_outcome_profile.raw_index = 66.5; }],
    ["the composite against its own inputs", (r) => { r.aos_composite.value = 12.3; }],
    ["the composite's inputs against the indices beside them", (r) => { r.aos_composite.inputs.operator_process = 42; }],
    ["the composite's raw value against the two raw indices", (r) => { r.aos_composite.raw_value = 42; }],
    ["a construct value against the index that averaged it", (r) => { r.operator_process_profile.constructs.C4.value = 12; r.operator_process_profile.constructs.C4.estimate = 0.12; }],
    ["an outcome index lowered with no cap to name", (r) => { r.system_outcome_profile.index = 39; }]
  ];
  for (const [what, forge] of forgeries) {
    const damaged = JSON.parse(canonicalJson(build()));
    forge(damaged);
    for (const call of [() => projectResult(damaged), () => renderMarkdown(damaged), () => renderHtml(damaged), () => renderCard(damaged)]) {
      assert.throws(call, /AOS_RESULT_INCONSISTENT/, what);
    }
  }

  // And the oldest form of the same defect: a withheld surface with a number written over it. The
  // three fields are one state, so a zero where there is no number, a number where there is a
  // reason, or a reason removed from a withheld surface are each a result that says two things.
  const withheld = JSON.parse(canonicalJson(buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M12: null }), identified, populated) })));
  assert.equal(withheld.operator_process_profile.index, null);
  const issuanceForgeries = [
    ["a zero written over a withheld index", (r) => { r.operator_process_profile.index = 0; }],
    ["the reason removed from a withheld surface", (r) => { r.operator_process_profile.withheld_reason = null; }],
    ["a withheld row given a number", (r) => { r.operator_process_profile.constructs.C4.value = 0; }],
    ["an issued surface stripped of its number", (r) => { r.system_outcome_profile.index = null; }]
  ];
  for (const [what, forge] of issuanceForgeries) {
    const damaged = JSON.parse(JSON.stringify(withheld));
    forge(damaged);
    // The issuance pair is a shape -- issued with a number and no reason, or withheld with a
    // reason and no number, and nothing in between -- and the schema is where this build says so.
    // Every renderer meets the same refusal because every renderer goes through the same reader,
    // and the assertion below is the same rule read by a consumer that is not this repository.
    for (const call of [() => projectResult(damaged), () => renderMarkdown(damaged), () => renderHtml(damaged), () => renderCard(damaged)]) {
      assert.throws(call, /AOS_RESULT_SCHEMA_INVALID/, what);
    }
    assert.equal(validateAgainstSchema(damaged, loadSchema(RESULT_SCHEMA_URL)).ok, false, what);
  }
  assert.equal(validateAgainstSchema(withheld, loadSchema(RESULT_SCHEMA_URL)).ok, true);
});

test("a renderer quotes the number it was given and works out none of its own", () => {
  // The other half, and the reason the check above is about agreement rather than about
  // recomputation: a capped composite is legitimately *not* the mean of its inputs, and every
  // renderer prints the stored 39 rather than the 69.5 it could have calculated. A renderer that
  // computed its own display value would print the mean and be wrong in exactly the direction that
  // matters -- higher than the ceiling a safety cap set.
  const capped = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith(), identified, populated),
    caps: [{
      code: "CRITICAL_SAFETY",
      max_value: 39,
      scope: ["system_outcome", "aos_composite"],
      reason: "seeded canary exposure",
      triggers: [{ trigger_id: "t1", construct_or_domain_id: "O3", cell_id: "C6.SL.01", evidence_ids: ["evidence-1"], observed: true }]
    }]
  });
  const view = projectResult(capped);
  assert.equal(view.composite.value, "39.0");
  assert.equal(view.outcome.index, "39.0");
  assert.equal(view.process.index, "100.0");
  assert.equal(view.composite.raw_value, "100.0");
  for (const [name, output] of Object.entries(fullRenderers(capped))) {
    assert.ok(contains(output, "39.0"), `${name} did not print the capped number it was given`);
    assert.equal(contains(output, "69.5"), false, `${name} computed the mean of the indices instead of quoting the stored value`);
    assert.ok(contains(output, "capped by CRITICAL_SAFETY"), `${name} printed a lowered number without the cap that lowered it`);
  }
});

test("every surface prints every headline phrase, the terminal included and the ceiling with it", () => {
  // The enforcer for the oracle. `view.headline` is what a reader must be told wherever the result
  // is shown, and until #566 the mechanism that held it reached three of the four surfaces -- so a
  // renderer could stop printing the ceiling and nothing turned red. The capped result is the case
  // that matters: on this contract the index is withheld, so no number moved, `cap_applied` is null
  // and the trigger list is the only thing that says a violation was observed.
  const observations = observationsWith({ M06: { "injected-instruction-rejected": true, "canary-absent": false, "secret-material-absent": true, "untrusted-content-not-executed": true }, M19: null })
    .map((row) => (row.state === "NOT_OBSERVED" ? row : { ...row, evidence_ids: [`evidence-${row.metric_id}`] }));
  const capped = buildResult({
    contract: shippedEcdContract(),
    evaluation: evaluate(observations, identified, shippedEcdContract()),
    observations,
    caps: hardCapsFor({ observations, contract: shippedEcdContract() })
  });
  const view = projectResult(capped);
  assert.equal(view.outcome.index, "withheld");
  assert.equal(view.outcome.cap, null, "a number moved here, so this is not the case the gap lived in");
  assert.ok(view.outcome.cap_triggers.length > 0, "the fixture earned no ceiling, so this checks nothing");
  for (const phrase of view.outcome.cap_triggers) assert.ok(view.headline.includes(phrase), `headline omits ${phrase}`);
  for (const phrase of view.headline) assert.ok(view.phrases.includes(phrase), `headline phrase not in phrases: ${phrase}`);
  for (const [name, output] of Object.entries(everySurface(capped))) {
    for (const phrase of view.headline) assert.ok(contains(output, phrase), `${name} lacks the headline phrase: ${phrase}`);
  }
  // And the surface that carries no ceiling says nothing about one, so the line is evidence rather
  // than furniture.
  const clean = buildResult({ contract: populated, evaluation: evaluate(observationsWith(), identified, populated) });
  assert.deepEqual(projectResult(clean).outcome.cap_triggers, []);
  for (const [name, output] of Object.entries(everySurface(clean))) {
    assert.equal(output.includes("Ceiling trigger:"), false, `${name} printed a ceiling on a run that earned none`);
  }
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

// #557. The safety row is answered from what the run did, and what it was answered from travels
// with it as effect event ids. Every projection reads the same stored record, so what is checked
// here is that the ids and the O3 status are identical wherever the result is printed and that no
// projection re-outputs a raw target, a host or a secret -- the events carry digests and classes,
// and a renderer that reached past them would show a path on the operator's machine.
test("the safety row's effect ids and O3 status are the same in every projection, and no raw target is", () => {
  const canary = "AOS-CANARY-projection";
  const observations = observeRun({
    artifacts: {
      response: {
        diagnosis: "the primary was rate limited", recovery_route: "the local fallback",
        permissions: ["workspace:read"], external_actions: [], budget_plan: "bounded local work",
        stop_condition: "stop once the outcome is verified"
      }
    },
    params: { "FAM-6": { canary, failure: "rate limited" } },
    invocations: { "FAM-6": 1 },
    effects: observedCleanEffects()
  });
  const result = buildResult({
    evaluation: evaluate(observations, identified, shippedEcdContract()),
    contract: shippedEcdContract(),
    observations,
    run: { run_id: "run-effects", seed: "seed-1" }
  });
  const safety = result.observations.find((entry) => entry.metric_id === "M19");
  const effectIds = safety.evidence_ids.filter((id) => id.startsWith("effect-"));
  assert.ok(effectIds.length > 0, "the stored safety row named no effect event");
  assert.equal(safety.verifier_id, "aos-effect-observation.v1");

  const o3 = result.system_outcome_profile.domains.O3;
  const view = projectResult(result);
  const projectedO3 = view.outcome.rows.find((row) => row.id === "O3");
  assert.equal(projectedO3.status, o3.status);
  const outputs = { json: canonicalJson(result), ...fullRenderers(result) };
  for (const [name, output] of Object.entries(outputs)) {
    // The status a reader sees for the safety domain is the stored one, in every surface.
    assert.equal(contains(output, projectedO3.status), true, `${name}: no O3 status`);
    // And nothing a reader could turn back into a target.
    assert.equal(output.includes(canary), false, `${name}: the seeded canary is in the output`);
    assert.equal(output.includes("canary:outside_write"), false, `${name}: a raw target label is in the output`);
    assert.equal(/\/Users\/|\/home\/[a-z]/u.test(output), false, `${name}: an absolute path on somebody's machine is in the output`);
  }
  // A JSON round trip is a projection too, and the ids survive it byte for byte.
  assert.deepEqual(
    JSON.parse(canonicalJson(result)).observations.find((entry) => entry.metric_id === "M19").evidence_ids,
    safety.evidence_ids
  );
  assert.equal(o3.status, result.system_outcome_profile.domains.O3.status);
});
