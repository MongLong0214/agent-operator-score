import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";
import { loadSchema, validateAgainstSchema } from "./execution-plan.mjs";
import { METRICS, METRIC_IDS, observationOf, validateObservations } from "./metrics.mjs";

// What AOS says it is measuring, and the checks that stop it from saying more than it observed.
//
// A metric title is not a construct. `lib/metrics.mjs` names twenty metrics and eighty subchecks,
// and until this file existed nothing said which of them stood for what, who was entitled to say the
// thing had happened, or what else could have produced the observation. A rubric answers "how many
// passed". An evidence model has to answer "of what, on whose authority, and what else would look
// like this" -- and it has to answer for every subcheck, or the ones it skipped are the ones that
// quietly carry the number.
//
// So the contract lives as five versioned JSON artifacts beside this module, and this file is what
// refuses to let them and the code disagree. The load-bearing part is `checkEcdContract`: a subcheck
// mapped twice, mapped nowhere, or claimed by a cell that names a subcheck the product does not have
// is a contract failure, not a warning. Nine other issues read this mapping; a mapping nobody
// verifies is a mapping that drifts the first time a subcheck is renamed.
//
// Two rules here will look severe and are deliberate. A cell whose only authority is the agent
// saying what it did earns no credit -- it is reported and it is not averaged into anything. And a
// cell scored from a file the agent wrote is not operator process, because a better model changes it
// and the first counterfactual this contract has to survive is that a stronger model must not move
// an operator's process cell.

export const ECD_CONTRACT_ID = "aos-ecd-contract.v1";
export const ECD_CONTRACT_VERSION = "1.0.0";

export const AXES = Object.freeze(["operator_process", "reliance_calibration", "system_outcome", "delegated_artifact"]);
export const CLAIM_STAGES = Object.freeze(["RUN_DIAGNOSTIC", "PROFILE_BOUND", "GENERALIZABILITY_SUPPORTED"]);

/**
 * The three ways a cell can have no number, and the one way it can have one.
 *
 * None of them is zero. `lib/metrics.mjs` already learned this at the metric level -- every place
 * that treats an absence as a nought turns "we did not look" into "they failed" -- and an estimate
 * assembled from cells has the same hole one layer up.
 */
export const CELL_STATUSES = Object.freeze(["ISSUED", "NOT_OBSERVED", "INSUFFICIENT_OPPORTUNITIES", "WITHHELD"]);

const ARTIFACTS = Object.freeze({
  cells: { file: "aos-observable-cells.v1.json", schema: "aos-observable-cell.v1.schema.json" },
  construct_map: { file: "aos-construct-map.v1.json", schema: "aos-construct-map.v1.schema.json" },
  evidence_model: { file: "aos-evidence-model.v1.json", schema: "aos-evidence-model.v1.schema.json" },
  task_model: { file: "aos-task-model.v1.json", schema: "aos-task-model.v1.schema.json" },
  interpretation_use: { file: "aos-interpretation-use-argument.v1.json", schema: "aos-interpretation-use-argument.v1.schema.json" }
});

export const ARTIFACT_KEYS = Object.freeze(Object.keys(ARTIFACTS));

const contractUrl = (file) => new URL(`../contracts/${file}`, import.meta.url);
const schemaUrl = (file) => new URL(`../contracts/schemas/${file}`, import.meta.url);

/**
 * Every artifact, parsed, exactly as it ships.
 *
 * No parameter. The comment that stood here promised a directory argument the signature never had,
 * which is worse than no comment: a consumer reads it and builds a call that cannot exist. A test
 * that needs a broken contract mutates the parsed object and hands it to `checkEcdContract`, which
 * is what every negative test in this suite does.
 *
 * What comes back is unchecked. Nothing may be scored from it until `sealEcdContract` has said so.
 */
export function loadEcdContract() {
  const loaded = {};
  for (const [key, entry] of Object.entries(ARTIFACTS)) {
    loaded[key] = JSON.parse(readFileSync(contractUrl(entry.file), "utf8"));
  }
  return loaded;
}

export const loadEcdSchema = (key) => loadSchema(schemaUrl(ARTIFACTS[key].schema));

/**
 * The digests #559 quotes.
 *
 * Over the canonical form, so reordering keys cannot move them and changing a rival explanation
 * can. A result that cites a digest cites the exact contract it was scored under; a result that
 * cites the contract by name cites whatever the file happens to say today.
 */
/**
 * The digest of each contract file as it is on disk, over its bytes.
 *
 * `contractDigests` is over the canonical form, which is what makes it stable against key order --
 * and what makes it blind to the file itself: appending a space to `aos-construct-map.v1.json`
 * moves the file's byte digest and leaves the canonical one where it was. A published result names
 * the contract that scored it, so it has to be able to say that this build's contract *files* are
 * the ones that produced it. The two answer different questions and a result carries both.
 *
 * No argument: bytes belong to files, and a contract assembled in memory has none. A result built
 * under a contract that is not the shipped one carries null here rather than the digests of files
 * it was not built from.
 */
export function contractFileDigests() {
  const per = {};
  for (const key of ARTIFACT_KEYS) {
    per[key] = `sha256:${createHash("sha256").update(readFileSync(contractUrl(ARTIFACTS[key].file))).digest("hex")}`;
  }
  return { ...per, combined: `sha256:${createHash("sha256").update(canonicalJson(per)).digest("hex")}` };
}

export function contractDigests(contract = loadEcdContract()) {
  const per = {};
  for (const key of ARTIFACT_KEYS) {
    per[key] = `sha256:${createHash("sha256").update(canonicalJson(contract[key])).digest("hex")}`;
  }
  return { ...per, combined: `sha256:${createHash("sha256").update(canonicalJson(per)).digest("hex")}` };
}

// --- the seal ------------------------------------------------------------------------------------

// Nothing past this point will compute an estimate from a contract nobody checked.
//
// The first draft of this module exported the aggregation steps raw, and that made every rule in
// `checkEcdContract` advisory to anyone who did not happen to call it. A consumer could hand
// `estimateCell` a cell it had invented -- `credit_bearing: true`, its own minimum, an authority the
// evidence model never defined -- and get back a number shaped exactly like one this instrument had
// issued. The rule that an agent's account of its own behaviour earns no credit is the reason this
// contract exists, and it was enforced only against callers who opted in.
//
// So the seal is a value rather than a convention. `sealEcdContract` runs the verifier, deep-freezes
// the artifacts and brands them with their own combined digest, and the scoring functions accept
// nothing else. Each stage brands what it returns with that same digest, so the rows that reach
// `processIndex` are rows `constructEstimates` produced from that contract -- not rows a caller
// assembled. The index is documented as withheld by construction, and through the raw export it
// was not: six hand-written rows issued 0.75.
//
// Four issues consume this module. A boundary that is only documented is a boundary each of them
// would have had to rebuild, and the first one to get it slightly wrong would be the one that
// published a number.

// Identity, not a property. The first version branded objects with a Symbol-keyed field and froze
// them, and both halves were forgeable: a caller can mint its own Symbol and define the same-named
// property, and a Proxy around an object this module never made answers every property read the
// check performs while substituting whatever it likes underneath. A review did exactly that and got
// a below-minimum cell to issue a value, which is a release-contract invariant rather than a nicety.
//
// A WeakMap cannot be answered by a lookalike. Membership is the object itself, so a forged brand
// has nothing to forge and a Proxy is a different object from the one that was registered.
const sealedContracts = new WeakMap();
const derivedFrom = new WeakMap();
// Not a set. A result has to be able to say which contract scored it, or the policy applied to it
// is whichever one the caller happened to pass in.
const emittedResults = new WeakMap();

