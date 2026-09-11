import { COMPOSITE_FORMULA, COMPOSITE_WEIGHTS, RELIANCE_FLOOR, RELIANCE_METRIC_IDS, RELIANCE_STATUSES, RESULT_SCHEMA_ID, RESULT_SCHEMA_VERSION, resultSchemaDigest } from "./result-schema.mjs";
import { ALWAYS_FORBIDDEN_USES, CLAIM_STAGES, EVIDENCE_CATEGORIES, EVIDENCE_STATUSES, GENERALIZABILITY_CATEGORIES, OPERATOR_PROCESS_CLAIM_ID, PERMITTED_USES_BY_STAGE, PROFILE_BOUND_CATEGORIES, VALIDITY_EVIDENCE_SCHEMA_ID } from "./claim-governance.mjs";
import { CALIBRATION_SCAFFOLD_SCHEMA_ID, D_STUDY_INTERFACE_SCHEMA_ID, FACET_RECORD_FIELDS, FACET_RECORD_SCHEMA_ID, G_STUDY_INTERFACE_SCHEMA_ID, HIERARCHICAL_ADAPTER_SCHEMA_ID, MFRM_INTERFACE_SCHEMA_ID, O4_SHORTCUT_DESCRIPTOR_SCHEMA_ID, O4_SHORTCUT_FIELDS, UNCERTAINTY_SCHEMA_ID } from "./facet-calibration.mjs";
import { CAPS, MINIMUM_OBSERVED, REQUIRED_METRICS, SCORER_ID, SCORER_VERSION } from "./scorer-v1.mjs";
import { CATEGORY_FIELDS, STANDARD_SETTING_FIELDS, STANDARD_SETTING_SCHEMA_ID } from "./standard-setting.mjs";
import { EQUIVALENCE_STATUSES, EXPOSURE_ENTRY_SCHEMA_ID_V2, EXPOSURE_LEDGER_SCHEMA_ID_V2, EXPOSURE_POLICIES, FORM_BANK_RECORD_SCHEMA_ID, FORM_CLASSES, FORM_CLASS_REGISTRY, FORM_LIFECYCLE_SCHEMA_ID, FORM_LINKING_SCHEMA_ID, LINKING_METHOD_REGISTRY } from "./form-class.mjs";
import { RELIANCE_CONFIDENCE_OBSERVATION_FLOOR, RELIANCE_OPPORTUNITY_FLOOR, relianceEventSchemaDigest, relianceOpportunityFloorDigest } from "./reliance.mjs";
import { formManifest, suiteManifest } from "./suite.mjs";
import { contractDigests, contractFileDigests } from "./ecd-contract.mjs";
import { fileByteDigest } from "./digest.mjs";
import { relayProtocolDigest } from "./relay.mjs";
import { sha256Value } from "./core.mjs";

// What a cycle froze, and what it takes to say two runs measured the same thing.
//
// The comparison this replaces was `run.suite_major !== cycle.suite_major` and the same line for the
// scorer: two integers, bumped by hand. Everything a major version is supposed to stand for --
// which cells exist, what the verifier accepts, how the composite is weighted, which uses the claim
// gate permits -- could change without either integer moving, and two runs marked by different
// rules aggregated into one median with nothing in the record to say so. A version is a promise
// about bytes; this module compares the bytes.
//
// Three properties are load-bearing and each is tested rather than asserted here:
//
//   Exact. One semantic byte of any normative source moves exactly one digest, and a moved digest
//   blocks the run from the cycle with a reason that names which contract moved.
//
//   Deterministic. The same source produces the same digest on another machine, in another
//   checkout path, at another time. Nothing below reads a timestamp, an absolute path, or an
//   mtime, and every object digest goes through `canonicalJson`, which sorts keys -- so a
//   re-serialisation that reorders them is not a change.
//
// What this is not, stated because the comparison reads like more than it is: it is not
// authentication. `cycle.json` is a plain file in the operator's own home and a run record is a
// field on it, so a hand-written cycle and a hand-written run that agree with each other pass every
// check below -- the run's digests are written by the run. What the comparison buys is that the two
// can no longer disagree by accident, which is the shape the failure actually takes: a rebuilt
// contract, a pulled branch, an edited cell, a scorer change nobody bumped a version for. Making
// the record testify against its own author needs a keyed digest or an attested writer, and this
// issue has no trust root to build one on. `exposureVerification` in lib/cycle.mjs draws the same
// line for the same reason.
//
//   Not the profile. `profile_digest` is deliberately machine-bound: it carries os, arch, node
//   version and the exact executable, because a number produced on a different runtime is a
//   different measurement. The determinism claim above is about the twelve measurement contracts,
//   which describe the instrument rather than the machine. Conflating the two would make either
//   "same source, same digest" false or the profile digest useless, and this paragraph exists
//   because an earlier draft of it claimed both.

