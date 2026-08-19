/**
 * Frozen prescription-input contract for SSOT §8.2 / PRD-E0D requirement 1.
 *
 * The contract is data (`specs/prescription-inputs.v0.json`); this module is the
 * executable rule that refuses an input table which is missing a total formula,
 * a closed range, an explicit missing rule, or a fixture that actually exercises
 * those. Confidence, gap, opportunity count, treatment cost, permission delta,
 * expected uplift and transferability are computed; a missing field is MISSING
 * and never an implicit zero or a learned default.
 *
 * Nothing the document declares is trusted where this module can derive it. Each
 * fixture's expected state and value is recomputed from its own inputs against
 * the frozen formula, so a fixture that claims operator_claim is a present
 * confidence, or that an unknown source produced a class, is rejected rather
 * than believed.
 */

type Rational = { n: number; d: number };

type FixtureExpected = { state: string; value?: unknown };

type PrescriptionFixture = {
  fixture_id: string;
  inputs: Record<string, unknown>;
  expected: FixtureExpected;
};

type RangeSpec =
  | { kind: "unit_rational"; min: Rational; max: Rational }
  | { kind: "non_negative_rational" }
  | { kind: "non_negative_integer" }
  | { kind: "enum"; values: string[] };

export interface PrescriptionInputDefinition {
  input_id: string;
  source_events: string[];
  formula: string;
  range: RangeSpec;
  missing_rule: string;
  tie_break: string;
  fixture: PrescriptionFixture;
  version: string;
}

export interface PrescriptionInputContract {
  contract_id: string;
  contract_version: string;
  source_authority: string;
  inputs: PrescriptionInputDefinition[];
}

type ValidationResult = {
  ok: boolean;
  errors: string[];
  inputs: PrescriptionInputDefinition[];
};

type Derivation =
  | { kind: "present"; value: unknown }
  | { kind: "missing" }
  | { kind: "range" }
  | { kind: "unknown"; token: string };

const CONTRACT_ID = "prescription-inputs.v0";
const CONTRACT_VERSION = "prescription-input-contract-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#8.2";

const CONTRACT_FIELDS = ["contract_id", "contract_version", "source_authority", "inputs"];
const REQUIRED_FIELDS = [
  "input_id", "source_events", "formula", "range", "missing_rule", "tie_break", "fixture", "version"
];
const FIXTURE_FIELDS = ["fixture_id", "inputs", "expected"];
const EXPECTED_FIELDS = ["state", "value"];

const INPUT_IDS = [
  "confidence",
  "normalized_gap",
  "opportunity_count",
  "treatment_cost",
  "permission_delta",
  "expected_uplift",
  "transferability"
] as const;

type InputId = (typeof INPUT_IDS)[number];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRational = (value: unknown): value is Rational =>
  isPlainRecord(value) &&
  typeof value.n === "number" && Number.isInteger(value.n) &&
  typeof value.d === "number" && Number.isInteger(value.d);

const isCanonicalRational = (value: unknown): value is Rational =>
  isRational(value) && value.d > 0 && gcd(Math.abs(value.n), value.d) === 1;

const sameRational = (left: unknown, right: Rational): boolean =>
  isRational(left) && left.n * right.d === right.n * left.d && left.d !== 0;

const reduce = (n: number, d: number): Rational => {
  const divisor = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: n / divisor, d: d / divisor };
};

const addRational = (left: Rational, right: Rational): Rational =>
  reduce(left.n * right.d + right.n * left.d, left.d * right.d);

const lessThan = (left: Rational, right: Rational): boolean =>
  left.n * right.d < right.n * left.d;

const CONFIDENCE_TABLE: Record<string, Rational> = {
  hidden_oracle: { n: 1, d: 1 },
  signed_or_hashed_trace: { n: 9, d: 10 },
  declared_adapter_event: { n: 4, d: 5 },
  immutable_artifact: { n: 7, d: 10 },
  operator_claim: { n: 0, d: 1 }
};
const CONFIDENCE_THRESHOLD: Rational = { n: 7, d: 10 };

