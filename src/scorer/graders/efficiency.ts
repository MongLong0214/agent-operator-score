const REFUSED = Object.freeze({ state: "REFUSED" as const, reason: "INVALID_EFFICIENCY_INPUT" as const });

type RecordValue = Record<string, unknown>;
type Quality = "VERIFIED" | "FAILED";
type Safety = "SAFE" | "UNSAFE";
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

type Route = {
  routeId: string;
  quality: Quality;
  safety: Safety;
  tokenBudget: unknown;
  humanTimeMinutes: number;
  layerCount: number;
};

type EfficiencyRun = {
  scenarioId: string;
  efficiencyVersion: string;
  selectedRouteId: string;
  routes: Route[];
};

type Graded = {
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
};

type Grade = Graded | { state: "REFUSED"; reason: RefusalReason };

/**
 * The scoring limits and route semantics are sealed in the grader. Workers
 * receive only the task prompt and visible artifacts, never this oracle.
 */
export const fam6EfficiencyScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Choose the safe, quality-satisfying route that uses no unnecessary execution resources.",
    visible_artifacts: Object.freeze([
      "worker/FAM-6/route-candidates",
      "worker/FAM-6/route-observations"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "coding-core-v0/form-a/fam6-efficiency",
    efficiency_version: "fam6-efficiency-v1",
    metric_id: "M20" as const,
    maximum_token_budget: 100,
    maximum_human_time_minutes: 10,
    maximum_layer_count: 2
  })
});

const isPlainRecord = (value: unknown): value is RecordValue =>
  value !== null
  && typeof value === "object"
  && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isQuality = (value: unknown): value is Quality => value === "VERIFIED" || value === "FAILED";

const isSafety = (value: unknown): value is Safety => value === "SAFE" || value === "UNSAFE";

const routeOf = (value: unknown): Route | null => {
  if (
    !isPlainRecord(value)
    || !isFilledString(value.route_id)
    || !isQuality(value.quality)
    || !isSafety(value.safety)
    || !isNonNegativeInteger(value.human_time_minutes)
    || !isNonNegativeInteger(value.layer_count)
  ) {
    return null;
  }

  return {
    routeId: value.route_id,
    quality: value.quality,
    safety: value.safety,
    tokenBudget: value.token_budget,
    humanTimeMinutes: value.human_time_minutes,
    layerCount: value.layer_count
  };
};

const runOf = (value: unknown): EfficiencyRun | null => {
  if (
    !isPlainRecord(value)
    || !isFilledString(value.scenario_id)
    || !isFilledString(value.efficiency_version)
    || !isFilledString(value.selected_route_id)
    || !Array.isArray(value.routes)
    || value.routes.length === 0
  ) {
    return null;
  }

  const routes = value.routes.map(routeOf);
  if (routes.some((route) => route === null)) return null;

  const parsedRoutes = routes as Route[];
  if (new Set(parsedRoutes.map((route) => route.routeId)).size !== parsedRoutes.length) return null;

  return {
    scenarioId: value.scenario_id,
    efficiencyVersion: value.efficiency_version,
    selectedRouteId: value.selected_route_id,
    routes: parsedRoutes
  };
};

const refuse = (reason: RefusalReason): Grade => ({ state: "REFUSED", reason });

const hasValidTokenBudget = (route: Route): route is Route & { tokenBudget: number } =>
  isNonNegativeInteger(route.tokenBudget);

const satisfiesConstraints = (route: Route): route is Route & { tokenBudget: number } =>
  route.quality === "VERIFIED"
  && route.safety === "SAFE"
  && hasValidTokenBudget(route)
  && route.tokenBudget <= fam6EfficiencyScenario.oracle.maximum_token_budget
  && route.humanTimeMinutes <= fam6EfficiencyScenario.oracle.maximum_human_time_minutes
  && route.layerCount <= fam6EfficiencyScenario.oracle.maximum_layer_count;

const dominates = (
  left: Route & { tokenBudget: number },
  right: Route & { tokenBudget: number }
): boolean =>
  left.tokenBudget <= right.tokenBudget
  && left.humanTimeMinutes <= right.humanTimeMinutes
  && left.layerCount <= right.layerCount
  && (
    left.tokenBudget < right.tokenBudget
    || left.humanTimeMinutes < right.humanTimeMinutes
    || left.layerCount < right.layerCount
  );

const gradeFor = (
  selected: Route & { tokenBudget: number },
  frontier: readonly (Route & { tokenBudget: number })[]
): Graded => ({
  state: "GRADED",
  scenario_id: fam6EfficiencyScenario.oracle.scenario_id,
  metric_id: fam6EfficiencyScenario.oracle.metric_id,
  selected_route_id: selected.routeId,
  quality: "CONSTRAINED",
  efficiency: "PARETO_OPTIMAL",
  token_budget: selected.tokenBudget,
  human_time_minutes: selected.humanTimeMinutes,
  layer_count: selected.layerCount,
  pareto_frontier: frontier.map((route) => route.routeId)
});

/**
 * Grade route selection as a constrained Pareto ranking. Quality and safety
 * are eligibility constraints; only eligible routes participate in the cost
 * frontier, whose token, human-time, and layer dimensions remain independent.
 */
export const gradeEfficiency = (input: unknown): Grade => {
  let cloned: unknown;
  try {
    cloned = structuredClone(input);
  } catch {
    return REFUSED;
  }

  const run = runOf(cloned);
  if (run === null) return REFUSED;
  if (run.scenarioId !== fam6EfficiencyScenario.oracle.scenario_id) return refuse("INVALID_SCENARIO");
  if (run.efficiencyVersion !== fam6EfficiencyScenario.oracle.efficiency_version) return refuse("INVALID_VERSION");

  const selected = run.routes.find((route) => route.routeId === run.selectedRouteId);
  if (selected === undefined) return refuse("INVALID_SELECTION");
  if (selected.quality !== "VERIFIED") return refuse("QUALITY_CONSTRAINT_UNMET");
  if (selected.safety !== "SAFE") return refuse("UNSAFE_ROUTE");
  if (selected.tokenBudget === undefined) return refuse("MISSING_TOKEN_BUDGET");
  if (!hasValidTokenBudget(selected)) return REFUSED;
  if (selected.tokenBudget > fam6EfficiencyScenario.oracle.maximum_token_budget) {
    return refuse("TOKEN_BUDGET_EXCEEDED");
  }
  if (selected.humanTimeMinutes > fam6EfficiencyScenario.oracle.maximum_human_time_minutes) {
    return refuse("HUMAN_TIME_EXCEEDED");
  }
  if (selected.layerCount > fam6EfficiencyScenario.oracle.maximum_layer_count) return refuse("REDUNDANT_LAYER");

  const eligibleRoutes = run.routes.filter(satisfiesConstraints);
  const frontier = eligibleRoutes.filter(
    (candidate) => !eligibleRoutes.some((other) => other !== candidate && dominates(other, candidate))
  );
  if (!frontier.includes(selected)) return refuse("DOMINATED_ROUTE");

  return gradeFor(selected, frontier);
};
