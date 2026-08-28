import { randomBytes } from "node:crypto";

import { normalizeSeed } from "./suite-seed.mjs";

// Why a cycle is locked before it starts.
//
// Run the suite twenty times, keep the best three, take the median: the number is now a measure of
// how many attempts somebody could afford. Nothing about the arithmetic prevents that, so the
// prevention has to be structural -- the seeds are fixed when the cycle is created, every valid run
// against them is included, and a run cannot be discarded because of what it scored.
//
// The one thing that may be rerun on the same seed is a run that never measured anything: AOS
// crashed, the provider was unreachable before the task began, the machine interrupted it, or the
// local run is corrupt. Those are failures of the instrument, and counting them would measure the
// instrument. A low score is not one of them, and this file says so in the only place it can be
// enforced.

export const CYCLE_SCHEMA = "aos-cycle.v1";
export const DEFAULT_RUNS = 3;

/** The only reasons a run may be repeated on the same seed. */
export const INFRASTRUCTURE_FAILURES = [
  "AOS_INTERNAL_ERROR",
  "PROVIDER_UNAVAILABLE_BEFORE_START",
  "OS_INTERRUPTED",
  "LOCAL_RUN_CORRUPTED"
];

export function createCycle({
  profileDigest,
  suiteMajor,
  scorerMajor,
  runs = DEFAULT_RUNS,
  cycleId = null,
  seeds = null,
  randomSource = () => randomBytes(8).toString("hex")
} = {}) {
  if (typeof profileDigest !== "string" || profileDigest.length === 0) throw new Error("AOS_CYCLE_NO_PROFILE");
  if (!Number.isInteger(runs) || runs < 3) throw new Error("AOS_CYCLE_TOO_SHORT");

  // Fixed here and never again. A cycle that could draw a fresh seed later is a cycle whose owner
  // can retry until the scenario suits them.
  // #485: one error covered three different problems and named none of them -- including the case
  // where every seed was valid and there were simply too few. An operator reaching for a seed
  // reaches for a sha256, because that is what the rest of this tool prints.
  const given = seeds ?? Array.from({ length: runs }, randomSource);
  if (given.length !== runs) {
    throw new Error(`AOS_CYCLE_SEED_COUNT ${given.length} seed(s) given for --runs ${runs}; pass one per run or none at all`);
  }
  const malformed = given.filter((seed) => normalizeSeed(seed) === null);
  if (malformed.length > 0) {
    throw new Error(`AOS_CYCLE_SEED_SHAPE ${malformed.join(", ")}; a seed is 1 to 16 hex characters, not a sha256`);
  }
  const chosen = given.map((seed) => normalizeSeed(seed));
  const repeated = chosen.filter((seed, index) => chosen.indexOf(seed) !== index);
  if (repeated.length > 0) {
    throw new Error(`AOS_CYCLE_DUPLICATE_SEEDS ${[...new Set(repeated)].join(", ")}; three runs on one seed is one run repeated`);
  }

  return {
    schema_id: CYCLE_SCHEMA,
    cycle_id: cycleId ?? `cycle-${randomBytes(8).toString("hex")}`,
    profile_digest: profileDigest,
    suite_major: suiteMajor,
    scorer_major: scorerMajor,
    seeds: chosen,
    runs: []
  };
}

/**
 * Whether a run counts, and why not when it does not.
 *
 * A run against a seed this cycle never fixed is not a run in this cycle at all -- that is the
 * shape a swapped scenario takes.
 */
export function runValidity(cycle, run) {
  if (!cycle.seeds.includes(run.seed)) return { valid: false, reason: "SEED_NOT_IN_CYCLE" };
  if (run.profile_digest !== cycle.profile_digest) return { valid: false, reason: "PROFILE_CHANGED" };
  if (run.suite_major !== cycle.suite_major) return { valid: false, reason: "SUITE_MAJOR_CHANGED" };
  if (run.scorer_major !== cycle.scorer_major) return { valid: false, reason: "SCORER_MAJOR_CHANGED" };
  if (INFRASTRUCTURE_FAILURES.includes(run.failure ?? "")) return { valid: false, reason: run.failure };
  if (run.terminal_committed !== true) return { valid: false, reason: "NO_TERMINAL" };
  if (run.issued !== true) return { valid: false, reason: "NOT_ISSUED" };
  return { valid: true, reason: null };
}

