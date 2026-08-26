type AlphaRow = Readonly<Record<string, unknown>>;
type ReferenceRun = Readonly<{ reference_run_id: string; profile_id: string }>;

type Rules = Readonly<{
  rowFields: readonly string[];
  missingReasons: ReadonlySet<string>;
  enrollment: number;
  stopParticipants: number;
  cohorts: Readonly<Record<string, number>>;
  forms: Readonly<Record<string, number>>;
  reviewerCount: number;
  blindReviewRequired: boolean;
  referenceRunsMinimum: number;
  referenceRunsMaximum: number;
  durationMaximum: number;
  allowedVerdicts: ReadonlySet<string>;
}>;

type Gate = Readonly<{ passed: boolean }>;
type Analysis = Readonly<{
  ok: boolean;
  verdict: string | null;
  next_action: string | null;
  feasibility_only: true;
  gates: Readonly<{
    row_accounting: Gate;
    reference_runs: Gate;
    duration: Gate;
    blind_review: Gate;
    person_signal: Gate;
  }>;
  observations: Readonly<{
    person_signal_variance: number | null;
    task_variance: number | null;
    session_variance: number | null;
    known_groups: Readonly<Record<string, number | null>>;
    agreement: Readonly<{ pair_count: number; matching_count: number; correlation: number | null }>;
    duration: Readonly<{ median_minutes: number | null }>;
    profile_effects: Readonly<Record<string, number | null>>;
    transfer: Readonly<{ observed_count: number; not_observed_count: number; missing_count: number }>;
    missingness: Readonly<Record<string, number>>;
    deviations: readonly string[];
  }>;
}>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const OBSERVATION_FIELDS = [
  "reviewer_a",
  "reviewer_b",
  "review_adjudication",
  "duration_minutes",
  "automated_score",
  "expert_review",
  "transfer_outcome"
];

const hasExactly = (record: Record<string, unknown>, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const manifestOf = (protocol: string): ReadonlyMap<string, string> | null => {
  const section = protocol.match(/<!-- alpha-protocol-manifest:start -->([\s\S]*?)<!-- alpha-protocol-manifest:end -->/);
  if (section === null) return null;
  const entries = new Map<string, string>();
  for (const line of section[1].trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!isFilledString(key) || !isFilledString(value) || entries.has(key)) return null;
    entries.set(key, value);
  }
  return entries;
};