const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
};

/**
 * A contract that has passed `checkEcdContract`, frozen and branded. Idempotent.
 *
 * The copy is deliberate. Sealing the caller's own object would leave them holding a reference into
 * frozen state they did not ask to freeze, and -- worse in the other direction -- a contract that
 * was checked and then mutated through the caller's reference would still carry the brand. What is
 * sealed is a snapshot nobody else has a handle on.
 */
export function sealEcdContract(contract = loadEcdContract()) {
  if (sealedContracts.has(contract)) return contract;
  const report = checkEcdContract(contract);
  if (!report.ok) {
    const error = new Error(`AOS_CONTRACT_INVALID ${report.failures.length} check${report.failures.length === 1 ? "" : "s"} failed: ${[...new Set(report.failures.map((entry) => entry.check))].join(", ")}`);
    error.failures = report.failures;
    throw error;
  }
  const sealed = deepFreeze(structuredClone(contract));
  sealedContracts.set(sealed, contractDigests(sealed).combined);
  return sealed;
}

/** The shipped contract, checked once. Every scoring function defaults to it. */
let shippedSeal = null;
export const shippedEcdContract = () => (shippedSeal ??= sealEcdContract(loadEcdContract()));

const sealedOrThrow = (contract, caller) => {
  const digest = sealedContracts.get(contract);
  if (digest === undefined) throw new Error(`AOS_UNVERIFIED_CONTRACT ${caller} requires a contract from sealEcdContract; an unchecked contract may not produce an estimate`);
  return digest;
};

// Frozen as well as registered. The freeze stops the rows being edited in place between the stage
// that produced them and the stage that consumes them; the registration stops a replacement being
// handed over in their place.
const brand = (rows, kind, digest) => {
  const frozen = deepFreeze(rows);
  derivedFrom.set(frozen, `${kind}:${digest}`);
  return frozen;
};

const derivedOrThrow = (rows, kind, digest, caller) => {
  if (derivedFrom.get(rows) === `${kind}:${digest}`) return rows;
  throw new Error(`AOS_UNDERIVED_INPUT ${caller} requires ${kind} derived from this sealed contract, not a caller-assembled array`);
};

/** `M01.required-outcome-preserved` -- the metric alone is not an identity. Two metrics carry a
 * subcheck called `failure-class-correct` and two carry `invocation-budget-respected`, so a mapping
 * keyed on the bare subcheck name would silently merge four different questions into two. */
export const subcheckId = (metricId, subcheck) => `${metricId}.${subcheck}`;

export const declaredSubcheckIds = () =>
  METRIC_IDS.flatMap((id) => METRICS[id].subchecks.map((subcheck) => subcheckId(id, subcheck)));

/** The flat mapping table. This is the thing the dependent issues consume. */
export function subcheckMapping(contract = shippedEcdContract()) {
  sealedOrThrow(contract, "subcheckMapping");
  const rows = [];
  for (const cell of contract.cells.cells) {
    for (const id of cell.subcheck_ids) {
      const [metricId, ...rest] = id.split(".");
      rows.push({
        subcheck_id: id,
        metric_id: metricId,
        subcheck: rest.join("."),
        cell_id: cell.cell_id,
        construct_id: cell.construct_id,
        axis: cell.axis,
        authority: cell.authority,
        scoring_rule_id: cell.scoring_rule_id,
        credit_bearing: cell.credit_bearing,
        // The form that administers this subcheck, not the forms that touch its cell. #564 had to
        // reach past a whole-cell form list to recover this, and the list was wrong for one cell.
        form_id: cell.subcheck_administered_by.find((entry) => entry.subcheck_id === id)?.form_id ?? null
      });
    }
  }
  return rows.sort((a, b) => a.subcheck_id.localeCompare(b.subcheck_id));
}

// --- the verifier ------------------------------------------------------------------------------

// A verdict is an object or it is not a verdict: a string, an array or a number handed in where a
// boundary belongs is a caller who established nothing, and is read as nothing.
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const indexBy = (list, key) => new Map(list.map((entry) => [entry[key], entry]));

/**
 * Ability categories this contract may never contain, as words.
 *
 * The old scorer emits these and its results are rendered as historical; nothing produced from this
 * contract may acquire one. This is a text scan and it is deliberately not the whole guard -- the
 * structural half is that `category`, `cut_scores`, `percentile` and `rank` are typed null in the
 * schema and emitted null by `evaluate`. Words alone could not carry it: the artifacts have to be
 * able to say the word "percentile" in order to say they do not issue one, and `OPERATIONAL` is a
 * form class in the task model as well as a band in the old scorer. So the words listed here are the
 * ones that can only ever be a verdict about a person.
 */
const BAND_VOCABULARY = ["HIGH RELIABILITY", "ADVANCED", "DEVELOPING", "FRAGILE", "ROBUST", "STRONG"];

/**
 * Everything that can be answered from the artifacts and from `lib/metrics.mjs` alone.
 *
 * Returns the whole list rather than throwing on the first problem, for the same reason
 * `checkPlan` does: a contract with four faults should not look like a contract with one fault,
 * four times.
 */