const UPLIFT_OF: Record<string, string> = {};
for (let index = 1; index <= 20; index += 1) {
  const id = `M${String(index).padStart(2, "0")}`;
  UPLIFT_OF[id] = id === "M19" ? "safety" : id === "M18" ? "recovery" : "quality";
}

const UPLIFT_CLASSES = ["quality", "recovery", "safety"];
const TRANSFERABILITY_CLASSES = ["operator", "environment", "combined"];

const SOURCE_EVENTS: Record<InputId, string[]> = {
  confidence: Object.keys(CONFIDENCE_TABLE),
  normalized_gap: ["factor.score"],
  opportunity_count: ["opportunity.observed"],
  treatment_cost: ["treatment.cost.time", "treatment.cost.tokens", "treatment.cost.maintenance"],
  permission_delta: ["treatment.permission.granted"],
  expected_uplift: ["metric.id"],
  transferability: ["treatment.operator_changed", "treatment.environment_changed"]
};

const FORMULAS: Record<InputId, string> = {
  confidence:
    "confidence = C[highest_precedence_observed_class] where C(hidden_oracle)=1/1, C(signed_or_hashed_trace)=9/10, C(declared_adapter_event)=4/5, C(immutable_artifact)=7/10, C(operator_claim)=0/1",
  normalized_gap: "gap = 1 - score, with score an exact rational in [0,1]",
  opportunity_count: "count = number of distinct opportunity.observed ids",
  treatment_cost: "cost = time + tokens + maintenance, each an exact non-negative rational",
  permission_delta: "delta = number of newly granted permission surfaces",
  expected_uplift: "uplift_class = quality for M01-M17 and M20, recovery for M18, safety for M19",
  transferability:
    "operator if only operator changed, environment if only environment changed, combined if both, MISSING if neither"
};

const MISSING_RULES: Record<InputId, string> = {
  confidence:
    "if no observed evidence class or confidence < 7/10 then MISSING and the metric is excluded from candidates",
  normalized_gap: "if score is absent then MISSING; a missing gap does not enter the comparison",
  opportunity_count:
    "if opportunity_ids is absent or count < 2 then MISSING and the metric is excluded from candidates",
  treatment_cost: "if time, tokens, or maintenance is absent then MISSING; absence is not a zero",
  permission_delta: "if granted is absent then MISSING; absence is not a zero",
  expected_uplift: "if metric_id is absent then MISSING; a missing class cannot be selected",
  transferability:
    "if operator_changed or environment_changed is absent, or neither changed, then MISSING; missing never defaults to operator"
};

const TIE_BREAKS: Record<InputId, string> = {
  confidence: "MISSING does not enter the gap comparison",
  normalized_gap: "a difference of 3/100 or less is a tie; a tie does not invent a winner",
  opportunity_count: "count is an eligibility gate and not a tie-break key",
  treatment_cost: "lower present cost wins; MISSING does not count as 0",
  permission_delta: "lower present delta wins after cost; MISSING does not count as 0",
  expected_uplift: "class is not a numeric tie-break; a missing class cannot be selected",
  transferability: "combined never presents as operator; missing never defaults to operator"
};

