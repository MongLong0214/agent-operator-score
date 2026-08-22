import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const REFUSED = "protocol cannot prove every run/profile/form/deviation row is retained and blinded.";
const protocol = readFileSync(new URL("../../../docs/validation/ALPHA-PREREGISTRATION.md", import.meta.url), "utf8");

type Manifest = ReadonlyMap<string, string>;
type AlphaRow = Readonly<{
  participant_id: string;
  consent_recorded: boolean;
  cohort: "novice" | "intermediate" | "expert";
  form: string;
  enrollment_status: "enrolled" | "excluded" | "withdrawn" | "completed";
  exclusion_reason: "NO_CONSENT" | "INELIGIBLE" | "PRE_ASSESSMENT_WITHDRAWAL" | null;
  reference_run_id: string | null;
  task_id: string;
  session_id: string;
  reviewer_a: string | null;
  reviewer_b: string | null;
  review_adjudication: "not_needed" | "third_blinded_expert" | null;
  duration_minutes: number | null;
  automated_score: number | null;
  expert_review: "pass" | "partial" | "fail" | "no" | null;
  missing_reason: string | null;
  deviation_id: string | null;
  transfer_outcome: "observed" | "not_observed" | null;
}>;
type ReferenceRun = Readonly<{ reference_run_id: string; profile_id: string }>;
type AlphaInput = Readonly<{
  mode: string;
  protocol: string;
  rows: readonly AlphaRow[];
  referenceRuns: readonly ReferenceRun[];
  formAssignments: Readonly<Record<string, number>>;
}>;
type Result = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
type Snapshot = Readonly<{
  mode: "dry-run";
  executed: false;
  rows: readonly AlphaRow[];
  referenceRuns: readonly ReferenceRun[];
  formAssignments: Readonly<Record<string, number>>;
  reviewerRows: readonly Readonly<Record<string, unknown>>[];
  deviationRows: readonly Readonly<{ participant_id: string; deviation_id: string }>[];
}>;
type AlphaRun = Readonly<{
  ok: true;
  mode: "dry-run";
  executed: false;
  replaceRecordedRow: (participantId: unknown, row: unknown) => Result;
  recordDeviation: (input: unknown) => Result;
  emitVerdict: (candidate: unknown) => Result;
  snapshot: () => Snapshot;
}>;
type AlphaApi = { runAlphaProtocol: (input: unknown) => AlphaRun | Readonly<{ ok: false; reason: string }> };

const loadAlpha = async (): Promise<Partial<AlphaApi>> => {
  try {
    return await import("../src/alpha-orchestrator.ts") as AlphaApi;
  } catch {
    return {};
  }
};

const requireAlpha = async (): Promise<AlphaApi> => {
  const loaded = await loadAlpha();
  assert.equal(typeof loaded.runAlphaProtocol, "function", REFUSED);
  if (typeof loaded.runAlphaProtocol !== "function") throw new Error(REFUSED);
  return loaded as AlphaApi;
};

const accepted = (result: { ok: boolean; reason?: string }): void => {
  assert.equal(result.ok, true, REFUSED);
};

const refused = (result: { ok: boolean; reason?: string }): void => {
  assert.equal(result.ok, false, REFUSED);
  if (!result.ok) assert.equal(result.reason, REFUSED, REFUSED);
};

const alphaRun = (api: AlphaApi, input: AlphaInput): AlphaRun => {
  const result = api.runAlphaProtocol(input);
  accepted(result);
  if (!result.ok) throw new Error(REFUSED);
  return result;
};

const manifest = (text: string): Manifest => {
  const section = text.match(/<!-- alpha-protocol-manifest:start -->([\s\S]*?)<!-- alpha-protocol-manifest:end -->/);
  assert.ok(section, REFUSED);
  const entries = new Map<string, string>();
  for (const line of section[1].trim().split("\n")) {
    const separator = line.indexOf("=");
    assert.ok(separator > 0, REFUSED);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    assert.ok(key.length > 0 && value.length > 0 && !entries.has(key), REFUSED);
    entries.set(key, value);
  }
  return entries;
};