const rowFieldsOf = (protocol: string): readonly string[] | null => {
  const section = protocol.match(/<!-- alpha-row-fields:start -->([\s\S]*?)<!-- alpha-row-fields:end -->/);
  if (section === null) return null;
  const fields = [...section[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
  return fields.length > 0 && fields.every(isFilledString) && new Set(fields).size === fields.length ? fields : null;
};

const integer = (entries: ReadonlyMap<string, string>, key: string, minimum = 0): number | null => {
  const value = Number(entries.get(key));
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
};

const boolean = (entries: ReadonlyMap<string, string>, key: string): boolean | null => {
  const value = entries.get(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const listed = (entries: ReadonlyMap<string, string>, key: string): readonly string[] | null => {
  const value = entries.get(key);
  if (!isFilledString(value)) return null;
  const result = value.split(",").map((item) => item.trim());
  return result.length > 0 && result.every(isFilledString) && new Set(result).size === result.length ? result : null;
};

const rulesOf = (protocol: unknown): Rules | null => {
  if (!isFilledString(protocol)) return null;
  const entries = manifestOf(protocol);
  const rowFields = rowFieldsOf(protocol);
  if (entries === null || rowFields === null) return null;

  const enrollment = integer(entries, "enrollment_n", 1);
  const stopParticipants = integer(entries, "stop_participants", 1);
  const novice = integer(entries, "cohort_novice", 0);
  const intermediate = integer(entries, "cohort_intermediate", 0);
  const expert = integer(entries, "cohort_expert", 0);
  const formA = integer(entries, "form_a", 0);
  const formB = integer(entries, "form_b", 0);
  const reviewerCount = integer(entries, "reviewer_count", 0);
  const blindReviewRequired = boolean(entries, "stop_blind_review_required");
  const referenceRunsMinimum = integer(entries, "stop_reference_runs_min", 0);
  const referenceRunsMaximum = integer(entries, "stop_reference_runs_max", 0);
  const durationMaximum = integer(entries, "stop_median_duration_minutes_max", 0);
  const missingReasons = listed(entries, "missing_reasons");
  const allowedVerdicts = listed(entries, "allowed_verdicts");

  if (
    enrollment === null ||
    stopParticipants === null ||
    novice === null ||
    intermediate === null ||
    expert === null ||
    formA === null ||
    formB === null ||
    reviewerCount === null ||
    blindReviewRequired === null ||
    referenceRunsMinimum === null ||
    referenceRunsMaximum === null ||
    durationMaximum === null ||
    missingReasons === null ||
    allowedVerdicts === null ||
    referenceRunsMinimum > referenceRunsMaximum
  ) {
    return null;
  }

  return {
    rowFields,
    missingReasons: new Set(missingReasons),
    enrollment,
    stopParticipants,
    cohorts: { novice, intermediate, expert },
    forms: { A: formA, B: formB },
    reviewerCount,
    blindReviewRequired,
    referenceRunsMinimum,
    referenceRunsMaximum,
    durationMaximum,
    allowedVerdicts: new Set(allowedVerdicts)
  };
};

const rowsOf = (value: unknown, rules: Rules): readonly AlphaRow[] | null => {
  if (!Array.isArray(value)) return null;
  const rows: AlphaRow[] = [];
  const participantIds = new Set<string>();
  for (const valueRow of value) {
    if (!isPlainRecord(valueRow) || !hasExactly(valueRow, rules.rowFields)) return null;
    if (!isFilledString(valueRow.participant_id) || participantIds.has(valueRow.participant_id)) return null;
    if (!isFilledString(valueRow.cohort) || !Object.hasOwn(rules.cohorts, valueRow.cohort)) return null;
    if (!isFilledString(valueRow.form) || !Object.hasOwn(rules.forms, valueRow.form)) return null;
    if (!isFilledString(valueRow.enrollment_status)) return null;
    if (!isFilledString(valueRow.task_id) || !isFilledString(valueRow.session_id)) return null;
    if (valueRow.reference_run_id !== null && !isFilledString(valueRow.reference_run_id)) return null;
    if (valueRow.duration_minutes !== null && (!isFiniteNumber(valueRow.duration_minutes) || valueRow.duration_minutes < 0)) return null;
    if (valueRow.automated_score !== null && !isFiniteNumber(valueRow.automated_score)) return null;
    const hasMissingObservation = OBSERVATION_FIELDS.some((field) => valueRow[field] === null);
    if (hasMissingObservation) {
      if (!isFilledString(valueRow.missing_reason) || !rules.missingReasons.has(valueRow.missing_reason)) return null;
    } else if (valueRow.missing_reason !== null) {
      return null;
    }
    participantIds.add(valueRow.participant_id);
    rows.push(valueRow);
  }
  return rows;
};

const referenceRunsOf = (value: unknown): readonly ReferenceRun[] | null => {
  if (!Array.isArray(value)) return null;
  const runs: ReferenceRun[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !hasExactly(candidate, ["reference_run_id", "profile_id"])) return null;
    if (!isFilledString(candidate.reference_run_id) || !isFilledString(candidate.profile_id) || ids.has(candidate.reference_run_id)) return null;
    ids.add(candidate.reference_run_id);
    runs.push({ reference_run_id: candidate.reference_run_id, profile_id: candidate.profile_id });
  }
  return runs;
};

const variance = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;

const groupMeans = (rows: readonly AlphaRow[], keyOf: (row: AlphaRow) => string | null): Record<string, number | null> => {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || !isFiniteNumber(row.automated_score)) continue;
    const values = grouped.get(key) ?? [];
    values.push(row.automated_score);
    grouped.set(key, values);
  }
  const result: Record<string, number | null> = {};
  for (const [key, values] of grouped) result[key] = mean(values);
  return result;
};

const groupVariance = (rows: readonly AlphaRow[], keyOf: (row: AlphaRow) => string | null): number | null =>
  variance(Object.values(groupMeans(rows, keyOf)).filter((value): value is number => value !== null));

const numericScores = (rows: readonly AlphaRow[]): readonly number[] | null => {
  const scores = rows.map((row) => row.automated_score);
  return scores.every(isFiniteNumber) ? scores : null;
};

const personSignalVariance = (rows: readonly AlphaRow[]): number | null => {
  const means = groupMeans(rows, (row) => `${row.task_id}\u0000${row.session_id}`);
  const residuals: number[] = [];
  for (const row of rows) {
    const key = `${row.task_id}\u0000${row.session_id}`;
    const groupedMean = means[key];
    if (!isFiniteNumber(row.automated_score) || groupedMean === null) return null;
    residuals.push(row.automated_score - groupedMean);
  }
  return variance(residuals);
};

const expertValue = (value: unknown): number | null => {
  if (value === "fail" || value === "no") return 0;
  if (value === "partial") return 0.5;
  if (value === "pass") return 1;
  return null;
};

const correlation = (pairs: readonly (readonly [number, number])[]): number | null => {
  if (pairs.length === 0) return null;
  const automated = pairs.map(([score]) => score);
  const expert = pairs.map(([, score]) => score);
  const automatedMean = mean(automated);
  const expertMean = mean(expert);
  if (automatedMean === null || expertMean === null) return null;
  let numerator = 0;
  let automatedSquares = 0;
  let expertSquares = 0;
  for (const [automatedScore, expertScore] of pairs) {
    const automatedDelta = automatedScore - automatedMean;
    const expertDelta = expertScore - expertMean;
    numerator += automatedDelta * expertDelta;
    automatedSquares += automatedDelta ** 2;
    expertSquares += expertDelta ** 2;
  }
  if (automatedSquares === 0 || expertSquares === 0) return null;
  return numerator / Math.sqrt(automatedSquares * expertSquares);
};

const agreementOf = (rows: readonly AlphaRow[]): Readonly<{ pair_count: number; matching_count: number; correlation: number | null }> => {
  const pairs: [number, number][] = [];
  let matchingCount = 0;
  for (const row of rows) {
    const expert = expertValue(row.expert_review);
    if (!isFiniteNumber(row.automated_score) || expert === null) continue;
    pairs.push([row.automated_score, expert]);
    if (row.automated_score === expert) matchingCount += 1;
  }
  return { pair_count: pairs.length, matching_count: matchingCount, correlation: correlation(pairs) };
};

const transferOf = (rows: readonly AlphaRow[]): Readonly<{ observed_count: number; not_observed_count: number; missing_count: number }> => {
  let observedCount = 0;
  let notObservedCount = 0;
  let missingCount = 0;
  for (const row of rows) {
    if (row.transfer_outcome === "observed") observedCount += 1;
    else if (row.transfer_outcome === "not_observed") notObservedCount += 1;
    else missingCount += 1;
  }
  return { observed_count: observedCount, not_observed_count: notObservedCount, missing_count: missingCount };
};

const missingnessOf = (rows: readonly AlphaRow[]): Record<string, number> => {
  const missingness: Record<string, number> = {};
  for (const row of rows) {
    if (!isFilledString(row.missing_reason)) continue;
    missingness[row.missing_reason] = (missingness[row.missing_reason] ?? 0) + 1;
  }
  return missingness;
};

const deviationIdsOf = (rows: readonly AlphaRow[]): readonly string[] =>
  rows.flatMap((row) => (isFilledString(row.deviation_id) ? [row.deviation_id] : []));

const rowAccountingPasses = (rows: readonly AlphaRow[], rules: Rules): boolean => {
  if (rows.length !== rules.enrollment || rows.length !== rules.stopParticipants) return false;
  const cohorts = Object.fromEntries(Object.keys(rules.cohorts).map((cohort) => [cohort, 0])) as Record<string, number>;
  const forms = Object.fromEntries(Object.keys(rules.forms).map((form) => [form, 0])) as Record<string, number>;
  for (const row of rows) {
    cohorts[row.cohort as string] += 1;
    forms[row.form as string] += 1;
  }
  return (
    Object.entries(rules.cohorts).every(([cohort, count]) => cohorts[cohort] === count) &&
    Object.entries(rules.forms).every(([form, count]) => forms[form] === count)
  );
};

const blindReviewPasses = (rows: readonly AlphaRow[], rules: Rules): boolean => {
  if (!rules.blindReviewRequired) return true;
  const reviewerFields = ["reviewer_a", "reviewer_b"].slice(0, rules.reviewerCount);
  if (reviewerFields.length !== rules.reviewerCount) return false;
  return rows
    .filter((row) => row.enrollment_status !== "excluded" && row.enrollment_status !== "withdrawn")
    .every(
      (row) =>
        reviewerFields.every((field) => isFilledString(row[field])) &&
        expertValue(row.expert_review) !== null &&
        (row.review_adjudication === "not_needed" || row.review_adjudication === "third_blinded_expert")
    );
};

const actionFor = (verdict: string): string => {
  if (verdict === "PIVOT_REQUIRED") return "PIVOT_TO_DIAGNOSTICS_AND_REGRESSION_SUITE";
  if (verdict === "PASS_TO_CONTINUE") return "CONTINUE_PREREGISTERED_INVESTIGATION";
  return "HOLD_WITHOUT_PERFORMANCE_CLAIM";
};

const failure = (): Analysis => ({
  ok: false,
  verdict: null,
  next_action: null,
  feasibility_only: true,
  gates: {
    row_accounting: { passed: false },
    reference_runs: { passed: false },
    duration: { passed: false },
    blind_review: { passed: false },
    person_signal: { passed: false }
  },
  observations: {
    person_signal_variance: null,
    task_variance: null,
    session_variance: null,
    known_groups: {},
    agreement: { pair_count: 0, matching_count: 0, correlation: null },
    duration: { median_minutes: null },
    profile_effects: {},
    transfer: { observed_count: 0, not_observed_count: 0, missing_count: 0 },
    missingness: {},
    deviations: []
  }
});

/**
 * Reproduce the preregistered feasibility decision from conserved alpha rows.
 *
 * This reports feasibility observations only. It does not mint a calibrated score,
 * certification, population claim, G2 attribution result, or G3 transfer result.
 */
export const analyzeAlpha = (input: unknown): Analysis => {
  if (!isPlainRecord(input) || !hasExactly(input, ["protocol", "rows", "referenceRuns"])) return failure();
  const rules = rulesOf(input.protocol);
  if (rules === null) return failure();
  const rows = rowsOf(input.rows, rules);
  const referenceRuns = referenceRunsOf(input.referenceRuns);
  if (rows === null || referenceRuns === null) return failure();

  const referenceRunById = new Map(referenceRuns.map((run) => [run.reference_run_id, run]));
  if (rows.some((row) => !isFilledString(row.reference_run_id) || !referenceRunById.has(row.reference_run_id))) return failure();

  const rowAccounting = rowAccountingPasses(rows, rules);
  const referenceRunsPass =
    referenceRuns.length >= rules.referenceRunsMinimum && referenceRuns.length <= rules.referenceRunsMaximum;
  const durations = rows.flatMap((row) => (isFiniteNumber(row.duration_minutes) ? [row.duration_minutes] : []));
  const durationMedian = median(durations);
  const durationPass = durationMedian !== null && durationMedian <= rules.durationMaximum;
  const blindReview = blindReviewPasses(rows, rules);

  const scores = numericScores(rows);
  const personSignal = scores === null ? null : personSignalVariance(rows);
  const taskVariance = scores === null ? null : groupVariance(rows, (row) => row.task_id as string);
  const sessionVariance = scores === null ? null : groupVariance(rows, (row) => row.session_id as string);
  const personSignalPass =
    personSignal !== null && taskVariance !== null && sessionVariance !== null && personSignal > taskVariance + sessionVariance;

  const knownGroups = Object.fromEntries(
    Object.keys(rules.cohorts).map((cohort) => [
      cohort,
      mean(
        rows
          .filter((row) => row.cohort === cohort)
          .flatMap((row) => (isFiniteNumber(row.automated_score) ? [row.automated_score] : []))
      )
    ])
  ) as Record<string, number | null>;
  const profileEffects = groupMeans(rows, (row) => {
    const referenceRunId = row.reference_run_id;
    return isFilledString(referenceRunId) ? referenceRunById.get(referenceRunId)?.profile_id ?? null : null;
  });

  const gates = {
    row_accounting: { passed: rowAccounting },
    reference_runs: { passed: referenceRunsPass },
    duration: { passed: durationPass },
    blind_review: { passed: blindReview },
    person_signal: { passed: personSignalPass }
  };
  const candidate =
    !rowAccounting || !referenceRunsPass || !durationPass || !blindReview
      ? "PIVOT_REQUIRED"
      : personSignalPass
        ? "PASS_TO_CONTINUE"
        : "INCONCLUSIVE";
  if (!rules.allowedVerdicts.has(candidate)) return failure();

  return {
    ok: true,
    verdict: candidate,
    next_action: actionFor(candidate),
    feasibility_only: true,
    gates,
    observations: {
      person_signal_variance: personSignal,
      task_variance: taskVariance,
      session_variance: sessionVariance,
      known_groups: knownGroups,
      agreement: agreementOf(rows),
      duration: { median_minutes: durationMedian },
      profile_effects: profileEffects,
      transfer: transferOf(rows),
      missingness: missingnessOf(rows),
      deviations: deviationIdsOf(rows)
    }
  };
};
