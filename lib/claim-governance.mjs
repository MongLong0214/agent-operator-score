// #586. The validation-evidence registry, the claim-stage engine and the forbidden-use gate.
//
// Three sentences this module exists to make structural rather than aspirational:
//
//   tests pass          ≠ interpretation valid
//   stable output       ≠ generalizable human ability
//   good system outcome ≠ operator ability isolated
//
// A green suite, a deterministic projection and a repeatable number are facts about a program. What
// a reader is entitled to conclude about a person from that number is a different question, and it
// is answered here from validation evidence rather than from delivery. The evidence itself is not an
// input to any function in this file: it is read off the sealed ECD contract, which is a reviewed
// artifact under `checkEcdContract`, so no caller can hand this module a PASS. Everything derived
// here -- the stage, the decision, the permitted uses, the digest -- is computed from that contract
// and from the frozen evaluation the run produced, and none of it is accepted as an argument.
//
// One engine, one stage, and the second site is unreachable rather than discouraged.
// `lib/result-schema.mjs` calls `validityEvidenceRecord` once and publishes what it returns; every
// renderer quotes the published strings. `deriveClaimStage` and `claimEvidenceBundle` are not
// exported at all, so the only way any module in this repository can obtain a stage is to hand this
// file a sealed contract and an evaluation `evaluate` emitted -- neither of which a renderer holds.
// A renderer has a result: strings, already formatted, with nothing to recompute from.

import { canonicalJson, sha256Value } from "./core.mjs";
import { CATEGORY_FIELDS, registryPermitsCategory } from "./standard-setting.mjs";

const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

export const VALIDITY_EVIDENCE_SCHEMA_ID = "aos-validity-evidence.v1";

/**
 * The one public claim this instrument makes about an operator. Named, so that "every public claim
 * has a registry entry" is a checkable statement rather than a hope: a claim that is not this one
 * has no entry, and a surface that makes one is making it without evidence.
 */
export const OPERATOR_PROCESS_CLAIM_ID = "operator-process.profile-bound.v1";

/** The seven evidence categories, in the order the registry reports them. */
export const EVIDENCE_CATEGORIES = Object.freeze([
  "content", "response_process", "internal_structure", "relations_to_other_variables",
  "generalizability", "fairness_invariance", "consequences"
]);

/**
 * Three states, and `UNESTABLISHED` is not a weak `PASS`. Absent evidence, unreadable evidence and
 * an unrecognised status all land here, never on `PASS`: this repository's recurring defect is
 * absence scored as a value, and the registry is the one place where that would convert a missing
 * study into a licence to interpret a number as a person's ability.
 */
export const EVIDENCE_STATUSES = Object.freeze(["PASS", "FAIL", "UNESTABLISHED"]);

/** The stages, weakest first. An index comparison is the only ordering; no renderer defines one. */
export const CLAIM_STAGES = Object.freeze(["EXPERIMENTAL", "INSTRUMENT_READY", "PROFILE_BOUND", "GENERALIZABILITY_SUPPORTED"]);

/** The categories PROFILE_BOUND requires at PASS. The other three may be UNESTABLISHED and bound the claim instead. */
export const PROFILE_BOUND_CATEGORIES = Object.freeze(["content", "response_process", "internal_structure", "consequences"]);

/** The categories that separate a profile-bound observation from a generalizable inference. */
export const GENERALIZABILITY_CATEGORIES = Object.freeze(["relations_to_other_variables", "generalizability", "fairness_invariance"]);

/**
 * What a reader is entitled to do with the number at each stage.
 *
 * A constant rather than a computation: the permitted set is part of the claim's definition, and a
 * derived list would let a run's own facts widen what its stage permits. PROFILE_BOUND's two uses
 * are the specification's own words.
 */
export const PERMITTED_USES_BY_STAGE = deepFreeze({
  EXPERIMENTAL: ["instrument-debugging"],
  INSTRUMENT_READY: ["instrument-debugging", "run-diagnostic-feedback"],
  PROFILE_BOUND: ["local-self-diagnosis", "same-profile-improvement-tracking"],
  GENERALIZABILITY_SUPPORTED: ["the-registered-use-only"]
});