const manifestValue = (entries: Manifest, key: string): string => {
  const value = entries.get(key);
  assert.notEqual(value, undefined, REFUSED);
  if (value === undefined) throw new Error(REFUSED);
  return value;
};

const setManifestValue = (text: string, key: string, value: string): string => {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  assert.equal(pattern.test(text), true, REFUSED);
  return text.replace(pattern, `${key}=${value}`);
};

const values = manifest(protocol);
const missingReasons = manifestValue(values, "missing_reasons").split(",").map((value) => value.trim());
const allowedVerdicts = manifestValue(values, "allowed_verdicts").split(",").map((value) => value.trim());
const blindedFields = manifestValue(values, "blinded_fields").split(",").map((value) => value.trim());
const formAssignments = Object.freeze(
  Object.fromEntries(
    [...values.entries()]
      .filter(([key]) => key.startsWith("form_"))
      .map(([key, value]) => [key.slice("form_".length).toUpperCase(), Number(value)])
  )
);
const forms = Object.keys(formAssignments);
assert.equal(forms.length, 2, REFUSED);

const ROW = Object.freeze({
  participant_id: "dry-run-row-001",
  consent_recorded: true,
  cohort: "novice" as const,
  form: forms[0],
  enrollment_status: "completed" as const,
  exclusion_reason: null,
  reference_run_id: "reference-dry-run-001",
  task_id: "task-dry-run-001",
  session_id: "session-dry-run-001",
  reviewer_a: "reviewer-a-dry-run",
  reviewer_b: "reviewer-b-dry-run",
  review_adjudication: "not_needed" as const,
  duration_minutes: 30,
  automated_score: 0.8,
  expert_review: "pass" as const,
  missing_reason: null,
  deviation_id: "deviation-dry-run-001",
  transfer_outcome: "observed" as const
}) satisfies AlphaRow;
const REFERENCE_RUNS = Object.freeze([
  Object.freeze({ reference_run_id: "reference-dry-run-001", profile_id: "profile-dry-run-001" })
] satisfies readonly ReferenceRun[]);

const input = (changes: Partial<AlphaInput> = {}): AlphaInput => ({
  mode: "dry-run",
  protocol,
  rows: Object.freeze([{ ...ROW }]),
  referenceRuns: REFERENCE_RUNS,
  formAssignments,
  ...changes
});

