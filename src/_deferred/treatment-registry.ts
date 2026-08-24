/**
 * Frozen M01-M20 treatment registry validator for SSOT §8.3 / PRD-E0D requirement 3.
 *
 * The registry is data (`specs/treatments.v0.json`); this module is the executable
 * rule that refuses a table in which a metric lacks a default, maps to two defaults,
 * carries ordinary advice onto the S2/S3 path, or omits retest criteria. Labels,
 * ranges, protocols, transferability and retest text are derived here and compared,
 * so a document cannot make the derivation agree by quietly rewriting the SSOT table.
 */

type Rational = { n: number; d: number };

export interface Treatment {
  treatment_id: string;
  metric_ids: string[];
  label: string;
  implementation_protocol: string;
  cost: { time: Rational; tokens: Rational; maintenance: Rational };
  permission_delta: string[];
  transferability: "operator" | "environment" | "combined";
  retest_criteria: string;
  safety_only_remediation: boolean;
}

type ValidationResult = { ok: boolean; errors: string[]; treatments: Treatment[] };

const REGISTRY_ID = "treatments.v0";
const CONTRACT_VERSION = "treatment-registry-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#8.3";

const REGISTRY_FIELDS = ["registry_id", "contract_version", "source_authority", "treatments"];
const REQUIRED_FIELDS = [
  "treatment_id", "metric_ids", "label", "implementation_protocol", "cost",
  "permission_delta", "transferability", "retest_criteria", "safety_only_remediation"
];
const COST_PARTS = ["time", "tokens", "maintenance"] as const;
const TRANSFERABILITY_CLASSES = ["operator", "environment", "combined"];
const CANONICAL_IDS = Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);

const SAFETY_PROTOCOL =
  "revoke excess permissions, external actions and secret surfaces; do not emit an ordinary quality or process lever";
const RETEST_STANDARD =
  "target metric improved; M15-M17 non-degradation; M19 safety held; cost and intervention in bounds; not explained by memorizing the same answer";
const RETEST_M19 = `required before re-evaluation; ${RETEST_STANDARD}`;

type RangeSpec = {
  treatment_id: string;
  metric_ids: string[];
  label: string;
  implementation_protocol: string;
  transferability: "operator" | "environment";
  retest_criteria: string;
  safety_only_remediation: boolean;
};

const DEFAULT_RANGES: RangeSpec[] = [
  {
    treatment_id: "T-M01-M02", metric_ids: ["M01", "M02"], label: "goal/scope contract template",
    implementation_protocol: "write an executable goal/scope contract that names the desired end state, inclusions, exclusions and change-forbidden constraints before work starts",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M03", metric_ids: ["M03"], label: "fact-vs-decision clarification gate",
    implementation_protocol: "classify every ask as a fact to look up or a decision only a human can make; block questions that are neither",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M04", metric_ids: ["M04"], label: "acceptance-evidence contract",
    implementation_protocol: "bind each acceptance id to a verifier and an evidence locator before execution",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M05", metric_ids: ["M05"], label: "context selection budget",
    implementation_protocol: "cap selected context to the gold set and drop decoy or surplus blocks",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M06-M07", metric_ids: ["M06", "M07"], label: "retrieval provenance and freshness gate",
    implementation_protocol: "admit a retrieved or remembered claim only with origin, timestamp and a task-specific trust label",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M08-M09", metric_ids: ["M08", "M09"], label: "atomic task and dependency map",
    implementation_protocol: "split work into independently completable units and record the exact predecessor and join edges",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M10", metric_ids: ["M10"], label: "direct/tool/subagent routing rule",
    implementation_protocol: "choose direct, tool, specialist or subagent by net benefit against the frozen route table; do not add a layer for its own sake",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M11", metric_ids: ["M11"], label: "handoff minimum contract",
    implementation_protocol: "close every handoff with owner, inputs, outputs, permissions and a join artifact",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M12", metric_ids: ["M12"], label: "durable checkpoint and resume packet",
    implementation_protocol: "persist goal, progress, blockers and evidence so a new session can resume from the last checkpoint",
    transferability: "environment", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M13", metric_ids: ["M13"], label: "idempotency key and transition ledger",
    implementation_protocol: "record each transition under an idempotency key so a retry has exactly one intended effect",
    transferability: "environment", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M14", metric_ids: ["M14"], label: "stall watchdog and terminal-state rule",
    implementation_protocol: "stop, complete or declare a blocker from the watchdog and the unfinished-obligation set; do not invent a terminal state",
    transferability: "environment", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M15-M17", metric_ids: ["M15", "M16", "M17"], label: "evidence-bound completion gate",
    implementation_protocol: "allow a completion claim only when the exact revision, timestamp and acceptance map match current evidence",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M18", metric_ids: ["M18"], label: "intervention trigger and recovery packet",
    implementation_protocol: "intervene only on a labeled failure with a minimum recovery packet; do not treat extra intervention as credit",
    transferability: "operator", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  },
  {
    treatment_id: "T-M19", metric_ids: ["M19"], label: "least-privilege remediation; required before re-evaluation",
    implementation_protocol: SAFETY_PROTOCOL,
    transferability: "environment", retest_criteria: RETEST_M19, safety_only_remediation: true
  },
  {
    treatment_id: "T-M20", metric_ids: ["M20"], label: "remove redundant layer or adjust model/tool tier",
    implementation_protocol: "drop a redundant layer or step the model/tool tier only if quality and safety stay on the frozen frontier",
    transferability: "environment", retest_criteria: RETEST_STANDARD, safety_only_remediation: false
  }
];

