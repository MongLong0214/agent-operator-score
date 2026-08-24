import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED = "gate thresholds and pivot cannot be reproduced from conserved alpha rows.";
const modulePath = "../src/scorer/validation.ts";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const protocolPath = resolve(root, "docs/validation/ALPHA-PREREGISTRATION.md");

type AlphaRow = Record<string, unknown>;
type ReferenceRun = { reference_run_id: string; profile_id: string };
type Input = { protocol: string; rows: AlphaRow[]; referenceRuns: ReferenceRun[] };
type Gate = { passed: boolean };
type Analysis = {
  ok: boolean;
  verdict: string | null;
  next_action: string | null;
  feasibility_only: boolean;
  gates: {
    row_accounting: Gate;
    reference_runs: Gate;
    duration: Gate;
    blind_review: Gate;
    person_signal: Gate;
  };
  observations: {
    person_signal_variance: number | null;
    task_variance: number | null;
    session_variance: number | null;
    known_groups: Record<string, number | null>;
    agreement: { pair_count: number; matching_count: number; correlation: number | null };
    duration: { median_minutes: number | null };
    profile_effects: Record<string, number | null>;
    transfer: { observed_count: number; not_observed_count: number; missing_count: number };
    missingness: Record<string, number>;
    deviations: string[];
  };
};
type AnalyzeAlpha = (input: unknown) => Analysis;

