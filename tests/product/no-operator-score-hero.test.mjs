import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { evaluate } from "../../lib/ecd-contract.mjs";
import { BAND_NAMES } from "../../lib/report-i18n.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { LABELS, RESULT_SCHEMA_ID, RESULT_SCHEMA_VERSION, buildResult, projectResult } from "../../lib/result-schema.mjs";
import { scoreRun as scoreRunUnbounded } from "../../lib/scorer-v1.mjs";
import { createRun, initHome, writeResult } from "../../lib/store.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { addAgent, makePlan, newestResult, newestRunId, run as runCli } from "./helpers.mjs";

// verify:no-operator-score-hero
//
// What a new result must never be shown as: one Operator Score, a composite standing alone, a band or
// a traffic light. Every renderer that takes a profile result is checked here; the legacy renderer
// keeps its hero because a legacy record is rendered as the record it is, and a test that forbade it
// there would be a test that legacy results cannot be shown at all.

const populated = contractWithAPopulatedIndex();
const build = (overrides = {}) => buildResult({ contract: populated, evaluation: evaluate(observationsWith(overrides), identified, populated) });

const bandNames = [...new Set(Object.values(BAND_NAMES).flatMap((names) => Object.values(names)))];
// The words a hero is made of. Percentile, rank and certification are not in this list because the
// claim section prints them on purpose -- as forbidden uses -- and the fields that would carry
// them are asserted null below instead.
// #556. The legacy scorer withholds its number on a lane the confinement gate did not call
// official, which is every lane a unit test runs on. These fixtures are about what the renderers do
// with a legacy record that has a score, so they are built under a boundary that held.
const UNDER_AN_OFFICIAL_BOUNDARY = { officialIssuance: { official: true, reasons: [] } };
const scoreRun = (observations, context = {}) => scoreRunUnbounded(observations, { ...UNDER_AN_OFFICIAL_BOUNDARY, ...context });

