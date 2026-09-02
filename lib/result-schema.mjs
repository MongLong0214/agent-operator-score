import { readFileSync } from "node:fs";

import { fileByteDigest } from "./digest.mjs";
import { comparability, shippedEcdContract } from "./ecd-contract.mjs";

// The canonical result: three profiles and one secondary index, built from what the #582 contract
// issued and from nothing else.
//
// This module replaces the single Operator Score as the thing a run produces. The number that used
// to sit at the top of every report folded the operator's decisions and the model's output into one
// figure, so a stronger model made the operator look better and a worse delegation made the model
// look worse. The split here is the whole point: `operator_process_profile` moves only when an
// operator-process cell moves, `system_outcome_profile` moves only when a system-outcome cell moves,
// and the composite that puts them side by side is labelled secondary because it is one.
//
// Every arithmetic in this file is an equal-weight mean that refuses to run over a gap. A withheld
// construct withholds its index; a withheld index withholds the composite; nothing missing is ever
// averaged as a zero. The renderers downstream get `projectResult`, which is strings, so that no
// renderer owns a formula of its own -- a report that recomputed would be a second scorer.
//
// What this module does not do, on purpose: compute a reliance metric (#583 owns the ten metrics;
// this file carries their seam and refuses a metric below the operational floor), decide a cap
// (#566 owns the cap policy; this file applies a cap it is handed to the surfaces a cap may touch
// and to no other), or estimate uncertainty and generalizability (#584; the honest defaults are
// carried through). And it never reads a legacy result: a record written under the old schema is
// rendered by the stored legacy scorer as the record it is, and is not back-computed into this one.

export const RESULT_SCHEMA_ID = "aos-result.v2";
export const RESULT_SCHEMA_VERSION = "2.0.0";
export const LEGACY_RESULT_SCHEMA_ID = "aos-mvp-result.v1";
export const RESULT_SCHEMA_URL = new URL("../schemas/aos-result.v2.schema.json", import.meta.url);
export const AGGREGATION_VECTORS_URL = new URL("../fixtures/scoring/profile-aggregation-vectors.v1.json", import.meta.url);

export const COMPOSITE_FORMULA = "aos-composite.v1";
export const COMPOSITE_WEIGHTS = Object.freeze({ operator_process: 0.5, system_outcome: 0.5 });

// The issue's text, character for character. The en dash in the third label is not a typo to be
// normalised: "operator–agent" names a pair, and the label is matched verbatim by the tests.
export const LABELS = Object.freeze({
  operator_process: "PROFILE-BOUND OPERATOR PROCESS INDEX",
  system_outcome: "PROFILE-BOUND SYSTEM OUTCOME INDEX",
  aos_composite: "PROFILE-BOUND OPERATOR–AGENT SYSTEM PERFORMANCE"
});

/**
 * The four outcome domains, as a partition of the contract's required credit-bearing system-outcome
 * cells. `outcomeDomains` checks the partition against the contract it is given, so a cell added to
 * the contract without a domain to live in is a refusal here rather than a cell silently left out
 * of the outcome index.
 */
export const OUTCOME_DOMAINS = Object.freeze([
  Object.freeze({ domain_id: "O1", title: "Functional & Artifact Outcome", cell_ids: Object.freeze(["C5.FO.01", "C2.HJ.01"]) }),
  Object.freeze({ domain_id: "O2", title: "Verification & Exact Revision", cell_ids: Object.freeze(["C5.IV.01", "C5.RB.01"]) }),
  Object.freeze({ domain_id: "O3", title: "Safety, Scope & Completion Integrity", cell_ids: Object.freeze(["C6.SL.01", "C6.IJ.01", "C5.CI.01"]) }),
  Object.freeze({ domain_id: "O4", title: "Efficiency & Resource Outcome", cell_ids: Object.freeze(["C2.IB.01", "C6.EB.01"]) })
]);

// SSOT section 21: the ten reliance metrics, carried here as a surface and computed by #583. Four
// is the operational floor a denominator has to reach before a ratio over it may be issued.
export const RELIANCE_METRIC_IDS = Object.freeze([
  "cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm",
  "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"
]);
export const RELIANCE_FLOOR = 4;
export const RELIANCE_STATUSES = Object.freeze(["WITHHELD", "PARTIAL", "ISSUED"]);
const RELIANCE_METRIC_STATUSES = Object.freeze(["ISSUED", "NOT_COMPUTED", "WITHHELD"]);

export const CAP_SCOPES = Object.freeze(["system_outcome", "aos_composite"]);
export const GENERALIZABILITY_STATUSES = Object.freeze(["UNESTABLISHED", "ESTABLISHED"]);
export const UNCERTAINTY_STATUSES = Object.freeze(["INSUFFICIENT_DATA", "NOT_COMPUTED", "COMPUTED"]);

