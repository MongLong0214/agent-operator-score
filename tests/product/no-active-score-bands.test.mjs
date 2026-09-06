import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { evaluate, loadEcdContract } from "../../lib/ecd-contract.mjs";
import { renderProfileTerminal } from "../../lib/profile-report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { buildResult, projectResult } from "../../lib/result-schema.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";

// verify:no-active-score-bands
//
// #568's completion condition: zero bands, categories or cut scores in anything a new result
// carries or any surface a new result is rendered on. The band vocabulary is the contract's own
// list -- the words that can only ever be a verdict about a person -- matched on word boundaries
// so OPERATIONAL-the-form-class and ADVANCED_FILE-the-authority stay out of scope. Two scans:
// the results and their renderings (the emission), and the profile renderers' own source (the
// re-entry route: a renderer that names a band or paints a traffic light is a renderer one badge
// away from issuing one).

const VOCABULARY = ["HIGH RELIABILITY", "ADVANCED", "DEVELOPING", "FRAGILE", "ROBUST", "STRONG"];
const vocabularyPattern = (word) => new RegExp(`\\b${word}\\b`, "u");
const TRAFFIC_LIGHT = /\u{1F7E2}|\u{1F7E1}|\u{1F534}/u;

const populated = contractWithAPopulatedIndex();
const build = (overrides = {}) => buildResult({ contract: populated, evaluation: evaluate(observationsWith(overrides), identified, populated) });
const renderings = (result) => ({
  markdown: renderMarkdown(result),
  html: renderHtml(result),
  card: renderCard(result),
  terminal: renderProfileTerminal(result).join("\n"),
  json: JSON.stringify(result)
});

test("a new result in the low nineties carries no band, and no surface prints one", () => {
  // The issue's own probe: a value where the retired scorer would have said HIGH RELIABILITY.
  const result = build({ M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true } });
  assert.equal(projectResult(result).process.index, "91.7");
  for (const field of ["category", "cut_score", "percentile", "rank", "band", "standard_setting"]) {
    assert.equal(result[field], null, field);
  }
  for (const [name, output] of Object.entries(renderings(result))) {
    for (const word of VOCABULARY) {
      assert.equal(vocabularyPattern(word).test(output), false, `${name} carries the band word ${word}`);
    }
    assert.equal(TRAFFIC_LIGHT.test(output), false, `${name} paints a traffic light`);
  }
});

test("a perfect new result is equally band-free", () => {
  const result = build();
  for (const [name, output] of Object.entries(renderings(result))) {
    for (const word of VOCABULARY) {
      assert.equal(vocabularyPattern(word).test(output), false, `${name} carries the band word ${word}`);
    }
  }
});

test("the profile renderers' own source names no band and paints no traffic light", () => {
  // The comment-stripped source of every module a profile result passes through on its way to a
  // reader. A band word in one of these is a category one string-concatenation from shipping,
  // whatever the tests on today's output say.
  const stripped = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const path of ["lib/profile-report.mjs", "lib/result-schema.mjs", "lib/standard-setting.mjs"]) {
    const source = stripped(path);
    for (const word of VOCABULARY) {
      assert.equal(vocabularyPattern(word).test(source), false, `${path} names the band ${word}`);
    }
    assert.equal(TRAFFIC_LIGHT.test(source), false, `${path} paints a traffic light`);
  }
  // No module in lib/ paints a traffic light, the legacy renderers included: colour-as-verdict is
  // an arbitrary category in a different alphabet.
  const root = new URL("../../lib/", import.meta.url);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    assert.equal(TRAFFIC_LIGHT.test(readFileSync(new URL(entry.name, root), "utf8")), false, `lib/${entry.name} paints a traffic light`);
  }
});

test("the canonical result's category fields are typed null by the schema, so a renderer has nothing to draw a band from", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schemas/aos-result.v4.schema.json", import.meta.url), "utf8"));
  for (const field of ["standard_setting", "category", "cut_score", "percentile", "rank", "band"]) {
    assert.deepEqual(schema.properties[field], { type: "null" }, field);
  }
  assert.equal(schema.properties.score, false, "the legacy score slot is open in the v4 schema");
  // And the contract the result names issues them null as well: one authority, stated twice,
  // checked against each other here.
  const use = loadEcdContract().interpretation_use;
  for (const field of ["standard_setting", "categories", "cut_scores"]) {
    assert.equal(use[field], null, field);
  }
});
