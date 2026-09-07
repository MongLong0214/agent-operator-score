import { randomBytes } from "node:crypto";

import { ADMINISTRATION_CLASSIFICATION_SCHEMA_ID } from "./form-class.mjs";
import { normalizeSeed } from "./suite-seed.mjs";
import { cycleModelIdentity, issuancePolicyFor, modelIdentityLines } from "./model-identity.mjs";

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
// One digest, two spellings. A published result normalises every digest to `sha256:<hex>` (#559)
// while a cycle's own key is written as bare hex, so a run and the cycle it belongs to can hold the
// same digest in two forms. Comparing the strings made every run of a new result PROFILE_CHANGED --
// excluded from its own cohort over a prefix. The spelling is not the identity.
const sameDigest = (left, right) => {
  const bare = (value) => (typeof value === "string" ? value.replace(/^sha256:/u, "") : value);
  return bare(left) === bare(right);
};

export const EXPOSURE_VERIFICATION_STATUSES = Object.freeze(["VERIFIED", "REFUSED", "UNVERIFIED"]);

/**
 * What the exposure ledger actually said about this administration, and what it means for a run
 * that otherwise counts.
 *
 * Three answers, the same shape `capabilityProbeGeneration` uses for a probe record's generation:
 * `VERIFIED` is a run the ledger classified and permitted, `REFUSED` is one it classified and
 * refused, `UNVERIFIED` is one it never saw at all -- a run recorded before the exposure ledger
 * existed, which is not the same fact as a permitted one even though `runValidity` used to fold
 * both into the identical `{valid: true, reason: null}` (#632's collapse, a sixth time). The
 * decision is a `lib/decision.mjs` tri-state: true only when the ledger itself said so, false when
 * it refused, null when it was never asked -- domain words stand beside it and are not a second
 * decision vocabulary.
 */
export function exposureVerification(run) {
  const classification = run.form_classification ?? null;
  if (classification === null) return Object.freeze({ decision: null, status: "UNVERIFIED" });
  // `classification` is a field on the stored run record -- `cycle.json`, a plain file -- and an
  // untagged object carrying only `official_scoring_permitted: true` used to authorize VERIFIED on
  // its own say-so, no different from any other stored artifact that approves itself (this
  // repository's recurring defect #3). Absence (`classification === null`) and a record that is
  // not the tagged shape `classifyAdministration` actually produces are not the same fact, but
  // they are the same answer here: neither one is evidence the ledger classified this
  // administration, so neither may authorize more than UNVERIFIED. A malformed record is not
  // "historical" -- historical is genuine absence -- it is unverified for the same reason absence
  // is.
  if (classification.schema_id !== ADMINISTRATION_CLASSIFICATION_SCHEMA_ID || typeof classification.official_scoring_permitted !== "boolean") {
    return Object.freeze({ decision: null, status: "UNVERIFIED" });
  }
  if (classification.official_scoring_permitted === true) return Object.freeze({ decision: true, status: "VERIFIED" });
  return Object.freeze({ decision: false, status: "REFUSED" });
}

