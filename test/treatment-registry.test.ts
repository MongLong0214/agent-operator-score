import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "../specs/treatments.v0.json");
const modulePath = "../src/_deferred/treatment-registry.ts";

// Independent oracle for SSOT §8.3 / PRD-E0D requirement 3. One default v0 treatment
// per metric range, covering M01-M20 with no overlap. Labels are the English reading
// of the SSOT table. Nothing here is read from the frozen document.
const CANONICAL_IDS = Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);

const DEFAULT_RANGES = [
  { treatment_id: "T-M01-M02", metric_ids: ["M01", "M02"], label: "goal/scope contract template" },
  { treatment_id: "T-M03", metric_ids: ["M03"], label: "fact-vs-decision clarification gate" },
  { treatment_id: "T-M04", metric_ids: ["M04"], label: "acceptance-evidence contract" },
  { treatment_id: "T-M05", metric_ids: ["M05"], label: "context selection budget" },
  { treatment_id: "T-M06-M07", metric_ids: ["M06", "M07"], label: "retrieval provenance and freshness gate" },
  { treatment_id: "T-M08-M09", metric_ids: ["M08", "M09"], label: "atomic task and dependency map" },
  { treatment_id: "T-M10", metric_ids: ["M10"], label: "direct/tool/subagent routing rule" },
  { treatment_id: "T-M11", metric_ids: ["M11"], label: "handoff minimum contract" },
  { treatment_id: "T-M12", metric_ids: ["M12"], label: "durable checkpoint and resume packet" },
  { treatment_id: "T-M13", metric_ids: ["M13"], label: "idempotency key and transition ledger" },
  { treatment_id: "T-M14", metric_ids: ["M14"], label: "stall watchdog and terminal-state rule" },
  { treatment_id: "T-M15-M17", metric_ids: ["M15", "M16", "M17"], label: "evidence-bound completion gate" },
  { treatment_id: "T-M18", metric_ids: ["M18"], label: "intervention trigger and recovery packet" },
  { treatment_id: "T-M19", metric_ids: ["M19"], label: "least-privilege remediation; required before re-evaluation" },
  { treatment_id: "T-M20", metric_ids: ["M20"], label: "remove redundant layer or adjust model/tool tier" }
] as const;

const REQUIRED_FIELDS = [
  "treatment_id",
  "metric_ids",
  "label",
  "implementation_protocol",
  "cost",
  "permission_delta",
  "transferability",
  "retest_criteria",
  "safety_only_remediation"
] as const;

const REGISTRY_ID = "treatments.v0";
const CONTRACT_VERSION = "treatment-registry-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#8.3";

const TRANSFERABILITY_CLASSES = ["operator", "environment", "combined"] as const;
const ENVIRONMENT_TREATMENTS = new Set(["T-M12", "T-M13", "T-M14", "T-M19", "T-M20"]);

const RETEST_STANDARD =
  "target metric improved; M15-M17 non-degradation; M19 safety held; cost and intervention in bounds; not explained by memorizing the same answer";
const RETEST_M19 = `required before re-evaluation; ${RETEST_STANDARD}`;

const SAFETY_PROTOCOL =
  "revoke excess permissions, external actions and secret surfaces; do not emit an ordinary quality or process lever";

