/**
 * Frozen adapter capability matrix validator for SSOT §9.2.
 *
 * The matrix is data (`specs/adapter-capabilities.v0.json`); this module is the executable
 * contract that refuses a matrix which drifts from the SSOT §9.2 "v0 event coverage matrix".
 * Completeness is the point: the contract is exhaustive over (event group × runtime), and a
 * missing or extra cell fails closed rather than defaulting to anything.
 *
 * Nothing the frozen table determines is read from the document. The status set, the
 * requirement scope, the conditional metrics, the missing-effect classes, the affected metric
 * ids, the unconditionally REQUIRED event-group set, the per-cell status and the per-runtime
 * coverage lists are all recomputed from the four frozen text columns and compared. The four
 * columns themselves are pinned verbatim, so a document cannot make the derivation agree by
 * quietly rewriting the prose it derives from.
 *
 * Two invariants carry most of the weight. A row whose 계약 cell is anything other than
 * exactly "REQUIRED" — including "REQUIRED for M18/M20" and "DERIVED/CONDITIONAL" — is never
 * admitted into the unconditional required set. And SSOT §9.2 line 980 ("DERIVED 근거가
 * 없으면 UNAVAILABLE이다") is enforced as a derivation, not a warning: a derived cell with no
 * derivation proof falls to UNAVAILABLE and must be declared as a known missing event.
 */

export type CapabilityStatus = "REQUIRED" | "CONDITIONAL" | "DERIVED" | "BEST_EFFORT" | "UNAVAILABLE";

export interface CapabilityRow {
  event_group: string;
  ordinal: number;
  source_row: string;
  contract: string;
  statuses: CapabilityStatus[];
  requirement_scope: string;
  condition_metrics: string[];
  missing_effect: string;
  missing_effects: string[];
  affected_metrics: string[];
  runtimes: Record<string, {
    capture: string;
    source_class: string;
    evidence_locator: string;
    derivation_proof: string | null;
    redaction: string[];
    runtime_constraint: string[];
    status: CapabilityStatus;
  }>;
}

type RuntimeCoverage = { supported_event_groups: string[]; known_missing_events: string[] };

type ValidationResult = {
  ok: boolean;
  errors: string[];
  rows: CapabilityRow[];
  required_event_groups: string[];
  coverage: Record<string, RuntimeCoverage>;
};

const CONTRACT_ID = "adapter-capabilities.v0";
const CONTRACT_VERSION = "adapter-capability-contract-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#9.2";

const MATRIX_FIELDS = [
  "contract_id", "contract_version", "source_authority", "redaction_policy", "status_definitions",
  "capability_digest_fields", "runtimes", "unconditional_required_event_groups", "rows"
];
const ROW_FIELDS = [
  "event_group", "ordinal", "source_row", "contract", "statuses", "requirement_scope",
  "condition_metrics", "missing_effect", "missing_effects", "affected_metrics", "runtimes"
];
const CELL_FIELDS = [
  "capture", "source_class", "evidence_locator", "derivation_proof", "redaction",
  "runtime_constraint", "status"
];
const STATUS_DEFINITION_FIELDS = ["status", "ordinal", "source_clause", "definition"];
const RUNTIME_FIELDS = [
  "runtime_id", "source_clause", "primary_sources", "secondary_sources", "forbidden_sources",
  "supported_event_groups", "known_missing_events"
];

/** SSOT §9.2 lines 943-947, in the order the document enumerates them. */
const STATUS_ORDER: CapabilityStatus[] = ["REQUIRED", "CONDITIONAL", "DERIVED", "BEST_EFFORT", "UNAVAILABLE"];
const FROZEN_STATUS_CLAUSES: Record<CapabilityStatus, string> = {
  REQUIRED: "REQUIRED: scored run에 반드시 필요. 누락 시 관련 metric 또는 전체 점수 차단",
  CONDITIONAL: "CONDITIONAL: 해당 기능을 사용했거나 scenario가 opportunity를 부여한 경우 필수",
  DERIVED: "DERIVED: workspace·runner·artifact에서 결정론적으로 재구성 가능",
  BEST_EFFORT: "BEST_EFFORT: 있으면 진단에 사용하되 누락을 사용자 실패로 처리하지 않음",
  UNAVAILABLE: "UNAVAILABLE: adapter가 관찰할 수 없음. 관련 metric은 NOT OBSERVED"
};