const INTENDED_INTERPRETATION = deepFreeze({
  EXPERIMENTAL: "An instrument under construction. Nothing it emits is an interpretation of an operator.",
  INSTRUMENT_READY: "The instrument's contracts are complete and its scoring and projection are deterministic. No claim about a person's ability is supported.",
  PROFILE_BOUND: "Performance observed across every locked operational form under one exact profile and measurement contract. Local self-diagnosis and same-profile tracking only.",
  GENERALIZABILITY_SUPPORTED: "A calibrated inference over a defined universe, for the registered use only."
});

/** Machine-readable refusals. A document's disclaimer is not one of these. */
export const USE_REFUSAL_REASONS = Object.freeze({
  UNDECLARED: "AOS_USE_UNDECLARED",
  FORBIDDEN: "AOS_USE_FORBIDDEN",
  STANDARD_SETTING_REQUIRED: "AOS_USE_STANDARD_SETTING_REQUIRED",
  INVARIANCE_UNESTABLISHED: "AOS_USE_INVARIANCE_UNESTABLISHED",
  NOT_PERMITTED_AT_STAGE: "AOS_USE_NOT_PERMITTED_AT_STAGE"
});

const normalisedUse = (use) => (typeof use === "string" && use.trim() !== "" ? use.trim().toLowerCase().replace(/[\s_]+/gu, "-") : null);

/**
 * The four uses this instrument refuses at every stage, whatever its evidence says. They are not
 * derived from the contract's list, because a contract edit must not be able to open them; the
 * contract's own `forbidden_uses` are refused as well, on top of these.
 */
export const ALWAYS_FORBIDDEN_USES = Object.freeze(["hiring", "promotion", "certification", "population-ranking"]);

/** Uses that assert one profile is better than another. Refused until invariance evidence passes. */
const COMPARATIVE_USES = Object.freeze([
  "cross-profile-superiority", "cross-profile-comparison", "cross-model-comparison",
  "cross-language-comparison", "cross-interface-comparison", "cross-platform-comparison"
]);

/**
 * Uses that are a verdict about a person and need a registered standard-setting study first (#568).
 *
 * Read from `lib/standard-setting.mjs` rather than retyped, for two reasons. The list is that
 * module's own vocabulary and a sixth field added there must be refused here too. And this module
 * would otherwise become another surface naming the legacy ability vocabulary, which the contract's
 * `legacy_band_surface` requires be declared module by module -- a declaration that would say this
 * file carries a category it does not carry.
 */
const STANDARD_SETTING_USES = Object.freeze(CATEGORY_FIELDS.map((field) => field.replace(/_/gu, "-")));

const DIGEST_SHAPE = /^(?:sha256:)?[0-9a-f]{64}$/u;

/**
 * The registry, read off the contract.
 *
 * Every one of the seven categories is reported, whether or not the contract mentions it: a
 * category the contract omits is `UNESTABLISHED` with no items and a detail that says the entry is
 * missing, so silence is visible as silence rather than as a gap in the object. An unrecognised
 * status reads `UNESTABLISHED` for the same reason -- a typo must not become a licence.
 */
export function evidenceRegistryOf(contract) {
  const entries = Array.isArray(contract?.interpretation_use?.validation_registry) ? contract.interpretation_use.validation_registry : [];
  return deepFreeze(Object.fromEntries(EVIDENCE_CATEGORIES.map((category) => {
    const entry = entries.find((one) => isPlainObject(one) && one.category === category);
    if (entry === undefined) {
      return [category, { status: "UNESTABLISHED", items: [], detail: `no registry entry for ${category} exists in this contract` }];
    }
    const declared = entry.status;
    const status = EVIDENCE_STATUSES.includes(declared) ? declared : "UNESTABLISHED";
    const detail = nonEmptyString(entry.detail) ? entry.detail : `the ${category} entry states no detail`;
    return [category, {
      status,
      // Items are the studies behind a status. The v1.10.0 contract carries none, so this is empty
      // for every shipped category; it is read rather than invented, because a list this module
      // made up would be evidence of nothing dressed as evidence of something.
      items: Array.isArray(entry.evidence_items) ? entry.evidence_items.filter(nonEmptyString).map(String) : [],
      detail: status === declared ? detail : `${detail} (status ${JSON.stringify(declared ?? null)} is not one of ${EVIDENCE_STATUSES.join(", ")} and reads as UNESTABLISHED)`
    }];
  })));
}

