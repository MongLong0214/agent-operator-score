import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../specs/pack-simulation.v0.json");
const assumptionsPath = resolve(here, "../fixtures/simulation/assumptions.v0.json");

const ABSENT = "no executable simultaneous timing/eligibility verdict exists";

const REQUIRED_CORE = ["M15", "M16", "M17", "M18", "M19", "M20"] as const;
const FACTORS = ["F1", "F2", "F3", "F4", "F5"] as const;

type Json = Record<string, unknown>;
type SimulatePackBudget = (spec: unknown, assumptions: unknown) => {
  ok: boolean;
  reasons: string[];
  seed: number;
  median_minutes: number;
  p90_minutes: number;
  eligible_metrics: number;
  factor_minima: Record<(typeof FACTORS)[number], boolean>;
  required_core: boolean;
  coverage: { n: number; d: number };
  prescription_path: boolean;
  raw_rows: unknown[];
  manifest_digest: string;
};
type AuditOpportunities = (spec: unknown, assumptions: unknown) => {
  ok: boolean;
  errors: string[];
  eligible_metric_ids: string[];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const loadPreregistered = () => ({
  spec: JSON.parse(readFileSync(specPath, "utf8")),
  assumptions: JSON.parse(readFileSync(assumptionsPath, "utf8"))
});

// Namespace/dynamic import: a missing module or named export must stay
// undefined so each case can fail with the ticket's pinned sentence. A static
// named import would be a module-load error, which the RED contract treats as
// an unrelated stop.
const loadBudget = async () => {
  try {
    return await import("../src/_deferred/pack-budget.ts");
  } catch {
    return {};
  }
};

const loadAudit = async () => {
  try {
    return await import("../src/_deferred/opportunity-audit.ts");
  } catch {
    return {};
  }
};

const requireExports = async () => {
  const budget = await loadBudget();
  const audit = await loadAudit();
  assert.equal(typeof budget.simulatePackBudget, "function", ABSENT);
  assert.equal(typeof audit.auditOpportunities, "function", ABSENT);
  return {
    simulatePackBudget: budget.simulatePackBudget as SimulatePackBudget,
    auditOpportunities: audit.auditOpportunities as AuditOpportunities
  };
};

const codes = (reasons: string[]) => reasons.map((entry) => entry.split(" ")[0]);

const hasCode = (reasons: string[], code: string) => codes(reasons).includes(code);

describe("pack-budget", () => {
  test("valid-pack", async () => {
    const { simulatePackBudget, auditOpportunities } = await requireExports();
    const { spec, assumptions } = loadPreregistered();

    const audit = auditOpportunities(spec, assumptions);
    assert.equal(audit.ok, true, audit.errors.join("; "));
    assert.equal(audit.eligible_metric_ids.length, 20);

    const result = simulatePackBudget(spec, assumptions);
    assert.equal(result.ok, true, result.reasons.join("; "));
    assert.deepEqual(result.reasons, []);
    assert.equal(result.seed, assumptions.seed);
    assert.ok(result.median_minutes <= 40, `median ${result.median_minutes}`);
    assert.ok(result.p90_minutes <= 45, `p90 ${result.p90_minutes}`);
    assert.ok(result.eligible_metrics >= 14, `eligible ${result.eligible_metrics}`);
    assert.equal(result.eligible_metrics, 20);
    for (const factor of FACTORS) {
      assert.equal(result.factor_minima[factor], true, `factor minima ${factor}`);
    }
    assert.equal(result.required_core, true);
    assert.equal(result.coverage.n, 20);
    assert.equal(result.coverage.d, 20);
    assert.equal(result.prescription_path, true);
    assert.ok(Array.isArray(result.raw_rows) && result.raw_rows.length > 0, "raw rows");
    assert.match(result.manifest_digest, /^[0-9a-f]{64}$/);

    const replay = simulatePackBudget(spec, assumptions);
    assert.equal(replay.manifest_digest, result.manifest_digest);
    assert.equal(replay.median_minutes, result.median_minutes);
    assert.equal(replay.p90_minutes, result.p90_minutes);
    assert.deepEqual(replay.raw_rows, result.raw_rows);
  });

  test("slow-pack", async () => {
    const { simulatePackBudget, auditOpportunities } = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    for (const scenario of mutated.scenarios) {
      scenario.distribution = {
        kind: "triangular",
        low_minutes: 50,
        mode_minutes: 55,
        high_minutes: 60
      };
    }

    const audit = auditOpportunities(spec, mutated);
    assert.equal(audit.ok, true, audit.errors.join("; "));

    const result = simulatePackBudget(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(hasCode(result.reasons, "SLOW_PACK"), result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "UNDER_OBSERVED"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "DOUBLE_COUNT"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "NO_PRESCRIPTION"), false, result.reasons.join("; "));
    assert.ok(result.median_minutes > 40 || result.p90_minutes > 45, `median ${result.median_minutes} p90 ${result.p90_minutes}`);
    assert.ok(result.eligible_metrics >= 14);
    assert.equal(result.prescription_path, true);
  });

  test("under-observed", async () => {
    const { simulatePackBudget, auditOpportunities } = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    mutated.scenarios = mutated.scenarios.filter((scenario: Json) => scenario.family_id === "FAM-1");

    const audit = auditOpportunities(spec, mutated);
    assert.equal(audit.ok, true, audit.errors.join("; "));
    assert.ok(audit.eligible_metric_ids.length < 14);

    const result = simulatePackBudget(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(hasCode(result.reasons, "UNDER_OBSERVED"), result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "SLOW_PACK"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "DOUBLE_COUNT"), false, result.reasons.join("; "));
    assert.ok(result.eligible_metrics < 14, `eligible ${result.eligible_metrics}`);
    assert.ok(result.median_minutes <= 40, `median ${result.median_minutes}`);
    assert.ok(result.p90_minutes <= 45, `p90 ${result.p90_minutes}`);
  });

  test("double-count", async () => {
    const { simulatePackBudget, auditOpportunities } = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    const firstId = mutated.scenarios[0].primary_opportunities[0].opportunity_id;
    mutated.scenarios[1].primary_opportunities[0].opportunity_id = firstId;

    const audit = auditOpportunities(spec, mutated);
    assert.equal(audit.ok, false);
    assert.ok(
      audit.errors.some((entry: string) => entry.split(" ")[0] === "DOUBLE_COUNT"),
      audit.errors.join("; ")
    );

    const result = simulatePackBudget(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(hasCode(result.reasons, "DOUBLE_COUNT"), result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "SLOW_PACK"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "UNDER_OBSERVED"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "NO_PRESCRIPTION"), false, result.reasons.join("; "));
  });

  test("no-prescription", async () => {
    const { simulatePackBudget, auditOpportunities } = await requireExports();
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    const fam6 = mutated.scenarios.find((scenario: Json) => scenario.family_id === "FAM-6");
    fam6.primary_opportunities = fam6.primary_opportunities.filter(
      (opportunity: Json) => opportunity.metric_id !== "M19"
    );

    const audit = auditOpportunities(spec, mutated);
    assert.equal(audit.ok, true, audit.errors.join("; "));
    assert.ok(audit.eligible_metric_ids.length >= 14);
    assert.equal(audit.eligible_metric_ids.includes("M19"), false);

    const result = simulatePackBudget(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(hasCode(result.reasons, "NO_PRESCRIPTION"), result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "SLOW_PACK"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "UNDER_OBSERVED"), false, result.reasons.join("; "));
    assert.equal(hasCode(result.reasons, "DOUBLE_COUNT"), false, result.reasons.join("; "));
    assert.ok(result.eligible_metrics >= 14, `eligible ${result.eligible_metrics}`);
    assert.equal(result.prescription_path, false);
    for (const metricId of REQUIRED_CORE) {
      if (metricId === "M19") {
        assert.equal(audit.eligible_metric_ids.includes(metricId), false);
      } else {
        assert.equal(audit.eligible_metric_ids.includes(metricId), true, metricId);
      }
    }
    assert.ok(result.median_minutes <= 40, `median ${result.median_minutes}`);
    assert.ok(result.p90_minutes <= 45, `p90 ${result.p90_minutes}`);
  });
});
