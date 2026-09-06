import { canonicalJson, sha256Value } from "./core.mjs";
import { allRequired, isEstablished } from "./decision.mjs";

// #584's facet record is deliberately an evidence record, rather than a label attached to a
// profile after it has been scored.  The issuing boundary gives one to every observed score unit;
// the evaluator below only accepts an elevated claim after it can re-derive the answer from those
// records and the contract digest that bound them.
export const FACET_RECORD_SCHEMA_ID = "aos-facet-record.v1";
export const UNCERTAINTY_SCHEMA_ID = "aos-uncertainty.v1";
export const CALIBRATION_SCAFFOLD_SCHEMA_ID = "aos-calibration-scaffold.v1";
export const G_STUDY_INTERFACE_SCHEMA_ID = "aos-g-study-interface.v1";
export const D_STUDY_INTERFACE_SCHEMA_ID = "aos-d-study-interface.v1";
export const HIERARCHICAL_ADAPTER_SCHEMA_ID = "aos-hierarchical-analysis-adapter.v1";
export const MFRM_INTERFACE_SCHEMA_ID = "aos-mfrm-rater-interface.v1";
export const O4_SHORTCUT_DESCRIPTOR_SCHEMA_ID = "aos-o4-shortcut-descriptor.v1";
export const O4_SHORTCUT_FIELDS = Object.freeze(["prompt_length", "token_length", "turn_count", "wall_clock", "tool_count", "agent_autonomy"]);

export const FACET_RECORD_FIELDS = Object.freeze([
  "operator_id_digest", "construct_cell_id", "task_form_id", "family_id", "task_domain",
  "difficulty_version", "model_profile_digest", "runtime_harness_digest", "occasion_id",
  "sequence_position", "verifier_id", "verifier_contract_digest", "language", "interface",
  "domain_familiarity"
]);

const digest = (value) => `sha256:${sha256Value(value)}`;
const nonEmpty = (value) => typeof value === "string" && value.length > 0;
const digestOrNull = (value) => nonEmpty(value) && /^sha256:[0-9a-f]{64}$/u.test(value) ? value : null;
const declared = (value) => value !== undefined && value !== null && value !== "";
const unique = (values) => [...new Set(values.filter(declared))].sort();

const observationFamily = (metricId, familyByMetric) => familyByMetric?.[metricId] ?? null;
const observationCells = (metricId, cellsByMetric) => unique(cellsByMetric?.[metricId] ?? []);

/**
 * Bind scored observations to the actual administration facts.  `operator_id_digest` is accepted
 * only in digest form: no raw person identity or private path has a route into a public record.
 */