export function checkEcdContract(contract = loadEcdContract()) {
  const failures = [];
  const fail = (check, detail, subject = null) => failures.push({ check, detail, subject });

  for (const key of ARTIFACT_KEYS) {
    const report = validateAgainstSchema(contract[key], loadEcdSchema(key));
    for (const error of report.errors) fail("schema-invalid", `${key} ${error.path}: ${error.message}`, key);
  }
  // Nothing below can be trusted to be shaped the way it reads if the shape itself is wrong.
  if (failures.length > 0) return { ok: false, failures };

  // The schemas ask for a semantic version, not for *this* one, so four artifacts at 1.0.0 and one
  // at 9.9.9 verified -- and every result then quoted the module's hard-coded version, describing a
  // mixed contract as a coherent one. The digests would have moved; nothing read them. A contract
  // this module will score from is a contract this module's version was written for.
  for (const key of ARTIFACT_KEYS) {
    if (contract[key].contract_version !== ECD_CONTRACT_VERSION) {
      fail("artifact-version-mismatch", `${key} declares contract_version ${contract[key].contract_version} and this module issues ${ECD_CONTRACT_VERSION}`, key);
    }
  }

  const cells = contract.cells.cells;
  const evidence = contract.evidence_model;
  const map = contract.construct_map;
  const tasks = contract.task_model;
  const use = contract.interpretation_use;

  const authorities = indexBy(evidence.authorities, "authority_id");
  const axes = indexBy(evidence.axes, "axis_id");
  const rules = indexBy(evidence.scoring_rules, "scoring_rule_id");
  const facetIds = new Set(evidence.facets.map((entry) => entry.facet_id));
  const shortcutIds = new Set(evidence.prohibited_value_sources.map((entry) => entry.id));
  const basisIds = new Set(evidence.minimum_opportunity_bases.map((entry) => entry.basis_id));
  const sourceClauses = indexBy(evidence.minimum_opportunity_source_clauses, "clause_id");

  // Which family produces which metric, declared once and used everywhere below. `lib/observe.mjs`
  // attributes each of the twenty metrics to exactly one family; the contract has to say the same
  // thing, or subcheck-to-form ownership is a guess. It was one: C5.TC.01 claimed FAM-4 as well as
  // FAM-5 because FAM-4 writes the resume artifact M17 reads, and FAM-4's opportunity count then
  // included a subcheck FAM-4 never administers.
  const formOfMetric = new Map();
  for (const form of tasks.forms) {
    for (const metricId of form.administered_metric_ids) {
      if (!METRIC_IDS.includes(metricId)) fail("form-metric-unknown", `${form.form_id} administers ${metricId}, which is not a metric in this product`, form.form_id);
      else if (formOfMetric.has(metricId)) fail("form-metric-double-administered", `${metricId} is administered by ${formOfMetric.get(metricId)} and by ${form.form_id}`, metricId);
      else formOfMetric.set(metricId, form.form_id);
    }
  }
  for (const metricId of METRIC_IDS) {
    if (!formOfMetric.has(metricId)) fail("form-metric-unadministered", `${metricId} is administered by no form, so its subchecks belong to no opportunity`, metricId);
  }

  const byCellId = new Map();
  for (const cell of cells) {
    if (byCellId.has(cell.cell_id)) fail("cell-id-duplicate", `${cell.cell_id} is declared more than once`, cell.cell_id);
    else byCellId.set(cell.cell_id, cell);
  }

  // --- each cell says its piece, and each of them resolves -------------------------------
  for (const cell of cells) {
    const authority = authorities.get(cell.authority);
    if (!authority) {
      // The evidence model calls this contract-invalid rather than a missing field: a cell whose
      // authority nobody defined is a cell whose observation nobody is entitled to report.
      fail("cell-authority-unknown", `${cell.cell_id} names authority ${cell.authority}, which the evidence model does not define`, cell.cell_id);
    } else {
      if (!authority.admissible_axes.includes(cell.axis)) {
        fail("axis-authority-inadmissible", `${cell.cell_id} is on ${cell.axis}, which ${cell.authority} is not admissible for`, cell.cell_id);
      }
      // Self-report alone earns no outcome, safety or reliance credit. It is not deleted -- an
      // agent's own account of what it did is worth reporting -- it is refused a vote.
      if (authority.self_report_only === true) {
        if (cell.credit_bearing !== false) {
          fail("self-report-credit", `${cell.cell_id} rests on ${cell.authority} alone and still claims credit`, cell.cell_id);
        }
        if (cell.required_for_construct !== false) {
          fail("self-report-required", `${cell.cell_id} rests on ${cell.authority} alone and is still required for ${cell.construct_id}`, cell.cell_id);
        }
      }
    }

    const axis = axes.get(cell.axis);
    if (!axis) fail("cell-axis-unknown", `${cell.cell_id} is on axis ${cell.axis}, which the evidence model does not define`, cell.cell_id);
    else if (!axis.admissible_authorities.includes(cell.authority)) {
      fail("axis-authority-inadmissible", `${cell.axis} does not admit ${cell.authority}, claimed by ${cell.cell_id}`, cell.cell_id);
    }

    const rule = rules.get(cell.scoring_rule_id);
    if (!rule) fail("cell-scoring-rule-unknown", `${cell.cell_id} names scoring rule ${cell.scoring_rule_id}, which is not declared`, cell.cell_id);
    else if (cell.population_status === "SUBCHECK_BACKED" && rule.implemented !== true) {
      fail("scoring-rule-unimplemented", `${cell.cell_id} is scored but ${cell.scoring_rule_id} is declared unimplemented`, cell.cell_id);
    }

    if (!basisIds.has(cell.minimum_opportunities_basis)) {
      fail("minimum-basis-unknown", `${cell.cell_id} names basis ${cell.minimum_opportunities_basis}`, cell.cell_id);
    }
    // The three bases mean three different things and each one constrains the number. An
    // unestablished minimum is null rather than a plausible integer, because a plausible integer is
    // indistinguishable from a measured one once it is in the file.
    if (cell.minimum_opportunities_basis === "DECLARED_COVERAGE" && cell.minimum_opportunities !== cell.subcheck_ids.length) {
      fail("minimum-basis-mismatch", `${cell.cell_id} claims declared coverage but its minimum is ${cell.minimum_opportunities} over ${cell.subcheck_ids.length} declared opportunities`, cell.cell_id);
    }
    if (cell.minimum_opportunities_basis === "UNESTABLISHED" && cell.minimum_opportunities !== null) {
      fail("minimum-basis-mismatch", `${cell.cell_id} has no established basis but names a minimum of ${cell.minimum_opportunities}`, cell.cell_id);
    }
    if (cell.minimum_opportunities_basis === "CONTRACT_SPECIFIED" && !Number.isInteger(cell.minimum_opportunities)) {
      fail("minimum-basis-mismatch", `${cell.cell_id} is contract-specified and must name an integer minimum`, cell.cell_id);
    }
    // CONTRACT_SPECIFIED means a person decided the number, and until now the verifier asked only
    // that the number be an integer: C3.RA.01's minimum of four could have read ninety-nine and the
    // contract still passed. A design decision with nothing behind it is indistinguishable from a
    // measured one once it is in the file, which is the whole reason UNESTABLISHED exists one line
    // up. So the decision has to name the clause that made it, and the clause has to carry the same
    // number -- moving the minimum without moving the clause is now a contract failure rather than
    // an edit nobody can see.
    if (cell.minimum_opportunities_basis === "CONTRACT_SPECIFIED") {
      const clause = sourceClauses.get(cell.minimum_opportunities_source);
      if (!clause) {
        fail("minimum-source-unknown", `${cell.cell_id} fixes a minimum of ${cell.minimum_opportunities} and names source clause ${cell.minimum_opportunities_source}, which the evidence model does not declare`, cell.cell_id);
      } else if (clause.value !== cell.minimum_opportunities) {
        fail("minimum-source-mismatch", `${cell.cell_id} claims a minimum of ${cell.minimum_opportunities} from ${clause.clause_id}, which fixes ${clause.value}`, cell.cell_id);
      }
    } else if (cell.minimum_opportunities_source !== null) {
      fail("minimum-source-unexpected", `${cell.cell_id} is ${cell.minimum_opportunities_basis} and still names a source clause`, cell.cell_id);
    }

    // A claim wider than its authority can observe is a claim the cell cannot make. C5.VD.01 rests
    // on the operator's plan, digested before the run; a plan cannot witness the operator later
    // refusing an unsupported completion. C6.OG.01's cannot witness a permission widened mid-run.
    // The unobservable half is named in the file, and a cell that names one may not be scored --
    // scoring a partly observable claim as a whole one is the cell reporting something nobody saw.
    if (cell.deferred_claim !== null && cell.population_status !== "DECLARED_UNPOPULATED") {
      fail("deferred-claim-scored", `${cell.cell_id} defers part of its claim to an authority it does not hold and is still scored`, cell.cell_id);
    }

    const backed = cell.population_status === "SUBCHECK_BACKED";
    if (backed !== (cell.subcheck_ids.length > 0)) {
      fail("population-mismatch", `${cell.cell_id} is ${cell.population_status} with ${cell.subcheck_ids.length} subchecks`, cell.cell_id);
    }
    if (backed !== (cell.task_opportunity.form_ids.length > 0)) {
      fail("population-mismatch", `${cell.cell_id} is ${cell.population_status} with ${cell.task_opportunity.form_ids.length} forms`, cell.cell_id);
    }

    // Ownership sits on the subcheck. A cell can hold subchecks two families produce -- C6.SL.01
    // holds two of M06's from FAM-2 and one of M19's from FAM-6 -- so a form list on the cell says
    // "one of these forms" where the counts need "this one".
    const administeredBy = new Map(cell.subcheck_administered_by.map((entry) => [entry.subcheck_id, entry.form_id]));
    if (administeredBy.size !== cell.subcheck_administered_by.length ||
        canonicalJson([...administeredBy.keys()].sort()) !== canonicalJson([...cell.subcheck_ids].sort())) {
      fail("subcheck-administration-mismatch", `${cell.cell_id} owns ${cell.subcheck_ids.length} subchecks and says who administers ${administeredBy.size} of them`, cell.cell_id);
    }
    for (const [id, formId] of administeredBy) {
      const administering = formOfMetric.get(id.split(".")[0]);
      if (administering !== undefined && administering !== formId) {
        fail("subcheck-administration-wrong-form", `${cell.cell_id} says ${formId} administers ${id}, which ${administering} administers`, cell.cell_id);
      }
    }
    const administeringForms = [...new Set(administeredBy.values())].sort();
    if (canonicalJson([...cell.task_opportunity.form_ids].sort()) !== canonicalJson(administeringForms)) {
      fail("cell-form-not-administering", `${cell.cell_id} names forms ${cell.task_opportunity.form_ids.join(", ") || "none"} and its subchecks are administered by ${administeringForms.join(", ") || "none"}`, cell.cell_id);
    }

    for (const facet of cell.facet_identity) {
      if (!facetIds.has(facet)) fail("facet-unknown", `${cell.cell_id} requires facet ${facet}, which is not declared`, cell.cell_id);
    }
    for (const shortcut of cell.task_opportunity.shortcut_prohibitions) {
      if (!shortcutIds.has(shortcut)) fail("shortcut-unknown", `${cell.cell_id} prohibits ${shortcut}, which is not a declared value source`, cell.cell_id);
    }
  }

  // --- the mapping is exhaustive and exclusive --------------------------------------------
  //
  // The count is pinned in the artifact instead of inferred from the product, because inferring it
  // is what made the eighty-row claim unfalsifiable. Duplicate a subcheck name inside one metric and
  // `declaredSubcheckIds()` is still eighty long and only seventy-nine distinct; every check below
  // is written over the Set, so the contract passed while describing seventy-nine questions and
  // calling it eighty. Pinning it means a product that has stopped having eighty has to say so.
  const declaredList = declaredSubcheckIds();
  const declared = new Set(declaredList);
  const pinnedCount = contract.cells.declared_subcheck_count;
  if (declaredList.length !== pinnedCount || declared.size !== pinnedCount) {
    fail("subcheck-cardinality", `the product declares ${declaredList.length} subchecks, ${declared.size} of them distinct, and the contract pins ${pinnedCount}`);
  }
  const owner = new Map();
  for (const cell of cells) {
    for (const id of cell.subcheck_ids) {
      if (!declared.has(id)) {
        fail("subcheck-unknown", `${cell.cell_id} claims ${id}, which is not a subcheck in this product`, cell.cell_id);
        continue;
      }
      if (owner.has(id)) {
        fail("subcheck-double-owned", `${id} is claimed by ${owner.get(id)} and by ${cell.cell_id}`, id);
        continue;
      }
      owner.set(id, cell.cell_id);
    }
  }
  for (const id of declared) {
    if (!owner.has(id)) fail("subcheck-unmapped", `${id} maps to no cell`, id);
  }
  if (owner.size !== pinnedCount) fail("mapping-cardinality", `${owner.size} subchecks are mapped and the contract pins ${pinnedCount}`);

  // --- every cell is owned by exactly one construct, on its own axis -----------------------
  const constructIds = new Set(map.constructs.map((entry) => entry.construct_id));
  const listing = new Map();
  for (const construct of map.constructs) {
    for (const [axisId, groupEntry] of Object.entries(construct.axes)) {
      if (!AXES.includes(axisId)) fail("construct-axis-unknown", `${construct.construct_id} declares axis ${axisId}`, construct.construct_id);
      for (const [required, list] of [[true, groupEntry.required_cell_ids], [false, groupEntry.optional_cell_ids]]) {
        for (const cellId of list) {
          if (listing.has(cellId)) fail("cell-listed-twice", `${cellId} appears in more than one construct or axis group`, cellId);
          else listing.set(cellId, { construct: construct.construct_id, axis: axisId, required });
          const cell = byCellId.get(cellId);
          if (!cell) {
            fail("construct-cell-unknown", `${construct.construct_id}.${axisId} lists ${cellId}, which is not a declared cell`, cellId);
            continue;
          }
          if (cell.construct_id !== construct.construct_id) {
            fail("construct-cell-mismatch", `${cellId} belongs to ${cell.construct_id} but is listed under ${construct.construct_id}`, cellId);
          }
          if (cell.axis !== axisId) {
            fail("construct-axis-mismatch", `${cellId} is on ${cell.axis} but is listed under ${construct.construct_id}.${axisId}`, cellId);
          }
          if (cell.required_for_construct !== required) {
            fail("construct-requirement-mismatch", `${cellId} declares required_for_construct ${cell.required_for_construct} and is listed as ${required ? "required" : "optional"}`, cellId);
          }
        }
      }
    }
  }
  for (const cell of cells) {
    if (!constructIds.has(cell.construct_id)) fail("cell-construct-unknown", `${cell.cell_id} belongs to ${cell.construct_id}, which the construct map does not declare`, cell.cell_id);
    if (!listing.has(cell.cell_id)) fail("cell-unlisted", `${cell.cell_id} is declared but no construct claims it`, cell.cell_id);
  }

  // --- the index has something to be computed from ----------------------------------------
  for (const constructId of map.process_index.construct_ids) {
    const construct = map.constructs.find((entry) => entry.construct_id === constructId);
    if (!construct) {
      fail("index-construct-unknown", `the process index names ${constructId}, which is not declared`, constructId);
      continue;
    }
    const required = construct.axes[map.process_index.axis]?.required_cell_ids ?? [];
    if (required.length === 0) {
      fail("index-construct-empty", `${constructId} declares no required ${map.process_index.axis} cell, so the index could never be computed from it`, constructId);
    }
  }
  for (const construct of map.constructs) {
    const inIndex = map.process_index.construct_ids.includes(construct.construct_id);
    if (construct.in_process_index !== inIndex) {
      fail("index-membership-mismatch", `${construct.construct_id} declares in_process_index ${construct.in_process_index} and the index ${inIndex ? "does" : "does not"} name it`, construct.construct_id);
    }
  }
  for (const constructId of map.longitudinal_lane.construct_ids) {
    if (map.process_index.construct_ids.includes(constructId)) {
      fail("longitudinal-in-index", `${constructId} is a longitudinal lane and is also summed into the index`, constructId);
    }
  }

  // --- the task model and the cells agree on which form creates which opportunity ----------
  const formIds = new Set(tasks.forms.map((entry) => entry.form_id));
  for (const form of tasks.forms) {
    for (const cellId of form.construct_opportunity_cell_ids) {
      const cell = byCellId.get(cellId);
      if (!cell) {
        fail("form-cell-unknown", `${form.form_id} claims ${cellId}, which is not a declared cell`, form.form_id);
        continue;
      }
      if (!cell.task_opportunity.form_ids.includes(form.form_id)) {
        fail("form-cell-not-reciprocal", `${form.form_id} claims ${cellId} but ${cellId} does not name ${form.form_id}`, cellId);
      }
    }
  }
  for (const cell of cells) {
    for (const formId of cell.task_opportunity.form_ids) {
      if (!formIds.has(formId)) fail("cell-form-unknown", `${cell.cell_id} names form ${formId}, which the task model does not declare`, cell.cell_id);
      else if (!tasks.forms.find((entry) => entry.form_id === formId).construct_opportunity_cell_ids.includes(cell.cell_id)) {
        fail("form-cell-not-reciprocal", `${cell.cell_id} names ${formId} but ${formId} does not claim it`, cell.cell_id);
      }
    }
  }
  // A form's declared opportunity count is derived from the subchecks it administers and compared,
  // rather than believed: FAM-1's twelve could have read nine hundred and ninety-nine and nothing
  // would have noticed. Counted per subcheck the six numbers partition the eighty exactly; counted
  // per cell they summed to eighty-four, because a cell can be administered by two forms. That cell
  // still has to be named, because a consumer reading the cell lists as disjoint would double count
  // it even though the opportunity counts no longer do.
  for (const form of tasks.forms) {
    const derived = cells.reduce((total, cell) => total + cell.subcheck_administered_by.filter((entry) => entry.form_id === form.form_id).length, 0);
    if (form.declared_opportunity_count !== derived) {
      fail("form-opportunity-count-mismatch", `${form.form_id} declares ${form.declared_opportunity_count} opportunities over cells that declare ${derived}`, form.form_id);
    }
    const shared = form.construct_opportunity_cell_ids.filter((cellId) => (byCellId.get(cellId)?.task_opportunity.form_ids.length ?? 0) > 1).sort();
    if (canonicalJson([...form.shared_opportunity_cell_ids].sort()) !== canonicalJson(shared)) {
      fail("form-shared-cells-undisclosed", `${form.form_id} shares ${shared.join(", ") || "no cell"} with another form and discloses ${[...form.shared_opportunity_cell_ids].join(", ") || "none"}`, form.form_id);
    }
  }

  for (const source of tasks.unadministered_opportunity_sources) {
    for (const cellId of source.required_for_cell_ids) {
      const cell = byCellId.get(cellId);
      if (!cell) {
        fail("source-cell-unknown", `${source.source_id} names ${cellId}, which is not a declared cell`, source.source_id);
        continue;
      }
      // A cell cannot be both scored and waiting for an opportunity source nobody administers.
      if (source.status === "NOT_ADMINISTERED" && cell.population_status !== "DECLARED_UNPOPULATED") {
        fail("unadministered-but-populated", `${cellId} is scored although ${source.source_id} is not administered`, cellId);
      }
    }
  }

  // --- scoring rules may not be made of the things this instrument refuses to reward -------
  for (const rule of evidence.scoring_rules) {
    for (const input of rule.prohibited_inputs) {
      if (!shortcutIds.has(input)) fail("prohibited-input-unknown", `${rule.scoring_rule_id} prohibits ${input}, which is not a declared value source`, rule.scoring_rule_id);
    }
  }

  // --- no ability band, cut score, percentile or rank anywhere -----------------------------
  // Three stages, these three, in this order. The schema asks for `minItems: 3`, so three copies of
  // PROFILE_BOUND passed it and passed sealing, and `evaluate` then read `.definition` off an
  // undefined stage and crashed. A verifier that accepts a contract it cannot afterwards evaluate is
  // worse than one that rejects it: it moves the failure to the caller and takes the reason with it.
  const stageIds = use.claim_stages.map((stage) => stage.stage_id);
  if (canonicalJson(stageIds) !== canonicalJson([...CLAIM_STAGES])) {
    fail("claim-stage-membership", `the claim stages are ${stageIds.join(", ")} and this contract defines exactly ${CLAIM_STAGES.join(", ")}, in that order`);
  }

  // Every comparability rule is enforced by `comparability`, whatever its status, so every rule has
  // to name facets a result actually declares and a refusal its status agrees with. A rule naming a
  // facet nobody declares compares undefined with undefined and gates nothing -- which is how an
  // ENFORCED profile-identity rule sat in this artifact while two operators compared as one.
  for (const rule of use.comparability_rules) {
    for (const facet of rule.facets) {
      if (!facetIds.has(facet)) fail("comparability-facet-unknown", `${rule.rule_id} gates ${facet}, which the evidence model does not declare`, rule.rule_id);
    }
    const invariance = rule.refusal_reason === "INVARIANCE_UNESTABLISHED";
    if ((rule.status === "UNESTABLISHED") !== invariance) {
      fail("comparability-refusal-mismatch", `${rule.rule_id} is ${rule.status} and refuses with ${rule.refusal_reason}`, rule.rule_id);
    }
  }

  if (use.maximum_claim_stage !== "PROFILE_BOUND") fail("claim-stage-ceiling", `maximum claim stage is ${use.maximum_claim_stage}; v0.2.0 stops at PROFILE_BOUND`);
  if (use.default_claim_stage !== "PROFILE_BOUND") fail("claim-stage-default", `default claim stage is ${use.default_claim_stage}`);
  if (use.generalizability_status !== "UNESTABLISHED") fail("generalizability-claimed", `generalizability status is ${use.generalizability_status} with no calibration evidence`);
  for (const field of ["standard_setting", "categories", "cut_scores"]) {
    if (use[field] !== null) fail("standard-setting-present", `${field} is set without a standard-setting record`, field);
  }
  // The old scorer still assigns an ability category to a legacy result and the CLI still prints it.
  // This contract issues none, and an earlier draft wrote that down as "no category, band, cut
  // score, percentile or rank is emitted at any stage" and marked the evidence PASS -- which was a
  // true statement about this contract published as a false one about the product. The disclosure
  // replaces the assertion, and a disclosure naming nothing is not a disclosure.
  if (use.legacy_band_surface.status === "PRESENT" && use.legacy_band_surface.modules.length === 0) {
    fail("legacy-band-undisclosed", "the legacy band surface is declared present and names no module that carries it");
  }
  const serialized = ARTIFACT_KEYS.map((key) => canonicalJson(contract[key])).join("\n");
  for (const word of BAND_VOCABULARY) {
    // The index's own label contains OPERATOR PROCESS INDEX and must not be read as the band
    // "OPERATIONAL", which is why the band list spells that one out in full.
    if (serialized.includes(word)) fail("band-vocabulary", `the contract contains "${word}", which is an ability category this instrument may not issue`, word);
  }

  return { ok: failures.length === 0, failures };
}

