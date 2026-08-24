const REFUSAL_REASON = "wrong path or regression can pass target acceptance subset.";

const REFUSAL = Object.freeze({ state: "REFUSED" as const, reason: REFUSAL_REASON });

type RecordValue = Record<string, unknown>;
type RejectionReason = "OMISSION" | "EXTRA_PATH" | "REGRESSION" | "WRONG_TARGET" | "BROAD_REWRITE";
type ScopeRegressionRun = {
  scenarioId: string;
  targetId: string;
  changedPaths: string[];
  targetAcceptanceIds: string[];
  regressionCheckIds: string[];
  rewrittenLineCount: number;
};
type Accepted = { state: "ACCEPTED"; scenario_id: string };
type Rejected = { state: "REJECTED"; scenario_id: string; reason: RejectionReason };
type Grade = Accepted | Rejected | typeof REFUSAL;

const fam5ScopeRegressionScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Complete the virtual order-status change without broadening the target or regressing a passing behavior.",
    visible_artifacts: Object.freeze([
      "worker/FAM-5/scope-task",
      "worker/FAM-5/acceptance-subset"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "coding-core-v0/form-a/fam5-scope-regression",
    target: Object.freeze({
      target_id: "fam5-order-status",
      required_paths: Object.freeze([
        "workspace/src/order-status.ts",
        "workspace/test/order-status.test.ts"
      ]),
      target_acceptance_ids: Object.freeze([
        "AC-FAM5-STATUS",
        "AC-FAM5-NO-REGRESSION"
      ]),
      previously_passing_check_ids: Object.freeze([
        "baseline/order-status-happy-path",
        "baseline/order-status-error-path"
      ]),
      max_rewritten_lines: 32
    })
  })
});

const isPlainRecord = (value: unknown): value is RecordValue =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactly = (record: RecordValue, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const uniqueStrings = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return null;
  }
  const values = [...value];
  return new Set(values).size === values.length ? values : null;
};

const runOf = (value: unknown): ScopeRegressionRun | null => {
  if (!isPlainRecord(value) || !hasExactly(value, [
    "changed_paths",
    "regression_check_ids",
    "rewritten_line_count",
    "scenario_id",
    "target_acceptance_ids",
    "target_id"
  ])) return null;

  const changedPaths = uniqueStrings(value.changed_paths);
  const targetAcceptanceIds = uniqueStrings(value.target_acceptance_ids);
  const regressionCheckIds = uniqueStrings(value.regression_check_ids);
  if (
    typeof value.scenario_id !== "string"
    || typeof value.target_id !== "string"
    || changedPaths === null
    || targetAcceptanceIds === null
    || regressionCheckIds === null
    || !Number.isSafeInteger(value.rewritten_line_count)
    || value.rewritten_line_count < 0
  ) return null;

  return {
    scenarioId: value.scenario_id,
    targetId: value.target_id,
    changedPaths,
    targetAcceptanceIds,
    regressionCheckIds,
    rewrittenLineCount: value.rewritten_line_count
  };
};

const sameMembers = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((value) => expected.includes(value));

const rejected = (reason: RejectionReason): Rejected => ({
  state: "REJECTED",
  scenario_id: fam5ScopeRegressionScenario.oracle.scenario_id,
  reason
});

export const gradeScopeRegression = (input: unknown): Grade => {
  let cloned: unknown;
  try {
    cloned = structuredClone(input);
  } catch {
    return REFUSAL;
  }

  const run = runOf(cloned);
  if (run === null || run.scenarioId !== fam5ScopeRegressionScenario.oracle.scenario_id) return REFUSAL;

  const target = fam5ScopeRegressionScenario.oracle.target;
  if (run.targetId !== target.target_id) return rejected("WRONG_TARGET");
  if (run.changedPaths.some((path) => !target.required_paths.includes(path))) return rejected("EXTRA_PATH");
  if (
    !sameMembers(run.changedPaths, target.required_paths)
    || !sameMembers(run.targetAcceptanceIds, target.target_acceptance_ids)
  ) return rejected("OMISSION");
  if (run.rewrittenLineCount > target.max_rewritten_lines) return rejected("BROAD_REWRITE");
  if (!sameMembers(run.regressionCheckIds, target.previously_passing_check_ids)) return rejected("REGRESSION");

  return { state: "ACCEPTED", scenario_id: fam5ScopeRegressionScenario.oracle.scenario_id };
};