/**
 * The rebuttals the contract has not closed, carried onto the record.
 *
 * Negative and null results are preserved rather than deleted: a registry that reported only its
 * passing categories would be an advertisement. `MITIGATED` rebuttals are the ones the contract
 * says are answered; everything else -- OPEN, PARTIALLY_MITIGATED, and any word a future contract
 * introduces -- travels.
 */
const openRebuttalsOf = (contract) => {
  const inferences = Array.isArray(contract?.interpretation_use?.inferences) ? contract.interpretation_use.inferences : [];
  return inferences.flatMap((inference) => (Array.isArray(inference?.rebuttals) ? inference.rebuttals : [])
    .filter((rebuttal) => isPlainObject(rebuttal) && rebuttal.status !== "MITIGATED")
    .map((rebuttal) => ({
      inference_id: String(inference.inference_id ?? "unnamed"),
      rebuttal_id: String(rebuttal.rebuttal_id ?? "unnamed"),
      status: String(rebuttal.status ?? "UNESTABLISHED"),
      detail: nonEmptyString(rebuttal.detail) ? rebuttal.detail : "no detail recorded"
    })));
};

/**
 * The runtime facts a profile-bound claim rests on, read from one frozen evaluation.
 *
 * Nothing here recomputes what `evaluate` already decided. `run_claim_stage` is quoted, not
 * re-derived: the run's own claim stage already carries the exact profile, the completed locked
 * forms, the declared facets and the official boundary, and a second arithmetic over the same
 * inputs is how two fields that must agree come to disagree. The terms below are the ones
 * `evaluate` does not own -- whether the official lane was actually STRICT rather than merely
 * official, whether every claim-specific required cell was issued, and whether the operator-process
 * cells are bound to observations rather than credited from nothing.
 */
function claimEvidenceBundle({ evaluation, contract } = {}) {
  const cells = Array.isArray(evaluation?.cells) ? evaluation.cells : [];
  const byId = new Map(cells.map((entry) => [entry.cell_id, entry]));
  const declared = Array.isArray(contract?.cells?.cells) ? contract.cells.cells : [];
  // A cell the contract declares unpopulated cannot be issued by any run, so requiring it here
  // would report a content gap as a runtime failure and make the two indistinguishable. The content
  // category is where an unpopulated cell is registered; this term is about the run.
  const claimRequired = declared.filter((cell) => cell.required_for_construct === true && cell.population_status === "SUBCHECK_BACKED");
  const operatorRequired = claimRequired.filter((cell) => cell.axis === "operator_process");
  const issued = (cell) => byId.get(cell.cell_id)?.status === "ISSUED";
  const bound = (cell) => (byId.get(cell.cell_id)?.bound_to ?? []).length > 0;
  const uncertainty = evaluation?.uncertainty ?? null;
  return deepFreeze({
    run_claim_stage: String(evaluation?.claim_stage ?? "RUN_DIAGNOSTIC"),
    run_profile_bound: evaluation?.claim_stage === "PROFILE_BOUND" || evaluation?.claim_stage === "GENERALIZABILITY_SUPPORTED",
    run_generalizability_supported: evaluation?.claim_stage === "GENERALIZABILITY_SUPPORTED",
    canonical_scoring_deterministic: DIGEST_SHAPE.test(String(evaluation?.contract?.digests?.combined ?? "")),
    strict_official_lane: (evaluation?.boundary_withheld ?? ["AOS_ISOLATION_NOT_MEASURED"]).length === 0 && evaluation?.boundary_state?.level === "STRICT",
    required_cells_issued: claimRequired.length > 0 && claimRequired.every(issued),
    // A credited operator-process cell with no observation behind it is the "good outcome, no
    // operator evidence" case: the run went well and nothing recorded what the operator did.
    operator_event_provenance: operatorRequired.length > 0 && operatorRequired.every((cell) => issued(cell) && bound(cell)),
    uncertainty_visible: nonEmptyString(uncertainty?.status),
    coverage_visible: Number.isFinite(evaluation?.facet_coverage?.opportunity_count) && evaluation.facet_coverage.opportunity_count > 0,
    universe_declared: nonEmptyString(evaluation?.generalizability?.universe_declaration),
    contract_ceiling: String(contract?.interpretation_use?.maximum_claim_stage ?? "PROFILE_BOUND")
  });
}