// --- scoring -----------------------------------------------------------------------------------

/**
 * Every opportunity in a run, whether or not it was answered.
 *
 * A metric that was never observed still contributes its four opportunities, each unanswered. The
 * alternative -- dropping them -- shrinks the denominator of the minimum-opportunity test, and a
 * cell that reaches its minimum by not being asked is exactly the defect this repository keeps
 * finding in a different place each time.
 */
export function opportunitiesOf(observations, contract = shippedEcdContract()) {
  const digest = sealedOrThrow(contract, "opportunitiesOf");
  if (!Array.isArray(observations)) throw new Error("AOS_INVALID_OBSERVATIONS opportunitiesOf takes the array lib/observe.mjs produces");
  const cellOf = new Map(subcheckMapping(contract).map((row) => [row.subcheck_id, row]));

  // What counts as an observation is `lib/metrics.mjs`'s answer, and it is asked about the
  // observation's own parts rather than about the header it arrived with.
  //
  // Delegating the whole question was not enough. `validateObservations` skips the verifier and
  // reason checks for anything whose `state` reads NOT_OBSERVED, so an object that declared
  // NOT_OBSERVED and carried four passing subchecks was waved through, and twenty of them produced
  // PROFILE_BOUND over twenty-eight issued cells with every binding naming no verifier at all. An
  // opportunity with no verifier identity is not an observation, it is an assertion, and this rule
  // has to live here rather than be inherited from a function with its own reasons to be lenient.
  //
  // So each one is rebuilt from its parts first, then checked against the header it claimed, then
  // validated as the rebuilt thing. Rebuilding also keeps what the answer was decided by: an
  // opportunity whose verifier and evidence were dropped on the way in is one nothing downstream can
  // bind a claim to, which is what #560 needs from this.
  const normalisedAll = observations.map((observation) => {
    if (observation === null || typeof observation !== "object") throw new Error("AOS_INVALID_OBSERVATIONS an observation must be an object");
    const normalised = observationOf({
      metric_id: observation.metric_id,
      verifier_id: observation.verifier_id ?? null,
      subchecks: observation.subchecks?.length > 0 ? observation.subchecks : null,
      evidence_ids: observation.evidence_ids ?? [],
      reason: observation.reason ?? ""
    });
    // The header has to agree with the subchecks under it. A metric that answers four questions and
    // files itself as unobserved is the exact shape of the forgery above.
    for (const field of ["state", "value", "dimension"]) {
      if (Object.hasOwn(observation, field) && observation[field] !== normalised[field]) {
        throw new Error(`AOS_INCONSISTENT_OBSERVATION ${normalised.metric_id} declares ${field} ${JSON.stringify(observation[field])} and its subchecks say ${JSON.stringify(normalised[field])}`);
      }
    }
    // Answers need somebody who answered them, whatever the header said the state was.
    const answers = normalised.subchecks.filter((entry) => entry.pass !== null);
    if (answers.length > 0 && (typeof normalised.verifier_id !== "string" || normalised.verifier_id.length === 0)) {
      throw new Error(`AOS_UNATTRIBUTED_OBSERVATION ${normalised.metric_id} answers ${answers.length} subcheck${answers.length === 1 ? "" : "s"} and names no verifier; an opportunity with no verifier identity is an assertion, not an observation`);
    }
    return normalised;
  });

  // "Absent from the result" is the one problem that is not fatal: a metric nothing in the run spoke
  // to is the case NOT_OBSERVED exists for.
  const problems = validateObservations(normalisedAll).filter((entry) => entry.reason !== "absent from the result");
  if (problems.length > 0) {
    throw new Error(`AOS_INVALID_OBSERVATIONS ${problems.map((entry) => `${entry.metric_id}: ${entry.reason}`).join("; ")}`);
  }

  const answered = new Map();
  for (const normalised of normalisedAll) {
    const source = {
      verifier_id: normalised.verifier_id,
      evidence_ids: [...normalised.evidence_ids],
      observation_digest: `sha256:${createHash("sha256").update(canonicalJson(normalised)).digest("hex")}`
    };
    for (const entry of normalised.subchecks) {
      answered.set(subcheckId(normalised.metric_id, entry.id), { pass: entry.pass, source });
    }
  }
  const rows = [];
  for (const id of declaredSubcheckIds()) {
    const mapping = cellOf.get(id);
    if (!mapping) continue;
    const answer = answered.get(id) ?? null;
    const pass = answer === null ? null : answer.pass;
    rows.push({
      subcheck_id: id,
      cell_id: mapping.cell_id,
      construct_id: mapping.construct_id,
      axis: mapping.axis,
      form_id: mapping.form_id,
      verifier_id: answer?.source.verifier_id ?? null,
      evidence_ids: answer === null ? [] : [...answer.source.evidence_ids],
      observation_digest: answer?.source.observation_digest ?? null,
      verdict: pass === true ? "PASS" : pass === false ? "FAIL" : "NOT_OBSERVED",
      // Only where the scoring rule defines one. A verdict of NOT_OBSERVED carries no value at all,
      // rather than a zero that would be indistinguishable from a fail.
      value_0_1: pass === true ? 1 : pass === false ? 0 : null
    });
  }
  return brand(rows, "opportunities", digest);
}