const PROTOCOLS: Record<string, string> = {
  "T-M01-M02":
    "write an executable goal/scope contract that names the desired end state, inclusions, exclusions and change-forbidden constraints before work starts",
  "T-M03":
    "classify every ask as a fact to look up or a decision only a human can make; block questions that are neither",
  "T-M04": "bind each acceptance id to a verifier and an evidence locator before execution",
  "T-M05": "cap selected context to the gold set and drop decoy or surplus blocks",
  "T-M06-M07":
    "admit a retrieved or remembered claim only with origin, timestamp and a task-specific trust label",
  "T-M08-M09":
    "split work into independently completable units and record the exact predecessor and join edges",
  "T-M10":
    "choose direct, tool, specialist or subagent by net benefit against the frozen route table; do not add a layer for its own sake",
  "T-M11": "close every handoff with owner, inputs, outputs, permissions and a join artifact",
  "T-M12":
    "persist goal, progress, blockers and evidence so a new session can resume from the last checkpoint",
  "T-M13": "record each transition under an idempotency key so a retry has exactly one intended effect",
  "T-M14":
    "stop, complete or declare a blocker from the watchdog and the unfinished-obligation set; do not invent a terminal state",
  "T-M15-M17":
    "allow a completion claim only when the exact revision, timestamp and acceptance map match current evidence",
  "T-M18":
    "intervene only on a labeled failure with a minimum recovery packet; do not treat extra intervention as credit",
  "T-M19": SAFETY_PROTOCOL,
  "T-M20":
    "drop a redundant layer or step the model/tool tier only if quality and safety stay on the frozen frontier"
};

type ValidateTreatmentRegistry = (input: unknown) => {
  ok: boolean;
  errors: string[];
  treatments: Array<Record<string, unknown>>;
};

const loadValidator = async (): Promise<ValidateTreatmentRegistry> => {
  const loaded = await import(modulePath);
  return loaded.validateTreatmentRegistry;
};

const frozen = () => JSON.parse(readFileSync(registryPath, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));
const treatmentOf = (doc: any, id: string) =>
  doc.treatments.find((entry: any) => entry.treatment_id === id);

const coveredMetrics = (doc: any): string[] =>
  (doc.treatments ?? []).flatMap((entry: any) =>
    Array.isArray(entry?.metric_ids) ? entry.metric_ids : []
  );

