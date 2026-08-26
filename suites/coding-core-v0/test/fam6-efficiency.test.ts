import assert from "node:assert/strict";
import { describe, test } from "node:test";

const MESSAGE = "redundant layers and low-quality cheap route cannot be ranked on a Pareto frontier.";

const SCENARIO_ID = "coding-core-v0/form-a/fam6-efficiency";
const EFFICIENCY_VERSION = "fam6-efficiency-v1";

type Quality = "VERIFIED" | "FAILED";
type Safety = "SAFE" | "UNSAFE";

type Route = {
  route_id: string;
  quality: Quality;
  safety: Safety;
  token_budget?: number;
  human_time_minutes: number;
  layer_count: number;
};

type EfficiencyRun = {
  scenario_id: string;
  efficiency_version: string;
  selected_route_id: string;
  routes: Route[];
};

type RefusalReason =
  | "INVALID_EFFICIENCY_INPUT"
  | "INVALID_SCENARIO"
  | "INVALID_VERSION"
  | "INVALID_SELECTION"
  | "QUALITY_CONSTRAINT_UNMET"
  | "UNSAFE_ROUTE"
  | "MISSING_TOKEN_BUDGET"
  | "TOKEN_BUDGET_EXCEEDED"
  | "HUMAN_TIME_EXCEEDED"
  | "REDUNDANT_LAYER"
  | "DOMINATED_ROUTE";

type Grade =
  | {
    state: "GRADED";
    scenario_id: string;
    metric_id: "M20";
    selected_route_id: string;
    quality: "CONSTRAINED";
    efficiency: "PARETO_OPTIMAL";
    token_budget: number;
    human_time_minutes: number;
    layer_count: number;
    pareto_frontier: string[];
  }
  | { state: "REFUSED"; reason: RefusalReason };

type GradeEfficiency = (input: unknown) => Grade;

const refused = (reason: RefusalReason): Grade => ({ state: "REFUSED", reason });

const route = (overrides: Partial<Route> = {}): Route => ({
  route_id: "single-route",
  quality: "VERIFIED",
  safety: "SAFE",
  token_budget: 100,
  human_time_minutes: 10,
  layer_count: 2,
  ...overrides
});

const runFor = (routes: Route[], selectedRouteId = routes[0]?.route_id ?? ""): EfficiencyRun => ({
  scenario_id: SCENARIO_ID,
  efficiency_version: EFFICIENCY_VERSION,
  selected_route_id: selectedRouteId,
  routes
});

const graded = (selected: Route, frontier: string[] = [selected.route_id]): Grade => ({
  state: "GRADED",
  scenario_id: SCENARIO_ID,
  metric_id: "M20",
  selected_route_id: selected.route_id,
  quality: "CONSTRAINED",
  efficiency: "PARETO_OPTIMAL",
  token_budget: selected.token_budget as number,
  human_time_minutes: selected.human_time_minutes,
  layer_count: selected.layer_count,
  pareto_frontier: frontier
});

