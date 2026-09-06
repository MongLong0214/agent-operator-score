import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { evaluate, loadEcdContract } from "../../lib/ecd-contract.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { buildResult, legacyScorerName } from "../../lib/result-schema.mjs";
import { SCORER_ID, SCORER_VERSION, scoreRun } from "../../lib/scorer-v1.mjs";
import { createRun, initHome, writeResult } from "../../lib/store.mjs";
import { writeJson } from "../../lib/core.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";

// verify:legacy-band-provenance
//
// #568's legacy policy. A stored legacy result keeps its band -- rendering it as anything else
// would be the silent rewrite the issue forbids -- but every screen that shows one has to say
// whose verdict it is: the retired scorer, by id and version, marked LEGACY / NOT COMPARABLE so
// nobody reads a band next to a v0.2.0 profile result as two points on one scale. The other half
// is provenance over the source tree itself: every module that still carries the band vocabulary
// must be one the contract's legacy_band_surface discloses, so a band cannot re-enter the active
// surface through a file the disclosure never named.

export const LEGACY_MARKER = "LEGACY / NOT COMPARABLE";

const UNDER_AN_OFFICIAL_BOUNDARY = { isolationLevel: "STRICT", officialIssuance: { official: true, reasons: [] } };
const legacyResult = () => ({
  schema_id: "aos-mvp-result.v1",
  ...scoreRun(observationsWith(), UNDER_AN_OFFICIAL_BOUNDARY),
  run_id: "run-legacy",
  metrics: observationsWith(),
  limitations: ["local"]
});

test("a legacy result's markdown and html carry LEGACY / NOT COMPARABLE with the stored scorer, and its band verbatim", () => {
  const legacy = legacyResult();
  assert.equal(legacy.score.band, "HIGH RELIABILITY");
  const markdown = renderMarkdown(legacy);
  const html = renderHtml(legacy);
  for (const [name, rendering] of [["markdown", markdown], ["html", html]]) {
    assert.ok(rendering.includes(LEGACY_MARKER), `${name} does not say ${LEGACY_MARKER}`);
    // The exact provenance: the stored scorer's own id and version, not this build's idea of them.
    assert.ok(rendering.includes(legacy.scorer.id), `${name} does not name the scorer id`);
    assert.ok(rendering.includes(legacy.scorer.version), `${name} does not name the scorer version`);
    // No silent rewrite: the stored band renders as the word the scorer stored.
    assert.ok(rendering.includes("HIGH RELIABILITY"), `${name} renamed or dropped the stored band`);
  }
  // The marker sits in the same block as the score, not in a footer. In markdown that is the
  // headline list, before the first section heading; in HTML it is inside the headline div.
  const firstHeading = markdown.indexOf("\n## ");
  assert.ok(markdown.indexOf(LEGACY_MARKER) < firstHeading, "the markdown marker is below the first section, which is a footnote");
  const headline = /<div class="headline">[\s\S]*?<h2>/u.exec(html);
  assert.ok(headline !== null && headline[0].includes(LEGACY_MARKER), "the html marker is not in the headline block");
});

test("the card renders exactly what the contract's legacy_band_surface claims for lib/report-card.mjs: the marker and the stored scorer", () => {
  // #568 round 1: the contract asserted this claim about the card and the shipped card did not do
  // it. The point of this test is to keep that from being possible again silently -- so the marker
  // checked below is read out of the contract's own prose, not retyped as a second copy that could
  // drift from the first without either failing.
  const use = loadEcdContract().interpretation_use;
  assert.ok(
    use.legacy_band_surface.modules.includes("lib/report-card.mjs"),
    "lib/report-card.mjs left the contract's legacy_band_surface disclosure, so this test no longer has a claim about the card to check"
  );
  const afterMarked = use.legacy_band_surface.statement.split("each marked ")[1];
  const marker = afterMarked?.slice(0, afterMarked.indexOf(". "));
  assert.ok(
    typeof marker === "string" && marker.length > 0,
    "the contract's statement no longer says what a disclosed module marks a legacy record with"
  );

  const legacy = legacyResult();
  const card = renderCard(legacy);
  // A substring match anywhere in the SVG passes for the `aria-label` too, which is metadata on
  // the root element, not a rendering a viewer sees. The claim is about the card, so the check has
  // to land inside a `<text>` element the way every other rendered word on this card does.
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const visible = (needle) => new RegExp(`<text[^>]*>[^<]*${escaped(needle)}[^<]*</text>`, "u").test(card);
  assert.ok(visible(marker), `the contract claims lib/report-card.mjs marks a legacy record ${JSON.stringify(marker)} and no visible text element on the shipped card does`);
  assert.ok(visible(legacy.scorer.id), "the card does not visibly name the stored scorer id the contract's disclosed modules render");
  assert.ok(visible(legacy.scorer.version), "the card does not visibly name the stored scorer version");
});

