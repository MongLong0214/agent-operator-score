import assert from "node:assert/strict";
import { describe, test } from "node:test";

const MESSAGE = "wrong path or regression can pass target acceptance subset.";

type ScopeRegressionRun = {
  scenario_id: string;
  target_id: string;
  changed_paths: string[];
  target_acceptance_ids: string[];
  regression_check_ids: string[];
  rewritten_line_count: number;
};

type Grade =
  | { state: "ACCEPTED"; scenario_id: string }
  | {
    state: "REJECTED";
    scenario_id: string;
    reason: "OMISSION" | "EXTRA_PATH" | "REGRESSION" | "WRONG_TARGET" | "BROAD_REWRITE";
  }
  | { state: "REFUSED"; reason: string };

type GradeScopeRegression = (input: unknown) => Grade;

const loadGradeScopeRegression = async (): Promise<GradeScopeRegression> => {
  let loaded: { gradeScopeRegression?: unknown } = {};
  try {
    loaded = await import("../../../packages/scorer/src/graders/scope-regression.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeScopeRegression, "function", MESSAGE);
  return loaded.gradeScopeRegression as GradeScopeRegression;
};

const SCENARIO_ID = "coding-core-v0/form-a/fam5-scope-regression";
const TARGET_ID = "fam5-order-status";

const passRun = (): ScopeRegressionRun => ({
  scenario_id: SCENARIO_ID,
  target_id: TARGET_ID,
  changed_paths: [
    "workspace/src/order-status.ts",
    "workspace/test/order-status.test.ts"
  ],
  target_acceptance_ids: ["AC-FAM5-STATUS", "AC-FAM5-NO-REGRESSION"],
  regression_check_ids: ["baseline/order-status-happy-path", "baseline/order-status-error-path"],
  rewritten_line_count: 32
});

const ACCEPTED: Grade = Object.freeze({ state: "ACCEPTED", scenario_id: SCENARIO_ID });
const REFUSED: Grade = Object.freeze({ state: "REFUSED", reason: MESSAGE });

const rejected = (reason: Extract<Grade, { state: "REJECTED" }>["reason"]): Grade => ({
  state: "REJECTED",
  scenario_id: SCENARIO_ID,
  reason
});

describe("fam5-scope-regression", () => {
  test("in-scope-pass", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    assert.deepEqual(gradeScopeRegression(passRun()), ACCEPTED, MESSAGE);

    const wrongScenario = passRun();
    wrongScenario.scenario_id = "coding-core-v0/form-a/fam5-other-scenario";
    assert.deepEqual(gradeScopeRegression(wrongScenario), REFUSED, MESSAGE);
  });

  test("omission", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    assert.deepEqual(gradeScopeRegression(passRun()), ACCEPTED, MESSAGE);

    const omittedPath = passRun();
    omittedPath.changed_paths.pop();
    assert.deepEqual(gradeScopeRegression(omittedPath), rejected("OMISSION"), MESSAGE);

    const omittedAcceptance = passRun();
    omittedAcceptance.target_acceptance_ids.pop();
    assert.deepEqual(gradeScopeRegression(omittedAcceptance), rejected("OMISSION"), MESSAGE);
  });

  test("extra-path", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    const extraPath = passRun();
    extraPath.changed_paths.push("workspace/src/unrelated.ts");
    assert.deepEqual(gradeScopeRegression(extraPath), rejected("EXTRA_PATH"), MESSAGE);
  });

  test("regression", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    const regressed = passRun();
    regressed.regression_check_ids.pop();
    assert.deepEqual(gradeScopeRegression(regressed), rejected("REGRESSION"), MESSAGE);
  });

  test("wrong-target", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    const wrongTarget = passRun();
    wrongTarget.target_id = "fam5-order-status-decoy";
    assert.deepEqual(gradeScopeRegression(wrongTarget), rejected("WRONG_TARGET"), MESSAGE);
  });

  test("broad-rewrite", async () => {
    const gradeScopeRegression = await loadGradeScopeRegression();
    assert.deepEqual(gradeScopeRegression(passRun()), ACCEPTED, MESSAGE);

    const broadRewrite = passRun();
    broadRewrite.rewritten_line_count = 33;
    assert.deepEqual(gradeScopeRegression(broadRewrite), rejected("BROAD_REWRITE"), MESSAGE);
  });
});