export function runValidity(cycle, run) {
  // #585. Computed first and carried on every return below, including the two that used to return
  // before it existed: `recordRun` reads `validity.exposure.status` unconditionally, and a run
  // whose profile changed (or whose seed was never this cycle's) used to come back with no
  // `exposure` key at all -- a TypeError on the very first thing every recorded run does, which
  // took the seed out of the cycle silently and left it re-runnable. Every branch of this function
  // is a run's whole validity verdict, and an exposure state is part of that verdict whichever way
  // it comes out, not a detail only the branches added after it happened to carry.
  const classification = run.form_classification ?? null;
  const exposure = exposureVerification(run);
  if (!cycle.seeds.includes(run.seed)) return { valid: false, reason: "SEED_NOT_IN_CYCLE", exposure };
  if (!sameDigest(run.profile_digest, cycle.profile_digest)) return { valid: false, reason: "PROFILE_CHANGED", exposure };
  // What the exposure ledger said this administration was. A locked seed prevents a rerun inside
  // one cycle; nothing here saw across cycles, so the same operational form could be abandoned and
  // reopened until the scenario suited its operator -- scored twice with a straight face. The
  // classification arrives from `lib/form-class.mjs` on the run record; an administration it did
  // not permit official scoring for is recorded and excluded, with the ledger's own reason. A run
  // with no classification predates the ledger and keeps its historical validity: the ledger
  // cannot testify about administrations it never saw, and an absence is not a refusal.
  if (classification !== null && classification.official_scoring_permitted !== true) {
    return { valid: false, reason: classification.refusal_code ?? "AOS_FORM_NOT_OFFICIAL", exposure };
  }
  if (run.suite_major !== cycle.suite_major) return { valid: false, reason: "SUITE_MAJOR_CHANGED", exposure };
  if (run.scorer_major !== cycle.scorer_major) return { valid: false, reason: "SCORER_MAJOR_CHANGED", exposure };
  if (INFRASTRUCTURE_FAILURES.includes(run.failure ?? "")) return { valid: false, reason: run.failure, exposure };
  if (run.terminal_committed !== true) return { valid: false, reason: "NO_TERMINAL", exposure };
  if (run.issued !== true) return { valid: false, reason: "NOT_ISSUED", exposure };
  return { valid: true, reason: null, exposure };
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
  return {
    ...cycle,
    runs: [...cycle.runs, {
      ...run,
      valid: validity.valid,
      invalid_reason: validity.reason,
      // #585. Named on the stored run, not only computable from it, so a reader of cycle.json sees
      // the third state without recomputing `exposureVerification` themselves.
      exposure_verification: validity.exposure.status
    }]
  };
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

  // #585. Falls back to computing it live: `recordRun` stamps `exposure_verification` on every run
  // it writes now, but a cycle recorded before that field existed still has runs, and this stays a
  // pure function of the stored cycle the same way `summariseCycle` does.
  const exposureStatusOf = (run) => run.exposure_verification ?? exposureVerification(run).status;

  return {
    cycle_id: cycle.cycle_id,
    profile_digest: cycle.profile_digest,
    seeds: [...cycle.seeds],
    valid_runs: valid.length,
    // Every run that was not counted, with its reason. A cycle that quietly dropped one would be
    // indistinguishable from a cycle that never ran it.
    excluded: cycle.runs.filter((run) => !run.valid).map((run) => ({ seed: run.seed, reason: run.invalid_reason })),
    // A run that counts and a run the exposure ledger actually verified are not the same claim --
    // this one predates the ledger, or was recorded before this ledger's home did. Named here so a
    // reader is never left inferring it from a count that reads identically either way (#632).
    valid_runs_exposure_unverified: valid.filter((run) => exposureStatusOf(run) === "UNVERIFIED").map((run) => run.seed),
    operator_score: valid.length >= 3 ? centre : null,
    dimensions: perDimension,
    spread: scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : null,
    mad,
    stability: stabilityOf(mad),
    local_repeat_evidence: repeatEvidence(valid.length, mad),
    complete: valid.length >= 3
  };
}

/**
 * The cycle's decision: its aggregate, its identity record, and what it is entitled to claim.
 *
 * Computed once and stored beside the runs, because it was computed twice -- the `cycle` command
 * and the dashboard each rebuilt the aggregate and the model policy from the raw cycle, so the
 * page and the command were two opinions that happened to agree. Both quote this now, the way the
 * run renderers quote a result's stored lines. It stays a pure function of the stored cycle so
 * that a cycle written before it existed can still be decided at read time -- by this same
 * function, which is the point.
 */
export function summariseCycle(cycle, { dimensions } = {}) {
  const aggregate = aggregateCycle(cycle, dimensions === undefined ? {} : { dimensions });
  const identity = cycleModelIdentity({ binding: cycle.model_identity ?? null, runs: cycle.runs ?? [] });
  const policy = identity ?? issuancePolicyFor({ provenance: null });
  const issued = aggregate.complete && policy.profile_bound_aggregation.status === "issued";
  return {
    ...aggregate,
    operator_score: issued ? aggregate.operator_score : null,
    dimensions: issued ? aggregate.dimensions : null,
    spread: issued ? aggregate.spread : null,
    mad: issued ? aggregate.mad : null,
    stability: issued ? aggregate.stability : null,
    local_repeat_evidence: issued ? aggregate.local_repeat_evidence : "WITHHELD",
    issued,
    // A cycle with no binding at all is historical: it keeps its runs and loses nothing, and it is
    // never promoted to a profile it never named.
    provisional: identity === null,
    model_identity: identity,
    claim_stage: policy.claim_stage,
    profile_bound_aggregation: policy.profile_bound_aggregation,
    composite: policy.composite,
    generalizability_status: policy.generalizability_status,
    cross_model_comparison: policy.cross_model_comparison,
    model_change_improvement_claim: policy.model_change_improvement_claim
  };
}

/** The lines every surface shows for a cycle: the stored decision's, or the record's own. */
export const cycleLines = (decision) =>
  (Array.isArray(decision?.model_identity?.lines) ? decision.model_identity.lines : modelIdentityLines(decision?.model_identity ?? null));