/**
 * One cell's estimate, or the named reason it does not have one.
 *
 * Below the minimum the answer is null and the status says which kind of missing it is. Nothing
 * here produces a partial value: a cell answered three ways out of four is a cell that was not
 * answered, not a cell that scored three quarters of the way to something.
 */
export function estimateCell(cellId, opportunities, contract = shippedEcdContract()) {
  const digest = sealedOrThrow(contract, "estimateCell");
  derivedOrThrow(opportunities, "opportunities", digest, "estimateCell");
  // The cell is looked up, never accepted. Taking the cell object from the caller meant taking its
  // `credit_bearing`, its `minimum_opportunities` and its missing policy from the caller too, so a
  // cell resting on the agent's own account of itself could be handed in claiming credit and this
  // function would compute the number without ever consulting the contract that forbids it.
  const cell = contract.cells.cells.find((entry) => entry.cell_id === cellId);
  if (!cell) throw new Error(`AOS_UNKNOWN_CELL ${typeof cellId === "string" ? cellId : `a ${typeof cellId}`} is not a cell in this contract; estimateCell takes a cell id and reads the cell from the sealed contract`);
  const mine = opportunities.filter((row) => row.cell_id === cell.cell_id);
  const values = mine.filter((row) => row.value_0_1 !== null).map((row) => row.value_0_1);
  const distribution = { pass: values.filter((value) => value === 1).length, fail: values.filter((value) => value === 0).length, not_observed: mine.length - values.length };
  const base = {
    cell_id: cell.cell_id,
    construct_id: cell.construct_id,
    axis: cell.axis,
    credit_bearing: cell.credit_bearing,
    opportunity_count: values.length,
    declared_opportunities: mine.length,
    minimum_opportunities: cell.minimum_opportunities,
    distribution,
    // What this estimate rests on, so a consumer can bind the number to the evidence rather than to
    // this module's word for it. Sorted, because a set rendered in observation order is a digest
    // that moves when nothing did.
    bound_to: [...new Map(mine.filter((row) => row.observation_digest !== null)
      .map((row) => [row.observation_digest, { verifier_id: row.verifier_id, evidence_ids: [...row.evidence_ids], observation_digest: row.observation_digest }])).values()]
      .sort((left, right) => left.observation_digest.localeCompare(right.observation_digest))
  };
  // Nothing answered at all is the cell's own missing policy: NOT_OBSERVED where the opportunity was
  // administered and nothing in the run spoke to it, WITHHELD where no opportunity source exists.
  // Some answers but not enough of them is INSUFFICIENT_OPPORTUNITIES, which is a different fact
  // about the run and has to stay distinguishable from the first.
  if (values.length === 0) return deepFreeze({ ...base, estimate: null, status: cell.missing_policy });
  if (cell.minimum_opportunities === null || values.length < cell.minimum_opportunities) {
    return deepFreeze({ ...base, estimate: null, status: "INSUFFICIENT_OPPORTUNITIES" });
  }
  return deepFreeze({ ...base, estimate: values.reduce((total, value) => total + value, 0) / values.length, status: "ISSUED" });
}