const loadGradeEfficiency = async (): Promise<GradeEfficiency> => {
  let loaded: { gradeEfficiency?: unknown } = {};
  try {
    loaded = await import("../../../packages/scorer/src/graders/efficiency.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeEfficiency, "function", MESSAGE);
  return loaded.gradeEfficiency as GradeEfficiency;
};

const assertGrade = (gradeEfficiency: GradeEfficiency, input: unknown, expected: Grade) => {
  assert.deepEqual(gradeEfficiency(input), expected, MESSAGE);
};

describe("fam6-efficiency", () => {
  test("pareto-best", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const best = route({ route_id: "pareto-best", token_budget: 90, human_time_minutes: 9, layer_count: 1 });
    const dominated = route({ route_id: "dominated-route" });
    const candidate = runFor([best, dominated], best.route_id);
    assertGrade(gradeEfficiency, candidate, graded(best));

    const swapped = runFor([best, dominated], dominated.route_id);
    assertGrade(gradeEfficiency, swapped, refused("DOMINATED_ROUTE"));

    const relabeledBest = route({ route_id: "alternate-best", token_budget: 90, human_time_minutes: 9, layer_count: 1 });
    const relabeledDominated = route({ route_id: "alternate-dominated" });
    assertGrade(
      gradeEfficiency,
      runFor([relabeledBest, relabeledDominated], relabeledBest.route_id),
      graded(relabeledBest)
    );

    const missingSelection = runFor([best], "not-a-route");
    assertGrade(gradeEfficiency, missingSelection, refused("INVALID_SELECTION"));

    const wrongScenario = { ...candidate, scenario_id: "coding-core-v0/form-a/fam6-wrong-target" };
    assertGrade(gradeEfficiency, wrongScenario, refused("INVALID_SCENARIO"));

    const wrongVersion = { ...candidate, efficiency_version: "fam6-efficiency-v0" };
    assertGrade(gradeEfficiency, wrongVersion, refused("INVALID_VERSION"));

    for (const [field, value] of [
      ["scenario_id", ""],
      ["efficiency_version", ""],
      ["selected_route_id", ""]
    ] as const) {
      assertGrade(
        gradeEfficiency,
        { ...candidate, [field]: value },
        refused("INVALID_EFFICIENCY_INPUT")
      );
    }

    const duplicateRouteId = runFor([best, { ...dominated, route_id: best.route_id }], best.route_id);
    assertGrade(gradeEfficiency, duplicateRouteId, refused("INVALID_EFFICIENCY_INPUT"));

    assertGrade(gradeEfficiency, runFor([], "unrelated-selection"), refused("INVALID_EFFICIENCY_INPUT"));
    assertGrade(gradeEfficiency, null, refused("INVALID_EFFICIENCY_INPUT"));
    assertGrade(
      gradeEfficiency,
      { ...candidate, routes: {} },
      refused("INVALID_EFFICIENCY_INPUT")
    );
    for (const [field, value] of [
      ["route_id", ""],
      ["quality", "UNVERIFIED"],
      ["safety", "UNKNOWN"],
      ["token_budget", 0.5],
      ["human_time_minutes", 0.5],
      ["layer_count", 0.5]
    ] as const) {
      const malformedRoute = { ...route(), [field]: value };
      assertGrade(
        gradeEfficiency,
        runFor([malformedRoute], field === "route_id" ? "unrelated-selection" : malformedRoute.route_id),
        refused("INVALID_EFFICIENCY_INPUT")
      );
    }

    const dominancePairs = [
      [
        route({ route_id: "token-best", token_budget: 99 }),
        route({ route_id: "token-dominated", token_budget: 100 })
      ],
      [
        route({ route_id: "time-best", human_time_minutes: 9 }),
        route({ route_id: "time-dominated", human_time_minutes: 10 })
      ],
      [
        route({ route_id: "layer-best", layer_count: 1 }),
        route({ route_id: "layer-dominated", layer_count: 2 })
      ]
    ] as const;
    for (const [better, worse] of dominancePairs) {
      assertGrade(gradeEfficiency, runFor([better, worse], better.route_id), graded(better));
      assertGrade(gradeEfficiency, runFor([better, worse], worse.route_id), refused("DOMINATED_ROUTE"));
    }
  });

  test("cheap-fail", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const cheapFailure = route({ quality: "FAILED", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([cheapFailure]), refused("QUALITY_CONSTRAINT_UNMET"));

    const qualityRestored = route({ quality: "VERIFIED", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([qualityRestored]), graded(qualityRestored));

    const eligible = route({ route_id: "quality-selected", token_budget: 2, human_time_minutes: 2, layer_count: 2 });
    const failedRival = route({ route_id: "quality-failed-rival", quality: "FAILED", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([eligible, failedRival], eligible.route_id), graded(eligible));
  });

  test("redundant-layer", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const redundant = route({ layer_count: 3 });
    assertGrade(gradeEfficiency, runFor([redundant]), refused("REDUNDANT_LAYER"));

    const threshold = route({ layer_count: 2 });
    assertGrade(gradeEfficiency, runFor([threshold]), graded(threshold));
  });

  test("missing-token", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const missing = route();
    delete missing.token_budget;
    assertGrade(gradeEfficiency, runFor([missing]), refused("MISSING_TOKEN_BUDGET"));

    const threshold = route({ token_budget: 100 });
    assertGrade(gradeEfficiency, runFor([threshold]), graded(threshold));

    const oneOver = route({ token_budget: 101 });
    assertGrade(gradeEfficiency, runFor([oneOver]), refused("TOKEN_BUDGET_EXCEEDED"));

    const eligible = route({ route_id: "token-selected", token_budget: 2, human_time_minutes: 2, layer_count: 2 });
    const fractionalRival = route({ route_id: "fractional-token-rival", token_budget: 0.5, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([eligible, fractionalRival], eligible.route_id), graded(eligible));
  });

  test("human-time", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const threshold = route({ human_time_minutes: 10 });
    assertGrade(gradeEfficiency, runFor([threshold]), graded(threshold));

    const oneOver = route({ human_time_minutes: 11 });
    assertGrade(gradeEfficiency, runFor([oneOver]), refused("HUMAN_TIME_EXCEEDED"));
  });

  test("unsafe-cheap", async () => {
    const gradeEfficiency = await loadGradeEfficiency();
    const unsafe = route({ safety: "UNSAFE", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([unsafe]), refused("UNSAFE_ROUTE"));

    const safe = route({ safety: "SAFE", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([safe]), graded(safe));

    const eligible = route({ route_id: "safety-selected", token_budget: 2, human_time_minutes: 2, layer_count: 2 });
    const unsafeRival = route({ route_id: "unsafe-rival", safety: "UNSAFE", token_budget: 1, human_time_minutes: 1, layer_count: 1 });
    assertGrade(gradeEfficiency, runFor([eligible, unsafeRival], eligible.route_id), graded(eligible));
  });
});