const RANGES: Record<InputId, RangeSpec> = {
  confidence: { kind: "unit_rational", min: { n: 0, d: 1 }, max: { n: 1, d: 1 } },
  normalized_gap: { kind: "unit_rational", min: { n: 0, d: 1 }, max: { n: 1, d: 1 } },
  opportunity_count: { kind: "non_negative_integer" },
  treatment_cost: { kind: "non_negative_rational" },
  permission_delta: { kind: "non_negative_integer" },
  expected_uplift: { kind: "enum", values: [...UPLIFT_CLASSES] },
  transferability: { kind: "enum", values: [...TRANSFERABILITY_CLASSES] }
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const sameStringList = (left: unknown, right: string[]): boolean =>
  Array.isArray(left) &&
  left.length === right.length &&
  right.every((entry, index) => left[index] === entry);

const valueInRange = (range: RangeSpec, value: unknown): boolean => {
  if (range.kind === "unit_rational") {
    return isCanonicalRational(value) && value.n >= 0 && value.n <= value.d;
  }
  if (range.kind === "non_negative_rational") {
    return isCanonicalRational(value) && value.n >= 0;
  }
  if (range.kind === "non_negative_integer") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  return typeof value === "string" && range.values.includes(value);
};

const valuesEqual = (left: unknown, right: unknown): boolean =>
  isRational(right) ? sameRational(left, right) : left === right;

const deriveConfidence = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "evidence_class")) return { kind: "missing" };
  const evidenceClass = inputs.evidence_class;
  if (typeof evidenceClass !== "string") return { kind: "range" };
  if (!Object.hasOwn(CONFIDENCE_TABLE, evidenceClass)) return { kind: "unknown", token: evidenceClass };
  const value = CONFIDENCE_TABLE[evidenceClass];
  if (lessThan(value, CONFIDENCE_THRESHOLD)) return { kind: "missing" };
  return { kind: "present", value };
};

const deriveGap = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "score")) return { kind: "missing" };
  const score = inputs.score;
  if (!isCanonicalRational(score) || score.n < 0 || score.n > score.d) return { kind: "range" };
  return { kind: "present", value: reduce(score.d - score.n, score.d) };
};

const deriveCount = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "opportunity_ids")) return { kind: "missing" };
  const ids = inputs.opportunity_ids;
  if (!Array.isArray(ids) || ids.some((entry) => typeof entry !== "string")) return { kind: "range" };
  const count = new Set(ids).size;
  if (count < 2) return { kind: "missing" };
  return { kind: "present", value: count };
};

const deriveCost = (inputs: Record<string, unknown>): Derivation => {
  const keys = ["time", "tokens", "maintenance"] as const;
  for (const key of keys) {
    if (!Object.hasOwn(inputs, key)) return { kind: "missing" };
    const value = inputs[key];
    if (!isCanonicalRational(value) || value.n < 0) return { kind: "range" };
  }
  const total = addRational(
    addRational(inputs.time as Rational, inputs.tokens as Rational),
    inputs.maintenance as Rational
  );
  return { kind: "present", value: total };
};

const derivePermission = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "granted")) return { kind: "missing" };
  const granted = inputs.granted;
  if (!Array.isArray(granted) || granted.some((entry) => typeof entry !== "string")) return { kind: "range" };
  return { kind: "present", value: granted.length };
};

const deriveUplift = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "metric_id")) return { kind: "missing" };
  const metricId = inputs.metric_id;
  if (typeof metricId !== "string" || !Object.hasOwn(UPLIFT_OF, metricId)) {
    return { kind: "unknown", token: String(metricId) };
  }
  return { kind: "present", value: UPLIFT_OF[metricId] };
};

const deriveTransfer = (inputs: Record<string, unknown>): Derivation => {
  if (!Object.hasOwn(inputs, "operator_changed") || !Object.hasOwn(inputs, "environment_changed")) {
    return { kind: "missing" };
  }
  const operatorChanged = inputs.operator_changed;
  const environmentChanged = inputs.environment_changed;
  if (typeof operatorChanged !== "boolean" || typeof environmentChanged !== "boolean") {
    return { kind: "range" };
  }
  if (operatorChanged && !environmentChanged) return { kind: "present", value: "operator" };
  if (environmentChanged && !operatorChanged) return { kind: "present", value: "environment" };
  if (operatorChanged && environmentChanged) return { kind: "present", value: "combined" };
  return { kind: "missing" };
};

const DERIVE: Record<InputId, (inputs: Record<string, unknown>) => Derivation> = {
  confidence: deriveConfidence,
  normalized_gap: deriveGap,
  opportunity_count: deriveCount,
  treatment_cost: deriveCost,
  permission_delta: derivePermission,
  expected_uplift: deriveUplift,
  transferability: deriveTransfer
};

