const REFUSED = "protocol cannot prove every run/profile/form/deviation row is retained and blinded.";
const FORM_PREFIX = "form_";
const OBSERVATION_FIELDS = [
  "reviewer_a",
  "reviewer_b",
  "review_adjudication",
  "duration_minutes",
  "automated_score",
  "expert_review",
  "transfer_outcome"
];

type Failure = Readonly<{ ok: false; reason: string }>;
type Success = Readonly<{ ok: true }>;
type Result = Success | Failure;
type AlphaRow = Readonly<Record<string, unknown>>;
type ReferenceRun = Readonly<{ reference_run_id: string; profile_id: string }>;
type Snapshot = Readonly<{
  mode: "dry-run";
  executed: false;
  rows: readonly AlphaRow[];
  referenceRuns: readonly ReferenceRun[];
  formAssignments: Readonly<Record<string, number>>;
  reviewerRows: readonly Readonly<Record<string, unknown>>[];
  deviationRows: readonly Readonly<{ participant_id: string; deviation_id: string }>[];
}>;
type AlphaRun = Readonly<{
  ok: true;
  mode: "dry-run";
  executed: false;
  replaceRecordedRow: (participantId: unknown, row: unknown) => Result;
  recordDeviation: (input: unknown) => Result;
  emitVerdict: (candidate: unknown) => Result;
  snapshot: () => Snapshot;
}>;
type Rules = Readonly<{
  rowFields: readonly string[];
  formAssignments: Readonly<Record<string, number>>;
  missingReasons: ReadonlySet<string>;
  blindedFields: ReadonlySet<string>;
  allowedVerdicts: ReadonlySet<string>;
}>;

const refuse = (): Failure => ({ ok: false, reason: REFUSED });
const accept = (): Success => ({ ok: true });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const hasExactly = (record: Record<string, unknown>, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const copy = <T>(value: T): T | null => {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
};

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const listed = (entries: ReadonlyMap<string, string>, key: string): readonly string[] | null => {
  const value = entries.get(key);
  if (!isFilledString(value)) return null;
  const items = value.split(",").map((item) => item.trim());
  return items.length > 0 && items.every(isFilledString) && new Set(items).size === items.length ? items : null;
};

const booleanValue = (entries: ReadonlyMap<string, string>, key: string): boolean | null => {
  const value = entries.get(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const manifestOf = (protocol: string): ReadonlyMap<string, string> | null => {
  const section = protocol.match(/<!-- alpha-protocol-manifest:start -->([\s\S]*?)<!-- alpha-protocol-manifest:end -->/);
  if (section === null) return null;
  const entries = new Map<string, string>();
  for (const line of section[1].trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!isFilledString(key) || !isFilledString(value) || entries.has(key)) return null;
    entries.set(key, value);
  }
  return entries;
};

const rowFieldsOf = (protocol: string): readonly string[] | null => {
  const section = protocol.match(/<!-- alpha-row-fields:start -->([\s\S]*?)<!-- alpha-row-fields:end -->/);
  if (section === null) return null;
  const fields = [...section[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
  return fields.length > 0 && fields.every(isFilledString) && new Set(fields).size === fields.length ? fields : null;
};

const formAssignmentsOf = (entries: ReadonlyMap<string, string>): Readonly<Record<string, number>> | null => {
  const assignments: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith(FORM_PREFIX)) continue;
    const form = key.slice(FORM_PREFIX.length).toUpperCase();
    const assigned = Number(value);
    if (!isFilledString(form) || !Number.isSafeInteger(assigned) || assigned < 0 || Object.hasOwn(assignments, form)) return null;
    assignments[form] = assigned;
  }
  return Object.keys(assignments).length > 0 ? freeze(assignments) : null;
};

const rulesOf = (protocol: unknown): Rules | null => {
  if (!isFilledString(protocol)) return null;
  const entries = manifestOf(protocol);
  const rowFields = rowFieldsOf(protocol);
  if (entries === null || rowFields === null) return null;

  const missingReasons = listed(entries, "missing_reasons");
  const blindedFields = listed(entries, "blinded_fields");
  const allowedVerdicts = listed(entries, "allowed_verdicts");
  const formAssignments = formAssignmentsOf(entries);
  const deleteRows = booleanValue(entries, "delete_rows");
  if (
    missingReasons === null ||
    blindedFields === null ||
    allowedVerdicts === null ||
    formAssignments === null ||
    deleteRows !== false
  ) return null;

  return freeze({
    rowFields: freeze([...rowFields]),
    formAssignments,
    missingReasons: new Set(missingReasons),
    blindedFields: new Set(blindedFields),
    allowedVerdicts: new Set(allowedVerdicts)
  });
};

const referenceRunsOf = (value: unknown): readonly ReferenceRun[] | null => {
  if (!Array.isArray(value)) return null;
  const runs: ReferenceRun[] = [];
  const identifiers = new Set<string>();
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !hasExactly(candidate, ["reference_run_id", "profile_id"])) return null;
    if (!isFilledString(candidate.reference_run_id) || !isFilledString(candidate.profile_id) || identifiers.has(candidate.reference_run_id)) return null;
    identifiers.add(candidate.reference_run_id);
    runs.push({ reference_run_id: candidate.reference_run_id, profile_id: candidate.profile_id });
  }
  return freeze(runs);
};