const forbidden = [
  /Operator Score/u,
  /\/ 100\b/u,
  /traffic/iu,
  /class="score"/u,
  /\u{1F7E2}|\u{1F7E1}|\u{1F534}/u,
  ...bandNames.map((name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
];

const renderings = (result) => ({
  markdown: renderMarkdown(result),
  html: renderHtml(result),
  card: renderCard(result),
  json: canonicalJson(result)
});

test("no renderer prints an Operator Score, a band or a traffic light for a profile result, and the rank fields are null", () => {
  for (const result of [build(), build({ M12: null }), build({ M17: null })]) {
    for (const [name, output] of Object.entries(renderings(result))) {
      for (const pattern of forbidden) assert.equal(pattern.test(output), false, `${name} matches ${pattern}`);
    }
    for (const field of ["category", "cut_score", "percentile", "rank", "band"]) assert.equal(result[field], null, field);
    assert.equal(Object.hasOwn(result, "score"), false);
    assert.ok(result.forbidden_uses.includes("certification"));
  }
});

test("the card has no lone hero number and the composite is drawn no larger than the process index", () => {
  const card = renderCard(build());
  const sizes = [...card.matchAll(/font-size="(\d+(?:\.\d+)?)"/gu)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  assert.ok(Math.max(...sizes) <= 48, `largest glyph is ${Math.max(...sizes)}px`);
  const sizeOf = (label) => {
    const at = card.indexOf(label);
    assert.ok(at >= 0, `card lacks ${label}`);
    const after = card.slice(at);
    return Number(/font-size="(\d+(?:\.\d+)?)"/u.exec(after)[1]);
  };
  assert.ok(sizeOf(LABELS.aos_composite) <= sizeOf(LABELS.operator_process));
  assert.ok(card.includes(LABELS.operator_process));
  assert.ok(card.includes(LABELS.system_outcome));
});

test("the markdown and html open on the process profile, not on the composite", () => {
  const result = build();
  const view = projectResult(result);
  for (const output of [renderMarkdown(result), renderHtml(result)]) {
    const process = output.indexOf(view.sections[0].title);
    const composite = output.indexOf(view.sections[3].title);
    assert.ok(process >= 0 && composite > process);
    const firstNumber = /\b\d+\.\d\b/u.exec(output);
    assert.ok(firstNumber !== null);
    assert.ok(firstNumber.index > process, "a number is printed before the process profile heading");
  }
});

test("the composite is always labelled secondary beside its value, in every renderer", () => {
  const result = build();
  const view = projectResult(result);
  assert.equal(view.composite.secondary_note, "secondary descriptive index · not a human ability score");
  for (const [name, output] of Object.entries(renderings(result))) {
    if (name === "json") continue;
    assert.ok(output.includes(view.composite.secondary_note) || output.includes("secondary descriptive index"), `${name} does not say the composite is secondary`);
  }
  assert.equal(result.aos_composite.secondary, true);
});

test("uncertainty, claim stage and generalizability are printed beside the numbers in every renderer", () => {
  const result = build();
  const view = projectResult(result);
  for (const [name, output] of Object.entries(renderings(result))) {
    if (name === "json") continue;
    assert.ok(output.includes(view.claim.stage), `${name} hides the claim stage`);
    assert.ok(output.includes(view.claim.generalizability), `${name} hides the generalizability status`);
    assert.ok(output.includes(view.claim.uncertainty), `${name} hides the uncertainty status`);
  }
  assert.equal(view.claim.stage, "PROFILE_BOUND");
  assert.equal(view.claim.generalizability, "UNESTABLISHED");
  assert.equal(view.claim.uncertainty, "INSUFFICIENT_DATA");
});

test("the dashboard index shows no band or Operator Score for a profile result and keeps the legacy row for a legacy result", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-no-hero-"));
  initHome(home);
  const profile = build();
  const { runId: profileRun } = createRun(home, { mode: "TEST", run_id: "run-profile" });
  writeResult(home, profileRun, profile, renderMarkdown(profile), renderHtml(profile), renderCard(profile));
  const legacy = { schema_id: "aos-mvp-result.v1", ...scoreRun(observationsWith()), run_id: "run-legacy", metrics: observationsWith(), limitations: ["local"] };
  const { runId: legacyRun } = createRun(home, { mode: "TEST", run_id: "run-legacy" });
  writeResult(home, legacyRun, legacy, renderMarkdown(legacy), renderHtml(legacy));
  const dashboard = await startDashboard({ home });
  try {
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    const profileRow = /<tr><td><a[^>]*>run-profile<\/a>.*?<\/tr>/u.exec(index)[0];
    const legacyRow = /<tr><td><a[^>]*>run-legacy<\/a>.*?<\/tr>/u.exec(index)[0];
    for (const pattern of forbidden) assert.equal(pattern.test(profileRow), false, `profile row matches ${pattern}`);
    assert.ok(profileRow.includes("process 100.0"));
    assert.ok(legacyRow.includes("100 (HIGH RELIABILITY)"));
    const legacyPage = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/run/${legacyRun}?t=${dashboard.token}`)).text();
    assert.ok(legacyPage.includes("100"));
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a legacy result is still rendered by the legacy renderer, as the legacy record it is", () => {
  const legacy = { schema_id: "aos-mvp-result.v1", ...scoreRun(observationsWith()), run_id: "run-legacy", metrics: observationsWith(), limitations: ["local"] };
  assert.match(renderMarkdown(legacy), /Score: \*\*100 \/ 100\*\* \(HIGH RELIABILITY\)/u);
  assert.equal(renderMarkdown(legacy).includes(LABELS.operator_process), false);
  assert.equal(renderCard(legacy).includes(LABELS.operator_process), false);
});

test("the assessment the product actually runs stores a profile result and prints no Operator Score", () => {
  // The schema is only real if the product writes it. While `aos assess` wrote the legacy record,
  // v2 was reachable by direct construction alone and the thing an operator sees after a run was
  // still a single Agent Operator Score with a band under it.
  const cwd = mkdtempSync(join(tmpdir(), "aos-assess-v2-"));
  try {
    runCli(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    const assessed = runCli(cwd, ["assess", "--plan", plan, "--seed", "5"], 3);
    const result = newestResult(cwd);
    assert.equal(result.schema_id, RESULT_SCHEMA_ID);
    assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
    assert.equal(Object.hasOwn(result, "score"), false);
    assert.equal(result.band, null);
    assert.equal(result.rank, null);
    for (const key of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]) {
      assert.ok(Object.hasOwn(result, key), key);
    }
    // The run is on the record: what it was, what it observed, and under which contract.
    assert.equal(result.run.run_id, newestRunId(cwd));
    assert.equal(result.observations.length, 20);
    assert.equal(result.contract.id, "aos-ecd-contract.v1");
    for (const pattern of forbidden) assert.equal(pattern.test(assessed.stdout), false, `stdout matches ${pattern}`);
    assert.match(assessed.stdout, /Operator process/u);
    assert.match(assessed.stdout, /System outcome/u);
    assert.match(assessed.stdout, /claim stage/iu);
    // And the stored report is the profile rendering, not the legacy one.
    const report = runCli(cwd, ["report", "--run", newestRunId(cwd)]).stdout;
    assert.ok(report.includes(LABELS.operator_process), report.slice(0, 400));
    for (const pattern of forbidden) assert.equal(pattern.test(report), false, `report matches ${pattern}`);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("the dashboard puts a profile row under profile headings, never under a Score column", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-no-hero-headers-"));
  initHome(home);
  const profile = build();
  const { runId } = createRun(home, { mode: "TEST", run_id: "run-profile" });
  writeResult(home, runId, profile, renderMarkdown(profile), renderHtml(profile), renderCard(profile));
  return startDashboard({ home }).then(async (dashboard) => {
    try {
      const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
      const table = /<table[^>]*>[\s\S]*?<\/table>/u.exec(index)[0];
      assert.equal(/<th>Score<\/th>/u.test(table), false, "a profile result sits under a Score heading");
      assert.match(table, /<th>Claim<\/th>/u);
      assert.match(table, /<th>Profiles<\/th>/u);
      assert.match(table, /<th>Coverage<\/th>/u);
    } finally {
      await dashboard.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