export const CYCLE_SCHEMA_V3 = "aos-cycle.v3";

/**
 * The cycle schemas that came before, kept apart rather than upgraded.
 *
 * A v1 cycle stored `suite_major` and `scorer_major` and nothing else about the contract it ran
 * under. There is no honest way to derive the twelve digests from those two integers -- the bytes
 * that would have produced them are whatever the checkout said at the time, and that is not
 * recoverable from the record. So a v1 cycle is historical: it keeps its runs, it keeps its
 * aggregate, and it never claims a v3 contract it cannot evidence.
 */
export const LEGACY_CYCLE_SCHEMAS = Object.freeze(["aos-cycle.v1", "aos-cycle.v2"]);

/** Every reason a run can fail to belong to the cycle it names, in the order the contract lists them. */
export const CONTRACT_MISMATCH_REASONS = Object.freeze([
  "PROFILE_CHANGED",
  "CONSTRUCT_CONTRACT_CHANGED",
  "EVIDENCE_MODEL_CHANGED",
  "TASK_MODEL_CHANGED",
  "USE_ARGUMENT_CHANGED",
  "SUITE_CONTRACT_CHANGED",
  "FORM_CONTRACT_CHANGED",
  "SCORER_CHANGED",
  "RELIANCE_CONTRACT_CHANGED",
  "FACET_UNCERTAINTY_CHANGED",
  "VALIDATION_CLAIM_CHANGED",
  "RESULT_SCHEMA_CHANGED"
]);

/** The one reason an active cycle refuses to continue: its own contract moved underneath it. */
export const BLOCKED_CONTRACT_CHANGE = "BLOCKED_CONTRACT_CHANGE";

/**
 * Which stored field each mismatch reason is decided from.
 *
 * Fourteen fields, twelve reasons: two reasons cover two fields each, because the contract names
 * one concept the code keeps in two places. `SCORER_CHANGED` covers the observable cells and the
 * aggregation formula -- both are "how a run becomes a number", and a reader told only that one of
 * them moved learns nothing the other would not have told them. `FORM_CONTRACT_CHANGED` covers the
 * per-form contract and the form bank policy for the same reason.
 *
 * The list is the comparison. A field added here is compared from the next run; a field that is
 * only documented is compared by nobody.
 */
export const CONTRACT_DIGEST_FIELDS = Object.freeze([
  Object.freeze({ field: "profile_digest", reason: "PROFILE_CHANGED" }),
  Object.freeze({ field: "construct_contract_digest", reason: "CONSTRUCT_CONTRACT_CHANGED" }),
  Object.freeze({ field: "evidence_model_digest", reason: "EVIDENCE_MODEL_CHANGED" }),
  Object.freeze({ field: "task_model_digest", reason: "TASK_MODEL_CHANGED" }),
  Object.freeze({ field: "interpretation_use_digest", reason: "USE_ARGUMENT_CHANGED" }),
  Object.freeze({ field: "suite_contract_digest", reason: "SUITE_CONTRACT_CHANGED" }),
  Object.freeze({ field: "form_bank_contract_digest", reason: "FORM_CONTRACT_CHANGED" }),
  Object.freeze({ field: "observable_cell_contract_digest", reason: "SCORER_CHANGED" }),
  Object.freeze({ field: "profile_aggregation_digest", reason: "SCORER_CHANGED" }),
  Object.freeze({ field: "reliance_contract_digest", reason: "RELIANCE_CONTRACT_CHANGED" }),
  Object.freeze({ field: "facet_uncertainty_digest", reason: "FACET_UNCERTAINTY_CHANGED" }),
  Object.freeze({ field: "validation_claim_digest", reason: "VALIDATION_CLAIM_CHANGED" }),
  Object.freeze({ field: "standard_setting_status_digest", reason: "VALIDATION_CLAIM_CHANGED" }),
  Object.freeze({ field: "result_schema", reason: "RESULT_SCHEMA_CHANGED" })
]);