/** SSOT §9.2 line 939: the exact fields a capability digest must carry. */
const DIGEST_FIELDS = [
  "runtime_version", "protocol_or_schema_version", "adapter_version",
  "source_class", "supported_event_groups", "known_missing_events"
];

/** SSOT §9.2 line 935. Redaction is per cell, because a single unredacted capture leaks. */
const REDACTION_CLAUSE =
  "각 adapter는 허용된 source class만 사용해 capability를 선언하며 raw secret과 hidden reasoning은 어떤 source에서도 저장하지 않는다.";
const NEVER_STORED = ["raw_secret", "hidden_reasoning"];

/** SSOT §9.2 lines 937-938. The clause is pinned because the guards below read it. */
const RUNTIME_IDS = ["codex", "claude-code"];
const FROZEN_RUNTIMES: Record<string, { clause: string; primary: string[]; secondary: string[]; forbidden: string[] }> = {
  codex: {
    clause: "Codex v0 primary는 app-server stdio JSON-RPC와 exact installed generated schema/digest다. experimental websocket, private DB, undocumented log는 금지한다.",
    primary: ["app-server stdio JSON-RPC", "exact installed generated schema/digest"],
    secondary: ["bounded wrapper", "workspace artifact"],
    forbidden: ["experimental websocket", "private DB", "undocumented log"]
  },
  "claude-code": {
    clause: "Claude Code v0 primary는 official TypeScript SDK `query()`/`SDKMessage`, `stream-json`, official permission/tool surface다. bounded wrapper/workspace artifact는 secondary이며 internal transcript/cache/log는 금지한다.",
    primary: ["official TypeScript SDK query()/SDKMessage", "stream-json", "official permission/tool surface"],
    secondary: ["bounded wrapper", "workspace artifact"],
    forbidden: ["internal transcript", "internal cache", "internal log"]
  }
};

const SOURCE_CLASSES = ["PRIMARY", "SECONDARY", "RUNNER_DERIVED"];

/**
 * Which capability-digest versions invalidate a cell, by source class. A cell read off the
 * runtime's official protocol surface is invalidated by a runtime, protocol/schema or adapter
 * change; a bounded wrapper never parses the protocol schema; a runner-derived cell is
 * produced by the runner outside the runtime process entirely.
 */
const CONSTRAINT_OF: Record<string, string[]> = {
  PRIMARY: ["runtime_version", "protocol_or_schema_version", "adapter_version"],
  SECONDARY: ["runtime_version", "adapter_version"],
  RUNNER_DERIVED: ["adapter_version"]
};

/**
 * The SSOT §9.2 "v0 event coverage matrix" (lines 951-966), verbatim.
 * [event_group, Event group, 계약, Codex adapter v0, Claude Code adapter v0, 누락 처리]
 */