/**
 * The stage, and every condition that kept it from being higher.
 *
 * The reasons are not decoration. A stage that drops without saying why is a refusal a consumer
 * works around, and the reason list is what makes "PROFILE_BOUND is impossible while the registry
 * is empty" a statement an operator can read off the artifact instead of a rule in a document.
 */
function deriveClaimStage({ registry, bundle, contract } = {}) {
  const statusOf = (category) => registry?.[category]?.status ?? "UNESTABLISHED";
  const reasons = [];

  const use = contract?.interpretation_use;
  const contractComplete = isPlainObject(use)
    && Array.isArray(use.claim_stages) && use.claim_stages.length > 0
    && Array.isArray(use.forbidden_uses) && use.forbidden_uses.length > 0
    && Array.isArray(use.comparability_rules) && use.comparability_rules.length > 0;
  if (!contractComplete) reasons.push("the construct/evidence/task/use contract is incomplete, so no stage above EXPERIMENTAL is defined");
  if (!EVIDENCE_CATEGORIES.every((category) => EVIDENCE_STATUSES.includes(registry?.[category]?.status))) {
    reasons.push("the validation registry does not carry a recognised status for every evidence category");
  }
  if (bundle?.canonical_scoring_deterministic !== true) reasons.push("the canonical scoring and projection are not bound to a contract digest, so determinism is unestablished");
  for (const category of ["content", "response_process", "internal_structure"]) {
    if (statusOf(category) === "FAIL") reasons.push(`${category} evidence is FAIL`);
  }
  const instrumentReady = reasons.length === 0;

  const profileReasons = [];
  if (bundle?.run_profile_bound !== true) profileReasons.push(`the run's own evaluation supports ${bundle?.run_claim_stage ?? "no stage"}, which is not a profile-bound observation`);
  if (bundle?.strict_official_lane !== true) profileReasons.push("the run was not administered on an actual STRICT official lane");
  if (bundle?.required_cells_issued !== true) profileReasons.push("a claim-specific required cell was not issued by this run");
  if (bundle?.operator_event_provenance !== true) profileReasons.push("an operator-process cell is not backed by an actual operator event observation");
  if (bundle?.uncertainty_visible !== true || bundle?.coverage_visible !== true) profileReasons.push("uncertainty and coverage are not both visible on this run");
  for (const category of PROFILE_BOUND_CATEGORIES) {
    if (statusOf(category) !== "PASS") profileReasons.push(`${category} evidence is ${statusOf(category)}, not PASS`);
  }
  const profileBound = instrumentReady && profileReasons.length === 0;

  const generalizabilityReasons = [];
  for (const category of GENERALIZABILITY_CATEGORIES) {
    if (statusOf(category) !== "PASS") generalizabilityReasons.push(`${category} evidence is ${statusOf(category)}, not PASS`);
  }
  if (bundle?.universe_declared !== true) generalizabilityReasons.push("no universe of operating situations is declared");
  if (bundle?.run_generalizability_supported !== true) generalizabilityReasons.push("the run carries no prospective calibration evidence");
  if (bundle?.contract_ceiling !== "GENERALIZABILITY_SUPPORTED") {
    generalizabilityReasons.push(`the contract's own claim-stage ceiling is ${bundle?.contract_ceiling ?? "PROFILE_BOUND"}, and a stage above the ceiling is not issuable`);
  }
  const generalizable = profileBound && generalizabilityReasons.length === 0;

  const stage = generalizable ? "GENERALIZABILITY_SUPPORTED" : profileBound ? "PROFILE_BOUND" : instrumentReady ? "INSTRUMENT_READY" : "EXPERIMENTAL";
  return deepFreeze({ stage, reasons: [...new Set([...reasons, ...profileReasons, ...generalizabilityReasons])] });
}

const standardSettingStatusOf = (contract) => {
  const permitted = registryPermitsCategory(contract);
  return permitted === true ? "REGISTERED" : permitted === false ? "REFUSED" : "NONE";
};