test("a legacy result missing its scorer record still says LEGACY / NOT COMPARABLE and invents no scorer", () => {
  // Recovery renders whatever is on disk. A half-written legacy record without `scorer` must not
  // take the page down, and must not be attributed to a scorer nobody recorded.
  const bare = { schema_id: "aos-mvp-result.v1", run_id: "r", status: "INCOMPLETE", score: null, provisional_raw: 0, dimensions: {}, coverage: { observed: 0, total: 20 }, caps: [], blockers: [] };
  for (const rendering of [renderMarkdown(bare), renderHtml(bare), renderCard(bare)]) {
    assert.ok(rendering.includes(LEGACY_MARKER));
    assert.equal(rendering.includes(SCORER_ID), false, "a scorer the record does not carry was invented");
    assert.ok(rendering.includes("unrecorded legacy scorer"));
  }
});

test("no profile rendering carries the legacy marker", () => {
  const populated = contractWithAPopulatedIndex();
  const result = buildResult({ contract: populated, evaluation: evaluate(observationsWith(), identified, populated) });
  for (const rendering of [renderMarkdown(result), renderHtml(result), renderCard(result)]) {
    assert.equal(rendering.includes(LEGACY_MARKER), false, "a v0.2.0 profile result is not a legacy record");
  }
});

test("the dashboard names every legacy row LEGACY / NOT COMPARABLE with the scorer that produced it", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-legacy-prov-"));
  initHome(home);
  const legacy = legacyResult();
  const { runId } = createRun(home, { mode: "TEST", run_id: "run-legacy" });
  writeResult(home, runId, legacy, renderMarkdown(legacy), renderHtml(legacy));
  const populated = contractWithAPopulatedIndex();
  const profile = buildResult({ contract: populated, evaluation: evaluate(observationsWith(), identified, populated) });
  const { runId: profileRun } = createRun(home, { mode: "TEST", run_id: "run-profile" });
  writeResult(home, profileRun, profile, renderMarkdown(profile), renderHtml(profile), renderCard(profile));
  const dashboard = await startDashboard({ home });
  try {
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    const legacyRow = /<tr><td><a[^>]*>run-legacy<\/a>[\s\S]*?<\/tr>/u.exec(index)[0];
    assert.ok(legacyRow.includes(LEGACY_MARKER), "the legacy row does not say LEGACY / NOT COMPARABLE");
    assert.ok(legacyRow.includes(SCORER_ID), "the legacy row does not name the stored scorer");
    assert.ok(legacyRow.includes(SCORER_VERSION));
    // The stored band stays, verbatim, beside the provenance -- shown as history, not rewritten.
    assert.ok(legacyRow.includes("100 (HIGH RELIABILITY)"));
    const profileRow = /<tr><td><a[^>]*>run-profile<\/a>[\s\S]*?<\/tr>/u.exec(index)[0];
    assert.equal(profileRow.includes(LEGACY_MARKER), false, "a profile row is marked legacy");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a legacy cycle aggregate is marked LEGACY / NOT COMPARABLE on the dashboard", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-legacy-cycle-"));
  initHome(home);
  // A stored legacy cycle: three legacy runs and the decision the cycle command wrote for them.
  // The dashboard quotes the stored decision, so the fixture carries one rather than relying on
  // the read-time fallback.
  const runs = [101, 202, 303].map((seed) => ({ seed, run_id: `run-${seed}`, result_schema: "aos-mvp-result.v1", status: "SCORED", score: 90 + (seed % 3), issued: true }));
  writeJson(join(home, "cycle.json"), {
    cycle_id: "cycle-legacy",
    seeds: [101, 202, 303],
    runs,
    decision: {
      cycle_id: "cycle-legacy",
      issued: true,
      operator_score: 91,
      valid_runs: 3,
      seeds: [101, 202, 303],
      spread: 2,
      mad: 1,
      stability: "STABLE",
      local_repeat_evidence: "LOCAL_REPEAT_ONLY",
      excluded: [],
      profile_bound_aggregation: { status: "issued", reason: "" }
    }
  });
  const dashboard = await startDashboard({ home });
  try {
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    const card = /<section class="card">[\s\S]*?<\/section>/u.exec(index)[0];
    assert.ok(card.includes("91"), "the stored legacy score is not shown");
    assert.ok(card.includes(LEGACY_MARKER), "a legacy aggregate renders unmarked next to profile results");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a scorer id recorded without a version says so, rather than reading as a complete record", () => {
  // A nit from round 1's review: an id-only record used to render as a bare id, which is exactly
  // what a complete `id version` record looks like -- a reader could not tell "this run's version
  // was never captured" from "this run's version is genuinely just its id". It now says so.
  assert.equal(legacyScorerName({ scorer: { id: "aos-scorer.v1" } }), "aos-scorer.v1 (version unrecorded)");
  assert.equal(legacyScorerName({ scorer: { id: "aos-scorer.v1", version: "" } }), "aos-scorer.v1 (version unrecorded)");
  assert.equal(legacyScorerName({ scorer: { id: "aos-scorer.v1", version: "1.0.0" } }), "aos-scorer.v1 1.0.0");
  assert.equal(legacyScorerName({ scorer: {} }), "unrecorded legacy scorer");
  assert.equal(legacyScorerName(null), "unrecorded legacy scorer");
  // #568 round 5 NIT. `.length > 0` counted a whitespace-only version as recorded, so `"   "`
  // rendered as a bare id -- the very ambiguity the line above exists to remove, reachable with a
  // string that looks empty to every reader but `===`.
  assert.equal(legacyScorerName({ scorer: { id: "aos-scorer.v1", version: "   " } }), "aos-scorer.v1 (version unrecorded)");
  assert.equal(legacyScorerName({ scorer: { id: "   ", version: "1.0.0" } }), "unrecorded legacy scorer");
});