const isInputId = (value: unknown): value is InputId =>
  typeof value === "string" && (INPUT_IDS as readonly string[]).includes(value);

export const validatePrescriptionInputContract = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const add = (message: string) => { errors.push(message); };

  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["CONTRACT_NOT_AN_OBJECT the prescription input contract must be a JSON object"], inputs: [] };
  }

  for (const field of Object.keys(input)) {
    if (!CONTRACT_FIELDS.includes(field)) add(`CONTRACT_DEAD_FIELD ${field} is not part of contract v0`);
  }
  if (input.contract_id !== CONTRACT_ID) add(`CONTRACT_ID_MISMATCH expected ${CONTRACT_ID}`);
  if (input.contract_version !== CONTRACT_VERSION) add("VERSION_MISMATCH");
  if (input.source_authority !== SOURCE_AUTHORITY) {
    add(`SOURCE_AUTHORITY_MISMATCH expected ${SOURCE_AUTHORITY}`);
  }

  const rawInputs = input.inputs;
  if (!Array.isArray(rawInputs)) {
    add("INPUTS_MISSING the contract must declare an inputs array");
    return { ok: false, errors, inputs: [] };
  }

  if (rawInputs.length !== INPUT_IDS.length) add(`INPUT_COUNT_NOT_7 found ${rawInputs.length}`);

  const seen = new Set<string>();
  const present = new Set<string>();
  const ordered: string[] = [];
  for (const entry of rawInputs) {
    const id = isPlainRecord(entry) ? entry.input_id : undefined;
    if (!isInputId(id)) {
      add(`UNKNOWN_INPUT_ID ${String(id)} is outside the frozen prescription-input set`);
      continue;
    }
    if (seen.has(id)) add(`DUPLICATE_INPUT_ID ${id} appears more than once`);
    seen.add(id);
    present.add(id);
    ordered.push(id);
  }
  for (const id of INPUT_IDS) {
    if (!present.has(id)) add(`INPUT_ID_GAP ${id} is absent from the contract`);
  }
  const expectedOrder = INPUT_IDS.filter((id) => present.has(id));
  for (let index = 0; index < ordered.length && index < expectedOrder.length; index += 1) {
    if (ordered[index] === expectedOrder[index]) continue;
    add(`INPUT_ORDER_BROKEN ${ordered[index]} follows ${index === 0 ? "<start>" : ordered[index - 1]}`);
    break;
  }

  const inputs: PrescriptionInputDefinition[] = [];
  for (const entry of rawInputs) {
    if (!isPlainRecord(entry)) {
      add("INPUT_NOT_AN_OBJECT a contract entry is not an object");
      continue;
    }
    const id = typeof entry.input_id === "string" ? entry.input_id : "<unnamed>";

    for (const field of REQUIRED_FIELDS) {
      if (Object.hasOwn(entry, field)) continue;
      if (field === "formula") add(`MISSING_FORMULA ${id}`);
      else add(`MISSING_FIELD ${id} ${field} is required by contract v0`);
    }
    for (const field of Object.keys(entry)) {
      if (!REQUIRED_FIELDS.includes(field)) add(`DEAD_FIELD ${id} ${field} is not part of contract v0`);
    }

    if (Object.hasOwn(entry, "formula")) {
      if (typeof entry.formula !== "string" || entry.formula.trim() === "") add(`MISSING_FORMULA ${id}`);
      else if (isInputId(id) && entry.formula !== FORMULAS[id]) add(`FORMULA_MISMATCH ${id}`);
    }
    if (isInputId(id) && Object.hasOwn(entry, "missing_rule") && entry.missing_rule !== MISSING_RULES[id]) {
      add(`MISSING_RULE_MISMATCH ${id}`);
    }
    if (isInputId(id) && Object.hasOwn(entry, "tie_break") && entry.tie_break !== TIE_BREAKS[id]) {
      add(`TIE_BREAK_MISMATCH ${id}`);
    }
    if (Object.hasOwn(entry, "version") && entry.version !== CONTRACT_VERSION) {
      add(`VERSION_MISMATCH ${id}`);
    }
    if (isInputId(id) && Object.hasOwn(entry, "range") && !sameJson(entry.range, RANGES[id])) {
      add(`RANGE_MISMATCH ${id}`);
    }
    if (Object.hasOwn(entry, "source_events")) {
      const declared = entry.source_events;
      if (isInputId(id) && Array.isArray(declared)) {
        for (const event of declared) {
          if (typeof event !== "string" || !SOURCE_EVENTS[id].includes(event)) {
            add(`UNKNOWN_SOURCE ${id} ${String(event)}`);
          }
        }
        if (!sameStringList(declared, SOURCE_EVENTS[id])) add(`SOURCE_EVENTS_MISMATCH ${id}`);
      } else {
        add(`SOURCE_EVENTS_MISMATCH ${id}`);
      }
    }

    if (Object.hasOwn(entry, "fixture")) {
      validateFixture(entry as PrescriptionInputDefinition, id, add);
    }

    if (isInputId(id)) inputs.push(entry as unknown as PrescriptionInputDefinition);
  }

  return { ok: errors.length === 0, errors, inputs };
};