/**
 * The subset an active cycle is re-checked against: the contracts this build recomputes from source.
 *
 * Two fields of the fourteen are not in it, and leaving them in made every unchanged cycle read as
 * drifted.
 *
 *   `profile_digest` is the cohort key the operator bound when the cycle was started -- a fact
 *   about the machine and the model, which `measurementContract` does not compute and has no
 *   business recomputing. It is compared per run, where it means something: this run came from
 *   the environment the cycle was opened for.
 *
 *   `result_schema` is declared by the cycle, not derived from this build. A cycle of the legacy
 *   scorer's runs freezes `aos-mvp-result.v1` on purpose, and comparing that against whatever id
 *   this build happens to ship would call the declaration a drift. The schema's *bytes* are still
 *   watched -- `result_schema_digest` is in the contract and is recomputed -- so an edit to the
 *   schema file still blocks the cycle. What is not watched is the cycle having chosen a
 *   different lane from this build's default, because that was never a change.
 */
const RECOMPUTED_CONTRACT_FIELDS = Object.freeze(
  CONTRACT_DIGEST_FIELDS.filter(({ field }) => field !== "profile_digest" && field !== "result_schema")
);

const moduleUrl = (relative) => new URL(relative, import.meta.url);

// One spelling, everywhere. `sha256Value` returns bare hex and `fileByteDigest` returns
// `sha256:<hex>`; a contract that mixed them would compare equal values unequal, which is the bug
// `sameDigest` in lib/cycle.mjs was written to paper over. Normalised on the way in instead.
const prefixed = (value) => (typeof value === "string" && value.startsWith("sha256:") ? value : `sha256:${value}`);
const digestOf = (value) => prefixed(sha256Value(value));

/** Whether two digests are the same digest, whichever of the two spellings each was written in. */
export const sameContractDigest = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") return left === right;
  return left.replace(/^sha256:/u, "") === right.replace(/^sha256:/u, "");
};

// --- the twelve --------------------------------------------------------------------------------

// Each of these takes bytes, canonical values, or both, and never a version string on its own.
// Where an algorithm rather than a table decides the contract, the module's own bytes are in the
// digest: a rewritten claim-stage function changes what a stage means without touching any
// constant it reads, and `suiteManifest` already digests its graders this way for the same reason.

/**
 * The suite as a contract, with the seed taken out.
 *
 * `suiteManifest` mixes two things: what the suite is (families, graders, verifiers, metric
 * contract) and what this seed drew from it (the form manifest, the fixture digest, the seed). Only
 * the first belongs to the cycle -- a cycle fixes several seeds, and a per-seed digest here would
 * make every run after the first SUITE_CONTRACT_CHANGED. The second half is the per-form digest
 * below.
 */
export function suiteContractDigest() {
  const { form_manifest: _form, fixture_manifest_digest: _fixture, seed: _seed, suite_digest: _digest, ...contract } = suiteManifest("0");
  return digestOf({
    ...contract,
    // The three files that decide where work is routed, what an operator checkpoint is, and how a
    // reliance opportunity is generated. Named by the contract; digested by bytes, because each is
    // an algorithm and none of them carries a version an edit is obliged to bump.
    routing_oracle: fileByteDigest(moduleUrl("./routing-oracle.mjs")),
    operator_checkpoint: fileByteDigest(moduleUrl("./checkpoint.mjs")),
    reliance_opportunity_generator: relianceOpportunityFloorDigest(),
    relay_protocol: prefixed(relayProtocolDigest())
  });
}