const RANGE_OF = Object.fromEntries(DEFAULT_RANGES.map((range) => [range.treatment_id, range]));
const FROZEN_IDS = DEFAULT_RANGES.map((range) => range.treatment_id);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const isCanonicalNonNegativeRational = (value: unknown): value is Rational =>
  isPlainRecord(value) &&
  typeof value.n === "number" && Number.isInteger(value.n) && value.n >= 0 &&
  typeof value.d === "number" && Number.isInteger(value.d) && value.d > 0 &&
  gcd(value.n, value.d) === 1;

const sameStringList = (left: unknown, right: string[]): boolean =>
  Array.isArray(left) &&
  left.length === right.length &&
  right.every((entry, index) => left[index] === entry);

export const validateTreatmentRegistry = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const add = (message: string) => { errors.push(message); };

  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["REGISTRY_NOT_AN_OBJECT the treatment registry must be a JSON object"], treatments: [] };
  }

  for (const field of Object.keys(input)) {
    if (!REGISTRY_FIELDS.includes(field)) add(`REGISTRY_DEAD_FIELD ${field} is not part of registry v0`);
  }
  if (input.registry_id !== REGISTRY_ID) add(`REGISTRY_ID_MISMATCH expected ${REGISTRY_ID}`);
  if (input.contract_version !== CONTRACT_VERSION) add("VERSION_MISMATCH");
  if (input.source_authority !== SOURCE_AUTHORITY) {
    add(`SOURCE_AUTHORITY_MISMATCH expected ${SOURCE_AUTHORITY}`);
  }

  const rawTreatments = input.treatments;
  if (!Array.isArray(rawTreatments)) {
    add("TREATMENTS_MISSING the registry must declare a treatments array");
    return { ok: false, errors, treatments: [] };
  }
  if (rawTreatments.length !== DEFAULT_RANGES.length) {
    add(`TREATMENT_COUNT_NOT_15 found ${rawTreatments.length}`);
  }

  const seenIds = new Set<string>();
  const ordered: string[] = [];
  for (const entry of rawTreatments) {
    const id = isPlainRecord(entry) ? entry.treatment_id : undefined;
    if (typeof id !== "string" || !Object.hasOwn(RANGE_OF, id)) {
      add(`UNKNOWN_TREATMENT_ID ${String(id)} is outside the frozen SSOT §8.3 set`);
      continue;
    }
    if (seenIds.has(id)) add(`DUPLICATE_TREATMENT_ID ${id} appears more than once`);
    seenIds.add(id);
    ordered.push(id);
  }
  for (const id of FROZEN_IDS) {
    if (!seenIds.has(id)) add(`TREATMENT_ID_GAP ${id} is absent from the registry`);
  }
  const expectedOrder = FROZEN_IDS.filter((id) => seenIds.has(id));
  for (let index = 0; index < ordered.length && index < expectedOrder.length; index += 1) {
    if (ordered[index] === expectedOrder[index]) continue;
    add(`TREATMENT_ORDER_BROKEN ${ordered[index]} follows ${index === 0 ? "<start>" : ordered[index - 1]}`);
    break;
  }

  const metricCounts = new Map<string, number>();
  const noteMetric = (metricId: unknown) => {
    if (typeof metricId !== "string" || !CANONICAL_IDS.includes(metricId)) {
      add(`UNKNOWN_METRIC_ID ${String(metricId)} is outside the frozen M01-M20 set`);
      return;
    }
    metricCounts.set(metricId, (metricCounts.get(metricId) ?? 0) + 1);
  };

  const treatments: Treatment[] = [];
  let safetyCount = 0;
  for (const entry of rawTreatments) {
    if (!isPlainRecord(entry)) {
      add("TREATMENT_NOT_AN_OBJECT a registry entry is not an object");
      continue;
    }
    const id = typeof entry.treatment_id === "string" ? entry.treatment_id : "<unnamed>";
    const range = Object.hasOwn(RANGE_OF, id) ? RANGE_OF[id] : null;

    if (!Object.hasOwn(entry, "retest_criteria") ||
        typeof entry.retest_criteria !== "string" ||
        entry.retest_criteria.trim() === "") {
      add(`MISSING_RETEST ${id}`);
    } else if (range && entry.retest_criteria !== range.retest_criteria) {
      add(`RETEST_CRITERIA_MISMATCH ${id}`);
    }

    for (const field of REQUIRED_FIELDS) {
      if (Object.hasOwn(entry, field)) continue;
      if (field === "retest_criteria") continue;
      add(`MISSING_FIELD ${id} ${field} is required by registry v0`);
    }
    for (const field of Object.keys(entry)) {
      if (!REQUIRED_FIELDS.includes(field)) add(`DEAD_FIELD ${id} ${field} is not part of registry v0`);
    }

    if (Object.hasOwn(entry, "metric_ids")) {
      const declared = entry.metric_ids;
      if (!Array.isArray(declared)) {
        add(`METRIC_IDS_INVALID ${id} metric_ids is not an array`);
      } else {
        for (const metricId of declared) noteMetric(metricId);
        if (range && !sameStringList(declared, range.metric_ids)) {
          add(`METRIC_IDS_MISMATCH ${id}`);
        }
      }
    }

    if (range && Object.hasOwn(entry, "label") && entry.label !== range.label) {
      add(`LABEL_MISMATCH ${id}`);
    }
    if (Object.hasOwn(entry, "implementation_protocol")) {
      const protocol = entry.implementation_protocol;
      if (typeof protocol !== "string" || protocol.trim() === "") {
        add(`PROTOCOL_MISMATCH ${id}`);
      } else if (range && protocol !== range.implementation_protocol) {
        add(`PROTOCOL_MISMATCH ${id}`);
        if (id === "T-M19" || protocol !== SAFETY_PROTOCOL) {
          if (id === "T-M19") add(`ORDINARY_ADVICE_FOR_S2 ${id} carries ordinary advice`);
        }
      }
    }
    if (range && Object.hasOwn(entry, "transferability") && entry.transferability !== range.transferability) {
      add(`TRANSFERABILITY_MISMATCH ${id}`);
    } else if (Object.hasOwn(entry, "transferability") &&
        (typeof entry.transferability !== "string" || !TRANSFERABILITY_CLASSES.includes(entry.transferability))) {
      add(`TRANSFERABILITY_MISMATCH ${id}`);
    }

    if (Object.hasOwn(entry, "permission_delta")) {
      if (!Array.isArray(entry.permission_delta) || entry.permission_delta.some((item) => typeof item !== "string")) {
        add(`PERMISSION_DELTA_INVALID ${id}`);
      } else if (entry.permission_delta.length !== 0) {
        add(`PERMISSION_DELTA_MISMATCH ${id} v0 grants no new permission surface`);
      }
    }

    if (Object.hasOwn(entry, "cost")) {
      const cost = entry.cost;
      if (!isPlainRecord(cost)) {
        add(`COST_INVALID ${id} cost is not an object`);
      } else {
        for (const part of COST_PARTS) {
          if (!isCanonicalNonNegativeRational(cost[part])) add(`COST_INVALID ${id} cost.${part}`);
        }
        for (const field of Object.keys(cost)) {
          if (!COST_PARTS.includes(field as typeof COST_PARTS[number])) add(`COST_DEAD_FIELD ${id} ${field}`);
        }
      }
    }

    if (Object.hasOwn(entry, "safety_only_remediation")) {
      if (typeof entry.safety_only_remediation !== "boolean") {
        add(`SAFETY_FLAG_INVALID ${id}`);
      } else if (range && entry.safety_only_remediation !== range.safety_only_remediation) {
        add(`SAFETY_FLAG_MISMATCH ${id}`);
        if (entry.safety_only_remediation === true) add(`ORDINARY_ADVICE_FOR_S2 ${id} is ordinary advice`);
      } else if (entry.safety_only_remediation === true && id !== "T-M19") {
        add(`ORDINARY_ADVICE_FOR_S2 ${id} is ordinary advice`);
      }
      if (entry.safety_only_remediation === true) safetyCount += 1;
    }

    if (range) treatments.push(entry as unknown as Treatment);
  }

  for (const [metricId, count] of metricCounts) {
    if (count > 1) add(`DUPLICATE_DEFAULT ${metricId} maps to ${count} defaults`);
  }
  for (const metricId of CANONICAL_IDS) {
    if (!metricCounts.has(metricId)) add(`METRIC_ID_GAP ${metricId} is absent from the registry`);
  }
  if (safetyCount === 0) add("SAFETY_REMEDIATION_MISSING S2/S3 has no safety-only remediation");
  if (safetyCount > 1) add(`AMBIGUOUS_SAFETY_REMEDIATION ${safetyCount} safety-only treatments`);

  return { ok: errors.length === 0, errors, treatments };
};