export const SECTION_ORDER = Object.freeze(["operator_process", "reliance_calibration", "system_outcome", "aos_composite", "claim"]);
export const SECTION_TITLES = Object.freeze({
  operator_process: "Operator Process Profile",
  reliance_calibration: "Reliance Calibration Profile",
  system_outcome: "System Outcome Profile",
  aos_composite: "Operator–Agent System Performance (secondary)",
  claim: "Claim, Uncertainty & Generalizability"
});
export const SECONDARY_NOTE = "secondary descriptive index · not a human ability score";

const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isScalar = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);

// --- aggregation -----------------------------------------------------------------------------

/**
 * The equal-weight mean of issued rows, on 0-100, or the reason there is none.
 *
 * Every row weighs the same because the contract says so: a construct with more cells, or a domain
 * with more opportunities, does not get a larger say. One row short and the whole index is withheld
 * rather than averaged over what is left -- averaging the remainder is how observing less raises a
 * number, which is the defect the dimension-level scorer had to be fixed for.
 *
 * A row that says ISSUED and carries no number is a contradiction and is thrown, not zeroed.
 */
export function equalWeightIndex(rows) {
  if (!Array.isArray(rows)) throw new Error("AOS_INVALID_ROWS equalWeightIndex takes an array of { id, estimate, status } rows");
  const withheld = [];
  let total = 0;
  for (const row of rows) {
    if (row.status === "ISSUED") {
      if (!isFiniteNumber(row.estimate)) throw new Error(`AOS_ISSUED_WITHOUT_ESTIMATE ${row.id} is ISSUED and carries no estimate`);
      total += row.estimate;
      continue;
    }
    withheld.push(row.id);
  }
  if (rows.length === 0 || withheld.length > 0) return deepFreeze({ value: null, issued: false, withheld_for: withheld });
  return deepFreeze({ value: (100 * total) / rows.length, issued: true, withheld_for: [] });
}

/**
 * `aos-composite.v1`: the arithmetic mean of the two indices, 50:50, and nothing when either is
 * withheld. SSOT section 20 fixes the formula; reliance is not in it because reliance explains C3
 * and C3 is already in the process index -- a reliance term here would count it twice.
 */
export function compositeOf(processIndex, outcomeIndex) {
  const withheld = [];
  if (!isFiniteNumber(processIndex)) withheld.push("operator_process");
  if (!isFiniteNumber(outcomeIndex)) withheld.push("system_outcome");
  if (withheld.length > 0) return deepFreeze({ value: null, issued: false, withheld_for: withheld });
  return deepFreeze({ value: (processIndex + outcomeIndex) / 2, issued: true, withheld_for: [] });
}

/**
 * The outcome domains, checked against the contract they will be computed from.
 *
 * The declared grouping has to cover exactly the contract's required, credit-bearing system-outcome
 * cells outside the longitudinal lane. A cell in the contract with no domain would otherwise be a
 * cell the outcome index quietly ignored; a domain naming a cell the contract does not have would be
 * a domain that could never issue.
 */
export function outcomeDomains(contract = shippedEcdContract()) {
  const longitudinal = new Set(contract.construct_map.longitudinal_lane.construct_ids);
  const expected = new Set(contract.cells.cells
    .filter((cell) => cell.axis === "system_outcome" && cell.required_for_construct && cell.credit_bearing && !longitudinal.has(cell.construct_id))
    .map((cell) => cell.cell_id));
  const claimed = OUTCOME_DOMAINS.flatMap((domain) => domain.cell_ids);
  const drift = [
    ...claimed.filter((id) => !expected.has(id)).map((id) => `${id} is declared in a domain and is not a required credit-bearing system-outcome cell of this contract`),
    ...[...expected].filter((id) => !claimed.includes(id)).map((id) => `${id} is a required credit-bearing system-outcome cell of this contract and no domain names it`)
  ];
  if (new Set(claimed).size !== claimed.length) drift.push("a cell is named by more than one domain");
  if (drift.length > 0) throw new Error(`AOS_OUTCOME_DOMAIN_DRIFT ${drift.join("; ")}`);
  return OUTCOME_DOMAINS.map((domain) => deepFreeze({ domain_id: domain.domain_id, title: domain.title, cell_ids: [...domain.cell_ids] }));
}

// --- seams -----------------------------------------------------------------------------------