/**
 * The contract for one locked operational form: exactly the digest the exposure ledger binds.
 *
 * `formManifest(seed).form_contract_digest` already covers everything the contract asks a per-form
 * digest to cover except one thing -- the suite the form was drawn from. Its body holds the seed
 * and form manifest, the task-tree digest, the oracle digest, the construct-opportunity cells and
 * count, the difficulty/facet features and their status, and the form class, exposure policy and
 * equivalence status.
 *
 * The issue's text folds the suite contract into this digest as well. It is kept out, and the
 * reason is not stylistic. A composite would be a *different value* from the one a run already
 * carries as `form_contract_digest` -- the value `reserveExposure` keys every administration by --
 * so the cycle would have needed the run to carry a second, near-identically named digest beside
 * it. Two fields one letter apart, one binding the ledger and one binding the cycle, is how the
 * next reader binds the wrong one.
 *
 * Nothing is lost by splitting them, because the cycle compares `suite_contract_digest` exactly and
 * separately. A suite change still blocks the run; it blocks it as SUITE_CONTRACT_CHANGED, which
 * says which half moved, where a composite would have said only that the form did.
 */
export function formContractDigestFor(seed) {
  return prefixed(formManifest(seed).form_contract_digest);
}

/** The observable cells: which cells exist, what values they take, which are required, and the minimum opportunities each needs. */
const observableCellContractDigest = () => digestOf({
  canonical: contractDigests().cells,
  bytes: contractFileDigests().cells
});

/**
 * How a run becomes a number.
 *
 * The C1–C6 and O1–O4 equal-weight formulae, the 50:50 composite, the coverage and withholding
 * rules, the rounding, and the cap trigger mapping. `result-schema.mjs` holds the formulae as code
 * and `scorer-v1.mjs` holds the caps and the observation floor, so both sets of bytes are here
 * beside the constants: changing `equalWeightIndex` to a weighted mean moves no constant in this
 * object, and it is the one change this digest most needs to catch.
 */
const profileAggregationDigest = () => digestOf({
  composite_formula: COMPOSITE_FORMULA,
  composite_weights: COMPOSITE_WEIGHTS,
  scorer_id: SCORER_ID,
  scorer_version: SCORER_VERSION,
  caps: CAPS,
  minimum_observed: MINIMUM_OBSERVED,
  required_metrics: [...REQUIRED_METRICS],
  aggregation_bytes: fileByteDigest(moduleUrl("./result-schema.mjs")),
  scorer_bytes: fileByteDigest(moduleUrl("./scorer-v1.mjs"))
});

/** The reliance contract: the initial-before-advice sequence, the CAIR/CSR definitions, and the operational floors. */
const relianceContractDigest = () => digestOf({
  event_schema: relianceEventSchemaDigest(),
  opportunity_floor: relianceOpportunityFloorDigest(),
  metric_ids: [...RELIANCE_METRIC_IDS],
  statuses: [...RELIANCE_STATUSES],
  result_floor: RELIANCE_FLOOR,
  opportunity_floor_value: RELIANCE_OPPORTUNITY_FLOOR,
  confidence_observation_floor: RELIANCE_CONFIDENCE_OBSERVATION_FLOOR,
  definition_bytes: fileByteDigest(moduleUrl("./reliance.mjs"))
});