const hasMissingObservation = (row: Record<string, unknown>): boolean => OBSERVATION_FIELDS.some((field) => row[field] === null);

const rowOf = (value: unknown, rules: Rules, referenceRunIds: ReadonlySet<string>): AlphaRow | null => {
  if (!isPlainRecord(value) || !hasExactly(value, rules.rowFields)) return null;
  if (!isFilledString(value.participant_id) || value.consent_recorded !== true) return null;
  if (!isFilledString(value.form) || !Object.hasOwn(rules.formAssignments, value.form)) return null;

  const referenceRunId = value.reference_run_id;
  if (!isFilledString(referenceRunId) || !referenceRunIds.has(referenceRunId)) return null;

  const missingReason = value.missing_reason;
  if (hasMissingObservation(value)) {
    if (!isFilledString(missingReason) || !rules.missingReasons.has(missingReason)) return null;
  } else if (missingReason !== null) return null;

  return freeze({ ...value });
};

const assignmentsOf = (value: unknown, rules: Rules): Readonly<Record<string, number>> | null => {
  if (!isPlainRecord(value) || !hasExactly(value, Object.keys(rules.formAssignments))) return null;
  for (const [form, count] of Object.entries(rules.formAssignments)) {
    if (value[form] !== count) return null;
  }
  return freeze({ ...value } as Record<string, number>);
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const reviewerRowOf = (row: AlphaRow, rules: Rules): Readonly<Record<string, unknown>> => {
  const reviewerRow: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    if (!rules.blindedFields.has(field)) reviewerRow[field] = value;
  }
  return freeze(reviewerRow);
};

const deviationRowOf = (row: AlphaRow): Readonly<{ participant_id: string; deviation_id: string }> | null =>
  isFilledString(row.participant_id) && isFilledString(row.deviation_id)
    ? freeze({ participant_id: row.participant_id, deviation_id: row.deviation_id })
    : null;

export const runAlphaProtocol = (input: unknown): AlphaRun | Failure => {
  const copiedInput = copy(input);
  if (!isPlainRecord(copiedInput) || !hasExactly(copiedInput, ["mode", "protocol", "rows", "referenceRuns", "formAssignments"])) return refuse();
  if (copiedInput.mode !== "dry-run") return refuse();

  const rules = rulesOf(copiedInput.protocol);
  const referenceRuns = referenceRunsOf(copiedInput.referenceRuns);
  if (rules === null || referenceRuns === null || !Array.isArray(copiedInput.rows)) return refuse();

  const referenceRunIds = new Set(referenceRuns.map((run) => run.reference_run_id));
  const rows: AlphaRow[] = [];
  const participantIds = new Set<string>();
  for (const candidate of copiedInput.rows) {
    const row = rowOf(candidate, rules, referenceRunIds);
    if (row === null || !isFilledString(row.participant_id) || participantIds.has(row.participant_id)) return refuse();
    participantIds.add(row.participant_id);
    rows.push(row);
  }

  const formAssignments = assignmentsOf(copiedInput.formAssignments, rules);
  if (formAssignments === null) return refuse();

  const retainedRows = freeze(rows);
  const reviewerRows = freeze(retainedRows.map((row) => reviewerRowOf(row, rules)));
  const deviationRows = freeze(retainedRows.map(deviationRowOf).filter((row): row is Readonly<{ participant_id: string; deviation_id: string }> => row !== null));
  const snapshot = freeze({
    mode: "dry-run" as const,
    executed: false as const,
    rows: retainedRows,
    referenceRuns,
    formAssignments,
    reviewerRows,
    deviationRows
  });

  const replaceRecordedRow = (participantId: unknown, candidate: unknown): Result => {
    if (!isFilledString(participantId)) return refuse();
    const recorded = retainedRows.find((row) => row.participant_id === participantId);
    const replacement = rowOf(copy(candidate), rules, referenceRunIds);
    if (recorded === undefined || replacement === null || canonical(recorded) !== canonical(replacement)) return refuse();
    return accept();
  };

  const recordDeviation = (candidate: unknown): Result => {
    const copiedCandidate = copy(candidate);
    if (!isPlainRecord(copiedCandidate) || !hasExactly(copiedCandidate, ["participant_id", "deviation_id"])) return refuse();
    if (!isFilledString(copiedCandidate.participant_id) || !isFilledString(copiedCandidate.deviation_id)) return refuse();
    const recorded = retainedRows.find((row) => row.participant_id === copiedCandidate.participant_id);
    return recorded?.deviation_id === copiedCandidate.deviation_id ? accept() : refuse();
  };

  const emitVerdict = (candidate: unknown): Result =>
    isFilledString(candidate) && rules.allowedVerdicts.has(candidate) ? accept() : refuse();

  return freeze({ ok: true as const, mode: "dry-run" as const, executed: false as const, replaceRecordedRow, recordDeviation, emitVerdict, snapshot: () => snapshot });
};