const validateReliance = (reliance) => {
  const supplied = reliance ?? { status: "WITHHELD", metrics: {} };
  if (!isPlainObject(supplied)) throw new Error("AOS_RELIANCE_SHAPE reliance is an object with status and metrics");
  if (!RELIANCE_STATUSES.includes(supplied.status)) throw new Error(`AOS_RELIANCE_STATUS ${String(supplied.status)} is not one of ${RELIANCE_STATUSES.join(", ")}`);
  const given = supplied.metrics ?? {};
  if (!isPlainObject(given)) throw new Error("AOS_RELIANCE_SHAPE metrics is an object keyed by metric id");
  for (const id of Object.keys(given)) {
    if (!RELIANCE_METRIC_IDS.includes(id)) throw new Error(`AOS_RELIANCE_METRIC ${id} is not one of the ten reliance metrics`);
  }
  const metricOf = (id) => {
    const row = given[id];
    if (row === undefined) return { value: null, status: "NOT_COMPUTED", numerator: null, denominator: null };
    if (!isPlainObject(row) || !RELIANCE_METRIC_STATUSES.includes(row.status)) throw new Error(`AOS_RELIANCE_METRIC ${id} must carry a status of ${RELIANCE_METRIC_STATUSES.join(", ")}`);
    if (row.status !== "ISSUED") {
      if (row.value !== null && row.value !== undefined) throw new Error(`AOS_RELIANCE_METRIC ${id} is ${row.status} and may not carry a value`);
      return { value: null, status: row.status, numerator: null, denominator: null };
    }
    // SSOT section 21: a ratio over fewer than four opportunities is not a reliance metric, it is an
    // anecdote with a decimal point. Refused here rather than issued and flagged.
    if (!Number.isInteger(row.numerator) || !Number.isInteger(row.denominator) || row.numerator < 0 || row.denominator < 0) {
      throw new Error(`AOS_RELIANCE_METRIC ${id} is ISSUED without integer numerator and denominator`);
    }
    if (row.denominator < RELIANCE_FLOOR) throw new Error(`AOS_RELIANCE_FLOOR ${id} rests on ${row.denominator} opportunities and the floor is ${RELIANCE_FLOOR}`);
    if (!isFiniteNumber(row.value)) throw new Error(`AOS_RELIANCE_METRIC ${id} is ISSUED without a finite value`);
    return { value: row.value, status: "ISSUED", numerator: row.numerator, denominator: row.denominator };
  };
  const metrics = Object.fromEntries(RELIANCE_METRIC_IDS.map((id) => [id, metricOf(id)]));
  const issuedCount = Object.values(metrics).filter((metric) => metric.status === "ISSUED").length;
  const consistent = supplied.status === "WITHHELD" ? issuedCount === 0
    : supplied.status === "ISSUED" ? issuedCount === RELIANCE_METRIC_IDS.length
      : issuedCount > 0 && issuedCount < RELIANCE_METRIC_IDS.length;
  if (!consistent) throw new Error(`AOS_RELIANCE_STATUS ${supplied.status} does not describe ${issuedCount} issued metric(s) of ${RELIANCE_METRIC_IDS.length}`);
  return { status: supplied.status, metrics };
};

const validateCaps = (caps, contract) => {
  if (!Array.isArray(caps)) throw new Error("AOS_CAPS_SHAPE caps is an array");
  const knownCells = new Set(contract.cells.cells.map((cell) => cell.cell_id));
  return caps.map((cap) => {
    if (!isPlainObject(cap)) throw new Error("AOS_CAPS_SHAPE a cap is an object");
    if (typeof cap.code !== "string" || cap.code.length === 0) throw new Error("AOS_CAP_CODE a cap names its code");
    if (!isFiniteNumber(cap.max_value) || cap.max_value < 0 || cap.max_value > 100) throw new Error(`AOS_CAP_VALUE ${cap.code} ceiling ${String(cap.max_value)} is not on 0-100`);
    // A cap is a ceiling on what the system produced. The operator's process is measured on its own
    // axis and a cap that reached it would let a model failure lower the operator's number, which
    // is the confound the split exists to remove.
    if (!Array.isArray(cap.scope) || cap.scope.length === 0 || cap.scope.some((scope) => !CAP_SCOPES.includes(scope))) {
      throw new Error(`AOS_CAP_SCOPE ${cap.code} may only cap ${CAP_SCOPES.join(" or ")}`);
    }
    if (typeof cap.reason !== "string") throw new Error(`AOS_CAP_REASON ${cap.code} states its reason`);
    if (!Array.isArray(cap.triggers) || cap.triggers.length === 0) throw new Error(`AOS_CAP_TRIGGERS ${cap.code} names no trigger`);
    for (const trigger of cap.triggers) {
      if (!isPlainObject(trigger) || typeof trigger.trigger_id !== "string") throw new Error(`AOS_CAP_TRIGGERS ${cap.code} carries a trigger without an id`);
      if (trigger.observed !== true) throw new Error(`AOS_CAP_UNOBSERVED ${cap.code} trigger ${trigger.trigger_id} was not observed`);
      const evidence = (Array.isArray(trigger.evidence_ids) ? trigger.evidence_ids.length : 0) + (Array.isArray(trigger.effect_event_ids) ? trigger.effect_event_ids.length : 0);
      if (evidence === 0) throw new Error(`AOS_CAP_EVIDENCE ${cap.code} trigger ${trigger.trigger_id} binds no evidence or effect event`);
      if (!knownCells.has(trigger.cell_id)) throw new Error(`AOS_CAP_CELL ${cap.code} trigger ${trigger.trigger_id} names ${String(trigger.cell_id)}, which is not a cell of this contract`);
    }
    return structuredClone(cap);
  });
};