/** The facet schema, the universe declaration, the uncertainty method and status, the G/D-study scaffold and the rater path. */
const facetUncertaintyDigest = () => digestOf({
  facet_record_schema: FACET_RECORD_SCHEMA_ID,
  facet_record_fields: [...FACET_RECORD_FIELDS],
  uncertainty_schema: UNCERTAINTY_SCHEMA_ID,
  calibration_scaffold_schema: CALIBRATION_SCAFFOLD_SCHEMA_ID,
  g_study_interface: G_STUDY_INTERFACE_SCHEMA_ID,
  d_study_interface: D_STUDY_INTERFACE_SCHEMA_ID,
  hierarchical_adapter: HIERARCHICAL_ADAPTER_SCHEMA_ID,
  mfrm_rater_interface: MFRM_INTERFACE_SCHEMA_ID,
  o4_shortcut_descriptor: O4_SHORTCUT_DESCRIPTOR_SCHEMA_ID,
  o4_shortcut_fields: [...O4_SHORTCUT_FIELDS],
  method_bytes: fileByteDigest(moduleUrl("./facet-calibration.mjs"))
});

/** The form bank: classification, exposure policy, scored-once, linking and equivalence, lifecycle. */
const formBankContractDigest = () => digestOf({
  form_bank_record_schema: FORM_BANK_RECORD_SCHEMA_ID,
  form_classes: [...FORM_CLASSES],
  exposure_policies: [...EXPOSURE_POLICIES],
  equivalence_statuses: [...EQUIVALENCE_STATUSES],
  form_class_registry: FORM_CLASS_REGISTRY,
  linking_method_registry: LINKING_METHOD_REGISTRY,
  linking_schema: FORM_LINKING_SCHEMA_ID,
  lifecycle_schema: FORM_LIFECYCLE_SCHEMA_ID,
  exposure_ledger_schema: EXPOSURE_LEDGER_SCHEMA_ID_V2,
  exposure_entry_schema: EXPOSURE_ENTRY_SCHEMA_ID_V2,
  policy_bytes: fileByteDigest(moduleUrl("./form-class.mjs"))
});

/** The validation evidence registry, the claim-stage algorithm and the forbidden-use gate. */
const validationClaimDigest = () => digestOf({
  validity_evidence_schema: VALIDITY_EVIDENCE_SCHEMA_ID,
  operator_process_claim: OPERATOR_PROCESS_CLAIM_ID,
  evidence_categories: [...EVIDENCE_CATEGORIES],
  evidence_statuses: [...EVIDENCE_STATUSES],
  claim_stages: [...CLAIM_STAGES],
  profile_bound_categories: [...PROFILE_BOUND_CATEGORIES],
  generalizability_categories: [...GENERALIZABILITY_CATEGORIES],
  permitted_uses_by_stage: PERMITTED_USES_BY_STAGE,
  always_forbidden_uses: [...ALWAYS_FORBIDDEN_USES],
  gate_bytes: fileByteDigest(moduleUrl("./claim-governance.mjs"))
});

/**
 * The standard-setting contract, which is the rules a status is decided by -- not a status.
 *
 * A cycle freezes what it would take to reach REGISTERED, because that is the part a run has to
 * have agreed with. Whether a particular record reached it is a fact about that record and lives on
 * the record. Freezing the value here would block a cycle the moment a study was registered, which
 * is the one direction this gate is supposed to allow.
 */
const standardSettingStatusDigest = () => digestOf({
  standard_setting_schema: STANDARD_SETTING_SCHEMA_ID,
  standard_setting_fields: [...STANDARD_SETTING_FIELDS],
  category_fields: [...CATEGORY_FIELDS],
  gate_bytes: fileByteDigest(moduleUrl("./standard-setting.mjs"))
});

// Computed once per process. Every one of these reads files and canonicalises trees, and
// `runValidity` is called per run in a loop; recomputing them per call made a twelve-run cycle read
// the contract tree twelve times to get the same answer. Nothing here depends on argument or state,
// so the cache cannot go stale within a process, and a process that edits its own contract files
// mid-run is not a case this product supports.
let contractCache = null;

/**
 * Every normative digest this build measures under, plus the result schema it writes.
 *
 * `result_schema` is read from `RESULT_SCHEMA_ID` rather than written here as a literal. The issue
 * text names `aos-result.v3`, and this build ships v4 -- a literal would have frozen every new
 * cycle against a schema no run produces, and every run would have been RESULT_SCHEMA_CHANGED
 * against its own cycle. Hardcoding a digest or a schema id is the failure the contract forbids in
 * the same breath, and it is the same failure whether the constant is invented or copied.
 */