const FROZEN_MATRIX: [string, string, string, string, string, string][] = [
  ["run_lifecycle", "run/task lifecycle, timestamps", "REQUIRED", "wrapper capture", "wrapper capture", "run invalid"],
  ["runtime_identity", "runtime·model·harness identity", "REQUIRED", "runtime query + config digest", "runtime query + config digest", "score blocked"],
  ["user_instruction", "user instruction·clarification", "REQUIRED", "wrapper/app-server event", "SDK/stream-json event", "M01–M04 blocked"],
  ["tool_call", "tool call·result·error", "REQUIRED", "supported app-server event/wrapper", "official SDK event/wrapper", "affected metrics blocked"],
  ["workspace_diff", "workspace diff·artifact digest", "DERIVED", "runner filesystem", "runner filesystem", "run invalid if derivation fails"],
  ["evidence_claim", "evidence created·invalidated·completion claim", "REQUIRED", "wrapper + scorer events", "wrapper + scorer events", "M15–M17 blocked"],
  ["approval_safety", "approval·permission·safety event", "REQUIRED", "sandbox/approval wrapper", "permission hook/wrapper", "M19 blocked; score may be withheld"],
  ["context_selection", "context selection·injection·compaction", "CONDITIONAL", "config/log + wrapper", "hook/log + wrapper", "M05/M07 NOT OBSERVED"],
  ["retrieval_memory", "retrieval·memory read/write", "CONDITIONAL", "intercepted tool/MCP events", "intercepted tool/MCP events", "M06/M07 NOT OBSERVED"],
  ["delegation_handoff", "delegation·return·handoff·join", "CONDITIONAL", "spawn/subagent wrapper", "subagent hook/log", "M10/M11 NOT OBSERVED"],
  ["plan_state", "plan·state·checkpoint·stall", "DERIVED/CONDITIONAL", "state artifacts + runner watchdog", "state artifacts + runner watchdog", "M12–M14 blocked or NOT OBSERVED"],
  ["token_cost", "token usage·provider cost", "BEST_EFFORT", "provider/runtime metadata", "provider/runtime metadata", "M20 uses calls·wall·human time only or NOT OBSERVED"],
  ["human_active_time", "human active time·takeover", "REQUIRED for M18/M20", "explicit intervention event + timer", "explicit intervention event + timer", "M18/M20 NOT OBSERVED"],
  ["actor_attribution", "actor attribution change", "REQUIRED", "wrapper + workspace correlation", "SDK/wrapper + workspace correlation", "unknown withholds score"]
];
const EVENT_GROUPS = FROZEN_MATRIX.map(([eventGroup]) => eventGroup);

/** Canonical report order for the derived missing-effect classes. */
const EFFECT_ORDER = ["RUN_INVALID", "SCORE_BLOCKED", "METRICS_BLOCKED", "SCORE_WITHHELD", "DEGRADED_SUBSTITUTE", "NOT_OBSERVED"];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sameList = (left: unknown, right: readonly string[]): boolean =>
  Array.isArray(left) && left.length === right.length && right.every((entry, index) => left[index] === entry);

/**
 * The 계약 column is the only authority on a row's requirement level. "REQUIRED for M18/M20"
 * is a conditional requirement and yields CONDITIONAL scope, never the unconditional one.
 */
const parseContract = (
  contract: string
): { statuses: CapabilityStatus[]; scope: string; conditionMetrics: string[] } | null => {
  const conditional = /^REQUIRED for (M\d{2}(?:\/M\d{2})*)$/.exec(contract);
  if (conditional) {
    return { statuses: ["REQUIRED"], scope: "CONDITIONAL", conditionMetrics: conditional[1].split("/") };
  }
  const parts = contract.split("/");
  if (!parts.every((part) => (STATUS_ORDER as string[]).includes(part))) return null;
  const statuses = parts as CapabilityStatus[];
  if (statuses.includes("CONDITIONAL")) return { statuses, scope: "CONDITIONAL", conditionMetrics: [] };
  if (statuses.length !== 1) return null;
  if (statuses[0] === "REQUIRED") return { statuses, scope: "UNCONDITIONAL_REQUIRED", conditionMetrics: [] };
  if (statuses[0] === "DERIVED") return { statuses, scope: "DERIVED", conditionMetrics: [] };
  if (statuses[0] === "BEST_EFFORT") return { statuses, scope: "BEST_EFFORT", conditionMetrics: [] };
  return null;
};

/** The 누락 처리 column, classified. "score blocked" is score level, "M19 blocked" is not. */
const deriveEffects = (text: string): string[] => {
  const found = new Set<string>();
  if (/run invalid/.test(text)) found.add("RUN_INVALID");
  if (/score blocked/.test(text)) found.add("SCORE_BLOCKED");
  if (/blocked/.test(text.replace(/score blocked/g, ""))) found.add("METRICS_BLOCKED");
  if (/withheld|withholds/.test(text)) found.add("SCORE_WITHHELD");
  if (/uses .* only/.test(text)) found.add("DEGRADED_SUBSTITUTE");
  if (/NOT OBSERVED/.test(text)) found.add("NOT_OBSERVED");
  return EFFECT_ORDER.filter((effect) => found.has(effect));
};

