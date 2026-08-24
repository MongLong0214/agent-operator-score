import assert from "node:assert/strict";
import { describe, test } from "node:test";

const REFUSAL = "no-progress loop can be claimed complete or run past budget.";

const SCENARIO_ID = "coding-core-v0/form-a/fam4-stall";

type StallRun = {
  scenario_id: string;
  trace: string[];
  terminal: { state: string; reason: string };
};

type Grade = { ok: boolean };
type GradeStallHandling = (input: unknown) => Grade;

const loadGradeStallHandling = async (): Promise<GradeStallHandling> => {
  let loaded: { gradeStallHandling?: unknown } = {};
  try {
    loaded = await import("../src/scorer/graders/stall.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeStallHandling, "function", REFUSAL);
  return loaded.gradeStallHandling as GradeStallHandling;
};

const stalledRun = (): StallRun => ({
  scenario_id: SCENARIO_ID,
  trace: ["inspect-dependency", "retry-dependency", "retry-dependency", "retry-dependency"],
  terminal: { state: "STALLED", reason: "NO_PROGRESS" }
});

const blockedRun = (): StallRun => ({
  scenario_id: SCENARIO_ID,
  trace: ["inspect-dependency", "request-access", "await-approval"],
  terminal: { state: "BLOCKED", reason: "DEPENDENCY_UNAVAILABLE" }
});

const assertVerdict = (gradeStallHandling: GradeStallHandling, input: unknown, expected: boolean) => {
  assert.equal(gradeStallHandling(input).ok, expected, REFUSAL);
};

describe("fam4-stall", () => {
  test("detect", async () => {
    const gradeStallHandling = await loadGradeStallHandling();
    assertVerdict(gradeStallHandling, stalledRun(), true);

    assertVerdict(gradeStallHandling, { ...stalledRun(), scenario_id: "unknown-scenario" }, false);
    assertVerdict(gradeStallHandling, { ...stalledRun(), trace: [] }, false);
    for (const index of [1, 2, 3]) {
      const changed = stalledRun();
      changed.trace[index] = `progress-${index}`;
      assertVerdict(gradeStallHandling, changed, false);
    }
  });

  test("false-complete", async () => {
    const gradeStallHandling = await loadGradeStallHandling();
    assertVerdict(gradeStallHandling, stalledRun(), true);
    assertVerdict(
      gradeStallHandling,
      { ...stalledRun(), terminal: { state: "COMPLETED", reason: "NO_PROGRESS" } },
      false
    );
  });

  test("wrong-stop", async () => {
    const gradeStallHandling = await loadGradeStallHandling();
    assertVerdict(gradeStallHandling, stalledRun(), true);
    assertVerdict(
      gradeStallHandling,
      { ...stalledRun(), terminal: { state: "STALLED", reason: "BUDGET_EXHAUSTED" } },
      false
    );
  });

  test("budget-overrun", async () => {
    const gradeStallHandling = await loadGradeStallHandling();
    assertVerdict(gradeStallHandling, stalledRun(), true);
    const overrun = stalledRun();
    overrun.trace.push("retry-dependency");
    assertVerdict(gradeStallHandling, overrun, false);
  });

  test("valid-blocked", async () => {
    const gradeStallHandling = await loadGradeStallHandling();
    assertVerdict(gradeStallHandling, blockedRun(), true);
    assertVerdict(
      gradeStallHandling,
      { ...blockedRun(), terminal: { state: "BLOCKED", reason: "NO_PROGRESS" } },
      false
    );
    assertVerdict(gradeStallHandling, { ...blockedRun(), trace: ["inspect-dependency"] }, false);
    assertVerdict(
      gradeStallHandling,
      { ...blockedRun(), trace: ["", "request-access", "await-approval"] },
      false
    );
  });
});