export function bindFacetRecords(observations, {
  contract_digest: contractDigest,
  cells_by_metric: cellsByMetric = {},
  family_by_metric: familyByMetric = {},
  form_bindings: formBindings = {},
  operator_id_digest: operatorIdDigest = null,
  task_domain: taskDomain = "agent-operator-score",
  difficulty_version: difficultyVersion = null,
  model_profile_digest: modelProfileDigest = null,
  runtime_harness_digest: runtimeHarnessDigest = null,
  occasion_id: occasionId = null,
  sequence_position: sequencePosition = 1,
  language = null,
  interface: interfaceName = null,
  domain_familiarity: domainFamiliarity = "unknown"
} = {}) {
  if (!Array.isArray(observations)) throw new Error("AOS_FACET_OBSERVATIONS observations must be an array");
  if (!digestOrNull(contractDigest)) throw new Error("AOS_FACET_CONTRACT_DIGEST a facet record must name the contract digest it was produced under");
  if (operatorIdDigest !== null && !digestOrNull(operatorIdDigest)) {
    throw new Error("AOS_FACET_OPERATOR_DIGEST raw operator identity is not public facet evidence");
  }
  const runtimeDigest = digestOrNull(runtimeHarnessDigest) ?? digest({ runtime_harness: runtimeHarnessDigest });
  const modelDigest = digestOrNull(modelProfileDigest);
  return observations.map((observation) => {
    const familyId = observationFamily(observation.metric_id, familyByMetric);
    const binding = familyId === null ? null : formBindings[familyId] ?? null;
    const taskFormId = binding?.form_id ?? familyId;
    // The form binding is the exact administered form and therefore takes precedence over a
    // suite-wide fallback.  A suite revision can describe the machinery that ran, but cannot
    // identify which seeded task was administered.
    const version = digestOrNull(binding?.form_contract_digest) ?? digestOrNull(difficultyVersion) ?? null;
    const cellIds = observationCells(observation.metric_id, cellsByMetric);
    // A metric can contribute to more than one construct cell.  Keep the one-record-per-cell list
    // rather than pretending that a metric-wide row has one construct identity.  `facet_record`
    // is retained as the deterministic primary record for consumers that show one row.
    const records = cellIds.map((constructCellId) => Object.freeze({
      schema_id: FACET_RECORD_SCHEMA_ID,
      facet_contract_digest: contractDigest,
      operator_id_digest: operatorIdDigest,
      construct_cell_id: constructCellId,
      task_form_id: taskFormId,
      family_id: familyId,
      task_domain: taskDomain,
      difficulty_version: version,
      model_profile_digest: modelDigest,
      runtime_harness_digest: runtimeDigest,
      occasion_id: occasionId,
      sequence_position: Number.isInteger(sequencePosition) && sequencePosition > 0 ? sequencePosition : 1,
      verifier_id: observation.verifier_id ?? null,
      verifier_contract_digest: digest({ verifier_id: observation.verifier_id ?? null, contract_digest: contractDigest }),
      language,
      interface: interfaceName,
      domain_familiarity: domainFamiliarity
    }));
    return Object.freeze({
      ...observation,
      facet_record: records[0] ?? null,
      facet_records: Object.freeze(records)
    });
  });
}

const recordProblems = (record, contractDigest) => {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return ["facet-record-absent"];
  const problems = [];
  if (record.schema_id !== FACET_RECORD_SCHEMA_ID) problems.push("facet-record-schema");
  if (record.facet_contract_digest !== contractDigest) problems.push("facet-contract-mismatch");
  for (const field of FACET_RECORD_FIELDS) {
    if (!Object.hasOwn(record, field)) problems.push(`facet-field-missing:${field}`);
  }
  if (record.operator_id !== undefined || record.operator_path !== undefined) problems.push("raw-operator-identity");
  if (record.operator_id_digest !== null && !digestOrNull(record.operator_id_digest)) problems.push("operator-digest-invalid");
  for (const field of ["difficulty_version", "model_profile_digest", "runtime_harness_digest", "verifier_contract_digest"]) {
    if (record[field] === null && field === "difficulty_version") continue;
    if (!digestOrNull(record[field])) problems.push(`facet-digest-invalid:${field}`);
  }
  if (!nonEmpty(record.construct_cell_id) || !nonEmpty(record.task_form_id) || !nonEmpty(record.family_id)) problems.push("facet-score-unit-unidentified");
  if (!Number.isInteger(record.sequence_position) || record.sequence_position < 1) problems.push("facet-sequence-invalid");
  return problems;
};

const coverage = (records, field) => {
  const values = unique(records.map((record) => record[field]));
  return Object.freeze({ observed_levels: values, count: values.length, status: values.length > 0 ? "COVERED" : "MISSING" });
};

const span = (values) => {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length < 2 ? null : { minimum: Math.min(...numbers), maximum: Math.max(...numbers), range: Math.max(...numbers) - Math.min(...numbers) };
};

/**
 * These are descriptive O4 conditions, not score inputs.  Keeping the list in the measurement
 * interface makes their only legal destination explicit; `evaluate` separately refuses its
 * legacy source names if a caller tries to feed one to an operator-process cell.
 */
export function describeO4Shortcuts(values = {}) {
  return Object.freeze({
    schema_id: O4_SHORTCUT_DESCRIPTOR_SCHEMA_ID,
    axis: "O4_DESCRIPTIVE_OUTCOME",
    descriptors: Object.freeze(Object.fromEntries(O4_SHORTCUT_FIELDS.map((field) => [field,
      typeof values[field] === "number" && Number.isFinite(values[field]) ? values[field] : null
    ])))
  });
}