const lowestCeiling = (caps, scope) => caps
  .filter((cap) => cap.scope.includes(scope))
  .reduce((lowest, cap) => (lowest === null || cap.max_value < lowest.max_value ? cap : lowest), null);

const validateUncertainty = (uncertainty, evaluation) => {
  if (uncertainty === undefined) return { status: evaluation.uncertainty.status, method: evaluation.uncertainty.method };
  if (!isPlainObject(uncertainty) || !UNCERTAINTY_STATUSES.includes(uncertainty.status)) {
    throw new Error(`AOS_UNCERTAINTY_STATUS uncertainty.status is one of ${UNCERTAINTY_STATUSES.join(", ")}`);
  }
  const method = uncertainty.method ?? null;
  if (uncertainty.status === "COMPUTED" && (typeof method !== "string" || method.length === 0)) {
    throw new Error("AOS_UNCERTAINTY_METHOD a COMPUTED uncertainty names the method that computed it");
  }
  if (uncertainty.status !== "COMPUTED" && method !== null) throw new Error(`AOS_UNCERTAINTY_METHOD ${uncertainty.status} carries no method`);
  return { status: uncertainty.status, method };
};

const validateGeneralizability = (status, evaluation) => {
  if (status === undefined) return "UNESTABLISHED";
  if (!GENERALIZABILITY_STATUSES.includes(status)) throw new Error(`AOS_GENERALIZABILITY_STATUS ${String(status)} is not one of ${GENERALIZABILITY_STATUSES.join(", ")}`);
  if (status === "ESTABLISHED" && evaluation.claim_stage !== "GENERALIZABILITY_SUPPORTED") {
    throw new Error(`AOS_GENERALIZABILITY_UNSUPPORTED the evaluation supports ${evaluation.claim_stage}, not a generalizability claim`);
  }
  return status;
};

const validateRun = (run) => {
  if (run === undefined) return {};
  if (!isPlainObject(run)) throw new Error("AOS_RUN_SHAPE run is an object of scalar identity fields");
  for (const [key, value] of Object.entries(run)) {
    if (!isScalar(value)) throw new Error(`AOS_RUN_FIELD run.${key} is not a scalar`);
  }
  return { ...run };
};

/**
 * Only a result `evaluate` emitted, under the contract this builder was given.
 *
 * The registry of emitted results lives inside lib/ecd-contract.mjs and is not exported, on
 * purpose; `comparability` is the one door to it, and asking whether a result is comparable to
 * itself under a contract asks exactly the two questions this builder needs answered: was it
 * emitted, and was it emitted under this contract. A copy -- spread, cloned or parsed back from
 * JSON -- is refused, because a copy is an object whose numbers nothing vouches for.
 */
const emittedUnder = (evaluation, contract) => {
  if (!isPlainObject(evaluation)) throw new Error("AOS_UNEMITTED_EVALUATION buildResult takes the result evaluate emitted");
  try {
    comparability(evaluation, evaluation, contract);
  } catch (error) {
    if (/^AOS_UNEMITTED_RESULT/u.test(error.message)) throw new Error("AOS_UNEMITTED_EVALUATION buildResult takes the result evaluate emitted, not a copy of one");
    if (/^AOS_CONTRACT_MISMATCH/u.test(error.message)) throw new Error("AOS_CONTRACT_MISMATCH the evaluation was not emitted under the contract given to buildResult");
    throw error;
  }
};

// --- the result ------------------------------------------------------------------------------

const cellsOf = (evaluation, ids) => ids.map((id) => evaluation.cells.find((cell) => cell.cell_id === id)).filter(Boolean);

