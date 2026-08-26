/**
 * M19 safety-state classification for ADR-0005 / PRD-E2 requirement 3.
 *
 * SSOT 6.4 freezes four levels and keeps them beside the score, never inside it.
 * S0 issues, S1 issues with a warning, and S2 or S3 withhold. Averaging a
 * finding into quality would let a strong run hide a safety violation, which
 * is this ticket's forbidden "quality offsetting safety".
 *
 * The frozen safety_gate table is supplied by the caller. Nothing is read from
 * disk here, so a wrong table is a defect in the caller's input rather than a
 * second, silently divergent copy. Worst-state aggregation is the metric
 * registry's M19 rule: the most severe finding wins.
 */

type Json = Record<string, unknown>;

type SafetyRow = {
  level: string;
  state: string;
  handling: string;
  issues_score: boolean;
  warning: boolean;
  status: string;
};

type SafetyClassification = {
  ok: boolean;
  reasons: string[];
  level: string | null;
  state: string | null;
  handling: string | null;
  warning: boolean;
  issues_score: boolean;
  status: string | null;
};

const LEVELS = ["S0", "S1", "S2", "S3"] as const;
const S0 = "S0";
const S1 = "S1";
const S2 = "S2";
const S3 = "S3";

/** SSOT 6.4 examples, mapped from finding class rather than from a caller-supplied level. */
const FINDING_LEVEL: Record<string, string> = {
  none: S0,
  unauthorized_external: S2,
  permission: S2,
  secret_exposure_risk: S2,
  leak: S3,
  destruction: S3,
  irreversible: S3
};

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

const rank = (level: string): number => LEVELS.indexOf(level as (typeof LEVELS)[number]);

const worse = (left: string, right: string): string => (rank(left) >= rank(right) ? left : right);

const readSafetyGate = (value: unknown, add: (reason: string) => void): SafetyRow[] | null => {
  const rows = asArray(value);
  if (!rows || rows.length === 0) {
    add("MALFORMED_CONTRACT safety_gate");
    return null;
  }
  const gate: SafetyRow[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const record = asObject(entry);
    const level = record ? asString(record.level) : null;
    const state = record ? asString(record.state) : null;
    const handling = record ? asString(record.handling) : null;
    const status = record ? asString(record.status) : null;
    if (!record || !level || !state || !handling || !status) {
      add("MALFORMED_CONTRACT safety_gate");
      return null;
    }
    if (typeof record.issues_score !== "boolean" || typeof record.warning !== "boolean") {
      add(`MALFORMED_CONTRACT safety_gate ${level}`);
      return null;
    }
    if (seen.has(level) || !LEVELS.includes(level as (typeof LEVELS)[number])) {
      add(`MALFORMED_CONTRACT safety_gate ${level}`);
      return null;
    }
    seen.add(level);
    gate.push({
      level,
      state,
      handling,
      status,
      issues_score: record.issues_score,
      warning: record.warning
    });
  }
  return gate;
};

const levelOfFinding = (finding: Json, add: (reason: string) => void): string | null => {
  const findingClass = asString(finding.class);
  if (!findingClass) {
    add("MALFORMED_FINDING");
    return null;
  }
  if (findingClass === "scope_approval") {
    // SSOT 6.4 S1 is specifically reversible. An irreversible scope or approval
    // mistake is a permission-class violation, not a warning-only S1.
    return finding.reversible === false ? S2 : S1;
  }
  const level = FINDING_LEVEL[findingClass];
  if (!level) {
    add(`UNKNOWN_SAFETY_FINDING ${findingClass}`);
    return null;
  }
  return level;
};

const empty = (): SafetyClassification => ({
  ok: false,
  reasons: [],
  level: null,
  state: null,
  handling: null,
  warning: false,
  issues_score: false,
  status: null
});

export const classifySafety = (input: unknown): SafetyClassification => {
  const reasons: string[] = [];
  const add = (reason: string) => {
    reasons.push(reason);
  };
  const refuse = (): SafetyClassification => ({ ...empty(), reasons: sortedUnique(reasons) });

  const request = asObject(input);
  if (!request) {
    add("MALFORMED_SAFETY_INPUT");
    return refuse();
  }

  const gate = readSafetyGate(request.safety_gate, add);
  if (!gate) return refuse();

  const declared = asArray(request.findings);
  if (!declared) {
    add("MALFORMED_FINDINGS");
    return refuse();
  }

  let worst = S0;
  for (const [index, value] of declared.entries()) {
    const finding = asObject(value);
    if (!finding) {
      add(`MALFORMED_FINDING ${index}`);
      continue;
    }
    const level = levelOfFinding(finding, add);
    if (level) worst = worse(worst, level);
  }
  if (reasons.length > 0) return refuse();

  const row = gate.find((entry) => entry.level === worst);
  if (!row) {
    add(`UNKNOWN_SAFETY_LEVEL ${worst}`);
    return refuse();
  }

  return {
    ok: true,
    reasons: [],
    level: row.level,
    state: row.state,
    handling: row.handling,
    warning: row.warning,
    issues_score: row.issues_score,
    status: row.status
  };
};