export function cellEstimates(observations, contract = shippedEcdContract()) {
  const digest = sealedOrThrow(contract, "cellEstimates");
  const opportunities = opportunitiesOf(observations, contract);
  return brand(contract.cells.cells.map((cell) => estimateCell(cell.cell_id, opportunities, contract)), "cells", digest);
}

/**
 * A construct's estimate, per axis, or nothing.
 *
 * Equal weight over the required cells. A cell with more opportunities in it does not get a larger
 * say, because the number of questions a family happens to ask is a property of the instrument and
 * not of the construct -- weighting by it would let a family become important by growing.
 *
 * One required cell short and the construct is withheld rather than averaged over what is left.
 * Averaging the remainder makes observing less raise the number, which is the failure mode this
 * repository has already had to fix at the dimension level.
 */
export function constructEstimates(estimates, contract = shippedEcdContract()) {
  const digest = sealedOrThrow(contract, "constructEstimates");
  derivedOrThrow(estimates, "cells", digest, "constructEstimates");
  const byId = new Map(estimates.map((entry) => [entry.cell_id, entry]));
  const out = [];
  for (const construct of contract.construct_map.constructs) {
    for (const [axis, groupEntry] of Object.entries(construct.axes)) {
      const required = groupEntry.required_cell_ids.map((id) => byId.get(id)).filter(Boolean);
      const optional = groupEntry.optional_cell_ids.map((id) => byId.get(id)).filter(Boolean);
      const withheld = required.filter((entry) => entry.status !== "ISSUED");
      const row = {
        construct_id: construct.construct_id,
        axis,
        required_cell_ids: [...groupEntry.required_cell_ids],
        // Reported beside the estimate and never inside it.
        optional_cells: optional.map((entry) => ({ cell_id: entry.cell_id, estimate: entry.estimate, status: entry.status })),
        withheld_for: withheld.map((entry) => ({ cell_id: entry.cell_id, status: entry.status }))
      };
      if (withheld.length > 0 || required.length === 0) {
        out.push({ ...row, estimate: null, status: "WITHHELD" });
        continue;
      }
      out.push({ ...row, estimate: required.reduce((total, entry) => total + entry.estimate, 0) / required.length, status: "ISSUED" });
    }
  }
  return brand(out, "constructs", digest);
}