test("a legacy cycle aggregate names the stored scorer that produced its runs, not the current build", async () => {
  // #568 round 2. The run row already names its stored scorer by reading its own result.json;
  // the aggregate's stored `decision` never carries one -- `recordRun` only ever kept
  // `scorer_major`, an integer bucket -- so this checks that the aggregate reaches past its own
  // decision object to the same result files the run row reads, rather than staying silent about
  // whose verdict the median actually is.
  const home = mkdtempSync(join(tmpdir(), "aos-legacy-cycle-scorer-"));
  initHome(home);
  const legacy = legacyResult();
  const seeds = [101, 202, 303];
  for (const seed of seeds) {
    const { runId } = createRun(home, { mode: "TEST", run_id: `run-${seed}` });
    writeResult(home, runId, { ...legacy, run_id: runId }, renderMarkdown(legacy), renderHtml(legacy));
  }
  writeJson(join(home, "cycle.json"), {
    cycle_id: "cycle-legacy-scorer",
    seeds,
    runs: seeds.map((seed) => ({ seed, run_id: `run-${seed}`, result_schema: "aos-mvp-result.v1", status: "SCORED", score: 90, issued: true })),
    decision: {
      cycle_id: "cycle-legacy-scorer",
      issued: true,
      operator_score: 90,
      valid_runs: 3,
      seeds,
      spread: 0,
      mad: 0,
      stability: "STABLE",
      local_repeat_evidence: "LOCAL_REPEAT_ONLY",
      excluded: [],
      profile_bound_aggregation: { status: "issued", reason: "" }
    }
  });
  const dashboard = await startDashboard({ home });
  try {
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    const card = /<section class="card">[\s\S]*?<\/section>/u.exec(index)[0];
    assert.ok(card.includes(SCORER_ID), "the aggregate does not name the stored scorer id");
    assert.ok(card.includes(SCORER_VERSION), "the aggregate does not name the stored scorer version");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a legacy cycle aggregate says unrecorded legacy scorer rather than inventing the current build's", async () => {
  // A cycle whose run files are gone or were never written -- recorded before this fix existed,
  // or pruned off disk -- still renders a page. It must not attribute the median to whatever
  // scorer happens to be running this build, which is exactly the fabrication #568 forbids.
  const home = mkdtempSync(join(tmpdir(), "aos-legacy-cycle-unrecorded-"));
  initHome(home);
  const seeds = [101, 202, 303];
  writeJson(join(home, "cycle.json"), {
    cycle_id: "cycle-legacy-unrecorded",
    seeds,
    runs: seeds.map((seed) => ({ seed, run_id: `run-${seed}`, result_schema: "aos-mvp-result.v1", status: "SCORED", score: 90, issued: true })),
    decision: {
      cycle_id: "cycle-legacy-unrecorded",
      issued: true,
      operator_score: 90,
      valid_runs: 3,
      seeds,
      spread: 0,
      mad: 0,
      stability: "STABLE",
      local_repeat_evidence: "LOCAL_REPEAT_ONLY",
      excluded: [],
      profile_bound_aggregation: { status: "issued", reason: "" }
    }
  });
  const dashboard = await startDashboard({ home });
  try {
    const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
    const card = /<section class="card">[\s\S]*?<\/section>/u.exec(index)[0];
    assert.ok(card.includes("unrecorded legacy scorer"), "the aggregate does not say unrecorded legacy scorer");
    assert.equal(card.includes(SCORER_ID), false, "a scorer no run recorded was invented");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("every module carrying legacy band vocabulary is disclosed by the contract's legacy band surface", () => {
  // The vocabulary the contract itself refuses (lib/ecd-contract.mjs BAND_VOCABULARY): the words
  // that can only ever be a verdict about a person. OPERATIONAL is deliberately absent -- it is a
  // form class in the task model. Comments are stripped first: a module must be able to explain in
  // prose the band it refuses to emit.
  const VOCABULARY = ["HIGH RELIABILITY", "ADVANCED", "DEVELOPING", "FRAGILE", "ROBUST", "STRONG"];
  const use = loadEcdContract().interpretation_use;
  const disclosed = new Set([...use.legacy_band_surface.modules, ...use.legacy_band_surface.excluded_modules]);
  const root = new URL("../../lib/", import.meta.url);
  const stripped = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const carriers = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `lib/${entry.name}`)
    .filter((path) => VOCABULARY.some((word) => new RegExp(`\\b${word}\\b`, "u").test(stripped(path))));
  assert.ok(carriers.length > 0, "the scan found no carrier at all, so it is scanning nothing");
  for (const path of carriers) {
    assert.ok(disclosed.has(path), `${path} carries band vocabulary and the contract's legacy_band_surface does not disclose it`);
  }
});

test("docs/ECD_CONTRACT.md names the same rendering modules as legacy_band_surface, not a stale list", () => {
  // #568 round 3 NIT. This paragraph named `lib/cli.mjs` where the contract's own
  // `legacy_band_surface.modules` names `lib/report-i18n.mjs` -- the CLI carries none of the band
  // vocabulary itself (the test above scans for exactly that) and the band-translation table lives
  // in `lib/report-i18n.mjs`, so the doc's inventory disagreed with the artifact it was describing.
  // This is not the general doc-to-contract checker that is #631's job and is out of scope here; it
  // is the same one-sentence binding "the form-variation section names the contract's current
  // version" already uses next to this section in tests/product/ecd-shortcuts.test.mjs, aimed at
  // the one paragraph a reader takes as "which modules render a legacy band, right now".
  const use = loadEcdContract().interpretation_use;
  const doc = readFileSync(new URL("../../docs/ECD_CONTRACT.md", import.meta.url), "utf8");
  const [, section = ""] = doc.split("## What this contract does not do");
  assert.ok(section.length > 0, "the 'what this contract does not do' section is gone");
  const paragraph = section.split("It does not define what a profile is")[0];
  const named = new Set([...paragraph.matchAll(/`(lib\/[a-z0-9-]+\.mjs)`/g)].map((match) => match[1]));
  for (const path of use.legacy_band_surface.modules) {
    assert.ok(named.has(path), `${path} is in the contract's legacy_band_surface.modules and is not named in docs/ECD_CONTRACT.md's "what this contract does not do" section`);
  }
});