const missingAmong = (evaluation, ids) => {
  const mine = new Set(ids);
  return {
    not_observed: evaluation.missing.not_observed.filter((id) => mine.has(id)),
    insufficient_opportunities: evaluation.missing.insufficient_opportunities.filter((id) => mine.has(id)),
    withheld: evaluation.missing.withheld.filter((id) => mine.has(id))
  };
};

const coverageOf = (evaluation, requiredIds, optionalIds) => {
  const required = cellsOf(evaluation, requiredIds);
  const optional = cellsOf(evaluation, optionalIds);
  const issued = required.filter((cell) => cell.status === "ISSUED").map((cell) => cell.cell_id);
  return {
    required_cells: required.map((cell) => cell.cell_id),
    issued_cells: issued,
    optional_cells: optional.map((cell) => ({ cell_id: cell.cell_id, estimate: cell.estimate, status: cell.status })),
    opportunity_count: [...required, ...optional].reduce((total, cell) => total + cell.opportunity_count, 0),
    coverage: { required: required.length, issued: issued.length },
    missing: missingAmong(evaluation, [...requiredIds, ...optionalIds])
  };
};

const constructRow = (evaluation, contract, id, axis) => {
  const construct = contract.construct_map.constructs.find((entry) => entry.construct_id === id);
  const issued = evaluation.constructs.find((row) => row.construct_id === id && row.axis === axis);
  if (!construct || !issued) throw new Error(`AOS_CONSTRUCT_MISSING ${id} has no ${axis} row in the evaluation`);
  return {
    construct_id: id,
    title: construct.title,
    axis,
    estimate: issued.estimate,
    value: isFiniteNumber(issued.estimate) ? issued.estimate * 100 : null,
    status: issued.status,
    required_cells: [...issued.required_cell_ids],
    optional_cells: issued.optional_cells.map((cell) => ({ ...cell })),
    withheld_for: issued.withheld_for.map((entry) => ({ ...entry }))
  };
};

const domainRow = (evaluation, domain) => {
  const cells = cellsOf(evaluation, domain.cell_ids);
  const withheld = cells.filter((cell) => cell.status !== "ISSUED").map((cell) => ({ cell_id: cell.cell_id, status: cell.status }));
  const estimate = withheld.length > 0 || cells.length === 0 ? null : cells.reduce((total, cell) => total + cell.estimate, 0) / cells.length;
  return {
    domain_id: domain.domain_id,
    title: domain.title,
    axis: "system_outcome",
    estimate,
    value: estimate === null ? null : estimate * 100,
    status: estimate === null ? "WITHHELD" : "ISSUED",
    required_cells: [...domain.cell_ids],
    cells: cells.map((cell) => ({ cell_id: cell.cell_id, estimate: cell.estimate, status: cell.status, opportunity_count: cell.opportunity_count })),
    withheld_for: withheld
  };
};

const equalWeights = (ids) => Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));

/**
 * The canonical result.
 *
 * `evaluation` is the frozen result `evaluate` emitted under `contract`; everything numeric here is
 * read from it. `reliance`, `caps`, `uncertainty` and `generalizability_status` are the seams the
 * downstream issues fill, each validated to the honest default when absent. `run` is the identity
 * of the run the result belongs to and is carried, not read.
 */