/** Whether a seed may be run again. Only after a failure of the instrument. */
export const mayRerun = (cycle, seed) => {
  const attempts = cycle.runs.filter((run) => run.seed === seed);
  if (attempts.length === 0) return true;
  // Every attempt so far failed for a reason that measured nothing. A single valid attempt closes
  // the seed, whatever it scored.
  return attempts.every((run) => INFRASTRUCTURE_FAILURES.includes(run.failure ?? ""));
};

/**
 * Records a run against the cycle.
 *
 * Refuses a second attempt at a seed that already produced a result. That refusal is the whole
 * mechanism: without it, "keep the best three" is one loop away.
 */
export function recordRun(cycle, run) {
  if (!cycle.seeds.includes(run.seed)) throw new Error(`AOS_CYCLE_UNKNOWN_SEED ${run.seed}`);
  if (!mayRerun(cycle, run.seed)) throw new Error(`AOS_CYCLE_SEED_ALREADY_RUN ${run.seed}`);
  const validity = runValidity(cycle, run);
  return { ...cycle, runs: [...cycle.runs, { ...run, valid: validity.valid, invalid_reason: validity.reason }] };
}

export const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Median absolute deviation: how far a typical run sits from the typical run. */
export const medianAbsoluteDeviation = (values) => {
  const centre = median(values);
  if (centre === null) return null;
  return median(values.map((value) => Math.abs(value - centre)));
};

export const stabilityOf = (mad) => {
  if (mad === null) return "UNKNOWN";
  if (mad <= 5) return "STABLE";
  if (mad <= 10) return "VARIABLE";
  return "UNSTABLE";
};

/**
 * How much repetition is behind the number.
 *
 * Called local repeat evidence and not confidence: this is one operator on one machine repeating a
 * local suite, and the word confidence would import a statistical claim nothing here supports.
 */
export function repeatEvidence(validRuns, mad) {
  if (validRuns >= 7 && mad !== null && mad <= 5) return "HIGH";
  if (validRuns >= 5 && mad !== null && mad <= 10) return "MEDIUM";
  if (validRuns >= 3) return "LOW";
  return "NONE";
}

/**
 * The operator score.
 *
 * Median of every valid run, not of the best ones. `excluded` names what was left out and why, so
 * the reader can see whether a run was dropped because the instrument failed -- the only reason
 * allowed -- or for some other reason that would need explaining.
 */
export function aggregateCycle(cycle, { dimensions = ["D1", "D2", "D3", "D4", "D5", "D6"] } = {}) {
  const valid = cycle.runs.filter((run) => run.valid);
  const scores = valid.map((run) => run.final_score);
  const centre = median(scores);
  const mad = medianAbsoluteDeviation(scores);

  const perDimension = {};
  for (const dimension of dimensions) {
    const values = valid
      .map((run) => run.dimensions?.[dimension])
      .filter((value) => typeof value === "number");
    perDimension[dimension] = median(values);
  }

  return {
    cycle_id: cycle.cycle_id,
    profile_digest: cycle.profile_digest,
    seeds: [...cycle.seeds],
    valid_runs: valid.length,
    // Every run that was not counted, with its reason. A cycle that quietly dropped one would be
    // indistinguishable from a cycle that never ran it.
    excluded: cycle.runs.filter((run) => !run.valid).map((run) => ({ seed: run.seed, reason: run.invalid_reason })),
    operator_score: valid.length >= 3 ? centre : null,
    dimensions: perDimension,
    spread: scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : null,
    mad,
    stability: stabilityOf(mad),
    local_repeat_evidence: repeatEvidence(valid.length, mad),
    complete: valid.length >= 3
  };
}
