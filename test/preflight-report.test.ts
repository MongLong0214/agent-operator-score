import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { simulatePackBudget } from "../src/_deferred/pack-budget.ts";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../specs/pack-simulation.v0.json");
const assumptionsPath = resolve(here, "../fixtures/simulation/assumptions.v0.json");

// The ticket's pinned pre-GREEN reason, verbatim from E0C-003 `## RED contract`.
const BLOCKING = "failing simulation can be summarized without a blocking verdict.";

const VERSION = "aos-preflight.v0";
const HUMAN_DATA = "human_data: none; this report does not claim human calibration.";

// E0C-001 froze both documents. These two digests are the identity of what E0C-003 freezes
// against: `input_digest` is sha256 over the canonical {spec, assumptions} pair and
// `MANIFEST_DIGEST` is what E0C-002's simulator records for that exact pair at seed
// 20260805. Either literal changing means a frozen input moved, which is the event this
// gate exists to notice.
const INPUT_DIGEST = "abb281c9bc1fd52d8c9fa5a905acaaf05b589182bcf3632f3738f42ff4d607ff";
const MANIFEST_DIGEST = "9bd1babe813e99f462e46e0a6b7e4d10067af4f587d2918adbc7a8cf2b238ef5";

const THRESHOLDS = [
  "median_minutes_max",
  "p90_minutes_max",
  "eligible_metrics_min",
  "primary_opportunities_per_scenario_max"
] as const;

// Any wording that would turn a simulated pack into a claim about people. The report must
// carry the HUMAN_DATA disclaimer and none of these.
const HUMAN_CLAIM = [
  /\bcalibrated\b/i,
  /\bhuman subject/i,
  /\bparticipant/i,
  /\breal operator/i,
  /\bfrom people\b/i,
  /\bempirical(?:ly)? validated\b/i
];

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const loadPreregistered = () => ({
  spec: JSON.parse(readFileSync(specPath, "utf8")),
  assumptions: JSON.parse(readFileSync(assumptionsPath, "utf8"))
});

// Independent canonicaliser. It is transcribed rather than imported so the digest the report
// prints is checked against a second implementation, not against the one that produced it.
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Json;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};

const sha256 = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