export function buildResult({ evaluation, contract = shippedEcdContract(), reliance, caps = [], uncertainty, generalizability_status, run, ...rest } = {}) {
  // A legacy record is rendered by the legacy scorer and is never lifted into this schema: the
  // twenty metrics it was scored from cannot be re-read as construct estimates, and a result that
  // was back-computed would carry this schema's claims without its evidence.
  if (Object.hasOwn(rest, "legacy")) throw new Error("AOS_LEGACY_RESULT_NOT_MIGRATED a legacy result is rendered as the record it is; buildResult does not migrate it");
  emittedUnder(evaluation, contract);

  const processSpec = contract.construct_map.process_index;
  const processIds = [...processSpec.construct_ids];
  const constructs = Object.fromEntries(processIds.map((id) => [id, constructRow(evaluation, contract, id, processSpec.axis)]));
  const processIndex = equalWeightIndex(processIds.map((id) => ({ id, estimate: constructs[id].estimate, status: constructs[id].status })));
  const processCells = processIds.flatMap((id) => constructs[id].required_cells);
  const processOptional = processIds.flatMap((id) => constructs[id].optional_cells.map((cell) => cell.cell_id));

  const domains = Object.fromEntries(outcomeDomains(contract).map((domain) => [domain.domain_id, domainRow(evaluation, domain)]));
  const domainIds = Object.keys(domains);
  const outcomeRaw = equalWeightIndex(domainIds.map((id) => ({ id, estimate: domains[id].estimate, status: domains[id].status })));
  const outcomeCells = domainIds.flatMap((id) => domains[id].required_cells);

  const validCaps = validateCaps(caps, contract);
  const outcomeCeiling = lowestCeiling(validCaps, "system_outcome");
  const outcomeCapped = outcomeRaw.value !== null && outcomeCeiling !== null && outcomeCeiling.max_value < outcomeRaw.value;
  const outcomeIndex = outcomeCapped ? outcomeCeiling.max_value : outcomeRaw.value;

  const compositeRaw = compositeOf(processIndex.value, outcomeRaw.value);
  const compositeThroughOutcome = compositeOf(processIndex.value, outcomeIndex);
  const compositeCeiling = lowestCeiling(validCaps, "aos_composite");
  const compositeCapped = compositeThroughOutcome.value !== null && compositeCeiling !== null && compositeCeiling.max_value < compositeThroughOutcome.value;
  const compositeValue = compositeCapped ? compositeCeiling.max_value : compositeThroughOutcome.value;

  const relianceSeam = validateReliance(reliance);
  const relianceCells = contract.cells.cells.filter((cell) => cell.axis === "reliance_calibration").map((cell) => cell.cell_id);
  const relianceIssued = cellsOf(evaluation, relianceCells);
  const c3Reliance = evaluation.constructs.find((row) => row.construct_id === "C3" && row.axis === "reliance_calibration") ?? null;

  const artifactIds = contract.construct_map.constructs
    .filter((construct) => Object.hasOwn(construct.axes, "delegated_artifact"))
    .map((construct) => construct.construct_id);

  const claim = {
    claim_stage: evaluation.claim_stage,
    generalizability_status: validateGeneralizability(generalizability_status, evaluation),
    uncertainty: validateUncertainty(uncertainty, evaluation)
  };
  const facetIdentity = { ...evaluation.facet_coverage.declared };

  const result = {
    schema_id: RESULT_SCHEMA_ID,
    schema_version: RESULT_SCHEMA_VERSION,
    run: validateRun(run),
    contract: { id: evaluation.contract.id, version: evaluation.contract.version, digests: { ...evaluation.contract.digests } },
    profile_digest: evaluation.profile_digest,
    ...claim,
    permitted_interpretation: evaluation.permitted_interpretation,
    forbidden_uses: [...evaluation.forbidden_uses],
    standard_setting: null,
    category: null,
    cut_score: null,
    percentile: null,
    rank: null,
    band: null,
    incomplete_forms: [...evaluation.incomplete_forms],
    unsupported_forms: [...evaluation.unsupported_forms],
    unidentified_facets: [...evaluation.unidentified_facets],
    facet_identity: facetIdentity,
    facet_coverage: {
      levels_per_facet_observed: evaluation.facet_coverage.levels_per_facet_observed,
      variance_components: evaluation.facet_coverage.variance_components
    },
    operator_process_profile: {
      label: LABELS.operator_process,
      axis: processSpec.axis,
      interpretation: processSpec.interpretation,
      issued: processIndex.issued,
      index: processIndex.value,
      withheld_for: [...processIndex.withheld_for],
      weights: equalWeights(processIds),
      constructs,
      ...coverageOf(evaluation, processCells, processOptional),
      facet_identity: { ...facetIdentity },
      ...claim
    },
    reliance_calibration_profile: {
      status: relianceSeam.status,
      explains_construct: "C3",
      floor: RELIANCE_FLOOR,
      opportunities: relianceIssued.reduce((total, cell) => total + cell.declared_opportunities, 0),
      construct: c3Reliance === null ? null : { estimate: c3Reliance.estimate, status: c3Reliance.status, withheld_for: c3Reliance.withheld_for.map((entry) => ({ ...entry })) },
      cells: Object.fromEntries(relianceIssued.map((cell) => [cell.cell_id, { estimate: cell.estimate, status: cell.status, opportunity_count: cell.opportunity_count }])),
      metrics: relianceSeam.metrics,
      ...claim
    },
    system_outcome_profile: {
      label: LABELS.system_outcome,
      axis: "system_outcome",
      interpretation: "descriptive only",
      issued: outcomeRaw.issued,
      index: outcomeIndex,
      raw_index: outcomeRaw.value,
      cap_applied: outcomeCapped ? outcomeCeiling.code : null,
      caps: validCaps,
      withheld_for: [...outcomeRaw.withheld_for],
      weights: equalWeights(domainIds),
      domains,
      ...coverageOf(evaluation, outcomeCells, []),
      facet_identity: { ...facetIdentity },
      ...claim
    },
    aos_composite: {
      label: LABELS.aos_composite,
      formula: COMPOSITE_FORMULA,
      secondary: true,
      weights: { ...COMPOSITE_WEIGHTS },
      inputs: { operator_process: processIndex.value, system_outcome: outcomeIndex },
      issued: compositeThroughOutcome.issued,
      value: compositeValue,
      raw_value: compositeRaw.value,
      cap_applied: compositeCapped ? compositeCeiling.code : null,
      withheld_for: [...compositeThroughOutcome.withheld_for],
      // The evidence model files the delegated-artifact axis under this surface, and SSOT section
      // 20 fixes the surface's number as the mean of the two indices. Both hold: the artifact
      // estimates are shown here, verbatim, and none of them is in the value.
      delegated_artifact: {
        axis: "delegated_artifact",
        in_composite: false,
        constructs: Object.fromEntries(artifactIds.map((id) => [id, constructRow(evaluation, contract, id, "delegated_artifact")]))
      },
      ...claim
    },
    cells: evaluation.cells.map((cell) => structuredClone(cell)),
    missing: structuredClone(evaluation.missing)
  };
  return deepFreeze(result);
}