export function measurementContract() {
  if (contractCache !== null) return contractCache;
  const canonical = contractDigests();
  const bytes = contractFileDigests();
  const pair = (key) => digestOf({ canonical: canonical[key], bytes: bytes[key] });
  contractCache = Object.freeze({
    construct_contract_digest: pair("construct_map"),
    evidence_model_digest: pair("evidence_model"),
    task_model_digest: pair("task_model"),
    interpretation_use_digest: pair("interpretation_use"),
    observable_cell_contract_digest: observableCellContractDigest(),
    suite_contract_digest: suiteContractDigest(),
    profile_aggregation_digest: profileAggregationDigest(),
    reliance_contract_digest: relianceContractDigest(),
    facet_uncertainty_digest: facetUncertaintyDigest(),
    form_bank_contract_digest: formBankContractDigest(),
    validation_claim_digest: validationClaimDigest(),
    standard_setting_status_digest: standardSettingStatusDigest(),
    result_schema: RESULT_SCHEMA_ID,
    result_schema_version: RESULT_SCHEMA_VERSION,
    result_schema_digest: resultSchemaDigest()
  });
  return contractCache;
}

/** Drops the memoised contract. For a test that edits a contract file and wants this build to notice. */
export const forgetMeasurementContract = () => { contractCache = null; };

// --- comparison --------------------------------------------------------------------------------

/**
 * Which contracts differ between what the cycle froze and what the run carried, by reason.
 *
 * A field the cycle froze and the run does not carry is a mismatch, not a pass. That direction is
 * the whole point: a run written by a build that does not compute a digest cannot be admitted to a
 * cycle that does, because there is nothing to compare and "nothing to compare" is exactly what an
 * absent field looks like. The legacy path is `isLegacyCycle`, which is a decision about the
 * cycle, made once, with a record -- not a per-field shrug.
 */