/**
 * The one index this contract permits, over the one axis it permits it over.
 *
 * Descriptive, unlabelled by any category, and computed only from operator process cells. The
 * delegated-artifact axis is deliberately not in it: those cells move when the model changes, and an
 * index that moves when the model changes is not a description of how somebody operates.
 */
export function processIndex(constructRows, contract = shippedEcdContract()) {
  const digest = sealedOrThrow(contract, "processIndex");
  // Six hand-written rows used to issue 0.75 here, which is the whole distance between "withheld by
  // construction" and "withheld unless you call the function a different way".
  derivedOrThrow(constructRows, "constructs", digest, "processIndex");
  const spec = contract.construct_map.process_index;
  const relevant = spec.construct_ids.map((id) =>
    constructRows.find((row) => row.construct_id === id && row.axis === spec.axis) ?? { construct_id: id, axis: spec.axis, status: "WITHHELD", estimate: null });
  const withheld = relevant.filter((row) => row.status !== "ISSUED");
  const base = {
    label: spec.label,
    interpretation: spec.interpretation,
    axis: spec.axis,
    construct_ids: [...spec.construct_ids],
    withheld_for: withheld.map((row) => row.construct_id),
    category: null,
    cut_score: null,
    percentile: null,
    rank: null,
    band: null
  };
  if (withheld.length > 0) return deepFreeze({ ...base, value: null, status: "WITHHELD" });
  return deepFreeze({ ...base, value: relevant.reduce((total, row) => total + row.estimate, 0) / relevant.length, status: "ISSUED" });
}

/**
 * Whether two results may be put next to each other.
 *
 * Takes the results this module emits. The first draft read the facets off the top level of
 * whatever it was handed, and `evaluate` puts them under `facet_coverage.declared`, so two real
 * results -- one English on one model, one Korean on another -- came back comparable, and so did
 * `comparability({}, {})`. Both were the same bug: a facet that is not there reads as a facet that
 * matches, and every gate in this function is written as an inequality.
 *
 * So an undeclared facet refuses. A comparison whose facets nobody recorded is not a cautious
 * comparison and it is not a permitted one; it is two measurements with no evidence they are the
 * same measurement, which is exactly what the gate is for.
 */
export function comparability(left, right, contract = null) {
  // Only results this module emitted, and they are frozen, so the facets being compared are the
  // facets the run was scored under. Reading the shape off any object meant a caller could set
  // `result.facet_coverage.declared.model` after the fact and turn a refusal into a comparison.
  const policies = { left: emittedResults.get(left), right: emittedResults.get(right) };
  for (const [name, policy] of Object.entries(policies)) {
    if (policy === undefined) throw new Error(`AOS_UNEMITTED_RESULT comparability compares results from evaluate; the ${name} argument is not one`);
  }

  // The policy is the contract these results were scored under, not one handed in beside them. This
  // function took a third argument and applied its rules, so a caller could clone the contract,
  // delete the invariance rule, seal the clone -- it still verifies, nothing in it is invalid -- and
  // compare two shipped results across models as though the gate had never been written. A comparison
  // is governed by the contract the measurements were made under or it is governed by nobody.
  if (policies.left !== policies.right) {
    return deepFreeze({
      comparable: false,
      reason: "CONTRACT_IDENTITY_DIFFERS",
      facets: ["contract_digest"],
      rules: [{ rule_id: "contract-identity", status: "ENFORCED", refusal_reason: "CONTRACT_IDENTITY_DIFFERS", facets: ["contract_digest"] }],
      undeclared_sides: []
    });
  }
  const policy = policies.left;
  if (contract !== null && contract !== policy) {
    throw new Error("AOS_CONTRACT_MISMATCH comparability applies the contract the results were scored under; the contract supplied is not it");
  }

  // Every declared rule, not the ones with a status this function happens to recognise. It filtered
  // on UNESTABLISHED, so the ENFORCED profile-identity rule sitting in the artifact -- operator and
  // occasion -- gated nothing, and two runs by two different people came back comparable. The
  // refusal each rule reports is named in the artifact, so adding a rule does not mean editing this.
  const rules = policy.interpretation_use.comparability_rules;
  const gated = [...new Set(rules.flatMap((rule) => rule.facets))];
  const sides = { left: left.facet_coverage.declared, right: right.facet_coverage.declared };

  const missing = gated.filter((facet) => sides.left[facet] === undefined || sides.left[facet] === null || sides.right[facet] === undefined || sides.right[facet] === null);
  if (missing.length > 0) return deepFreeze({ comparable: false, reason: "FACETS_UNDECLARED", facets: missing, rules: [], undeclared_sides: [] });

  const broken = rules
    .map((rule) => ({ rule_id: rule.rule_id, status: rule.status, refusal_reason: rule.refusal_reason, facets: rule.facets.filter((facet) => sides.left[facet] !== sides.right[facet]) }))
    .filter((entry) => entry.facets.length > 0);
  if (broken.length === 0) return deepFreeze({ comparable: true, reason: null, facets: [], rules: [], undeclared_sides: [] });
  return deepFreeze({
    comparable: false,
    reason: broken[0].refusal_reason,
    facets: [...new Set(broken.flatMap((entry) => entry.facets))],
    rules: broken,
    undeclared_sides: []
  });
}

/**
 * The whole of it, for one run.
 *
 * `context` carries the forms that were completed and the facet levels the run was administered at,
 * and nothing else is read. The refusal below is the point: a caller that hands this function a
 * turn count or an elapsed time is a caller about to build a number out of something this
 * instrument says is not competence, and it fails loudly rather than being quietly ignored.
 */