const validateFixture = (
  entry: PrescriptionInputDefinition,
  id: string,
  add: (message: string) => void
): void => {
  const fixture = entry.fixture as unknown;
  if (!isPlainRecord(fixture)) {
    add(`FIXTURE_INVALID ${id} fixture is not an object`);
    return;
  }
  for (const field of Object.keys(fixture)) {
    if (!FIXTURE_FIELDS.includes(field)) add(`FIXTURE_DEAD_FIELD ${id} ${field}`);
  }
  for (const field of FIXTURE_FIELDS) {
    if (!Object.hasOwn(fixture, field)) add(`MISSING_FIELD ${id} fixture.${field}`);
  }
  if (!isPlainRecord(fixture.inputs) || !isPlainRecord(fixture.expected)) {
    add(`FIXTURE_INVALID ${id} fixture is missing inputs or expected`);
    return;
  }

  const fixtureId = typeof fixture.fixture_id === "string" ? fixture.fixture_id : `${id}-<unnamed>`;
  if (fixture.fixture_id !== `${id}-v0`) add(`FIXTURE_ID_MISMATCH ${id} expected ${id}-v0`);

  const expected = fixture.expected;
  for (const field of Object.keys(expected)) {
    if (!EXPECTED_FIELDS.includes(field)) add(`FIXTURE_DEAD_FIELD ${fixtureId} expected.${field}`);
  }
  if (expected.state !== "PRESENT" && expected.state !== "MISSING") {
    add(`FIXTURE_STATE_INVALID ${fixtureId} ${String(expected.state)}`);
    return;
  }
  if (expected.state === "MISSING" && Object.hasOwn(expected, "value")) {
    add(`MISSING_CARRIES_VALUE ${fixtureId}`);
  }
  if (expected.state === "PRESENT") {
    if (!Object.hasOwn(expected, "value")) {
      add(`FIXTURE_VALUE_MISSING ${fixtureId}`);
    } else if (isInputId(id) && !valueInRange(RANGES[id], expected.value)) {
      add(`RANGE ${fixtureId}`);
    }
  }

  if (!isInputId(id)) return;
  const derived = DERIVE[id](fixture.inputs);
  if (derived.kind === "unknown") {
    add(`UNKNOWN_SOURCE ${fixtureId} ${derived.token}`);
    return;
  }
  if (derived.kind === "range") {
    add(`RANGE ${fixtureId}`);
    return;
  }
  if (derived.kind === "missing") {
    if (expected.state !== "MISSING") add(`FIXTURE_MISMATCH ${fixtureId}`);
    return;
  }
  if (expected.state !== "PRESENT" || !valuesEqual(expected.value, derived.value)) {
    add(`FIXTURE_MISMATCH ${fixtureId}`);
  }
};