export function contractMismatches(frozen, carried, fields = CONTRACT_DIGEST_FIELDS) {
  const reasons = [];
  for (const { field, reason } of fields) {
    const expected = frozen?.[field] ?? null;
    if (expected === null) continue;
    if (!sameContractDigest(expected, carried?.[field] ?? null) && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

/** The per-form half of the same comparison, kept separate because a cycle holds one per form. */
export function formContractMismatch(frozen, carried, seed) {
  const expected = frozen?.form_contracts?.[seed] ?? null;
  if (expected === null) return null;
  return sameContractDigest(expected, carried?.form_contract_digest ?? null) ? null : "FORM_CONTRACT_CHANGED";
}

/** Whether this cycle predates the exact contract, and keeps its historical aggregate rather than claiming one. */
export const isLegacyCycle = (cycle) => LEGACY_CYCLE_SCHEMAS.includes(cycle?.schema_id ?? "");

/**
 * Whether an active cycle may be resumed under the contract this build now computes.
 *
 * Fail-closed, and loudly. The forbidden shape is the quiet one: continue the cycle, mark the runs
 * that no longer fit as `excluded`, and let the median close over whatever is left. That reads as a
 * complete cycle and is a cycle measured under two contracts. So a drifted cycle is blocked rather
 * than filtered -- the old forms, runs and evidence stay exactly where they are, no profile-bound
 * aggregate is issued from them, and the operator is told which contract moved and that the way
 * forward is a new cycle.
 *
 * The reason is not a defence against an operator who wants a restart: nothing here can tell a
 * contract change from a contract change made because the last cycle scored badly, and a check
 * that claimed to would be the name-reading kind. What it does is make the restart cost a new
 * cycle id with its own seeds and its own runs, so the abandoned one stays in the record and the
 * two cannot be read as one.
 */
export function activeCycleDrift(cycle, current = measurementContract()) {
  if (isLegacyCycle(cycle)) {
    return Object.freeze({
      blocked: false,
      legacy: true,
      reasons: Object.freeze([]),
      detail: `${cycle?.schema_id ?? "an unversioned cycle"} predates the exact contract; it stays historical and is never upgraded in place`
    });
  }
  const reasons = contractMismatches(cycle, current, RECOMPUTED_CONTRACT_FIELDS);
  if (reasons.length === 0) return Object.freeze({ blocked: false, legacy: false, reasons: Object.freeze([]), detail: null });
  return Object.freeze({
    blocked: true,
    legacy: false,
    code: BLOCKED_CONTRACT_CHANGE,
    reasons: Object.freeze([...reasons]),
    detail: `${BLOCKED_CONTRACT_CHANGE}: ${reasons.join(", ")}. This cycle's runs and evidence are preserved and no profile-bound aggregate is issued from them. Start a new cycle: aos cycle start --force --reason "<why>".`
  });
}

// --- what a reader is shown ---------------------------------------------------------------------

/**
 * The safe prefix of a digest: enough to recognise it by, never enough to retype it as a claim.
 *
 * Twelve characters of hex. Both spellings collapse first, so `sha256:abc…` and `abc…` shorten to
 * the same prefix rather than to two that differ by seven characters of label.
 */
export const digestPrefix = (value) => (typeof value === "string"
  ? `${value.replace(/^sha256:/u, "").slice(0, 12)}…`
  : "unrecorded");

/**
 * The contract rows for a cycle's status: the machine digest and the prefix, side by side.
 *
 * Both, because they answer different questions. The prefix is what a person compares across two
 * terminals; the full digest is what a script compares, and a status that printed only the prefix
 * would be a status whose output cannot be used as evidence. A cycle that froze no contract says so
 * per row rather than printing a blank, which reads identically to a digest of nothing.
 */
export function contractLines(cycle) {
  if (isLegacyCycle(cycle)) {
    return [`contract: ${cycle?.schema_id ?? "unversioned"} — historical, and never upgraded into ${CYCLE_SCHEMA_V3}`];
  }
  const row = (label, fields) => {
    const values = fields.map((field) => cycle?.[field] ?? null);
    if (values.every((value) => value === null)) return `  ${label}: unrecorded`;
    return `  ${label}: ${values.map(digestPrefix).join(" · ")}`;
  };
  const forms = Object.entries(cycle?.form_contracts ?? {});
  return [
    `contract: ${cycle?.schema_id ?? "unversioned"} · package ${cycle?.package_version ?? "unrecorded"}`,
    row("Profile", ["profile_digest"]),
    row("Construct/Evidence/Task/Use", ["construct_contract_digest", "evidence_model_digest", "task_model_digest", "interpretation_use_digest"]),
    row("Suite/Form", ["suite_contract_digest", "form_bank_contract_digest"]),
    row("Aggregation/Reliance", ["observable_cell_contract_digest", "profile_aggregation_digest", "reliance_contract_digest"]),
    row("Facet/Uncertainty", ["facet_uncertainty_digest"]),
    row("Validation/Claim", ["validation_claim_digest", "standard_setting_status_digest"]),
    `  Result schema: ${cycle?.result_schema ?? "unrecorded"} · ${digestPrefix(cycle?.result_schema_digest ?? null)}`,
    ...forms.map(([seed, digest]) => `  Form ${seed}: ${digestPrefix(digest)}`),
    ...(cycle?.runs ?? [])
      .filter((run) => Array.isArray(run.contract_mismatches) && run.contract_mismatches.length > 0)
      .map((run) => `  Mismatch ${run.seed}: ${run.contract_mismatches.join(", ")}`)
  ];
}

/** The machine-readable half of the same rows, for `--json` and for a script that compares them. */
export const contractRecordOf = (cycle) => Object.fromEntries(
  [...CONTRACT_DIGEST_FIELDS.map(({ field }) => field), "result_schema_digest", "package_version"]
    .map((field) => [field, cycle?.[field] ?? null])
);