/** "M01–M04 blocked" names four metrics; "M05/M07 NOT OBSERVED" names two. */
const deriveAffectedMetrics = (text: string): string[] => {
  const affected: string[] = [];
  const pattern = /M(\d{2})(?:–M(\d{2}))?/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    for (let index = first; index <= last; index += 1) affected.push(`M${String(index).padStart(2, "0")}`);
    match = pattern.exec(text);
  }
  return affected;
};

/**
 * A requirement level and its stated consequence must agree. An unconditionally REQUIRED or
 * DERIVED row blocks something when it is absent; a CONDITIONAL or BEST_EFFORT row degrades to
 * NOT OBSERVED and never blocks the score outright.
 */
const effectsCoherent = (scope: string, effects: string[]): boolean => {
  if (effects.length === 0) return false;
  if (scope === "CONDITIONAL" || scope === "BEST_EFFORT") return effects.includes("NOT_OBSERVED");
  return !effects.includes("NOT_OBSERVED");
};

export const validateCapabilityMatrix = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const add = (message: string) => { errors.push(message); };
  const empty = {
    rows: [] as CapabilityRow[],
    required_event_groups: [] as string[],
    coverage: {} as Record<string, RuntimeCoverage>
  };

  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["MATRIX_NOT_AN_OBJECT the capability matrix must be a JSON object"], ...empty };
  }
  if (!Array.isArray(input.rows)) {
    return { ok: false, errors: ["MATRIX_ROWS_MISSING the matrix must declare a rows array"], ...empty };
  }

  for (const field of Object.keys(input)) {
    if (!MATRIX_FIELDS.includes(field)) add(`MATRIX_DEAD_FIELD ${field} is not part of the capability contract`);
  }
  if (input.contract_id !== CONTRACT_ID) add(`MATRIX_CONTRACT_ID expected ${CONTRACT_ID}`);
  if (input.contract_version !== CONTRACT_VERSION) add(`MATRIX_CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  if (input.source_authority !== SOURCE_AUTHORITY) add(`MATRIX_SOURCE_AUTHORITY expected ${SOURCE_AUTHORITY}`);
  if (!sameList(input.capability_digest_fields, DIGEST_FIELDS)) {
    add(`DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`);
  }

  const policy = isPlainRecord(input.redaction_policy) ? input.redaction_policy : null;
  if (!policy || policy.source_clause !== REDACTION_CLAUSE || !sameList(policy.never_stored, NEVER_STORED)) {
    add("REDACTION_POLICY_MISMATCH the SSOT 9.2 redaction clause and never-stored classes are frozen");
  }

  validateStatusDefinitions(input.status_definitions, add);
  const rows = input.rows as CapabilityRow[];
  const declaredRuntimes = validateRuntimeDeclarations(input.runtimes, add);

  // --- identity: exactly the fourteen SSOT rows, once each, in table order ---------------
  if (rows.length !== EVENT_GROUPS.length) add(`ROW_COUNT_NOT_14 found ${rows.length}`);

  const seen = new Set<string>();
  for (const row of rows) {
    const eventGroup = isPlainRecord(row) ? row.event_group : undefined;
    if (typeof eventGroup !== "string" || !EVENT_GROUPS.includes(eventGroup)) {
      add(`UNKNOWN_EVENT_GROUP ${String(eventGroup)} is outside the frozen SSOT 9.2 matrix`);
      continue;
    }
    if (seen.has(eventGroup)) add(`DUPLICATE_EVENT_GROUP ${eventGroup} appears more than once`);
    seen.add(eventGroup);
  }
  for (const eventGroup of EVENT_GROUPS) {
    if (!seen.has(eventGroup)) add(`EVENT_GROUP_GAP ${eventGroup} is absent from the matrix`);
  }
  const ordered = rows
    .map((row) => (isPlainRecord(row) ? row.event_group : undefined))
    .filter((value): value is string => typeof value === "string" && EVENT_GROUPS.includes(value))
    .map((value) => EVENT_GROUPS.indexOf(value));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index] <= ordered[index - 1]) {
      add(`ROW_ORDER_BROKEN ${EVENT_GROUPS[ordered[index]]} follows ${EVENT_GROUPS[ordered[index - 1]]}`);
      break;
    }
  }

  // --- per-row derivation ----------------------------------------------------------------
  const derivedRequired: string[] = [];
  const coverage: Record<string, RuntimeCoverage> = {};
  for (const runtimeId of RUNTIME_IDS) coverage[runtimeId] = { supported_event_groups: [], known_missing_events: [] };

  for (const row of rows) {
    if (!isPlainRecord(row)) { add("ROW_NOT_AN_OBJECT a matrix entry is not an object"); continue; }
    const eventGroup = typeof row.event_group === "string" ? row.event_group : "<unnamed>";
    const canonicalIndex = EVENT_GROUPS.indexOf(eventGroup);

    for (const field of ROW_FIELDS) {
      if (!Object.hasOwn(row, field)) add(`MISSING_ROW_FIELD ${eventGroup} ${field} is required by the capability contract`);
    }
    for (const field of Object.keys(row)) {
      if (!ROW_FIELDS.includes(field)) add(`ROW_DEAD_FIELD ${eventGroup} ${field} is not part of the capability contract`);
    }
    if (canonicalIndex === -1) continue;

    const [, sourceRow, contract, codexCapture, claudeCapture, missingEffect] = FROZEN_MATRIX[canonicalIndex];
    const captures: Record<string, string> = { codex: codexCapture, "claude-code": claudeCapture };

    if (Object.hasOwn(row, "ordinal") && row.ordinal !== canonicalIndex + 1) {
      add(`ROW_ORDINAL_MISMATCH ${eventGroup} declares ${String(row.ordinal)} and not ${canonicalIndex + 1}`);
    }
    // The four frozen columns. Prose that contradicts the derivation would make the
    // artifact decorative, so the document must reproduce the SSOT cells exactly.
    if (Object.hasOwn(row, "source_row") && row.source_row !== sourceRow) {
      add(`SOURCE_ROW_MISMATCH ${eventGroup} must quote the SSOT 9.2 event group verbatim`);
    }
    if (Object.hasOwn(row, "contract") && row.contract !== contract) {
      add(`CONTRACT_TEXT_MISMATCH ${eventGroup} must read ${contract}`);
    }
    if (Object.hasOwn(row, "missing_effect") && row.missing_effect !== missingEffect) {
      add(`MISSING_EFFECT_TEXT_MISMATCH ${eventGroup} must read ${missingEffect}`);
    }

    // Derived from the row's own declared columns, so a rewritten column is caught twice:
    // once against the frozen text, and once as an incoherent contract.
    const declaredContract = typeof row.contract === "string" ? row.contract : contract;
    const parsed = parseContract(declaredContract);
    if (!parsed) {
      add(`CONTRACT_UNPARSEABLE ${eventGroup} ${declaredContract} carries no derivable requirement level`);
      continue;
    }
    if (Array.isArray(row.statuses)) {
      for (const status of row.statuses) {
        if (typeof status !== "string" || !(STATUS_ORDER as string[]).includes(status)) {
          add(`UNKNOWN_STATUS ${eventGroup} ${String(status)} is outside the frozen status set`);
        }
      }
    }
    if (!sameList(row.statuses, parsed.statuses)) {
      add(`STATUSES_MISMATCH ${eventGroup} derives ${parsed.statuses.join(",")}`);
    }
    if (row.requirement_scope !== parsed.scope) {
      add(`REQUIREMENT_SCOPE_MISMATCH ${eventGroup} derives ${parsed.scope}`);
    }
    if (!sameList(row.condition_metrics, parsed.conditionMetrics)) {
      add(`CONDITION_METRICS_MISMATCH ${eventGroup} derives ${parsed.conditionMetrics.join(",") || "none"}`);
    }
    if (parsed.scope === "UNCONDITIONAL_REQUIRED") derivedRequired.push(eventGroup);

    const declaredEffectText = typeof row.missing_effect === "string" ? row.missing_effect : missingEffect;
    const effects = deriveEffects(declaredEffectText);
    const affected = deriveAffectedMetrics(declaredEffectText);
    if (!sameList(row.missing_effects, effects)) {
      add(`MISSING_EFFECTS_MISMATCH ${eventGroup} derives ${effects.join(",") || "none"}`);
    }
    if (!sameList(row.affected_metrics, affected)) {
      add(`AFFECTED_METRICS_MISMATCH ${eventGroup} derives ${affected.join(",") || "none"}`);
    }
    if (!effectsCoherent(parsed.scope, effects)) {
      add(`MISSING_EFFECT_INCOHERENT ${eventGroup} ${parsed.scope} cannot have the effect set ${effects.join(",") || "none"}`);
    }

    // --- exhaustive over runtimes --------------------------------------------------------
    const cells = isPlainRecord(row.runtimes) ? row.runtimes : null;
    if (!cells) {
      if (Object.hasOwn(row, "runtimes")) add(`RUNTIME_CELLS_INVALID ${eventGroup} runtimes is not an object`);
      for (const runtimeId of RUNTIME_IDS) add(`RUNTIME_CELL_GAP ${eventGroup} ${runtimeId} has no capability cell`);
      continue;
    }
    for (const runtimeId of Object.keys(cells)) {
      if (!RUNTIME_IDS.includes(runtimeId)) add(`UNKNOWN_RUNTIME_CELL ${eventGroup} ${runtimeId} is not a declared runtime`);
    }
    for (const runtimeId of RUNTIME_IDS) {
      if (!Object.hasOwn(cells, runtimeId)) {
        add(`RUNTIME_CELL_GAP ${eventGroup} ${runtimeId} has no capability cell`);
        continue;
      }
      const status = validateCell(eventGroup, runtimeId, cells[runtimeId], captures[runtimeId], parsed.statuses, add);
      if (status === null) continue;
      const bucket = status === "UNAVAILABLE" ? "known_missing_events" : "supported_event_groups";
      coverage[runtimeId][bucket].push(eventGroup);
    }
  }

  if (!sameList(input.unconditional_required_event_groups, derivedRequired)) {
    add(`REQUIRED_SET_MISMATCH the unconditionally REQUIRED event groups derive ${derivedRequired.join(",") || "none"}`);
  }

  // A declared coverage list may neither invent support nor hide a gap.
  for (const runtimeId of RUNTIME_IDS) {
    const declared = declaredRuntimes[runtimeId];
    if (!declared) continue;
    for (const listField of ["supported_event_groups", "known_missing_events"] as const) {
      if (!sameList(declared[listField], coverage[runtimeId][listField])) {
        add(`COVERAGE_MISMATCH ${runtimeId} ${listField} derives ${coverage[runtimeId][listField].join(",") || "none"}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, rows, required_event_groups: derivedRequired, coverage };
};

