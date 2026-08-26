const REFUSAL = Object.freeze({
  ok: false as const,
  reason: "no-progress loop can be claimed complete or run past budget."
});

type RecordValue = Record<string, unknown>;

type Terminal = { state: string; reason: string };
type StallRun = { scenarioId: unknown; trace: string[]; terminal: unknown };
type Passed = {
  ok: true;
  scenario_id: string;
  metric_id: "M14";
  terminal_state: "STALLED" | "BLOCKED";
};
type Grade = Passed | typeof REFUSAL;

type Fam4StallScenario = Readonly<{
  worker: Readonly<{
    prompt: string;
    visible_artifacts: readonly string[];
  }>;
  oracle: Readonly<{
    scenario_id: string;
    budget: Readonly<{ max_steps: number }>;
    no_progress: Readonly<{
      repeated_activities: number;
      terminal: Readonly<Terminal>;
    }>;
    valid_blocked: Readonly<{ terminal: Readonly<Terminal> }>;
  }>;
}>;

export const fam4StallScenario: Fam4StallScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Stop a no-progress dependency retry without claiming completion or exceeding the run budget.",
    visible_artifacts: Object.freeze([
      "worker/FAM-4/dependency-status",
      "worker/FAM-4/retry-trace"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "coding-core-v0/form-a/fam4-stall",
    budget: Object.freeze({ max_steps: 4 }),
    no_progress: Object.freeze({
      repeated_activities: 3,
      terminal: Object.freeze({ state: "STALLED", reason: "NO_PROGRESS" })
    }),
    valid_blocked: Object.freeze({
      terminal: Object.freeze({ state: "BLOCKED", reason: "DEPENDENCY_UNAVAILABLE" })
    })
  })
});

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const traceOf = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.some((entry) => !isFilledString(entry))) return null;
  return [...value];
};

const runOf = (value: unknown): StallRun | null => {
  if (!isRecord(value)) return null;
  const trace = traceOf(value.trace);
  return trace === null
    ? null
    : { scenarioId: value.scenario_id, trace, terminal: value.terminal };
};

const sameTerminal = (left: unknown, right: Terminal): boolean =>
  isRecord(left) && left.state === right.state && left.reason === right.reason;

const hasNoProgressLoop = (trace: readonly string[]): boolean => {
  const { repeated_activities } = fam4StallScenario.oracle.no_progress;
  if (trace.length < repeated_activities) return false;
  const repeated = trace.slice(-repeated_activities);
  return repeated.every((activity) => activity === repeated[0]);
};

const hasProgress = (trace: readonly string[]): boolean =>
  trace.some((activity, index) => index > 0 && activity !== trace[index - 1]);

export const gradeStallHandling = (input: unknown): Grade => {
  try {
    const run = runOf(structuredClone(input));
    if (run === null || run.scenarioId !== fam4StallScenario.oracle.scenario_id) return REFUSAL;
    if (run.trace.length > fam4StallScenario.oracle.budget.max_steps) return REFUSAL;

    if (hasNoProgressLoop(run.trace)) {
      return sameTerminal(run.terminal, fam4StallScenario.oracle.no_progress.terminal)
        ? {
          ok: true,
          scenario_id: fam4StallScenario.oracle.scenario_id,
          metric_id: "M14",
          terminal_state: "STALLED"
        }
        : REFUSAL;
    }

    if (
      hasProgress(run.trace)
      && sameTerminal(run.terminal, fam4StallScenario.oracle.valid_blocked.terminal)
    ) {
      return {
        ok: true,
        scenario_id: fam4StallScenario.oracle.scenario_id,
        metric_id: "M14",
        terminal_state: "BLOCKED"
      };
    }

    return REFUSAL;
  } catch {
    return REFUSAL;
  }
};
