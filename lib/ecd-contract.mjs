import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";
import { loadSchema, validateAgainstSchema } from "./execution-plan.mjs";
import { METRICS, METRIC_IDS } from "./metrics.mjs";

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

const SEALED = Symbol("aos.ecd.sealed");
const DERIVED = Symbol("aos.ecd.derived");

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
  if (contract !== null && typeof contract === "object" && typeof contract[SEALED] === "string") return contract;
  const report = checkEcdContract(contract);
  if (!report.ok) {
    const error = new Error(`AOS_CONTRACT_INVALID ${report.failures.length} check${report.failures.length === 1 ? "" : "s"} failed: ${[...new Set(report.failures.map((entry) => entry.check))].join(", ")}`);
    error.failures = report.failures;
    throw error;
  }
  const sealed = structuredClone(contract);
  Object.defineProperty(sealed, SEALED, { value: contractDigests(sealed).combined, enumerable: false });
  return deepFreeze(sealed);
}

/** The shipped contract, checked once. Every scoring function defaults to it. */
let shippedSeal = null;
export const shippedEcdContract = () => (shippedSeal ??= sealEcdContract(loadEcdContract()));

const sealedOrThrow = (contract, caller) => {
  if (contract !== null && typeof contract === "object" && typeof contract[SEALED] === "string") return contract[SEALED];
  throw new Error(`AOS_UNVERIFIED_CONTRACT ${caller} requires a contract from sealEcdContract; an unchecked contract may not produce an estimate`);
};

// The rows are frozen as well as branded. A brand alone would let a caller take a real cell estimate
// array, flip a NOT_OBSERVED to ISSUED, and pass it on still carrying the digest of the contract it
// no longer describes.
const brand = (rows, kind, digest) => {
  Object.defineProperty(rows, DERIVED, { value: `${kind}:${digest}`, enumerable: false });
  return deepFreeze(rows);
};

const derivedOrThrow = (rows, kind, digest, caller) => {
  if (rows !== null && typeof rows === "object" && rows[DERIVED] === `${kind}:${digest}`) return rows;
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
        credit_bearing: cell.credit_bearing
      });
    }
  }
  return rows.sort((a, b) => a.subcheck_id.localeCompare(b.subcheck_id));
}

// --- the verifier ------------------------------------------------------------------------------

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

  const byCellId = new Map();
  for (const cell of cells) {
    if (byCellId.has(cell.cell_id)) fail("cell-id-duplicate", `${cell.cell_id} is declared more than once`, cell.cell_id);
    else byCellId.set(cell.cell_id, cell);
  }

  // --- each cell says the thirteen things, and each of them resolves ----------------------
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
  // A form's declared opportunity count is derivable from the cells it claims, so it is derived and
  // compared rather than believed: FAM-1's twelve could have read nine hundred and ninety-nine and
  // nothing would have noticed. The counts also sum to eighty-four over eighty subchecks, because
  // two cells are administered by two forms each, and a consumer reading the six numbers as a
  // partition of the product would double count. A form that shares a cell has to name it.
  for (const form of tasks.forms) {
    const derived = form.construct_opportunity_cell_ids.reduce((total, cellId) => total + (byCellId.get(cellId)?.subcheck_ids.length ?? 0), 0);
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
  const cellOf = new Map(subcheckMapping(contract).map((row) => [row.subcheck_id, row]));
  const answered = new Map();
  for (const observation of observations) {
    for (const entry of observation.subchecks ?? []) {
      answered.set(subcheckId(observation.metric_id, entry.id), entry.pass);
    }
  }
  const rows = [];
  for (const id of declaredSubcheckIds()) {
    const mapping = cellOf.get(id);
    if (!mapping) continue;
    const pass = answered.has(id) ? answered.get(id) : null;
    rows.push({
      subcheck_id: id,
      cell_id: mapping.cell_id,
      construct_id: mapping.construct_id,
      axis: mapping.axis,
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
    distribution
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
export function comparability(left, right, contract = shippedEcdContract()) {
  sealedOrThrow(contract, "comparability");
  const gated = [...new Set(contract.interpretation_use.comparability_rules.filter((rule) => rule.status === "UNESTABLISHED").flatMap((rule) => rule.facets))];

  const declaredOf = (side) => {
    const declared = side?.facet_coverage?.declared;
    return declared !== null && typeof declared === "object" ? declared : null;
  };
  const sides = { left: declaredOf(left), right: declaredOf(right) };
  const undeclared = Object.entries(sides).filter(([, declared]) => declared === null).map(([name]) => name);
  if (undeclared.length > 0) {
    return { comparable: false, reason: "FACETS_UNDECLARED", facets: gated, undeclared_sides: undeclared };
  }

  const missing = gated.filter((facet) => sides.left[facet] === undefined || sides.left[facet] === null || sides.right[facet] === undefined || sides.right[facet] === null);
  if (missing.length > 0) return { comparable: false, reason: "FACETS_UNDECLARED", facets: missing, undeclared_sides: [] };

  const differing = gated.filter((facet) => sides.left[facet] !== sides.right[facet]);
  if (differing.length === 0) return { comparable: true, reason: null, facets: [], undeclared_sides: [] };
  return { comparable: false, reason: "INVARIANCE_UNESTABLISHED", facets: differing, undeclared_sides: [] };
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

  const cells = cellEstimates(observations, contract);
  const constructs = constructEstimates(cells, contract);
  const index = processIndex(constructs, contract);

  const forms = contract.task_model.forms;
  const operational = forms.filter((form) => form.class === "OPERATIONAL").map((form) => form.form_id);
  const completed = Array.isArray(context.forms_completed) ? context.forms_completed : [];
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

  const claimStage = missingForms.length === 0 && unsupportedForms.length === 0 ? "PROFILE_BOUND" : "RUN_DIAGNOSTIC";

  return {
    contract: { id: ECD_CONTRACT_ID, version: ECD_CONTRACT_VERSION, digests: contractDigests(contract) },
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
    facet_coverage: { declared: { ...(context.facets ?? {}) }, levels_per_facet_observed: 1, variance_components: "UNESTABLISHED" },
    cells,
    constructs,
    process_index: index,
    missing: {
      not_observed: cells.filter((entry) => entry.status === "NOT_OBSERVED").map((entry) => entry.cell_id),
      insufficient_opportunities: cells.filter((entry) => entry.status === "INSUFFICIENT_OPPORTUNITIES").map((entry) => entry.cell_id),
      withheld: cells.filter((entry) => entry.status === "WITHHELD").map((entry) => entry.cell_id)
    }
  };
}