const validateStatusDefinitions = (declared: unknown, add: (message: string) => void): void => {
  if (!Array.isArray(declared)) {
    add("STATUS_DEFINITION_COUNT_NOT_5 the matrix must declare the five SSOT 9.2 status definitions");
    return;
  }
  if (declared.length !== STATUS_ORDER.length) add(`STATUS_DEFINITION_COUNT_NOT_5 found ${declared.length}`);

  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { add("STATUS_DEFINITION_NOT_AN_OBJECT a status definition is not an object"); continue; }
    const status = entry.status;
    if (typeof status !== "string" || !(STATUS_ORDER as string[]).includes(status)) {
      add(`UNKNOWN_STATUS ${String(status)} is outside the frozen status set`);
      continue;
    }
    if (seen.has(status)) add(`DUPLICATE_STATUS_DEFINITION ${status} appears more than once`);
    seen.add(status);

    for (const field of STATUS_DEFINITION_FIELDS) {
      if (!Object.hasOwn(entry, field)) add(`MISSING_STATUS_DEFINITION_FIELD ${status} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!STATUS_DEFINITION_FIELDS.includes(field)) add(`STATUS_DEFINITION_DEAD_FIELD ${status} ${field}`);
    }
    const canonicalIndex = (STATUS_ORDER as string[]).indexOf(status);
    if (canonicalIndex !== index) {
      add(`STATUS_DEFINITION_ORDER_BROKEN ${status} sits at position ${index + 1} and not ${canonicalIndex + 1}`);
    }
    if (Object.hasOwn(entry, "ordinal") && entry.ordinal !== canonicalIndex + 1) {
      add(`STATUS_DEFINITION_ORDINAL_MISMATCH ${status} declares ${String(entry.ordinal)}`);
    }
    if (Object.hasOwn(entry, "source_clause") && entry.source_clause !== FROZEN_STATUS_CLAUSES[status as CapabilityStatus]) {
      add(`STATUS_DEFINITION_MISMATCH ${status} must quote the SSOT 9.2 status clause verbatim`);
    }
    if (Object.hasOwn(entry, "definition") && !isFilledString(entry.definition)) {
      add(`EMPTY_CONTRACT_TEXT ${status} definition`);
    }
  }
  for (const status of STATUS_ORDER) {
    if (!seen.has(status)) add(`STATUS_DEFINITION_GAP ${status} is absent from the matrix`);
  }
};

const validateRuntimeDeclarations = (
  declared: unknown,
  add: (message: string) => void
): Record<string, Record<string, unknown>> => {
  const found: Record<string, Record<string, unknown>> = {};
  if (!Array.isArray(declared)) {
    add("RUNTIME_COUNT_NOT_2 the matrix must declare the Codex and Claude Code adapters");
    return found;
  }
  if (declared.length !== RUNTIME_IDS.length) add(`RUNTIME_COUNT_NOT_2 found ${declared.length}`);

  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { add("RUNTIME_NOT_AN_OBJECT a runtime declaration is not an object"); continue; }
    const runtimeId = entry.runtime_id;
    if (typeof runtimeId !== "string" || !RUNTIME_IDS.includes(runtimeId)) {
      add(`UNKNOWN_RUNTIME ${String(runtimeId)} is outside the frozen SSOT 9.2 runtime set`);
      continue;
    }
    if (Object.hasOwn(found, runtimeId)) { add(`DUPLICATE_RUNTIME ${runtimeId} appears more than once`); continue; }
    if (RUNTIME_IDS.indexOf(runtimeId) !== index) {
      add(`RUNTIME_ORDER_BROKEN ${runtimeId} sits at position ${index + 1}`);
    }
    found[runtimeId] = entry;

    for (const field of RUNTIME_FIELDS) {
      if (!Object.hasOwn(entry, field)) add(`MISSING_RUNTIME_FIELD ${runtimeId} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!RUNTIME_FIELDS.includes(field)) add(`RUNTIME_DEAD_FIELD ${runtimeId} ${field} is not part of the capability contract`);
    }
    const frozen = FROZEN_RUNTIMES[runtimeId];
    if (Object.hasOwn(entry, "source_clause") && entry.source_clause !== frozen.clause) {
      add(`RUNTIME_SOURCE_CLAUSE_MISMATCH ${runtimeId} must quote the SSOT 9.2 source-class clause verbatim`);
    }
    const inventories: [string, string[]][] = [
      ["primary_sources", frozen.primary],
      ["secondary_sources", frozen.secondary],
      ["forbidden_sources", frozen.forbidden]
    ];
    for (const [field, expected] of inventories) {
      if (Object.hasOwn(entry, field) && !sameList(entry[field], expected)) {
        add(`RUNTIME_SOURCE_INVENTORY_MISMATCH ${runtimeId} ${field} must read ${expected.join(",")}`);
      }
    }
  }
  for (const runtimeId of RUNTIME_IDS) {
    if (!Object.hasOwn(found, runtimeId)) add(`RUNTIME_GAP ${runtimeId} is absent from the matrix`);
  }
  return found;
};