const digestableBody = (record) => {
  const { digest, ...body } = record;
  return body;
};

/**
 * The `aos-validity-evidence.v1` record for one evaluated run.
 *
 * Derived in full. `stage`, `decision` and `digest` are not parameters of this function and there
 * is no overload that accepts them: the only way to move the stage is to move the contract's
 * evidence or the run's facts, both of which are checked elsewhere by something that is not this
 * module.
 */
export function validityEvidenceRecord({ contract, evaluation } = {}) {
  const registry = evidenceRegistryOf(contract);
  const bundle = claimEvidenceBundle({ evaluation, contract });
  const { stage, reasons } = deriveClaimStage({ registry, bundle, contract });
  const body = {
    schema_id: VALIDITY_EVIDENCE_SCHEMA_ID,
    claim_id: OPERATOR_PROCESS_CLAIM_ID,
    intended_interpretation: INTENDED_INTERPRETATION[stage],
    intended_uses: [...PERMITTED_USES_BY_STAGE[stage]],
    forbidden_uses: Array.isArray(contract?.interpretation_use?.forbidden_uses) ? [...contract.interpretation_use.forbidden_uses] : [],
    evidence: registry,
    rebuttals: openRebuttalsOf(contract),
    stage,
    stage_reasons: reasons,
    // ALLOW is a statement about the operator claim, not about whether the program ran. Below
    // PROFILE_BOUND there is no operator to make a claim about, so the decision withholds.
    decision: stage === "PROFILE_BOUND" || stage === "GENERALIZABILITY_SUPPORTED" ? "ALLOW" : "WITHHOLD",
    standard_setting_status: standardSettingStatusOf(contract),
    generalizability_status: String(evaluation?.generalizability_status ?? "UNESTABLISHED"),
    uncertainty_status: String(evaluation?.uncertainty?.status ?? "UNESTABLISHED"),
    evidence_bundle: bundle
  };
  return deepFreeze({ ...body, digest: `sha256:${sha256Value(body)}` });
}

/**
 * Whether a record's digest is over the record's own content.
 *
 * This catches a record whose fields were edited after it was derived, and it does not catch a
 * forger who edits the content and recomputes the digest -- a digest binds bytes to bytes, never
 * bytes to the study behind them (#585's trust-root reasoning, which applies unchanged here). What
 * it does close is the case that actually happens: a stored artifact quietly disagreeing with
 * itself, and a projection reading the disagreement as a verdict.
 */
export function verifyValidityRecord(record) {
  if (!isPlainObject(record) || record.schema_id !== VALIDITY_EVIDENCE_SCHEMA_ID) return false;
  if (!DIGEST_SHAPE.test(String(record.digest ?? ""))) return false;
  return record.digest === `sha256:${sha256Value(JSON.parse(canonicalJson(digestableBody(record))))}`;
}

/**
 * The forbidden-use gate.
 *
 * Answers every request with a decision and, when it refuses, a reason code -- never with a
 * sentence in a document somebody may or may not read. An undeclared use is refused: a caller who
 * does not say what the number is for has not established that it is for something permitted, and
 * defaulting that to "allowed" is the same absence-as-value defect the registry exists to prevent.
 */