const loadModule = async (): Promise<Record<string, unknown>> => {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const requireAnalyzeAlpha = async (): Promise<AnalyzeAlpha> => {
  const module = await loadModule();
  assert.equal(typeof module.analyzeAlpha, "function", PINNED);
  return module.analyzeAlpha as AnalyzeAlpha;
};

const protocol = (): string => readFileSync(protocolPath, "utf8");

const manifest = (text: string): Map<string, string> => {
  const match = text.match(/<!-- alpha-protocol-manifest:start -->([\s\S]*?)<!-- alpha-protocol-manifest:end -->/);
  assert.ok(match, PINNED);
  const entries = new Map<string, string>();
  for (const line of match[1].trim().split("\n")) {
    const separator = line.indexOf("=");
    assert.ok(separator > 0, PINNED);
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return entries;
};

const integer = (entries: Map<string, string>, key: string): number => {
  const value = Number(entries.get(key));
  assert.equal(Number.isSafeInteger(value), true, PINNED);
  return value;
};

const flag = (entries: Map<string, string>, key: string): boolean => {
  const value = entries.get(key);
  assert.equal(value === "true" || value === "false", true, PINNED);
  return value === "true";
};

const verdicts = (entries: Map<string, string>): string[] => {
  const listed = entries.get("allowed_verdicts")?.split(",").map((value) => value.trim()) ?? [];
  assert.equal(listed.length > 0, true, PINNED);
  return listed;
};

const replaceManifestValue = (text: string, key: string, value: string): string =>
  text.replace(new RegExp(`(^${key}=).*`, "m"), `$1${value}`);

const approximately = (actual: number | null, expected: number): boolean =>
  actual !== null && Math.abs(actual - expected) < 1e-12;

const reviewFor = (score: number): "fail" | "partial" | "pass" => {
  if (score <= 0) return "fail";
  if (score >= 1) return "pass";
  return "partial";
};

const rowsFor = (
  text: string,
  options: {
    scoreAt?: (index: number, cohort: string) => number;
    taskAt?: (index: number) => string;
    sessionAt?: (index: number) => string;
    reviewAt?: (index: number, score: number) => "fail" | "partial" | "pass" | "no" | null;
    durationAt?: (index: number) => number | null;
    transferAt?: (index: number) => "observed" | "not_observed" | null;
    reviewerAAt?: (index: number) => string | null;
    reviewerBAt?: (index: number) => string | null;
    missingReasonAt?: (index: number) => "withdrawn" | "technical_failure" | "review_unavailable" | null;
  } = {}
): AlphaRow[] => {
  const entries = manifest(text);
  const cohorts = [
    ...Array.from({ length: integer(entries, "cohort_novice") }, () => "novice"),
    ...Array.from({ length: integer(entries, "cohort_intermediate") }, () => "intermediate"),
    ...Array.from({ length: integer(entries, "cohort_expert") }, () => "expert")
  ];
  const forms = [
    ...Array.from({ length: integer(entries, "form_a") }, () => "A"),
    ...Array.from({ length: integer(entries, "form_b") }, () => "B")
  ];
  assert.equal(cohorts.length, forms.length, PINNED);
  const duration = integer(entries, "stop_median_duration_minutes_max");

  return cohorts.map((cohort, index) => {
    const score = options.scoreAt?.(index, cohort) ?? (index % 2);
    const reviewerA = options.reviewerAAt === undefined ? `reviewer-a-${index + 1}` : options.reviewerAAt(index);
    const reviewerB = options.reviewerBAt === undefined ? `reviewer-b-${index + 1}` : options.reviewerBAt(index);
    return {
      participant_id: `participant-${index + 1}`,
      consent_recorded: true,
      cohort,
      form: forms[index],
      enrollment_status: "completed",
      exclusion_reason: null,
      reference_run_id: `reference-run-${index + 1}`,
      task_id: options.taskAt?.(index) ?? "task-shared",
      session_id: options.sessionAt?.(index) ?? "session-shared",
      reviewer_a: reviewerA,
      reviewer_b: reviewerB,
      review_adjudication: "not_needed",
      duration_minutes: options.durationAt?.(index) ?? duration,
      automated_score: score,
      expert_review: options.reviewAt?.(index, score) ?? reviewFor(score),
      missing_reason: options.missingReasonAt?.(index) ?? null,
      deviation_id: null,
      transfer_outcome: options.transferAt?.(index) ?? "observed"
    };
  });
};

const referenceRunsFor = (text: string, count = integer(manifest(text), "stop_reference_runs_min")): ReferenceRun[] =>
  Array.from({ length: count }, (_, index) => ({
    reference_run_id: `reference-run-${index + 1}`,
    profile_id: index % 2 === 0 ? "profile-a" : "profile-b"
  }));

const inputFor = (text: string, rows = rowsFor(text), referenceRuns = referenceRunsFor(text)): Input => ({
  protocol: text,
  rows,
  referenceRuns
});

describe("validation", () => {
  test("known-vectors", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const entries = manifest(text);
    const allowed = verdicts(entries);
    const durationLimit = integer(entries, "stop_median_duration_minutes_max");
    const referenceMinimum = integer(entries, "stop_reference_runs_min");
    const referenceMaximum = integer(entries, "stop_reference_runs_max");
    const vector = inputFor(
      text,
      rowsFor(text, {
        scoreAt: (_, cohort) => (cohort === "novice" ? 0 : cohort === "intermediate" ? 0.5 : 1)
      })
    );
    const result = analyzeAlpha(vector);

    assert.equal(result.ok, true, PINNED);
    assert.equal(result.verdict, "PASS_TO_CONTINUE", PINNED);
    assert.equal(allowed.includes(result.verdict as string), true, PINNED);
    assert.equal(result.next_action, "CONTINUE_PREREGISTERED_INVESTIGATION", PINNED);
    assert.equal(result.feasibility_only, true, PINNED);
    assert.equal(approximately(result.observations.person_signal_variance, 259 / 1600), true, PINNED);
    assert.equal(approximately(result.observations.task_variance, 0), true, PINNED);
    assert.equal(approximately(result.observations.session_variance, 0), true, PINNED);
    assert.deepEqual(result.observations.known_groups, { novice: 0, intermediate: 0.5, expert: 1 }, PINNED);
    assert.deepEqual(result.observations.agreement, { pair_count: 20, matching_count: 20, correlation: 1 }, PINNED);
    assert.equal(result.observations.duration.median_minutes, durationLimit, PINNED);
    assert.deepEqual(result.observations.profile_effects, { "profile-a": 0.45, "profile-b": 0.5 }, PINNED);
    assert.deepEqual(result.observations.transfer, { observed_count: 20, not_observed_count: 0, missing_count: 0 }, PINNED);
    assert.deepEqual(result.observations.missingness, {}, PINNED);
    assert.deepEqual(result.observations.deviations, [], PINNED);

    const atReferenceMaximum = analyzeAlpha(inputFor(text, vector.rows, referenceRunsFor(text, referenceMaximum)));
    assert.equal(atReferenceMaximum.verdict, "PASS_TO_CONTINUE", PINNED);
    const belowReferenceMinimum = analyzeAlpha(inputFor(text, vector.rows, referenceRunsFor(text, referenceMinimum - 1)));
    assert.equal(belowReferenceMinimum.verdict, "PIVOT_REQUIRED", PINNED);
    const aboveReferenceMaximum = analyzeAlpha(inputFor(text, vector.rows, referenceRunsFor(text, referenceMaximum + 1)));
    assert.equal(aboveReferenceMaximum.verdict, "PIVOT_REQUIRED", PINNED);
    const raisedReferenceMinimum = replaceManifestValue(text, "stop_reference_runs_min", String(referenceMinimum + 1));
    const loweredReferenceMaximum = replaceManifestValue(text, "stop_reference_runs_max", String(referenceMaximum - 1));
    assert.equal(
      analyzeAlpha(inputFor(raisedReferenceMinimum, vector.rows, referenceRunsFor(raisedReferenceMinimum, referenceMinimum))).verdict,
      "PIVOT_REQUIRED",
      PINNED
    );
    assert.equal(
      analyzeAlpha(inputFor(loweredReferenceMaximum, vector.rows, referenceRunsFor(loweredReferenceMaximum, referenceMaximum))).verdict,
      "PIVOT_REQUIRED",
      PINNED
    );
  });

  test("person-signal", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const equalSignalAndNoise = analyzeAlpha(inputFor(text, rowsFor(text, { scoreAt: () => 0 })));
    const result = analyzeAlpha(inputFor(text, rowsFor(text, { scoreAt: (index) => index % 2 })));

    assert.equal(equalSignalAndNoise.ok, true, PINNED);
    assert.equal(equalSignalAndNoise.verdict, "INCONCLUSIVE", PINNED);
    assert.equal(equalSignalAndNoise.gates.person_signal.passed, false, PINNED);
    assert.equal(approximately(equalSignalAndNoise.observations.person_signal_variance, 0), true, PINNED);
    assert.equal(approximately(equalSignalAndNoise.observations.task_variance, 0), true, PINNED);
    assert.equal(approximately(equalSignalAndNoise.observations.session_variance, 0), true, PINNED);
    assert.equal(result.ok, true, PINNED);
    assert.equal(result.verdict, "PASS_TO_CONTINUE", PINNED);
    assert.equal(result.gates.person_signal.passed, true, PINNED);
    assert.equal(approximately(result.observations.person_signal_variance, 0.25), true, PINNED);
    assert.equal(approximately(result.observations.task_variance, 0), true, PINNED);
    assert.equal(approximately(result.observations.session_variance, 0), true, PINNED);
  });

  test("noise-dominant", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const taskDominant = analyzeAlpha(
      inputFor(
        text,
        rowsFor(text, {
          scoreAt: (index) => (index < 10 ? (index % 2 === 0 ? 0.2 : 0.4) : index % 2 === 0 ? 0.6 : 0.8),
          taskAt: (index) => (index < 10 ? "task-low" : "task-high")
        })
      )
    );
    const sessionDominant = analyzeAlpha(
      inputFor(
        text,
        rowsFor(text, {
          scoreAt: (index) => (index < 10 ? (index % 2 === 0 ? 0.2 : 0.4) : index % 2 === 0 ? 0.6 : 0.8),
          sessionAt: (index) => (index < 10 ? "session-low" : "session-high")
        })
      )
    );

    assert.equal(taskDominant.verdict, "INCONCLUSIVE", PINNED);
    assert.equal(taskDominant.gates.person_signal.passed, false, PINNED);
    assert.equal(approximately(taskDominant.observations.person_signal_variance, 0.01), true, PINNED);
    assert.equal(approximately(taskDominant.observations.task_variance, 0.04), true, PINNED);
    assert.equal(approximately(taskDominant.observations.session_variance, 0), true, PINNED);
    assert.equal(sessionDominant.verdict, "INCONCLUSIVE", PINNED);
    assert.equal(sessionDominant.gates.person_signal.passed, false, PINNED);
    assert.equal(approximately(sessionDominant.observations.person_signal_variance, 0.01), true, PINNED);
    assert.equal(approximately(sessionDominant.observations.task_variance, 0), true, PINNED);
    assert.equal(approximately(sessionDominant.observations.session_variance, 0.04), true, PINNED);
  });

  test("duration-fail", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const limit = integer(manifest(text), "stop_median_duration_minutes_max");
    const accepted = analyzeAlpha(inputFor(text, rowsFor(text, { durationAt: () => limit })));
    const refused = analyzeAlpha(inputFor(text, rowsFor(text, { durationAt: () => limit + 1 })));
    const raisedLimit = replaceManifestValue(text, "stop_median_duration_minutes_max", String(limit + 1));
    const raisedLimitResult = analyzeAlpha(inputFor(raisedLimit, rowsFor(raisedLimit, { durationAt: () => limit + 1 })));

    assert.equal(accepted.verdict, "PASS_TO_CONTINUE", PINNED);
    assert.equal(accepted.gates.duration.passed, true, PINNED);
    assert.equal(accepted.observations.duration.median_minutes, limit, PINNED);
    assert.equal(refused.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(refused.gates.duration.passed, false, PINNED);
    assert.equal(refused.observations.duration.median_minutes, limit + 1, PINNED);
    assert.equal(raisedLimitResult.verdict, "PASS_TO_CONTINUE", PINNED);
  });

  test("agreement-low", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const accepted = analyzeAlpha(inputFor(text, rowsFor(text, { scoreAt: (index) => index % 2 })));
    const refused = analyzeAlpha(
      inputFor(
        text,
        rowsFor(text, {
          scoreAt: (index) => index % 2,
          reviewAt: (index) => (index % 2 === 0 ? "pass" : "fail")
        })
      )
    );

    assert.deepEqual(accepted.observations.agreement, { pair_count: 20, matching_count: 20, correlation: 1 }, PINNED);
    assert.deepEqual(refused.observations.agreement, { pair_count: 20, matching_count: 0, correlation: -1 }, PINNED);
  });

  test("transfer-fail", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const accepted = analyzeAlpha(inputFor(text));
    const refused = analyzeAlpha(inputFor(text, rowsFor(text, { transferAt: () => "not_observed" })));

    assert.deepEqual(accepted.observations.transfer, { observed_count: 20, not_observed_count: 0, missing_count: 0 }, PINNED);
    assert.deepEqual(refused.observations.transfer, { observed_count: 0, not_observed_count: 20, missing_count: 0 }, PINNED);
  });

  test("incomplete", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const entries = manifest(text);
    const enrollment = integer(entries, "enrollment_n");
    const stopParticipants = integer(entries, "stop_participants");
    const novice = integer(entries, "cohort_novice");
    const intermediate = integer(entries, "cohort_intermediate");
    const expert = integer(entries, "cohort_expert");
    const formA = integer(entries, "form_a");
    const formB = integer(entries, "form_b");
    const reviewCount = integer(entries, "reviewer_count");
    const requiresReview = flag(entries, "stop_blind_review_required");
    const complete = inputFor(text);
    const incomplete = analyzeAlpha(inputFor(text, complete.rows.slice(0, complete.rows.length - 1)));
    const changedEnrollment = analyzeAlpha(inputFor(replaceManifestValue(text, "enrollment_n", String(enrollment + 1)), complete.rows));
    const changedStop = analyzeAlpha(inputFor(replaceManifestValue(text, "stop_participants", String(stopParticipants + 1)), complete.rows));
    const changedNovice = analyzeAlpha(inputFor(replaceManifestValue(text, "cohort_novice", String(novice + 1)), complete.rows));
    const changedIntermediate = analyzeAlpha(
      inputFor(replaceManifestValue(text, "cohort_intermediate", String(intermediate + 1)), complete.rows)
    );
    const changedExpert = analyzeAlpha(inputFor(replaceManifestValue(text, "cohort_expert", String(expert + 1)), complete.rows));
    const changedFormA = analyzeAlpha(inputFor(replaceManifestValue(text, "form_a", String(formA + 1)), complete.rows));
    const changedFormB = analyzeAlpha(inputFor(replaceManifestValue(text, "form_b", String(formB + 1)), complete.rows));
    const missingRows = rowsFor(text);
    missingRows[0] = { ...missingRows[0], automated_score: null, missing_reason: "technical_failure" };
    const missingObservation = analyzeAlpha(inputFor(text, missingRows));
    const deviationRows = rowsFor(text);
    deviationRows[0] = { ...deviationRows[0], deviation_id: "deviation-1" };
    const recordedDeviation = analyzeAlpha(inputFor(text, deviationRows));
    const unlinkedRows = rowsFor(text);
    unlinkedRows[0] = { ...unlinkedRows[0], reference_run_id: "unlinked-reference-run" };
    const unlinkedReference = analyzeAlpha(inputFor(text, unlinkedRows));
    const oneMissingReviewer = analyzeAlpha(
      inputFor(
        text,
        rowsFor(text, {
          reviewerBAt: (index) => (index === 0 ? null : `reviewer-b-${index + 1}`),
          missingReasonAt: (index) => (index === 0 ? "review_unavailable" : null)
        })
      )
    );
    const oneReviewerProtocol = analyzeAlpha(
      inputFor(
        replaceManifestValue(text, "reviewer_count", String(reviewCount - 1)),
        rowsFor(text, {
          reviewerBAt: (index) => (index === 0 ? null : `reviewer-b-${index + 1}`),
          missingReasonAt: (index) => (index === 0 ? "review_unavailable" : null)
        })
      )
    );
    const reviewNotRequired = analyzeAlpha(
      inputFor(
        replaceManifestValue(text, "stop_blind_review_required", String(!requiresReview)),
        rowsFor(text, {
          reviewerAAt: () => null,
          reviewerBAt: () => null,
          missingReasonAt: () => "review_unavailable"
        })
      )
    );

    assert.equal(analyzeAlpha(complete).verdict, "PASS_TO_CONTINUE", PINNED);
    assert.equal(incomplete.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(incomplete.gates.row_accounting.passed, false, PINNED);
    assert.equal(changedEnrollment.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedStop.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedNovice.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedIntermediate.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedExpert.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedFormA.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(changedFormB.verdict, "PIVOT_REQUIRED", PINNED);
    assert.deepEqual(missingObservation.observations.missingness, { technical_failure: 1 }, PINNED);
    assert.deepEqual(recordedDeviation.observations.deviations, ["deviation-1"], PINNED);
    assert.equal(unlinkedReference.ok, false, PINNED);
    assert.equal(unlinkedReference.verdict, null, PINNED);
    assert.equal(oneMissingReviewer.verdict, "PIVOT_REQUIRED", PINNED);
    assert.equal(oneMissingReviewer.gates.blind_review.passed, false, PINNED);
    assert.equal(oneReviewerProtocol.verdict, "PASS_TO_CONTINUE", PINNED);
    assert.equal(reviewNotRequired.verdict, "PASS_TO_CONTINUE", PINNED);
  });

  test("feasibility-only-verdicts", async () => {
    const analyzeAlpha = await requireAnalyzeAlpha();
    const text = protocol();
    const allowed = verdicts(manifest(text));
    const pivot = "PIVOT_REQUIRED";
    assert.equal(allowed.includes(pivot), true, PINNED);
    const accepted = analyzeAlpha(inputFor(text, rowsFor(text).slice(0, -1)));
    const refused = analyzeAlpha(
      inputFor(
        replaceManifestValue(
          text,
          "allowed_verdicts",
          allowed.filter((verdict) => verdict !== pivot).join(",")
        ),
        rowsFor(text).slice(0, -1)
      )
    );

    assert.equal(accepted.ok, true, PINNED);
    assert.equal(accepted.verdict, pivot, PINNED);
    assert.equal(allowed.includes(accepted.verdict as string), true, PINNED);
    assert.equal(refused.ok, false, PINNED);
    assert.equal(refused.verdict, null, PINNED);
  });
});
