import { randomBytes } from "node:crypto";

import { RESULT_SCHEMA_ID as PROFILE_RESULT_SCHEMA_ID } from "./result-schema.mjs";
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
 * `VERIFIED` is a run the ledger itself classified and permitted, `REFUSED` is one the ledger
 * classified and did not permit (or one whose stored record contradicts the ledger's own entry for
 * it), `UNVERIFIED` is one the ledger has no committed entry for at all -- a run recorded before the
 * exposure ledger existed, one recorded against a different home, or one this function was asked
 * about with no ledger available to check. None of those is the same fact as a permitted one, even
 * though `runValidity` used to fold every one of them into the identical `{valid: true, reason:
 * null}` (#632's collapse, a sixth time). The decision is a `lib/decision.mjs` tri-state: true only
 * when the ledger itself said so, false when it refused or disagreed, null when it was never asked
 * -- domain words stand beside it and are not a second decision vocabulary.
 *
 * #585 item 1 (this round). Three review rounds fixed this by adding one more field comparison to
 * `run.form_classification` -- a field on the stored run record, `cycle.json`, a plain file an
 * operator can edit by hand -- and each next round defeated the new comparison by filling in one
 * more field. Every one of those checks compared fields inside `cycle.json` against other fields
 * inside that same file: a wholly hand-written `cycle.json`, internally consistent down to the
 * schema tag and the run/administration/form ids, satisfied all of them, because nothing about that
 * scheme ever read evidence the operator did not also control. This function no longer authorizes
 * VERIFIED from the stored record at all. It looks the administration up in the exposure ledger --
 * `ledger`, the value `openExposureLedger` (lib/form-class.mjs) returns, and answers from what the
 * ledger's own committed entry for this exact administration says.
 *
 * What that buys, stated exactly, because the previous wording here claimed more than it bought and
 * a reviewer measured the gap: `openExposureLedger` recomputes the transition-digest chain, so an
 * entry deleted, reordered, inserted or edited in place WITHOUT recomputing the chain is refused.
 * That is tamper-evidence, not authentication. The chain is un-keyed and the ledger is a plain file
 * in the operator's own home, so a ledger written from scratch through these same builders --
 * coherent chain, coherent head, no administration behind it -- is indistinguishable from a real one
 * and does reach VERIFIED. Measured, not assumed.
 *
 * So this move is narrower than "the ledger cannot be forged": it is that the verdict is no longer
 * read out of the same record it is about. Forging now costs a coherent ledger rather than four
 * fields in cycle.json, and the shapes an operator actually produces by accident -- a copied
 * classification, a hand-edited cycle, a replayed record -- stop passing. Authenticating the ledger
 * itself needs a keyed digest or an attested writer, which is a trust root this issue does not have
 * and must not invent. `form_classification`
 * survives only as a cached convenience that must agree with the ledger; a caller-supplied verdict
 * that disagrees with the ledger's own is never resolved in the stored record's favour.
 */
const nonEmptyString = (value) => typeof value === "string" && value.length > 0;

export function exposureVerification(run, { ledger = null } = {}) {
  // No ledger to check against is not evidence of anything about this administration -- neither a
  // caller with no AOS home available nor a caller that never asked may promote a run past
  // UNVERIFIED on the strength of what the run's own record claims about itself.
  if (ledger === null || typeof ledger !== "object" || !Array.isArray(ledger.entries)) {
    return Object.freeze({ decision: null, status: "UNVERIFIED" });
  }
  if (!nonEmptyString(run.run_id)) return Object.freeze({ decision: null, status: "UNVERIFIED" });
  // The ledger's own committed row for this exact administration -- `reserveExposure` and
  // `recordExposure` (lib/form-class.mjs) both key every entry they write or finalize by
  // `administration_id`, and `assess` always names that id with the run's own id. No row here is
  // not "the record must be believed instead"; it is the one case this fix exists to close: a
  // `cycle.json` with no ledger entry backing it at all.
  const entry = ledger.entries.find((row) => row.administration_id === run.run_id);
  if (entry === undefined) return Object.freeze({ decision: null, status: "UNVERIFIED" });
  // A row that exists but names a different form contract than this run's own record is not
  // evidence for this run's exposure claim -- it is a contradiction, refused rather than read as
  // silence.
  if (!nonEmptyString(run.form_contract_digest) || entry.form_contract_digest !== run.form_contract_digest) {
    return Object.freeze({ decision: false, status: "REFUSED" });
  }
  // A v2 entry still mid-transition (RESERVED or REVEALED, never finalized to TERMINAL) has not
  // finished being administered -- the ledger cannot yet say what it was, whatever the run record
  // claims about it. Only a v2 entry ever carries `state` at all; a v1 entry is by construction a
  // completed historical administration (#585 round 2) and has nothing left to transition through.
  if (typeof entry.state === "string" && entry.state !== "TERMINAL") {
    return Object.freeze({ decision: null, status: "UNVERIFIED" });
  }
  // The ledger's own verdict: `recordExposure` only ever stamps `administered_class: "OPERATIONAL"`
  // on an entry `classifyAdministration` permitted for official scoring while the run was inside a
  // cycle -- see lib/cli.mjs's `assess`. Nothing a caller writes into `run.form_classification` can
  // change what this entry says, because this reads the ledger's row, never the run's own claim
  // about it.
  const ledgerPermitted = entry.administered_class === "OPERATIONAL";
  // The stored classification, when the run carries one, is a cached convenience now -- never a
  // second authority. It must agree with the ledger's own verdict; a stored record that disagrees
  // is refused rather than trusted, whatever shape it has.
  const classification = run.form_classification ?? null;
  if (classification !== null && typeof classification === "object" &&
      typeof classification.official_scoring_permitted === "boolean" &&
      classification.official_scoring_permitted !== ledgerPermitted) {
    return Object.freeze({ decision: false, status: "REFUSED" });
  }
  return ledgerPermitted
    ? Object.freeze({ decision: true, status: "VERIFIED" })
    : Object.freeze({ decision: false, status: "REFUSED" });
}

export function runValidity(cycle, run, { ledger = null } = {}) {
  // #585. Computed first and carried on every return below, including the two that used to return
  // before it existed: `recordRun` reads `validity.exposure.status` unconditionally, and a run
  // whose profile changed (or whose seed was never this cycle's) used to come back with no
  // `exposure` key at all -- a TypeError on the very first thing every recorded run does, which
  // took the seed out of the cycle silently and left it re-runnable. Every branch of this function
  // is a run's whole validity verdict, and an exposure state is part of that verdict whichever way
  // it comes out, not a detail only the branches added after it happened to carry.
  //
  // #585 item 1 (this round). `ledger` is threaded straight through to `exposureVerification`
  // rather than opened here: a caller with a real AOS home opens it once with `openExposureLedger`
  // (lib/form-class.mjs), which is where tampering is actually caught, and hands the same opened
  // ledger to every run it validates in one cycle rather than this function re-reading and
  // re-verifying the chain per run. A caller with no home available passes nothing, and
  // `exposureVerification` treats that exactly like a home whose ledger has no entry for this run:
  // UNVERIFIED, never a promotion earned by the stored record alone.
  const classification = run.form_classification ?? null;
  const exposure = exposureVerification(run, { ledger });
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
  // Governance directive 21. `valid_runs_exposure_unverified` named these runs and counted them
  // anyway, so a PROFILE_BOUND number could rest on administrations nothing verified were
  // administered once -- naming a gap is not closing it. The compatibility above is for records
  // written before the ledger existed, and those are legacy results: the ledger cannot testify
  // about administrations it never saw, and an absence is not a refusal. A v0.2 result is a
  // different claim. It was written by a build that has the ledger, so an exposure the ledger
  // cannot verify is a hole in this run's own evidence rather than a record from before the
  // evidence existed, and it does not enter the official aggregate.
  if (run.result_schema === PROFILE_RESULT_SCHEMA_ID && exposure.status !== "VERIFIED") {
    return { valid: false, reason: "AOS_EXPOSURE_UNVERIFIED_FOR_PROFILE_BOUND", exposure };
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
export function recordRun(cycle, run, { ledger = null } = {}) {
  if (!cycle.seeds.includes(run.seed)) throw new Error(`AOS_CYCLE_UNKNOWN_SEED ${run.seed}`);
  if (!mayRerun(cycle, run.seed)) throw new Error(`AOS_CYCLE_SEED_ALREADY_RUN ${run.seed}`);
  const validity = runValidity(cycle, run, { ledger });
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
export function aggregateCycle(cycle, { dimensions = ["D1", "D2", "D3", "D4", "D5", "D6"], ledger = null } = {}) {
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
  // pure function of the stored cycle the same way `summariseCycle` does. `ledger`, when a caller
  // has one to give, lets that fallback re-derive VERIFIED for such a run instead of defaulting it
  // to UNVERIFIED only because nobody asked the ledger; a caller with none gets exactly the old
  // fallback behaviour, because `exposureVerification` already treats a missing ledger as "nothing
  // to check against" rather than as permission.
  const exposureStatusOf = (run) => run.exposure_verification ?? exposureVerification(run, { ledger }).status;

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
export function summariseCycle(cycle, { dimensions, ledger = null } = {}) {
  const aggregate = aggregateCycle(cycle, { ...(dimensions === undefined ? {} : { dimensions }), ledger });
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