export function checkUse(use, record) {
  const normalised = normalisedUse(use);
  const stage = isPlainObject(record) ? String(record.stage) : "EXPERIMENTAL";
  const refuse = (reason_code, detail) => Object.freeze({ use: normalised, stage, permitted: false, reason_code, detail });
  if (normalised === null) {
    return refuse(USE_REFUSAL_REASONS.UNDECLARED, "no intended use was declared, and an undeclared use is refused rather than permitted by omission");
  }
  const contractForbidden = (Array.isArray(record?.forbidden_uses) ? record.forbidden_uses : []).map(normalisedUse);
  if (ALWAYS_FORBIDDEN_USES.includes(normalised) || contractForbidden.includes(normalised)) {
    return refuse(USE_REFUSAL_REASONS.FORBIDDEN, `${normalised} is a forbidden use of this instrument at every claim stage`);
  }
  if (STANDARD_SETTING_USES.includes(normalised) && record?.standard_setting_status !== "REGISTERED") {
    return refuse(USE_REFUSAL_REASONS.STANDARD_SETTING_REQUIRED, `${normalised} is a verdict about a person and needs a registered aos-standard-setting.v1 study; this contract's standard-setting status is ${record?.standard_setting_status ?? "NONE"}`);
  }
  if (COMPARATIVE_USES.includes(normalised) && record?.evidence?.fairness_invariance?.status !== "PASS") {
    return refuse(USE_REFUSAL_REASONS.INVARIANCE_UNESTABLISHED, `${normalised} compares profiles, and fairness/invariance evidence is ${record?.evidence?.fairness_invariance?.status ?? "UNESTABLISHED"}`);
  }
  const permitted = Array.isArray(record?.intended_uses) ? record.intended_uses.map(normalisedUse) : [];
  if (!permitted.includes(normalised)) {
    return refuse(USE_REFUSAL_REASONS.NOT_PERMITTED_AT_STAGE, `${stage} permits ${permitted.join(", ") || "no use"}, and ${normalised} is not among them`);
  }
  return Object.freeze({ use: normalised, stage, permitted: true, reason_code: null, detail: `${normalised} is a permitted use at ${stage}` });
}

/** The same gate, for a caller that would rather fail than branch. */
export function assertUsePermitted(use, record) {
  const decision = checkUse(use, record);
  if (!decision.permitted) throw new Error(`${decision.reason_code} ${decision.detail}`);
  return decision;
}

/**
 * The record as it is actually published, resealed over its published bytes.
 *
 * `lib/result-schema.mjs` puts every string on a result through a redaction gate before publishing
 * it, and that gate replaces anything that looks unpublishable with a digest of itself. It fires on
 * this record's contract-derived prose -- the rebuttal id `person-by-task-or-model-interaction`
 * contains `sk-` followed by sixteen characters, which is the shape of a provider secret -- so the
 * record a reader holds is not byte-identical to the record that was derived, and a digest taken
 * before redaction would be a digest of an artifact nobody has.
 *
 * The reseal is deliberately narrow, because "recompute the digest" is otherwise a laundering tool:
 * a forged record could be handed to it and come back self-consistent. The only difference this
 * accepts is a string the gate replaced with a digest. Every key, every array length, every
 * non-string value and every string the gate left alone must be identical, so a stage, a decision or
 * an evidence status that moved between derivation and publication is refused by name rather than
 * sealed over.
 */
export function publishValidityRecord(derived, published) {
  const redactedOnly = (left, right, path) => {
    if (typeof left === "string") {
      if (left === right) return;
      if (typeof right === "string" && DIGEST_SHAPE.test(right)) return;
      throw new Error(`AOS_VALIDITY_PUBLISH_ALTERED ${path} changed from ${JSON.stringify(left)} to ${JSON.stringify(right)} between derivation and publication, and that is not a redaction`);
    }
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || left.length !== right.length) {
        throw new Error(`AOS_VALIDITY_PUBLISH_ALTERED ${path} is an array of ${left.length} and was published as ${Array.isArray(right) ? `${right.length}` : typeof right}`);
      }
      left.forEach((entry, index) => redactedOnly(entry, right[index], `${path}[${index}]`));
      return;
    }
    if (isPlainObject(left)) {
      const leftKeys = Object.keys(left).sort();
      const rightKeys = isPlainObject(right) ? Object.keys(right).sort() : [];
      if (canonicalJson(leftKeys) !== canonicalJson(rightKeys)) {
        throw new Error(`AOS_VALIDITY_PUBLISH_ALTERED ${path} carried ${leftKeys.join(", ")} and was published carrying ${rightKeys.join(", ")}`);
      }
      for (const key of leftKeys) redactedOnly(left[key], right[key], `${path}.${key}`);
      return;
    }
    if (left !== right) throw new Error(`AOS_VALIDITY_PUBLISH_ALTERED ${path} changed from ${JSON.stringify(left)} to ${JSON.stringify(right)}`);
  };
  redactedOnly(digestableBody(derived), digestableBody(published), "validity_evidence");
  const body = digestableBody(published);
  return deepFreeze({ ...body, digest: `sha256:${sha256Value(body)}` });
}