// Namespace/dynamic import: a missing module or a missing named export must stay undefined so
// every case fails with the ticket's pinned sentence rather than with a module-load error the
// RED contract would read as an unrelated stop.
const loadReport = async () => {
  try {
    return await import("../src/_deferred/preflight-report.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const requireExports = async () => {
  const mod = await loadReport();
  assert.equal(typeof mod.renderPreflightReport, "function", BLOCKING);
  return mod.renderPreflightReport as (input: unknown) => string;
};

const record = (spec: unknown, assumptions: unknown) => ({
  spec,
  assumptions,
  simulation: simulatePackBudget(spec, assumptions)
});

const field = (report: string, name: string): string => {
  const match = new RegExp(`^${name}: (.*)$`, "m").exec(report);
  assert.ok(match, `report has no ${name} line`);
  return match[1];
};

const thresholdRow = (report: string, key: string) => {
  const match = new RegExp(`^threshold ${key} limit (\\S+) observed (\\S+) status (PASS|FAIL)$`, "m").exec(report);
  assert.ok(match, `report has no threshold row for ${key}`);
  return { limit: Number(match[1]), observed: Number(match[2]), status: match[3] };
};

const reasons = (report: string): string[] => {
  const lines = report.split("\n");
  const start = lines.indexOf("## reasons");
  assert.ok(start >= 0, "report has no reasons section");
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => line.startsWith("## "));
  const body = next === -1 ? rest : rest.slice(0, next);
  return body
    .map((line) => /^reason (.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
};

const withDistributions = (assumptions: Json, table: Record<string, [number, number, number]>) => {
  const mutated = clone(assumptions);
  for (const scenario of mutated.scenarios as Json[]) {
    const [low, mode, high] = table[scenario.family_id as string];
    scenario.distribution = { kind: "triangular", low_minutes: low, mode_minutes: mode, high_minutes: high };
  }
  return mutated;
};

// Deep key-order permutation. Canonical digests and a deterministic render must both be blind
// to it; a report that reads `JSON.stringify` of its input is not.
const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Json;
  const flipped: Json = {};
  for (const key of Object.keys(record).reverse()) flipped[key] = reverseKeys(record[key]);
  return flipped;
};

describe("preflight-report", () => {
  test("pass-golden", async () => {
    const renderPreflightReport = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const evidence = record(spec, assumptions);

    assert.equal(evidence.simulation.ok, true, evidence.simulation.reasons.join("; "));
    const report = renderPreflightReport(evidence);

    assert.equal(field(report, "version"), VERSION);
    assert.equal(field(report, "verdict"), "PASS");
    assert.equal(field(report, "form_a_freeze"), "ELIGIBLE");
    assert.equal(field(report, "seed"), String(assumptions.seed));
    assert.equal(field(report, "seed"), "20260805");
    assert.equal(field(report, "policy_class"), assumptions.policy_class);

    // Input and output digests, both required by `## Minimum GREEN`.
    assert.equal(field(report, "input_digest"), sha256({ spec, assumptions }));
    assert.equal(field(report, "input_digest"), INPUT_DIGEST);
    assert.match(field(report, "output_digest"), /^[0-9a-f]{64}$/);
    assert.equal(field(report, "manifest_digest"), evidence.simulation.manifest_digest);
    assert.equal(field(report, "manifest_digest"), MANIFEST_DIGEST);
    assert.equal(field(report, "manifest_digest_recomputed"), MANIFEST_DIGEST);

    // The registry is twenty metrics wide and stays twenty wide; a PASS may not be bought by
    // narrowing the declared pack.
    assert.equal(field(report, "declared_metrics"), "20");
    assert.equal(field(report, "eligible_metrics"), "20");

    // Every threshold is rendered, not only the breached ones.
    for (const key of THRESHOLDS) {
      assert.equal(thresholdRow(report, key).status, "PASS", key);
    }
    assert.equal(thresholdRow(report, "median_minutes_max").limit, 40);
    assert.equal(thresholdRow(report, "p90_minutes_max").limit, 45);
    assert.equal(thresholdRow(report, "eligible_metrics_min").limit, 14);
    assert.equal(thresholdRow(report, "primary_opportunities_per_scenario_max").limit, 4);
    assert.equal(thresholdRow(report, "eligible_metrics_min").observed, 20);
    assert.equal(thresholdRow(report, "primary_opportunities_per_scenario_max").observed, 4);

    // The median is analytic, not the seeded p50. All six families are symmetric triangulars,
    // so the exact median of their sum is the sum of the per-family centres and lands on 40
    // with no Monte Carlo error. The empirical p50 of the same thousand rows sits above the
    // 40-minute limit, so a report that took the sampled value would refuse a pack the
    // contract admits. Pin both halves: the rendered value and the fact that the sampled one
    // would have read differently.
    const observedMedian = thresholdRow(report, "median_minutes_max").observed;
    assert.equal(observedMedian, 40);
    assert.equal(/^threshold median_minutes_max limit 40\.000000 observed 40\.000000 status PASS$/m.test(report), true);
    const sortedMinutes = evidence.simulation.raw_rows
      .map((row) => (row as { minutes: number }).minutes)
      .sort((left, right) => left - right);
    const empiricalP50 = sortedMinutes[Math.ceil(0.5 * sortedMinutes.length) - 1];
    assert.ok(empiricalP50 > 40, `empirical p50 ${empiricalP50} no longer diverges from the analytic median`);
    assert.match(report, /^median_source: analytic;/m);

    // Assumptions are rendered, not summarised away.
    for (const scenario of assumptions.scenarios as Json[]) {
      assert.ok(
        report.includes(`scenario ${scenario.scenario_id} family ${scenario.family_id} triangular`),
        `scenario ${scenario.scenario_id} is not rendered`
      );
      for (const opportunity of scenario.primary_opportunities as Json[]) {
        assert.ok(
          report.includes(`opportunity ${scenario.scenario_id} ${opportunity.opportunity_id} ${opportunity.metric_id}`),
          `opportunity ${opportunity.opportunity_id} is not rendered`
        );
      }
    }

    // Raw rows are rendered, not replaced by a summary line.
    assert.equal(field(report, "raw_rows"), "1000");
    assert.equal(field(report, "raw_rows_digest"), sha256(evidence.simulation.raw_rows));
    assert.equal(report.split("\n").filter((line) => line.startsWith("row ")).length, 1000);
    const firstRow = evidence.simulation.raw_rows[0] as { trial: number; minutes: number; families: Record<string, number> };
    assert.ok(
      report.includes(`row 1 total ${firstRow.minutes.toFixed(6)} FAM-1 ${firstRow.families["FAM-1"].toFixed(6)}`),
      "the first raw row is not rendered with its family breakdown"
    );

    assert.ok(report.includes(HUMAN_DATA), "the report drops the no-human-data disclaimer");
    for (const pattern of HUMAN_CLAIM) {
      assert.equal(pattern.test(report), false, `report carries a human-data claim: ${pattern}`);
    }

    assert.deepEqual(reasons(report), ["none"]);

    // A PASS that cannot become a FAIL is not a verdict. Same pack, same timings, same
    // thresholds, one unobserved safety metric: the simulator refuses it and the report must
    // carry that refusal instead of summarising it away.
    const unprescribed = clone(assumptions);
    const family6 = (unprescribed.scenarios as Json[]).find((scenario) => scenario.family_id === "FAM-6") as Json;
    family6.primary_opportunities = (family6.primary_opportunities as Json[])
      .filter((opportunity) => opportunity.metric_id !== "M19");
    const refused = record(spec, unprescribed);
    assert.equal(refused.simulation.ok, false);
    assert.deepEqual(refused.simulation.reasons, ["NO_PRESCRIPTION"]);
    const refusedReport = renderPreflightReport(refused);
    for (const key of THRESHOLDS) {
      assert.equal(thresholdRow(refusedReport, key).status, "PASS", `${key} should still hold`);
    }
    assert.equal(field(refusedReport, "verdict"), "FAIL");
    assert.equal(field(refusedReport, "form_a_freeze"), "BLOCKED");
    assert.ok(
      reasons(refusedReport).includes("SIMULATION NO_PRESCRIPTION"),
      reasons(refusedReport).join("; ")
    );
    assert.equal(field(refusedReport, "declared_metrics"), "20");
  });

  test("each-threshold-fail", async () => {
    const renderPreflightReport = await requireExports();
    const { spec, assumptions } = loadPreregistered();

    // One fixture per threshold, each built so exactly one row flips. The other three rows
    // must still read PASS, or the case proves only that something somewhere failed.
    const overMedian = withDistributions(assumptions, {
      "FAM-1": [4.9, 5, 5.1],
      "FAM-2": [5.9, 6, 6.1],
      "FAM-3": [7.9, 8, 8.1],
      "FAM-4": [6.9, 7, 7.1],
      "FAM-5": [6.9, 7, 7.1],
      "FAM-6": [7.9, 8, 8.1]
    });
    const overP90 = withDistributions(assumptions, {
      "FAM-1": [0.5, 5, 9.5],
      "FAM-2": [1.5, 6, 10.5],
      "FAM-3": [3.5, 8, 12.5],
      "FAM-4": [2.5, 7, 11.5],
      "FAM-5": [2.5, 7, 11.5],
      "FAM-6": [2.5, 7, 11.5]
    });
    const underEligible = clone(assumptions);
    underEligible.scenarios = (underEligible.scenarios as Json[])
      .filter((scenario) => ["FAM-1", "FAM-2", "FAM-3"].includes(scenario.family_id as string));
    const overCap = clone(assumptions);
    (overCap.scenarios as Json[])[0].primary_opportunities = [
      ...((overCap.scenarios as Json[])[0].primary_opportunities as Json[]),
      { opportunity_id: "FAM1-OPP-EXTRA", metric_id: "M01" }
    ];

    const fixtures: [(typeof THRESHOLDS)[number], Json][] = [
      ["median_minutes_max", overMedian],
      ["p90_minutes_max", overP90],
      ["eligible_metrics_min", underEligible],
      ["primary_opportunities_per_scenario_max", overCap]
    ];

    for (const [breached, mutated] of fixtures) {
      const evidence = record(spec, mutated);
      const report = renderPreflightReport(evidence);

      assert.equal(field(report, "verdict"), "FAIL", breached);
      assert.equal(field(report, "form_a_freeze"), "BLOCKED", breached);
      assert.equal(thresholdRow(report, breached).status, "FAIL", breached);
      for (const other of THRESHOLDS) {
        if (other === breached) continue;
        assert.equal(thresholdRow(report, other).status, "PASS", `${breached} also flipped ${other}`);
      }
      assert.ok(reasons(report).includes(`THRESHOLD ${breached}`), reasons(report).join("; "));
      // Failing does not shrink the pack: the declared registry stays twenty wide.
      assert.equal(field(report, "declared_metrics"), "20", breached);
      // Digests are still bound on the failing path; a FAIL is evidence, not an abort.
      assert.equal(field(report, "input_digest"), sha256({ spec, assumptions: mutated }), breached);
      assert.equal(field(report, "manifest_digest_recomputed"), evidence.simulation.manifest_digest, breached);
      assert.ok(report.includes(HUMAN_DATA), breached);
    }

    // The cap threshold is the one the simulator does not police, so the gate has to police it
    // itself. If the report merely echoed `simulation.reasons` this fixture would read PASS.
    const capEvidence = record(spec, overCap);
    assert.equal(capEvidence.simulation.ok, true, capEvidence.simulation.reasons.join("; "));
    assert.deepEqual(capEvidence.simulation.reasons, []);
    const capReport = renderPreflightReport(capEvidence);
    assert.equal(field(capReport, "verdict"), "FAIL");
    assert.equal(thresholdRow(capReport, "primary_opportunities_per_scenario_max").observed, 5);
  });

  test("digest-mismatch", async () => {
    const renderPreflightReport = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const evidence = record(spec, assumptions);

    // Control: the untampered triple binds, so a mismatch below is the tamper and not noise.
    assert.equal(
      reasons(renderPreflightReport(evidence)).includes("DIGEST_MISMATCH"),
      false,
      "the untampered record already reports a digest mismatch"
    );

    // Tamper after the run. A wider FAM-1 tail changes nothing the thresholds read: the
    // recorded median, p90, eligible count and per-scenario cap all still pass. Without the
    // digest bound to the exact frozen inputs this renders a clean PASS over a pack that is
    // no longer the pack that was simulated.
    const tamperedAssumptions = clone(assumptions);
    ((tamperedAssumptions.scenarios as Json[])[0].distribution as Json).high_minutes = 6.5;
    const tamperedRecord = { spec, assumptions: tamperedAssumptions, simulation: evidence.simulation };
    const tamperedReport = renderPreflightReport(tamperedRecord);

    for (const key of THRESHOLDS) {
      assert.equal(thresholdRow(tamperedReport, key).status, "PASS", `${key} should be unaffected by the tamper`);
    }
    assert.equal(field(tamperedReport, "verdict"), "FAIL");
    assert.equal(field(tamperedReport, "form_a_freeze"), "BLOCKED");
    assert.ok(reasons(tamperedReport).includes("DIGEST_MISMATCH"), reasons(tamperedReport).join("; "));
    assert.equal(field(tamperedReport, "manifest_digest"), MANIFEST_DIGEST);
    assert.notEqual(field(tamperedReport, "manifest_digest_recomputed"), MANIFEST_DIGEST);
    assert.match(field(tamperedReport, "manifest_digest_recomputed"), /^[0-9a-f]{64}$/);
    // The moved input is visible in the report's own input digest too.
    assert.equal(field(tamperedReport, "input_digest"), sha256({ spec, assumptions: tamperedAssumptions }));
    assert.notEqual(field(tamperedReport, "input_digest"), INPUT_DIGEST);

    // The contract half of the freeze moves the same way. Transition overhead is not read by
    // any threshold, so only the digest can catch it.
    const tamperedSpec = clone(spec);
    (tamperedSpec.transition_overhead as Json).max_minutes = 6;
    const specReport = renderPreflightReport({ spec: tamperedSpec, assumptions, simulation: evidence.simulation });
    assert.equal(field(specReport, "verdict"), "FAIL");
    assert.equal(field(specReport, "form_a_freeze"), "BLOCKED");
    assert.ok(reasons(specReport).includes("DIGEST_MISMATCH"), reasons(specReport).join("; "));

    // A swapped seed breaks the run identity as well as the digest, and both must be named.
    const reseeded = clone(assumptions);
    reseeded.seed = 20260806;
    const seedReport = renderPreflightReport({ spec, assumptions: reseeded, simulation: evidence.simulation });
    assert.equal(field(seedReport, "verdict"), "FAIL");
    assert.ok(reasons(seedReport).includes("DIGEST_MISMATCH"), reasons(seedReport).join("; "));
    assert.ok(reasons(seedReport).includes("SEED_POLICY"), reasons(seedReport).join("; "));

    // A tampered result is caught from the other side: the rows are rewritten but the recorded
    // digest is left alone.
    const tamperedSimulation = clone(evidence.simulation);
    tamperedSimulation.raw_rows = (tamperedSimulation.raw_rows as Json[]).slice(0, 500);
    const rowsReport = renderPreflightReport({ spec, assumptions, simulation: tamperedSimulation });
    assert.equal(field(rowsReport, "verdict"), "FAIL");
    assert.ok(reasons(rowsReport).includes("DIGEST_MISMATCH"), reasons(rowsReport).join("; "));
    assert.equal(field(rowsReport, "raw_rows"), "500");
  });

  test("stable-bytes", async () => {
    const renderPreflightReport = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const evidence = record(spec, assumptions);

    const first = renderPreflightReport(evidence);
    const second = renderPreflightReport(evidence);
    assert.equal(first, second);
    assert.equal(sha256(first), sha256(second));

    // Key order is not data. The same triple written with every object's keys reversed is the
    // same frozen input and must render byte-for-byte identically.
    const flipped = reverseKeys(clone(evidence));
    assert.notEqual(JSON.stringify(flipped), JSON.stringify(evidence), "the permutation did not move any key");
    assert.equal(renderPreflightReport(flipped), first);

    // A structurally identical rebuild of the same record renders identically, so nothing in
    // the report is carried over from the object identity of a previous call.
    assert.equal(renderPreflightReport(clone(evidence)), first);

    // Nothing ambient leaks in: no clock, no host path, no run counter.
    assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(first), false, "the report carries a timestamp");
    assert.equal(/(?:^|[^\w])\/(?:Users|home|private|tmp)\//.test(first), false, "the report carries a host path");

    // The failing path is deterministic too, and its digests differ from the passing one.
    const overCap = clone(assumptions);
    (overCap.scenarios as Json[])[0].primary_opportunities = [
      ...((overCap.scenarios as Json[])[0].primary_opportunities as Json[]),
      { opportunity_id: "FAM1-OPP-EXTRA", metric_id: "M01" }
    ];
    const failing = renderPreflightReport(record(spec, overCap));
    assert.equal(failing, renderPreflightReport(record(spec, overCap)));
    assert.equal(field(failing, "verdict"), "FAIL");
    assert.notEqual(field(failing, "output_digest"), field(first, "output_digest"));
    assert.notEqual(field(failing, "input_digest"), field(first, "input_digest"));

    // The output digest is a function of the decision, not of the whole rendered blob: it must
    // move when the verdict moves and hold when nothing does.
    assert.equal(field(renderPreflightReport(clone(evidence)), "output_digest"), field(first, "output_digest"));
    assert.match(field(first, "output_digest"), /^[0-9a-f]{64}$/);

    assert.equal(first.startsWith("AOS-PREFLIGHT\n"), true);
    assert.equal(first.endsWith("\n"), false, "a trailing newline is not part of the rendered bytes");
  });
});
