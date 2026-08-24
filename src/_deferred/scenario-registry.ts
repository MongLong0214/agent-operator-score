import { createHash } from "node:crypto";

const REFUSED = "scenario can start without sealed budgets/opportunities/oracle/exposure.";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FIELDS = [
  "schema_version",
  "suite",
  "scenario_id",
  "family",
  "form",
  "version",
  "budgets",
  "primary_opportunity_ids",
  "secondary_opportunity_ids",
  "worker_visible",
  "fault_digest",
  "oracle_digest",
  "exposure_digest",
  "signature"
];
const BUDGET_FIELDS = ["time_minutes", "token_limit", "tool_call_limit"];

type Budgets = Readonly<{ time_minutes: number; token_limit: number; tool_call_limit: number }>;
type Fail = { ok: false; reason: string };
type Loaded = { ok: true; scenario: ScenarioDefinition };

export type ScenarioDefinition = Readonly<{
  schema_version: string;
  suite: string;
  scenario_id: string;
  family: string;
  form: string;
  version: string;
  budgets: Budgets;
  primary_opportunity_ids: readonly string[];
  secondary_opportunity_ids: readonly string[];
  worker_visible: readonly string[];
  fault_digest: string;
  oracle_digest: string;
  exposure_digest: string;
  signature: string;
}>;

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && value > 0;

const hasExactly = (record: Record<string, unknown>, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const seal = (value: Record<string, unknown>): string =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

const budgetOf = (value: unknown): Budgets | null => {
  if (!isPlainRecord(value) || !hasExactly(value, BUDGET_FIELDS)) return null;
  if (!isPositiveInteger(value.time_minutes) || !isPositiveInteger(value.token_limit) || !isPositiveInteger(value.tool_call_limit)) {
    return null;
  }
  return Object.freeze({
    time_minutes: value.time_minutes,
    token_limit: value.token_limit,
    tool_call_limit: value.tool_call_limit
  });
};

const opportunityIdsOf = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => !isFilledString(id))) return null;
  const ids = [...value];
  return Object.freeze(ids);
};

const workerVisibleOf = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries = [...value];
  if (entries.some((entry) => !isFilledString(entry) || !entry.startsWith("worker/"))) return null;
  return new Set(entries).size === entries.length ? Object.freeze(entries) : null;
};

const parsedOf = (record: Record<string, unknown>): ScenarioDefinition | null => {
  if (!hasExactly(record, FIELDS)) return null;
  const signature = record.signature;
  if (!isFilledString(signature) || !DIGEST.test(signature)) return null;

  // The v0 seal detects registry drift without claiming an authority trust root this ticket does not own.
  const unsigned: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field !== "signature") unsigned[field] = record[field];
  }
  if (signature !== seal(unsigned)) return null;

  const strings = [record.schema_version, record.suite, record.scenario_id, record.family, record.form, record.version];
  if (strings.some((value) => !isFilledString(value))) return null;
  const budgets = budgetOf(record.budgets);
  const primary = opportunityIdsOf(record.primary_opportunity_ids);
  const secondary = opportunityIdsOf(record.secondary_opportunity_ids);
  const workerVisible = workerVisibleOf(record.worker_visible);
  if (budgets === null || primary === null || secondary === null || workerVisible === null || primary.length > 4) return null;

  const opportunityIds = [...primary, ...secondary];
  if (new Set(opportunityIds).size !== opportunityIds.length) return null;
  if (![record.fault_digest, record.oracle_digest, record.exposure_digest].every((value) => isFilledString(value) && DIGEST.test(value))) {
    return null;
  }

  return Object.freeze({
    schema_version: record.schema_version,
    suite: record.suite,
    scenario_id: record.scenario_id,
    family: record.family,
    form: record.form,
    version: record.version,
    budgets,
    primary_opportunity_ids: primary,
    secondary_opportunity_ids: secondary,
    worker_visible: workerVisible,
    fault_digest: record.fault_digest,
    oracle_digest: record.oracle_digest,
    exposure_digest: record.exposure_digest,
    signature
  });
};

export const loadScenario = (input: unknown): Loaded | Fail => {
  try {
    const copied = structuredClone(input);
    if (!isPlainRecord(copied)) return refuse();
    const scenario = parsedOf(copied);
    return scenario === null ? refuse() : { ok: true, scenario };
  } catch {
    return refuse();
  }
};