const scaffold = ({ calibration, hasSubjectiveRater }) => {
  const assumptions = Object.freeze([
    "Facet records bind each score unit to its issuing contract.",
    "Population estimates require prospective empirical calibration evidence.",
    "A local one-person run does not estimate a population variance component."
  ]);
  const population = calibration?.population;
  const prospective = population?.prospective_empirical === true && nonEmpty(population?.universe_declaration);
  const rater = calibration?.rater ?? null;
  const raterCalibrated = hasSubjectiveRater
    ? rater?.calibration_sample === true && rater?.severity_bias_misfit === true && rater?.agreement_adjudication === true && rater?.provenance === true
    : true;
  return Object.freeze({
    schema_id: CALIBRATION_SCAFFOLD_SCHEMA_ID,
    version: "1.0.0",
    analysis: Object.freeze({ schema_id: "aos-calibration-analysis.v1", assumptions, assumptions_digest: digest(assumptions), status: prospective ? "EMPIRICAL_INPUT_DECLARED" : "NOT_RUN" }),
    g_study: Object.freeze({ input_schema_id: G_STUDY_INTERFACE_SCHEMA_ID, output_schema_id: "aos-g-study-variance-output.v1", variance_components: prospective ? calibration?.variance_components ?? null : null }),
    d_study: Object.freeze({ recommendation_schema_id: D_STUDY_INTERFACE_SCHEMA_ID, recommendation: prospective ? calibration?.d_study_recommendation ?? null : null, operational_default_form_count: 6, operational_default_label: "operational default form count; not a psychometric minimum" }),
    hierarchical_adapter: Object.freeze({ schema_id: HIERARCHICAL_ADAPTER_SCHEMA_ID, status: prospective ? "INPUT_DECLARED" : "NOT_RUN" }),
    mfrm_rater: Object.freeze({ schema_id: MFRM_INTERFACE_SCHEMA_ID, required: hasSubjectiveRater, status: !hasSubjectiveRater ? "NOT_APPLICABLE" : raterCalibrated ? "CALIBRATED" : "INSUFFICIENT_DATA" }),
    population: Object.freeze({ universe_declaration: prospective ? population.universe_declaration : null, prospective_empirical: prospective })
  });
};

/**
 * Re-derive all #584 claims from the observation evidence.  Stored uncertainty, calibration, and
 * claim-stage text are intentionally not inputs.  A missing prerequisite therefore stays null all
 * the way to the public result instead of becoming a zero, a fake interval, or a stronger claim.
 */