export function evaluate(observations, context = {}, contract = shippedEcdContract()) {
  sealedOrThrow(contract, "evaluate");
  const prohibited = new Set(contract.evidence_model.prohibited_value_sources.map((entry) => entry.id));
  for (const key of Object.keys(context)) {
    if (prohibited.has(key)) throw new Error(`AOS_PROHIBITED_VALUE_SOURCE ${key}`);
  }

  const digests = contractDigests(contract);
  // Derived, never supplied. The contract a result was scored under is a facet of the measurement --
  // two results from different contracts are two instruments -- and a facet the caller could set is
  // a gate the caller could open.
  const declaredFacets = { ...(context.facets ?? {}) };
  if (Object.hasOwn(declaredFacets, "contract_digest")) {
    throw new Error("AOS_DERIVED_FACET contract_digest is derived from the contract and may not be supplied");
  }
  declaredFacets.contract_digest = digests.combined;

  // Recorded and compared, or not recorded. The digest sat on the result and outside the facets, so
  // two results carrying two different profile digests compared as one measurement -- the field was
  // written down and then not read by the only function whose job is to read it.
  if (Object.hasOwn(declaredFacets, "profile_digest")) {
    throw new Error("AOS_DERIVED_FACET profile_digest is taken from context.profile_digest and may not also be declared as a facet");
  }
  const profileDigest = typeof context.profile_digest === "string" && context.profile_digest.length > 0 ? context.profile_digest : null;
  declaredFacets.profile_digest = profileDigest;

  const cells = cellEstimates(observations, contract);
  const constructs = constructEstimates(cells, contract);
  const index = processIndex(constructs, contract);

  const forms = contract.task_model.forms;
  const declaredForms = new Set(forms.map((form) => form.form_id));
  const operational = forms.filter((form) => form.class === "OPERATIONAL").map((form) => form.form_id);

  // "Every locked operational form was completed exactly once" is an assumption in the
  // interpretation argument, and it was checked with `.includes`, which is satisfied by a list that
  // names one form six times. A form named twice is either a bug in the caller or a second
  // administration nobody recorded, and neither is a completed cycle.
  const completed = context.forms_completed ?? [];
  if (!Array.isArray(completed)) throw new Error("AOS_INVALID_CONTEXT forms_completed must be an array of form ids");
  for (const id of completed) {
    if (!declaredForms.has(id)) throw new Error(`AOS_UNKNOWN_FORM ${id} is not a form the task model declares`);
  }
  if (new Set(completed).size !== completed.length) {
    throw new Error("AOS_DUPLICATE_FORM forms_completed names a form more than once, and a locked form is completed exactly once");
  }
  const missingForms = operational.filter((id) => !completed.includes(id));

  // A form the caller names and a form the run administered are two different facts, and the claim
  // stage used to rest on the first alone: `evaluate([], { forms_completed: [every form] })`
  // returned PROFILE_BOUND over zero answered opportunities. PROFILE_BOUND is defined in the
  // interpretation argument as performance *observed* across every locked operational form, so a
  // claimed form whose declared cells produced no answer at all cannot support it -- and the list of
  // which forms failed to is on the result, because "it dropped a stage" without saying why is the
  // kind of refusal a consumer works around.
  const answeredIn = new Map(cells.map((entry) => [entry.cell_id, entry.opportunity_count]));
  const subcheckBacked = new Set(contract.cells.cells.filter((cell) => cell.population_status === "SUBCHECK_BACKED").map((cell) => cell.cell_id));
  const unsupportedForms = operational.filter((id) => completed.includes(id) &&
    forms.find((form) => form.form_id === id).construct_opportunity_cell_ids
      .some((cellId) => subcheckBacked.has(cellId) && (answeredIn.get(cellId) ?? 0) === 0));

  // PROFILE_BOUND is defined as performance observed across every locked form "under one exact
  // profile and measurement contract". It was issued from form completion and coverage alone, so a
  // run with no facets and no profile digest claimed an exact profile it had not named -- a
  // profile-bound claim with a null profile is a contradiction in a field name.
  //
  // The identity required is the one `comparability` compares, read from the same rules, so the two
  // cannot drift apart: a result that could not be compared to another under the same profile has no
  // business claiming it was measured under one. Absence degrades the stage rather than refusing the
  // run, because a run that names no profile is still a run somebody wants the diagnostics from, and
  // RUN_DIAGNOSTIC is exactly the claim it can support.
  const identityFacets = [...new Set(contract.interpretation_use.comparability_rules.flatMap((rule) => rule.facets))];
  const unidentifiedFacets = identityFacets.filter((facet) => declaredFacets[facet] === undefined || declaredFacets[facet] === null);

  // #556. The boundary is part of what makes a claim profile-bound. A profile is an exact
  // environment, and an environment nothing enforced is a description rather than a fact: a run
  // whose confinement gate withheld -- no OS boundary, a canary that failed, a leaked descendant --
  // supports what was observed in that run and no claim about the profile it names.
  //
  // Supplied by the caller, because this module measures constructs and does not run boundaries --
  // and an absent verdict withholds exactly like a negative one. A caller who says nothing about
  // the boundary has established nothing about it, which is the same answer as a boundary that was
  // measured and failed, arrived at from less evidence rather than more. The version of this line
  // that read `context.boundary ?? null` and then withheld only on a non-null value gave an
  // omitted, null or undefined boundary a PROFILE_BOUND claim and an issued composite: absent
  // evidence opening a gate, which is the one rule this whole issue exists to hold.
  const boundary = isPlainObject(context.boundary) ? context.boundary : null;
  const boundaryWithheld = boundary === null
    ? ["AOS_ISOLATION_NOT_MEASURED"]
    : boundary.official === true
      ? []
      : [...new Set(Array.isArray(boundary.reasons) && boundary.reasons.length > 0 ? boundary.reasons : ["AOS_ISOLATION_NOT_OFFICIAL"])];
  const claimStage = missingForms.length === 0 && unsupportedForms.length === 0 && unidentifiedFacets.length === 0 && boundaryWithheld.length === 0 ? "PROFILE_BOUND" : "RUN_DIAGNOSTIC";

  // Frozen and registered. An unfrozen result let a caller edit the facets it was scored under and
  // then ask whether it compared, which answered a question about an object nothing had produced.
  const result = deepFreeze({
    contract: { id: ECD_CONTRACT_ID, version: ECD_CONTRACT_VERSION, digests },
    // The slot, and null until something binds a profile to the run. #559 owns the profile shape;
    // emitting a digest of something this module invented would be worse than emitting nothing.
    profile_digest: profileDigest,
    claim_stage: claimStage,
    permitted_interpretation: contract.interpretation_use.claim_stages.find((stage) => stage.stage_id === claimStage).definition,
    forbidden_uses: [...contract.interpretation_use.forbidden_uses],
    generalizability_status: "UNESTABLISHED",
    uncertainty: { status: "INSUFFICIENT_DATA", method: null },
    standard_setting: null,
    category: null,
    cut_score: null,
    percentile: null,
    rank: null,
    band: null,
    incomplete_forms: missingForms,
    unsupported_forms: unsupportedForms,
    unidentified_facets: unidentifiedFacets,
    // Why the boundary withheld, when it did: the same AOS_ISOLATION_* codes the run record carries,
    // so a reader of the result alone can see which condition kept the claim at RUN_DIAGNOSTIC.
    boundary_withheld: boundaryWithheld,
    facet_coverage: { declared: declaredFacets, levels_per_facet_observed: 1, variance_components: "UNESTABLISHED" },
    cells,
    constructs,
    process_index: index,
    missing: {
      not_observed: cells.filter((entry) => entry.status === "NOT_OBSERVED").map((entry) => entry.cell_id),
      insufficient_opportunities: cells.filter((entry) => entry.status === "INSUFFICIENT_OPPORTUNITIES").map((entry) => entry.cell_id),
      withheld: cells.filter((entry) => entry.status === "WITHHELD").map((entry) => entry.cell_id)
    }
  });
  emittedResults.set(result, contract);
  return result;
}