describe("treatment-registry", () => {
  test("coverage-M01-M20", async () => {
    const validateTreatmentRegistry = await loadValidator();
    const result = validateTreatmentRegistry(frozen());

    assert.deepEqual(result.errors, [], "frozen treatment registry must validate with zero errors");
    assert.equal(result.ok, true);
    assert.equal(result.treatments.length, DEFAULT_RANGES.length);
    assert.deepEqual(
      result.treatments.map((entry) => entry.treatment_id),
      DEFAULT_RANGES.map((entry) => entry.treatment_id),
      "registry must declare exactly the SSOT §8.3 ranges in table order"
    );

    const doc = frozen();
    assert.equal(doc.registry_id, REGISTRY_ID);
    assert.equal(doc.contract_version, CONTRACT_VERSION);
    assert.equal(doc.source_authority, SOURCE_AUTHORITY);

    const seen = new Set<string>();
    for (const range of DEFAULT_RANGES) {
      const entry = treatmentOf(doc, range.treatment_id);
      assert.ok(entry, `${range.treatment_id} is absent`);
      for (const field of REQUIRED_FIELDS) {
        assert.ok(Object.hasOwn(entry, field), `${range.treatment_id} is missing ${field}`);
      }
      assert.deepEqual(
        Object.keys(entry).sort(),
        [...REQUIRED_FIELDS].sort(),
        `${range.treatment_id} carries a dead or undeclared field`
      );
      assert.deepEqual(entry.metric_ids, [...range.metric_ids], range.treatment_id);
      assert.equal(entry.label, range.label, range.treatment_id);
      assert.equal(entry.implementation_protocol, PROTOCOLS[range.treatment_id], range.treatment_id);
      assert.ok(entry.cost && typeof entry.cost === "object" && !Array.isArray(entry.cost), range.treatment_id);
      for (const part of ["time", "tokens", "maintenance"]) {
        const value = entry.cost[part];
        assert.ok(value && Number.isInteger(value.n) && Number.isInteger(value.d) && value.d > 0 && value.n >= 0, `${range.treatment_id} cost.${part}`);
      }
      assert.deepEqual(entry.permission_delta, [], range.treatment_id);
      const expectedTransfer = ENVIRONMENT_TREATMENTS.has(range.treatment_id) ? "environment" : "operator";
      assert.equal(entry.transferability, expectedTransfer, range.treatment_id);
      assert.ok(TRANSFERABILITY_CLASSES.includes(entry.transferability), range.treatment_id);
      for (const metricId of range.metric_ids) {
        assert.equal(seen.has(metricId), false, `${metricId} is covered twice`);
        seen.add(metricId);
      }
    }
    assert.deepEqual([...seen].sort(), [...CANONICAL_IDS], "registry must cover exactly M01-M20");

    const dropped = frozen();
    dropped.treatments = dropped.treatments.filter((entry: any) => entry.treatment_id !== "T-M14");
    const droppedResult = validateTreatmentRegistry(dropped);
    assert.equal(droppedResult.ok, false, "dropping the M14 range was accepted");
    assert.ok(has(droppedResult, "METRIC_ID_GAP M14"), droppedResult.errors.join("; "));

    const narrowed = frozen();
    treatmentOf(narrowed, "T-M06-M07").metric_ids = ["M06"];
    const narrowedResult = validateTreatmentRegistry(narrowed);
    assert.equal(narrowedResult.ok, false, "dropping M07 from its range was accepted");
    assert.ok(has(narrowedResult, "METRIC_ID_GAP M07"), narrowedResult.errors.join("; "));
  });

  test("unique-default", async () => {
    const validateTreatmentRegistry = await loadValidator();
    const result = validateTreatmentRegistry(frozen());
    assert.deepEqual(result.errors, [], "frozen registry must already have one default per metric");

    const counts = new Map<string, number>();
    for (const metricId of coveredMetrics(frozen())) {
      counts.set(metricId, (counts.get(metricId) ?? 0) + 1);
    }
    for (const metricId of CANONICAL_IDS) {
      assert.equal(counts.get(metricId), 1, `${metricId} does not have exactly one default`);
    }

    const overlapped = frozen();
    treatmentOf(overlapped, "T-M03").metric_ids = ["M03", "M01"];
    const overlappedResult = validateTreatmentRegistry(overlapped);
    assert.equal(overlappedResult.ok, false, "M01 mapping to two defaults was accepted");
    assert.ok(has(overlappedResult, "DUPLICATE_DEFAULT M01"), overlappedResult.errors.join("; "));

    const doubled = frozen();
    doubled.treatments[1] = {
      ...clone(treatmentOf(doubled, "T-M01-M02")),
      treatment_id: "T-M01-M02-dup"
    };
    const doubledResult = validateTreatmentRegistry(doubled);
    assert.equal(doubledResult.ok, false, "two default treatments for M01-M02 were accepted");
    assert.ok(has(doubledResult, "DUPLICATE_DEFAULT M01"), doubledResult.errors.join("; "));
    assert.ok(has(doubledResult, "METRIC_ID_GAP M03"), doubledResult.errors.join("; "));
  });

  test("S2-remediation", async () => {
    const validateTreatmentRegistry = await loadValidator();
    const result = validateTreatmentRegistry(frozen());
    assert.deepEqual(result.errors, [], "frozen registry must already encode safety-only S2/S3 remediation");

    const safety = result.treatments.filter((entry) => entry.safety_only_remediation === true);
    assert.equal(safety.length, 1, "S2/S3 must resolve to exactly one safety-only treatment");
    assert.equal(safety[0].treatment_id, "T-M19");
    assert.deepEqual(safety[0].metric_ids, ["M19"]);
    assert.equal(safety[0].label, "least-privilege remediation; required before re-evaluation");
    assert.equal(safety[0].implementation_protocol, SAFETY_PROTOCOL);
    assert.equal(safety[0].transferability, "environment");
    for (const entry of result.treatments) {
      if (entry.treatment_id === "T-M19") continue;
      assert.equal(entry.safety_only_remediation, false, `${entry.treatment_id} is ordinary advice and must not be a safety remediation`);
    }

    const ordinaryAsSafety = frozen();
    treatmentOf(ordinaryAsSafety, "T-M01-M02").safety_only_remediation = true;
    const ordinaryResult = validateTreatmentRegistry(ordinaryAsSafety);
    assert.equal(ordinaryResult.ok, false, "ordinary M01-M02 advice was accepted as S2 remediation");
    assert.ok(has(ordinaryResult, "ORDINARY_ADVICE_FOR_S2"), ordinaryResult.errors.join("; "));

    const stripped = frozen();
    treatmentOf(stripped, "T-M19").safety_only_remediation = false;
    const strippedResult = validateTreatmentRegistry(stripped);
    assert.equal(strippedResult.ok, false, "clearing the M19 safety flag left S2 without remediation");
    assert.ok(has(strippedResult, "SAFETY_REMEDIATION_MISSING"), strippedResult.errors.join("; "));

    const rewritten = frozen();
    treatmentOf(rewritten, "T-M19").implementation_protocol = PROTOCOLS["T-M01-M02"];
    const rewrittenResult = validateTreatmentRegistry(rewritten);
    assert.equal(rewrittenResult.ok, false, "ordinary goal/scope advice was accepted on the S2 path");
    assert.ok(has(rewrittenResult, "ORDINARY_ADVICE_FOR_S2"), rewrittenResult.errors.join("; "));
  });

  test("missing-retest", async () => {
    const validateTreatmentRegistry = await loadValidator();
    const result = validateTreatmentRegistry(frozen());
    assert.deepEqual(result.errors, [], "frozen registry must already carry retest criteria on every treatment");

    for (const range of DEFAULT_RANGES) {
      const entry = treatmentOf(frozen(), range.treatment_id);
      assert.equal(
        entry.retest_criteria,
        range.treatment_id === "T-M19" ? RETEST_M19 : RETEST_STANDARD,
        range.treatment_id
      );
    }

    for (const treatmentId of ["T-M04", "T-M19"] as const) {
      const missing = frozen();
      delete treatmentOf(missing, treatmentId).retest_criteria;
      const missingResult = validateTreatmentRegistry(missing);
      assert.equal(missingResult.ok, false, `dropping retest_criteria from ${treatmentId} was accepted`);
      assert.ok(
        has(missingResult, `MISSING_RETEST ${treatmentId}`),
        `dropping retest_criteria from ${treatmentId} produced ${missingResult.errors.join("; ")}`
      );
    }

    const blank = frozen();
    treatmentOf(blank, "T-M10").retest_criteria = "   ";
    const blankResult = validateTreatmentRegistry(blank);
    assert.equal(blankResult.ok, false, "blank retest criteria on T-M10 was accepted");
    assert.ok(has(blankResult, "MISSING_RETEST T-M10"), blankResult.errors.join("; "));
  });

  test("unknown-metric", async () => {
    const validateTreatmentRegistry = await loadValidator();
    const result = validateTreatmentRegistry(frozen());
    assert.deepEqual(result.errors, []);

    const extra = frozen();
    extra.treatments.push({
      ...clone(treatmentOf(extra, "T-M20")),
      treatment_id: "T-M21",
      metric_ids: ["M21"]
    });
    const extraResult = validateTreatmentRegistry(extra);
    assert.equal(extraResult.ok, false, "M21 was accepted as a treatment metric");
    assert.ok(has(extraResult, "UNKNOWN_METRIC_ID M21"), extraResult.errors.join("; "));

    const renamed = frozen();
    treatmentOf(renamed, "T-M20").metric_ids = ["M21"];
    const renamedResult = validateTreatmentRegistry(renamed);
    assert.equal(renamedResult.ok, false, "replacing M20 with M21 was accepted");
    assert.ok(has(renamedResult, "UNKNOWN_METRIC_ID M21"), renamedResult.errors.join("; "));
    assert.ok(has(renamedResult, "METRIC_ID_GAP M20"), renamedResult.errors.join("; "));
  });
});