/** Returns the derived status of the cell, or null when the cell is too broken to place. */
const validateCell = (
  eventGroup: string,
  runtimeId: string,
  cell: unknown,
  capture: string,
  statuses: CapabilityStatus[],
  add: (message: string) => void
): CapabilityStatus | null => {
  if (!isPlainRecord(cell)) { add(`CELL_NOT_AN_OBJECT ${eventGroup} ${runtimeId}`); return null; }

  for (const field of CELL_FIELDS) {
    if (!Object.hasOwn(cell, field)) add(`MISSING_CELL_FIELD ${eventGroup} ${runtimeId} ${field} is required by the capability contract`);
  }
  for (const field of Object.keys(cell)) {
    if (!CELL_FIELDS.includes(field)) add(`CELL_DEAD_FIELD ${eventGroup} ${runtimeId} ${field} is not part of the capability contract`);
  }
  if (Object.hasOwn(cell, "capture") && cell.capture !== capture) {
    add(`CAPTURE_TEXT_MISMATCH ${eventGroup} ${runtimeId} must read ${capture}`);
  }

  // A cell that names no source is not a capability. SSOT 9.2 also bars named source
  // classes outright, so naming a forbidden one is worse than naming none.
  const locator = cell.evidence_locator;
  if (Object.hasOwn(cell, "evidence_locator")) {
    if (!isFilledString(locator)) {
      add(`EMPTY_EVIDENCE_LOCATOR ${eventGroup} ${runtimeId} declares no evidence source`);
    } else {
      for (const forbidden of FROZEN_RUNTIMES[runtimeId].forbidden) {
        if (locator.toLowerCase().includes(forbidden.toLowerCase())) {
          add(`FORBIDDEN_SOURCE ${eventGroup} ${runtimeId} ${forbidden} is forbidden by SSOT 9.2`);
        }
      }
    }
  }

  if (!sameList(cell.redaction, NEVER_STORED)) {
    add(`REDACTION_MISMATCH ${eventGroup} ${runtimeId} must redact ${NEVER_STORED.join(",")}`);
  }

  const sourceClass = cell.source_class;
  const known = typeof sourceClass === "string" && SOURCE_CLASSES.includes(sourceClass);
  if (!known) {
    add(`UNKNOWN_SOURCE_CLASS ${eventGroup} ${runtimeId} ${String(sourceClass)}`);
  } else {
    // SSOT 9.2: DERIVED means deterministic reconstruction from workspace, runner or
    // artifact. Only a derived row may be runner derived, and only a runner-derived cell
    // may carry a derivation proof.
    const shouldBeRunnerDerived = statuses.includes("DERIVED");
    if (shouldBeRunnerDerived !== (sourceClass === "RUNNER_DERIVED")) {
      add(`SOURCE_CLASS_MISMATCH ${eventGroup} ${runtimeId} derives ${shouldBeRunnerDerived ? "RUNNER_DERIVED" : "a non-runner source class"}`);
    }
    if (sourceClass !== "RUNNER_DERIVED" && cell.derivation_proof !== null) {
      add(`DERIVATION_PROOF_UNEXPECTED ${eventGroup} ${runtimeId} is not reconstructed from the runner`);
    }
    if (!sameList(cell.runtime_constraint, CONSTRAINT_OF[sourceClass])) {
      add(`RUNTIME_CONSTRAINT_MISMATCH ${eventGroup} ${runtimeId} derives ${CONSTRAINT_OF[sourceClass].join(",")}`);
    }
  }

  // SSOT 9.2 line 980: a derived cell with no derivation proof is UNAVAILABLE, never a
  // silently promoted DERIVED.
  const derived: CapabilityStatus =
    statuses.includes("DERIVED") && !isFilledString(cell.derivation_proof) ? "UNAVAILABLE" : statuses[0];
  if (typeof cell.status !== "string" || !(STATUS_ORDER as string[]).includes(cell.status)) {
    add(`UNKNOWN_STATUS ${eventGroup} ${runtimeId} ${String(cell.status)} is outside the frozen status set`);
    return derived;
  }
  if (cell.status !== derived) {
    add(`CELL_STATUS_MISMATCH ${eventGroup} ${runtimeId} derives ${derived}`);
  }
  return derived;
};