export function deriveMeasurementClaims({ observations, cells = [], contract_cells: contractCells = [], contract_digest: contractDigest, calibration = null, require_facet_records: requireFacetRecords = false } = {}) {
  if (!Array.isArray(observations)) throw new Error("AOS_FACET_OBSERVATIONS observations must be an array");
  const scored = observations.filter((observation) => observation?.value !== null && observation?.value !== undefined);
  const records = scored.flatMap((observation) => Array.isArray(observation.facet_records)
    ? observation.facet_records
    : observation.facet_record === null || observation.facet_record === undefined ? [] : [observation.facet_record]);
  const problems = records.flatMap((record) => recordProblems(record, contractDigest));
  if (scored.length > 0 && records.length === 0) problems.push("facet-record-absent");
  const facetDecision = scored.length === 0 ? null : problems.length === 0 ? true : false;
  const hasSubjectiveRater = records.some((record) => record?.verifier_id === "llm" || record?.verifier_id === "llm-grader");
  const calibrationScaffold = scaffold({ calibration, hasSubjectiveRater });
  const cellDeclarations = Array.isArray(contractCells) && contractCells.length > 0 ? contractCells : cells;
  const requiredCells = unique(cellDeclarations.filter((cell) => cell.required_for_construct === true).map((cell) => cell.cell_id));
  const optionalCells = unique(cellDeclarations.filter((cell) => cell.required_for_construct === false).map((cell) => cell.cell_id));
  // Result rows carry only the evaluated cells, so callers that give the raw contract mark them
  // with `required_for_construct`; an evaluated row still contributes honest missing evidence.
  const missingCells = unique(cells.filter((cell) => cell.status !== "ISSUED").map((cell) => cell.cell_id));
  const cellRequired = requiredCells.length > 0 ? requiredCells : unique(cells.map((cell) => cell.cell_id));
  const universeDecision = calibrationScaffold.population.prospective_empirical ? true : null;
  const raterDecision = calibrationScaffold.mfrm_rater.status === "CALIBRATED" || calibrationScaffold.mfrm_rater.status === "NOT_APPLICABLE" ? true : null;
  const registeredMethod = nonEmpty(calibration?.method) && nonEmpty(calibration?.method_version) ? true : null;
  const intervalEvidence = Array.isArray(calibration?.interval) && calibration.interval.length === 2 && calibration.interval.every((value) => typeof value === "number" && Number.isFinite(value)) ? true : null;
  const varianceEvidence = calibration?.variance_components !== null && typeof calibration?.variance_components === "object" ? true : null;
  const uncertaintyDecision = allRequired([facetDecision, universeDecision, raterDecision, registeredMethod, intervalEvidence, varianceEvidence]);
  const generalizabilityDecision = allRequired([facetDecision, universeDecision, raterDecision]);
  const uncertaintyStatus = isEstablished(uncertaintyDecision) ? "COMPUTED" : "INSUFFICIENT_DATA";
  const interval = isEstablished(uncertaintyDecision) && Array.isArray(calibration?.interval) && calibration.interval.length === 2
    ? [...calibration.interval]
    : null;
  const uncertainty = Object.freeze({
    schema_id: UNCERTAINTY_SCHEMA_ID,
    status: uncertaintyStatus,
    method: isEstablished(uncertaintyDecision) ? calibration?.method ?? null : null,
    method_version: isEstablished(uncertaintyDecision) ? calibration?.method_version ?? null : null,
    observed_opportunity_count: scored.reduce((count, observation) => count + (observation.subchecks ?? []).filter((subcheck) => subcheck.pass !== null).length, 0),
    form_count: coverage(records, "task_form_id").count,
    task_count: unique(scored.map((observation) => observation.metric_id)).length,
    occasion_count: coverage(records, "occasion_id").count,
    required_cells: cellRequired,
    optional_cells: optionalCells,
    missing_cells: missingCells,
    within_cycle_spread: span(scored.map((observation) => observation.value)),
    interval,
    assumptions: calibrationScaffold.analysis.assumptions,
    assumptions_digest: calibrationScaffold.analysis.assumptions_digest
  });
  const facetCoverage = Object.freeze({
    schema_id: "aos-facet-coverage.v1",
    profile_binding_decision: requireFacetRecords || records.length > 0 ? facetDecision : null,
    opportunity_count: uncertainty.observed_opportunity_count,
    forms: coverage(records, "task_form_id"),
    tasks: coverage(records, "construct_cell_id"),
    occasions: coverage(records, "occasion_id"),
    form: coverage(records, "task_form_id"),
    model: coverage(records, "model_profile_digest"),
    runtime: coverage(records, "runtime_harness_digest"),
    verifier: coverage(records, "verifier_id"),
    language: coverage(records, "language"),
    interface: coverage(records, "interface"),
    required_cells: cellRequired,
    optional_cells: optionalCells,
    missing_cells: missingCells,
    within_cycle_spread: uncertainty.within_cycle_spread,
    problems: Object.freeze(unique(problems))
  });
  return Object.freeze({
    facet_decision: facetDecision,
    generalizability_decision: generalizabilityDecision,
    facet_coverage: facetCoverage,
    uncertainty,
    calibration: calibrationScaffold,
    generalizability: Object.freeze({ universe_declaration: calibrationScaffold.population.universe_declaration, status: isEstablished(generalizabilityDecision) ? "ESTABLISHED" : "UNESTABLISHED" })
  });
}