describe("alpha-orchestrator", () => {
  test("dry-run", async () => {
    const api = await requireAlpha();
    const candidate = input();
    const run = alphaRun(api, candidate);

    assert.equal(run.mode, "dry-run", REFUSED);
    assert.equal(run.executed, false, REFUSED);
    assert.deepEqual(run.snapshot().rows, candidate.rows, REFUSED);
    assert.deepEqual(run.snapshot().referenceRuns, candidate.referenceRuns, REFUSED);
    assert.deepEqual(run.snapshot().formAssignments, candidate.formAssignments, REFUSED);
    refused(api.runAlphaProtocol({ ...candidate, mode: "execute" }));
  });

  test("consent-block", async () => {
    const api = await requireAlpha();
    const candidate = input();
    accepted(api.runAlphaProtocol(candidate));
    refused(api.runAlphaProtocol({ ...candidate, rows: Object.freeze([{ ...ROW, consent_recorded: false }]) }));
  });

  test("immutable-row", async () => {
    const api = await requireAlpha();
    const candidate = input();
    const run = alphaRun(api, candidate);
    const recorded = candidate.rows[0];
    const changed = { ...recorded, form: forms[1] };

    accepted(run.replaceRecordedRow(recorded.participant_id, recorded));
    refused(run.replaceRecordedRow(recorded.participant_id, changed));
    assert.deepEqual(run.snapshot().rows, candidate.rows, REFUSED);
  });

  test("missingness", async () => {
    const api = await requireAlpha();
    for (const reason of missingReasons) {
      const missing = Object.freeze({ ...ROW, automated_score: null, missing_reason: reason });
      const candidate = input({ rows: Object.freeze([missing]) });
      const run = alphaRun(api, candidate);

      assert.deepEqual(run.snapshot().rows, candidate.rows, REFUSED);
      refused(api.runAlphaProtocol({ ...candidate, rows: Object.freeze([{ ...missing, missing_reason: null }]) }));
      refused(api.runAlphaProtocol({ ...candidate, rows: Object.freeze([{ ...missing, missing_reason: `not-${reason}` }]) }));
      refused(api.runAlphaProtocol({ ...candidate, protocol: setManifestValue(protocol, "delete_rows", "true") }));
    }

    const registeredReason = missingReasons[0];
    const unregisteredReason = "anything";
    assert.equal(missingReasons.includes(unregisteredReason), false, REFUSED);
    const missing = Object.freeze({ ...ROW, automated_score: null, missing_reason: registeredReason });
    const retained = input({ rows: Object.freeze([missing]) });
    accepted(api.runAlphaProtocol(retained));
    refused(api.runAlphaProtocol({ ...retained, rows: Object.freeze([{ ...missing, missing_reason: unregisteredReason }]) }));

    const complete = input();
    accepted(api.runAlphaProtocol(complete));
    refused(api.runAlphaProtocol({ ...complete, rows: Object.freeze([{ ...ROW, automated_score: null }]) }));
    refused(api.runAlphaProtocol({ ...complete, rows: Object.freeze([{ ...ROW, missing_reason: missingReasons[0] }]) }));
  });

  test("counterbalance", async () => {
    const api = await requireAlpha();
    const candidate = input();
    const run = alphaRun(api, candidate);

    assert.deepEqual(run.snapshot().formAssignments, candidate.formAssignments, REFUSED);
    for (const form of forms) {
      refused(api.runAlphaProtocol({
        ...candidate,
        formAssignments: Object.freeze({ ...formAssignments, [form]: formAssignments[form] - 1 })
      }));
    }
    refused(api.runAlphaProtocol({ ...candidate, rows: Object.freeze([{ ...ROW, form: `not-${forms[0]}` }]) }));
  });

  test("blinding", async () => {
    const api = await requireAlpha();
    const candidate = input();
    const run = alphaRun(api, candidate);
    const reviewerRow = run.snapshot().reviewerRows[0];

    for (const field of blindedFields) assert.equal(Object.hasOwn(reviewerRow, field), false, REFUSED);
    const visibleField = Object.keys(ROW).find((field) => !blindedFields.includes(field));
    assert.notEqual(visibleField, undefined, REFUSED);
    if (visibleField === undefined) throw new Error(REFUSED);
    assert.equal(reviewerRow[visibleField], ROW[visibleField as keyof typeof ROW], REFUSED);
  });

  test("deviation", async () => {
    const api = await requireAlpha();
    const candidate = input();
    const run = alphaRun(api, candidate);
    const recorded = candidate.rows[0];

    accepted(run.recordDeviation({ participant_id: recorded.participant_id, deviation_id: recorded.deviation_id }));
    refused(run.recordDeviation({ participant_id: recorded.participant_id, deviation_id: "" }));
    refused(run.recordDeviation({ participant_id: recorded.participant_id, deviation_id: `not-${recorded.deviation_id}` }));
    assert.deepEqual(
      run.snapshot().deviationRows,
      [{ participant_id: recorded.participant_id, deviation_id: recorded.deviation_id }],
      REFUSED
    );
  });

  test("feasibility-claim-block", async () => {
    const api = await requireAlpha();
    const run = alphaRun(api, input());

    for (const verdict of allowedVerdicts) accepted(run.emitVerdict(verdict));
    refused(run.emitVerdict("CERTIFIED"));
  });
});