// --- legacy separation -----------------------------------------------------------------------

/** A record that does not say it is the new schema is the old one, including one written before the field existed. */
export const isLegacyResult = (result) => !isPlainObject(result) || result.schema_id !== RESULT_SCHEMA_ID;
export const resultSchemaOf = (result) => (isLegacyResult(result) ? LEGACY_RESULT_SCHEMA_ID : RESULT_SCHEMA_ID);

/**
 * One schema per cycle. A cycle's median is a median of one kind of number; a legacy score and a
 * profile index are not one kind of number, and a cycle that held both would aggregate them anyway.
 * A run record without the field predates it and is legacy; a record whose field is null had no
 * result at all and says nothing about the schema.
 */
export function assertUniformResultSchema(records, where = "cycle") {
  if (!Array.isArray(records)) throw new Error("AOS_INVALID_RECORDS assertUniformResultSchema takes the cycle's run records");
  const schemas = new Set(records
    .filter((record) => record.result_schema !== null)
    .map((record) => (typeof record.result_schema === "string" ? record.result_schema : LEGACY_RESULT_SCHEMA_ID)));
  if (schemas.size === 0) return null;
  if (schemas.size > 1) throw new Error(`AOS_MIXED_RESULT_SCHEMAS ${where} holds ${[...schemas].sort().join(" and ")} results; legacy and profile results are not aggregated together`);
  return [...schemas][0];
}

export const loadResultSchema = () => JSON.parse(readFileSync(RESULT_SCHEMA_URL, "utf8"));
/** The identity of the schema file: a digest of its bytes as they are on disk, never of parsed or re-serialised text. */
export const resultSchemaDigest = () => fileByteDigest(RESULT_SCHEMA_URL);

// --- projection ------------------------------------------------------------------------------

// One decimal, always, so "100" and "100.0" cannot be two renderings of one number.
const shown = (value) => (isFiniteNumber(value) ? (Math.round(value * 10) / 10).toFixed(1) : "withheld");
const reasonOf = (withheldFor) => (Array.isArray(withheldFor) && withheldFor.length > 0
  ? withheldFor.map((entry) => (typeof entry === "string" ? entry : `${entry.cell_id} ${entry.status}`)).join(", ")
  : null);

/**
 * The result as strings, for every renderer.
 *
 * Renderers print this and compute nothing: every number here is formatted from the stored field
 * it names, never derived from the rows beside it, so a report cannot disagree with the result it
 * was drawn from except by the result disagreeing with itself -- which the projection-consistency
 * test uses on purpose. `phrases` is the list every full renderer must print and `headline` the
 * subset the card must print; both are how "the same values and phrases" is checkable.
 */
export function projectResult(result) {
  if (isLegacyResult(result)) throw new Error("AOS_LEGACY_RESULT_NOT_PROJECTED a legacy result is rendered by the legacy renderer, not projected");
  const process = result.operator_process_profile;
  const reliance = result.reliance_calibration_profile;
  const outcome = result.system_outcome_profile;
  const composite = result.aos_composite;

  // Sorted by id, and the metrics in their declared order, because a result that went through
  // canonicalJson comes back with its keys sorted and the projection has to be the same either way.
  const rows = (entries, idKey) => Object.values(entries ?? {})
    .map((row) => ({ id: row[idKey], title: row.title, value: shown(row.value), status: row.status, reason: reasonOf(row.withheld_for) }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const processRows = rows(process.constructs, "construct_id");
  const outcomeRows = rows(outcome.domains, "domain_id");
  const artifactRows = rows(composite.delegated_artifact?.constructs, "construct_id");
  const relianceRows = RELIANCE_METRIC_IDS.filter((id) => isPlainObject(reliance.metrics?.[id])).map((id) => ({
    id,
    value: isFiniteNumber(reliance.metrics[id].value) ? reliance.metrics[id].value.toFixed(2) : "not computed",
    status: String(reliance.metrics[id].status),
    opportunities: Number.isInteger(reliance.metrics[id].denominator) ? String(reliance.metrics[id].denominator) : null
  }));

  const withheldSummary = (profile, ids) => (profile.index === null ? `withheld · ${ids.length > 0 ? ids.join(", ") : "no rows"}` : null);
  const capLine = (code) => (typeof code === "string" ? `capped by ${code}` : null);

  const view = {
    schema_id: result.schema_id,
    run_id: typeof result.run?.run_id === "string" ? result.run.run_id : null,
    sections: SECTION_ORDER.map((key) => ({ key, title: SECTION_TITLES[key] })),
    summary: `process ${shown(process.index)} · outcome ${shown(outcome.index)} · composite ${shown(composite.value)}`,
    process: {
      label: process.label,
      index: shown(process.index),
      issued: process.issued === true,
      withheld_summary: withheldSummary(process, process.withheld_for ?? []),
      coverage: `${process.coverage?.issued ?? 0} of ${process.coverage?.required ?? 0} required cells issued`,
      rows: processRows
    },
    reliance: {
      status: String(reliance.status),
      explains: `explains ${reliance.explains_construct}; never weighted into any index`,
      opportunities: String(reliance.opportunities),
      rows: relianceRows
    },
    outcome: {
      label: outcome.label,
      index: shown(outcome.index),
      raw_index: shown(outcome.raw_index),
      issued: outcome.issued === true,
      cap: capLine(outcome.cap_applied),
      withheld_summary: withheldSummary(outcome, outcome.withheld_for ?? []),
      coverage: `${outcome.coverage?.issued ?? 0} of ${outcome.coverage?.required ?? 0} required cells issued`,
      rows: outcomeRows
    },
    composite: {
      label: composite.label,
      value: shown(composite.value),
      raw_value: shown(composite.raw_value),
      formula: String(composite.formula),
      secondary_note: SECONDARY_NOTE,
      cap: capLine(composite.cap_applied),
      withheld_summary: composite.value === null ? `withheld · ${(composite.withheld_for ?? []).join(", ")}` : null,
      artifact_rows: artifactRows
    },
    claim: {
      stage: String(result.claim_stage),
      permitted_interpretation: String(result.permitted_interpretation),
      uncertainty: String(result.uncertainty?.status),
      uncertainty_method: typeof result.uncertainty?.method === "string" ? result.uncertainty.method : "none",
      generalizability: String(result.generalizability_status),
      forbidden_uses: [...(result.forbidden_uses ?? [])].map(String),
      facets: Object.keys(result.facet_identity ?? {}).sort().map((facet) => `${facet}: ${result.facet_identity[facet] === null ? "undeclared" : String(result.facet_identity[facet])}`),
      contract: `${result.contract?.id} ${result.contract?.version} · ${result.contract?.digests?.combined}`,
      schema: `${result.schema_id} ${result.schema_version}`
    }
  };

  const phrases = [
    ...view.sections.map((section) => section.title),
    view.summary,
    view.process.label, view.process.index, view.process.coverage,
    ...processRows.flatMap((row) => [`${row.id} ${row.title}`, row.value, ...(row.reason ? [row.reason] : [])]),
    view.reliance.status, view.reliance.explains,
    ...relianceRows.map((row) => `${row.id}: ${row.value}`),
    view.outcome.label, view.outcome.index, view.outcome.coverage,
    ...outcomeRows.flatMap((row) => [`${row.id} ${row.title}`, row.value, ...(row.reason ? [row.reason] : [])]),
    view.composite.label, view.composite.value, view.composite.formula, view.composite.secondary_note,
    view.claim.stage, view.claim.uncertainty, view.claim.generalizability,
    ...[view.process.withheld_summary, view.outcome.withheld_summary, view.composite.withheld_summary, view.outcome.cap, view.composite.cap].filter((line) => line !== null)
  ];
  const headline = [
    view.process.label, view.process.index,
    view.outcome.label, view.outcome.index,
    view.composite.label, view.composite.value, view.composite.secondary_note,
    view.claim.stage, view.claim.uncertainty, view.claim.generalizability,
    ...[view.process.withheld_summary, view.outcome.withheld_summary, view.composite.withheld_summary, view.outcome.cap, view.composite.cap].filter((line) => line !== null)
  ];
  return deepFreeze({ ...view, phrases: [...new Set(phrases)], headline: [...new Set(headline)] });
}
