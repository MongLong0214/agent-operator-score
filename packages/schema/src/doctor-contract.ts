/**
 * Frozen capability doctor output contract for SSOT §9.2.
 *
 * The contract is data (`specs/doctor-output.v0.json`); this module is the executable rule
 * that refuses a doctor report which does not say what the frozen capability matrix says.
 * SSOT §9.2 line 977 requires `aos doctor --capabilities --runtime <runtime>` to print "위
 * matrix의 실제 상태와 근거 source" — the matrix's actual state *and* the source it rests
 * on — and line 978 requires the capability snapshot and adapter digest to be stored. A
 * report that prints a status without its source class and evidence locator, without the
 * 누락 처리 effect that status carries, or without the six §9.2 line 939 digest fields has
 * not met that clause, so each of those omissions is an error and not a cosmetic gap.
 *
 * Nothing the report declares is trusted where the matrix determines it. The command line,
 * the per-group status, source class, evidence locator, derivation proof, missing effect,
 * effect classes and affected metrics, the digest's source-class inventory, supported and
 * known-missing group lists, the verdict, its exit code, the ordered reasons and every line
 * of the human projection are recomputed from `specs/adapter-capabilities.v0.json` through
 * capability.ts and compared. The verdict in particular is never read: it is the verdict of
 * the most severe reason the matrix produces, and a report that calls a blocked adapter
 * COMPLETE is rejected rather than believed.
 *
 * The matrix is not trusted either. It is revalidated by `validateCapabilityMatrix` on every
 * call, and a matrix carrying a single error yields no doctor verdict at all — a pin whose
 * input is free would buy nothing, so the input is itself the frozen, self-checking artifact
 * E0B-001 delivered. The doctor contract also pins that matrix's contract id and version and
 * the fourteen event groups and seven unconditionally REQUIRED groups it derives, so drift on
 * either side fails: change the matrix and the doctor contract stops matching it; change the
 * doctor contract and it stops matching the matrix.
 *
 * ---------------------------------------------------------------------------------------
 * What this contract is, and what it is not
 * ---------------------------------------------------------------------------------------
 * A doctor report validated here is a faithful projection of a frozen document. It is not a
 * probe of an installed runtime, and this module has no way to become one: the ticket forbids
 * runtime probing, and nothing in `specs/adapter-capabilities.v0.json` is measured — it is
 * written down. So "COMPLETE" means "the frozen matrix says every event group of this runtime
 * is observable at its declared status, and the report repeats that correctly". It does not
 * mean any adapter was executed, and no issuer may read it as evidence that one was.
 *
 * Four inputs are declared and cannot be checked here, and each is labelled rather than
 * dressed up:
 *   - `assessment_mode` names the session the caller asked about. Deciding whether a session
 *     really was wrapped start to end is session-class.ts's job and needs a trace; here it is
 *     a caller assertion, constrained to the two frozen SSOT §9.2 classes and nothing more.
 *   - `runtime_version`, `protocol_or_schema_version` and `adapter_version` are the installed
 *     versions the caller reports. They are checked for shape — one non-blank whitespace-free
 *     token within a length bound — which proves the field was filled in, not that it names
 *     the version that is installed. That is a presence-and-shape check and it is worth
 *     exactly that much.
 *   - `evidence_locator` is proved to reproduce the frozen matrix cell verbatim. E0B-001
 *     recorded that the locator itself is validated as non-empty prose plus a substring scan
 *     against each runtime's forbidden source list; this contract inherits that limit and
 *     adds nothing to it. The report is proved to name the source the matrix names, never
 *     proved that the source exists or was read.
 *   - the nine `statement` fields of the frozen document — two assessment modes, four verdicts
 *     and three reason codes — are prose the derivation never reads and are checked for
 *     presence and non-emptiness only. That proves the field exists, not that it says anything
 *     true: the accompanying `source_clause`, `predicate`, `exit_code` and `verdict_id` are the
 *     pinned halves of every row, and a `statement` that contradicts them is accepted, so no
 *     issuer may read one as a rule. This is the same limit session-class.ts records for its
 *     own `statement` and `failure_mode` fields, stated here in the same terms.
 *
 * The return value carries one rule with no exception in it, for the same reason everything
 * above is labelled rather than dressed up. A rejected report is not an answer, so `ok === false`
 * always carries the SCORE_BLOCKED verdict, exit code 30, no reasons and no projection, whatever
 * the matrix would have derived for a correct report: a caller running
 * `process.exit(result.exit_code)` on a report this module refused must not exit zero, and a
 * report-level defect fails closed by the same rule as a matrix, contract or corpus defect. The
 * verdict the matrix does derive is still reported, in the `VERDICT_MISMATCH derives …` error.
 *
 * There is no signature, attestation or key material anywhere in this module, and there is
 * none in SSOT v1.0 §9.2 or §9.5 to implement. A trust root invented inside a contract-freezing
 * ticket would read as proof while resting on a key nobody was appointed to hold, so the gap
 * is named here and escalated to its owning ADR/PRD instead of approximated.
 *
 * One consequence of freezing v0 honestly is worth stating. SSOT §9.2 line 980 is the only
 * clause that makes a cell UNAVAILABLE — "DERIVED 근거가 없으면 UNAVAILABLE이다" — so in the
 * v0 matrix exactly two cells per runtime can reach UNAVAILABLE at all: `workspace_diff` and
 * `plan_state`, the two DERIVED rows. DEGRADED and SCORE_BLOCKED are therefore demonstrated
 * through those two rows, as frozen minimal perturbations of the real matrix rather than as a
 * second hand-written matrix that could drift away from the first.
 */

import { validateCapabilityMatrix } from "./capability.ts";

type DoctorResult = {
  ok: boolean;
  errors: string[];
  verdict: string;
  exit_code: number;
  reasons: string[];
  human_projection: string[];
};

type Observation = {
  event_group: string;
  ordinal: number;
  source_row: string;
  contract: string;
  requirement_scope: string;
  status: string;
  source_class: string;
  evidence_locator: string;
  derivation_proof: string | null;
  missing_effect: string;
  missing_effects: string[];
  affected_metrics: string[];
};

type MatrixView = {
  rows: Record<string, unknown>[];
  coverage: Record<string, { supported_event_groups: string[]; known_missing_events: string[] }>;
  required_event_groups: string[];
};

type Derived = {
  observations: Observation[];
  verdict: string;
  exit_code: number;
  reasons: string[];
  human_projection: string[];
};

const CONTRACT_ID = "doctor-output.v0";
const CONTRACT_VERSION = "doctor-output-contract-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#9.2";

/** SSOT §9.2 "Adapter acceptance", lines 977, 980 and 981. */
const ACCEPTANCE_CLAUSE =
  "aos doctor --capabilities --runtime <runtime>는 위 matrix의 실제 상태와 근거 source를 출력해야 한다.";
const NO_SILENT_ESTIMATION_CLAUSE =
  "native event가 없다는 이유로 조용히 추정하지 않는다. DERIVED 근거가 없으면 UNAVAILABLE이다.";
const NOT_USER_FAILURE_CLAUSE = "adapter coverage 부족을 사용자 능력 부족으로 해석하지 않는다.";

/**
 * The honesty paragraph. It is frozen in the document and asserted by the test suite, so
 * deleting it fails the lane on purpose: a reader must not be able to remove the statement
 * of what a doctor verdict does not prove while leaving the verdict itself in place.
 */
const DECLARED_ONLY_STATEMENT =
  "A doctor report is a projection of the frozen capability matrix, not a probe of an installed runtime. " +
  "Status, source class, evidence locator, missing effect, digest coverage, verdict, exit code, reason order " +
  "and every projection line are recomputed from specs/adapter-capabilities.v0.json and compared. " +
  "Four inputs are declared and unverifiable here: assessment_mode names the session the caller asked about, " +
  "and runtime_version, protocol_or_schema_version and adapter_version are the installed versions the caller " +
  "reports, checked for shape only. The evidence locator is proved to reproduce the frozen matrix cell, never " +
  "proved to name a source that exists or was read. The fourth is prose: the nine statement fields of this " +
  "document are checked for presence and non-emptiness only, the derivation never reads one, and a statement " +
  "that contradicts its own row's pinned source clause, predicate, exit code or verdict id is accepted, so no " +
  "issuer may read a statement as a rule.";

/** SSOT §9.2 line 977 and §9.3 line 989: the command whose output this contract governs. */
const COMMAND_TEMPLATE = "aos doctor --capabilities --runtime <runtime>";
const RUNTIME_PLACEHOLDER = "<runtime>";

/** SSOT §9.2 lines 937-938. */
const RUNTIME_IDS = ["codex", "claude-code"];

/** SSOT §9.2 line 939, in document order. */
const DIGEST_FIELDS = [
  "runtime_version", "protocol_or_schema_version", "adapter_version",
  "source_class", "supported_event_groups", "known_missing_events"
];
/** The three the caller reports; see the declared-only statement above. */
const DECLARED_DIGEST_FIELDS = ["runtime_version", "protocol_or_schema_version", "adapter_version"];
/** The three the matrix determines, recomputed and compared rather than read. */
const DERIVED_DIGEST_FIELDS = ["source_class", "supported_event_groups", "known_missing_events"];
const VERSION_TOKEN = /^\S+$/;
const VERSION_TOKEN_MAX_CHARS = 64;
// A version token is echoed into the projection and stored in the digest, so control and
// bidi characters are refused: they forge terminal output, disguise direction and break
// log parsing.
const FORBIDDEN_TOKEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/** The capability matrix's source classes, in the order the digest inventory reports them. */
const SOURCE_CLASSES = ["PRIMARY", "SECONDARY", "RUNNER_DERIVED"];

/** SSOT §9.2 lines 970-971: the two session classes, and the only two modes a doctor reports. */
const VERIFIED_MODE = "VERIFIED_ASSESSMENT";
const IMPORTED_MODE = "IMPORTED_SESSION";
const MODE_IDS = [VERIFIED_MODE, IMPORTED_MODE];
const FROZEN_MODE_CLAUSES: Record<string, string> = {
  [VERIFIED_MODE]: "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
  [IMPORTED_MODE]: "Imported Session: 기존 Codex·Claude Code 기록의 사후 분석은 DIAGNOSTIC ONLY"
};

/**
 * The four verdicts of the Minimum GREEN, most severe first, each with the SSOT clause it
 * rests on, the predicate the code applies, and its exit code.
 *
 * Severity order is this contract's reading and is recorded as one: SSOT §9.2 states each of
 * these conditions but never ranks them, and SCORE_BLOCKED and IMPORTED_ONLY can hold at once.
 * SCORE_BLOCKED is placed above IMPORTED_ONLY because it reports a defect in the adapter's
 * observability, which is what `aos doctor --capabilities` exists to report, while
 * IMPORTED_ONLY reports a property of the session the caller asked about. Ranking the mode
 * first would let a runtime that cannot observe a blocking event group be reported as merely
 * imported. Nothing is lost by the choice: `reasons` lists every finding in the same order,
 * so the mode is still reported when the verdict is SCORE_BLOCKED.
 *
 * The exit codes are also this contract's reading; SSOT v1.0 names none. Only COMPLETE exits
 * zero, so any state that cannot issue an official AOS-Coding P0 is a non-zero exit, and the
 * codes increase with severity. A non-zero exit reports an adapter or mode limitation and
 * never a user failure, which is why line 981 is the last line of every projection.
 *
 * [verdict_id, exit_code, source_clause, predicate]
 */
const FROZEN_VERDICTS: [string, number, string, string][] = [
  ["SCORE_BLOCKED", 30,
    "REQUIRED: scored run에 반드시 필요. 누락 시 관련 metric 또는 전체 점수 차단",
    "at least one event group is UNAVAILABLE and its 누락 처리 effects do not fall to NOT OBSERVED"],
  ["IMPORTED_ONLY", 20,
    "Imported Session: 기존 Codex·Claude Code 기록의 사후 분석은 DIAGNOSTIC ONLY",
    "no such group is UNAVAILABLE and the report declares an imported session"],
  ["DEGRADED", 10,
    "UNAVAILABLE: adapter가 관찰할 수 없음. 관련 metric은 NOT OBSERVED",
    "no such group is UNAVAILABLE, the report declares a controlled assessment, and at least one event group is UNAVAILABLE and falls to NOT OBSERVED"],
  ["COMPLETE", 0,
    "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
    "no event group is UNAVAILABLE and the report declares a controlled assessment"]
];
const VERDICT_IDS = FROZEN_VERDICTS.map(([verdictId]) => verdictId);
const EXIT_CODE_OF: Record<string, number> = Object.fromEntries(
  FROZEN_VERDICTS.map(([verdictId, exitCode]) => [verdictId, exitCode])
);
const COMPLETE = VERDICT_IDS[VERDICT_IDS.length - 1];

/**
 * The reason catalogue, in the canonical order reasons are reported. The order is the verdict
 * severity order with COMPLETE removed, because COMPLETE is the absence of every reason; the
 * verdict is then the verdict of the first reason, and reason ordering and verdict derivation
 * are one rule rather than two that could disagree.
 *
 * [reason_code, verdict_id, predicate]
 */
const FROZEN_REASONS: [string, string, string][] = [
  ["BLOCKING_GROUP_UNAVAILABLE", "SCORE_BLOCKED",
    "one event group is UNAVAILABLE and its 누락 처리 effects do not fall to NOT OBSERVED"],
  ["IMPORTED_SESSION_DIAGNOSTIC_ONLY", "IMPORTED_ONLY",
    "the report declares an imported session, which SSOT 9.2 admits only as DIAGNOSTIC ONLY"],
  ["DEGRADED_GROUP_UNAVAILABLE", "DEGRADED",
    "one event group is UNAVAILABLE and its 누락 처리 effects fall to NOT OBSERVED"]
];
const REASON_CODES = FROZEN_REASONS.map(([reasonCode]) => reasonCode);
const [BLOCKING_REASON, IMPORTED_REASON, DEGRADED_REASON] = REASON_CODES;
const VERDICT_OF_REASON: Record<string, string> = Object.fromEntries(
  FROZEN_REASONS.map(([reasonCode, verdictId]) => [reasonCode, verdictId])
);

/** SSOT §9.2 line 947: the status a cell reaches when the adapter cannot observe it. */
const UNAVAILABLE = "UNAVAILABLE";
/** SSOT §9.2 line 947 again, as the 누락 처리 effect class capability.ts derives. */
const NOT_OBSERVED = "NOT_OBSERVED";

const CONTRACT_FIELDS = [
  "contract_id", "contract_version", "source_authority", "capability_contract_id",
  "capability_contract_version", "acceptance_clause", "no_silent_estimation_clause",
  "not_user_failure_clause", "declared_only_statement", "command_template", "runtime_ids",
  "capability_digest_fields", "declared_digest_fields", "derived_digest_fields", "source_classes",
  "version_token_max_chars", "report_fields", "observation_fields", "event_groups",
  "unconditional_required_event_groups", "derivation_proofs", "assessment_modes", "verdicts",
  "reason_codes", "matrix_variants", "canonical_fixture_directory",
  "canonical_fixture_name_template", "canonical_reports"
];
const REPORT_FIELDS = [
  "contract_id", "contract_version", "command", "runtime_id", "assessment_mode",
  "capability_digest", "observations", "verdict", "exit_code", "reasons", "human_projection"
];
const OBSERVATION_FIELDS = [
  "event_group", "ordinal", "source_row", "contract", "requirement_scope", "status",
  "source_class", "evidence_locator", "derivation_proof", "missing_effect", "missing_effects",
  "affected_metrics"
];
const MODE_FIELDS = ["mode_id", "ordinal", "source_clause", "statement"];
const VERDICT_FIELDS = ["verdict_id", "ordinal", "source_clause", "statement", "predicate", "exit_code"];
const REASON_FIELDS = ["reason_code", "ordinal", "verdict_id", "statement", "predicate"];
const VARIANT_FIELDS = ["variant_id", "ordinal", "source_clause", "unproven_derivations"];
const CANONICAL_FIELDS = ["report_id", "ordinal", "matrix_variant"];
const DERIVATION_PROOF_FIELDS = ["event_group", "proof"];

/**
 * The frozen matrix variants the canonical reports are derived against. Each names the DERIVED
 * event groups whose derivation proof is absent, which SSOT §9.2 line 980 turns into
 * UNAVAILABLE; `as-declared` names none.
 *
 * A variant states the DERIVED cells absolutely rather than as a delta, so which report derives
 * which verdict does not depend on the derivation proofs the supplied matrix happens to carry.
 * That is what `derivation_proofs` is for: the two proof texts are pinned in the document, the
 * pin is checked against every cell of the supplied matrix that carries one, and a variant
 * restores the unlisted groups from it. Everything else — the resulting status and the
 * runtime's supported and known-missing coverage — is recomputed, and the result must still be
 * a matrix capability.ts accepts.
 *
 * [variant_id, source_clause, unproven_derivations]
 */
const FROZEN_VARIANTS: [string, string, string[]][] = [
  ["as-declared", ACCEPTANCE_CLAUSE, []],
  ["plan-state-derivation-unproven", NO_SILENT_ESTIMATION_CLAUSE, ["plan_state"]],
  ["workspace-diff-derivation-unproven", NO_SILENT_ESTIMATION_CLAUSE, ["workspace_diff"]],
  ["both-derivations-unproven", NO_SILENT_ESTIMATION_CLAUSE, ["workspace_diff", "plan_state"]]
];
const VARIANT_IDS = FROZEN_VARIANTS.map(([variantId]) => variantId);

/**
 * The canonical report set, exhaustive and ordered, so a fixture cannot vanish quietly.
 *
 * The reports themselves are not in the frozen document: each one is a file in
 * `fixtures/doctor/`, holding exactly what `aos doctor --capabilities --runtime <runtime>`
 * prints and nothing else. The document declares only the manifest — which report ids exist,
 * in what order, and against which matrix variant each was produced — and the caller hands the
 * parsed corpus in. There is therefore no second copy of a report to drift: every fixture is
 * recomputed here against its variant, a declared id with no file is an error, and a file no id
 * declares is an error. The file name is derived from the report id rather than declared, so a
 * renamed fixture fails twice over.
 */
const CANONICAL_REPORT_IDS = [
  "complete", "degraded", "blocked", "imported-only", "imported-and-degraded", "blocked-and-imported",
  "blocking-and-degraded", "blocking-and-imported"
];
const CANONICAL_FIXTURE_DIRECTORY = "fixtures/doctor";
const CANONICAL_FIXTURE_NAME_TEMPLATE = "<report_id>.json";
const REPORT_ID_PLACEHOLDER = "<report_id>";
const fixtureNameOf = (reportId: string): string =>
  CANONICAL_FIXTURE_NAME_TEMPLATE.replace(REPORT_ID_PLACEHOLDER, reportId);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sameList = (left: unknown, right: readonly string[]): boolean =>
  Array.isArray(left) && left.length === right.length && right.every((entry, index) => left[index] === entry);

const listText = (values: readonly string[]): string => values.join(",") || "none";

// An error message must never throw while naming the value it refuses. Strings name
// themselves; primitives keep their coercion; an object may carry no primitive coercion at
// all, so it is named by the placeholder the sibling contracts use rather than coerced.
const namedValue = (value: unknown): string =>
  typeof value === "string" ? value
    : typeof value === "object" && value !== null ? "<unnamed>"
    : String(value);

const failClosed = (errors: string[]): DoctorResult => ({
  ok: false,
  errors,
  verdict: VERDICT_IDS[0],
  exit_code: EXIT_CODE_OF[VERDICT_IDS[0]],
  reasons: [],
  human_projection: []
});

// --- derivation -------------------------------------------------------------------------

const observationsOf = (runtimeId: string, view: MatrixView): Observation[] =>
  view.rows.map((row) => {
    const cell = (row.runtimes as Record<string, Record<string, unknown>>)[runtimeId];
    return {
      event_group: row.event_group as string,
      ordinal: row.ordinal as number,
      source_row: row.source_row as string,
      contract: row.contract as string,
      requirement_scope: row.requirement_scope as string,
      status: cell.status as string,
      source_class: cell.source_class as string,
      evidence_locator: cell.evidence_locator as string,
      derivation_proof: (cell.derivation_proof ?? null) as string | null,
      missing_effect: row.missing_effect as string,
      missing_effects: row.missing_effects as string[],
      affected_metrics: row.affected_metrics as string[]
    };
  });

/**
 * An UNAVAILABLE group blocks the score unless the 누락 처리 column says the metrics fall to
 * NOT OBSERVED. capability.ts already refuses a matrix whose requirement level and stated
 * consequence disagree, so reading the effect column here is the same partition as reading
 * the 계약 column; the effect column is used because the effect is what the doctor prints.
 */
const isBlocking = (observation: Observation): boolean => !observation.missing_effects.includes(NOT_OBSERVED);

/**
 * The ordered reasons a matrix and a declared mode produce. Groups are walked in SSOT §9.2
 * table order and the sort is by reason-code severity alone; `Array#sort` is stable, so two
 * reasons sharing a code keep the table order they were collected in and no second sort key is
 * needed. The imported reason is collected last and carries its own code, so it lands between
 * the blocking and the degraded groups wherever it applies.
 */
const reasonsOf = (observations: Observation[], assessmentMode: string): string[] => {
  const found: [number, string][] = [];
  for (const observation of observations) {
    if (observation.status !== UNAVAILABLE) continue;
    const reasonCode = isBlocking(observation) ? BLOCKING_REASON : DEGRADED_REASON;
    found.push([
      REASON_CODES.indexOf(reasonCode),
      `${reasonCode} ${observation.event_group} is ${UNAVAILABLE} and its absence yields ${listText(observation.missing_effects)}`
    ]);
  }
  if (assessmentMode === IMPORTED_MODE) {
    found.push([
      REASON_CODES.indexOf(IMPORTED_REASON),
      `${IMPORTED_REASON} the report declares an imported session, so its output is DIAGNOSTIC ONLY`
    ]);
  }
  return found.sort((left, right) => left[0] - right[0]).map(([, message]) => message);
};

const projectionOf = (
  command: string,
  assessmentMode: string,
  digest: Record<string, unknown>,
  observations: Observation[],
  view: MatrixView,
  verdict: string,
  exitCode: number,
  reasons: string[]
): string[] => {
  const unavailable = observations.filter((observation) => observation.status === UNAVAILABLE);
  // Every unconditionally REQUIRED group is observed in every matrix this contract can be
  // handed, so the count is stated as the constant it is rather than filtered. capability.ts
  // freezes the 계약 column text per event group, derives `statuses` and `requirement_scope`
  // from it, and reaches UNAVAILABLE only for a row whose statuses include DERIVED (line 980);
  // no DERIVED row of that frozen table is UNCONDITIONAL_REQUIRED, so the two sets are disjoint
  // for any matrix the sibling accepts and a subtraction here could never subtract anything.
  // That is a property of the sibling and not of this module, so it is guarded rather than
  // trusted: `required-groups-cannot-be-unavailable` fails the moment they stop being disjoint,
  // and whoever makes them overlap must put the subtraction back.
  const requiredObserved = view.required_event_groups.length;
  return [
    command,
    `verdict: ${verdict} exit=${exitCode} mode=${assessmentMode}`,
    `digest: runtime_version=${namedValue(digest.runtime_version)}` +
      ` protocol_or_schema_version=${namedValue(digest.protocol_or_schema_version)}` +
      ` adapter_version=${namedValue(digest.adapter_version)}` +
      ` source_class=${listText(sourceClassInventory(observations))}`,
    `groups: supported=${observations.length - unavailable.length} unavailable=${unavailable.length}` +
      ` required_observed=${requiredObserved}/${view.required_event_groups.length}`,
    ...observations.map((observation) =>
      `${observation.ordinal}. ${observation.event_group} ${observation.status}` +
      ` contract=${observation.contract} scope=${observation.requirement_scope}` +
      ` source=${observation.source_class} evidence=${observation.evidence_locator}` +
      ` proof=${observation.derivation_proof ?? "none"}` +
      ` effect=${observation.missing_effect} effects=${listText(observation.missing_effects)}` +
      ` metrics=${listText(observation.affected_metrics)}`),
    ...reasons.map((reason) => `reason: ${reason}`),
    `note: ${NOT_USER_FAILURE_CLAUSE}`
  ];
};

/**
 * The digest's `source_class` inventory, in canonical order. It is derived rather than pinned
 * so it follows the matrix. A limit is worth recording: E0B-001 freezes a source class per cell,
 * and in the v0 matrix all three classes occur for both runtimes, so every report built from
 * that matrix yields the same three values. The inventory is nonetheless exercised directly with
 * a PRIMARY-only observation set, which is what distinguishes it from a constant; an earlier
 * guard asserted only that the frozen matrix contains all three classes and therefore did not.
 */
const sourceClassInventory = (observations: Observation[]): string[] =>
  SOURCE_CLASSES.filter((sourceClass) =>
    observations.some((observation) => observation.source_class === sourceClass));

// --- report validation ------------------------------------------------------------------

/**
 * Validates one doctor report against a validated capability matrix, deriving every field the
 * matrix determines. Returns the derived verdict so a canonical report cannot be credited with
 * a verdict it did not produce.
 */
const validateReport = (report: unknown, view: MatrixView, push: (message: string) => void): Derived | null => {
  if (!isPlainRecord(report)) {
    push("REPORT_NOT_AN_OBJECT a doctor report must be a JSON object");
    return null;
  }
  for (const field of REPORT_FIELDS) {
    if (!Object.hasOwn(report, field)) push(`REPORT_MISSING_FIELD ${field} is required by the doctor contract`);
  }
  for (const field of Object.keys(report)) {
    if (!REPORT_FIELDS.includes(field)) push(`REPORT_DEAD_FIELD ${field} is not part of the doctor contract`);
  }
  if (report.contract_id !== CONTRACT_ID) push(`REPORT_CONTRACT_ID expected ${CONTRACT_ID}`);
  if (report.contract_version !== CONTRACT_VERSION) push(`REPORT_CONTRACT_VERSION expected ${CONTRACT_VERSION}`);

  const runtimeId = report.runtime_id;
  if (typeof runtimeId !== "string" || !RUNTIME_IDS.includes(runtimeId)) {
    push(`UNKNOWN_RUNTIME ${namedValue(runtimeId)} is outside the frozen SSOT 9.2 runtime set`);
    return null;
  }
  const assessmentMode = report.assessment_mode;
  if (typeof assessmentMode !== "string" || !MODE_IDS.includes(assessmentMode)) {
    push(`UNKNOWN_ASSESSMENT_MODE ${namedValue(assessmentMode)} is outside the frozen SSOT 9.2 session classes`);
    return null;
  }

  const command = COMMAND_TEMPLATE.replace(RUNTIME_PLACEHOLDER, runtimeId);
  if (report.command !== command) push(`COMMAND_MISMATCH derives ${command}`);

  const observations = observationsOf(runtimeId, view);
  const reasons = reasonsOf(observations, assessmentMode);
  const verdict = reasons.length === 0 ? COMPLETE : VERDICT_OF_REASON[reasons[0].split(" ")[0]];
  const exitCode = EXIT_CODE_OF[verdict];
  const digest = isPlainRecord(report.capability_digest) ? report.capability_digest : {};
  const projection = projectionOf(command, assessmentMode, digest, observations, view, verdict, exitCode, reasons);

  validateDigest(report.capability_digest, runtimeId, observations, view, push);
  validateObservations(report.observations, observations, push);

  if (report.verdict !== verdict) push(`VERDICT_MISMATCH derives ${verdict}`);
  if (report.exit_code !== exitCode) push(`EXIT_CODE_MISMATCH derives ${exitCode}`);
  if (!sameList(report.reasons, reasons)) {
    push(`REASONS_MISMATCH derives ${listText(reasons.map((reason) => reason.split(" ")[0]))}`);
  }

  const declaredProjection = report.human_projection;
  if (!Array.isArray(declaredProjection) || declaredProjection.length !== projection.length) {
    push(`HUMAN_PROJECTION_LENGTH_MISMATCH derives ${projection.length} lines`);
  } else {
    for (const [index, line] of projection.entries()) {
      if (declaredProjection[index] !== line) push(`HUMAN_PROJECTION_MISMATCH line ${index + 1} derives ${line}`);
    }
  }
  return { observations, verdict, exit_code: exitCode, reasons, human_projection: projection };
};

const validateDigest = (
  declared: unknown,
  runtimeId: string,
  observations: Observation[],
  view: MatrixView,
  push: (message: string) => void
): void => {
  if (!isPlainRecord(declared)) {
    push("DIGEST_NOT_AN_OBJECT the stored capability digest must be an object");
    return;
  }
  if (!sameList(Object.keys(declared), DIGEST_FIELDS)) {
    push(`DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`);
  }
  for (const field of DECLARED_DIGEST_FIELDS) {
    const value = declared[field];
    if (!isFilledString(value) || !VERSION_TOKEN.test(value) || FORBIDDEN_TOKEN_CHARS.test(value) || value.length > VERSION_TOKEN_MAX_CHARS) {
      push(`DIGEST_DECLARED_FIELD_INVALID ${field} ${namedValue(value)} is not a version token`);
    }
  }
  const inventory = sourceClassInventory(observations);
  if (!sameList(declared.source_class, inventory)) {
    push(`DIGEST_SOURCE_CLASS_MISMATCH derives ${listText(inventory)}`);
  }
  const coverage = view.coverage[runtimeId];
  if (!sameList(declared.supported_event_groups, coverage.supported_event_groups)) {
    push(`DIGEST_SUPPORTED_GROUPS_MISMATCH derives ${listText(coverage.supported_event_groups)}`);
  }
  if (!sameList(declared.known_missing_events, coverage.known_missing_events)) {
    push(`DIGEST_KNOWN_MISSING_MISMATCH derives ${listText(coverage.known_missing_events)}`);
  }
};

const validateObservations = (
  declared: unknown,
  derived: Observation[],
  push: (message: string) => void
): void => {
  if (!Array.isArray(declared)) {
    push("OBSERVATIONS_NOT_AN_ARRAY the report must declare one observation per SSOT 9.2 event group");
    return;
  }
  if (declared.length !== derived.length) {
    push(`OBSERVATION_COUNT_MISMATCH found ${declared.length} and not ${derived.length}`);
  }
  for (const [index, entry] of declared.entries()) {
    const expected = derived[index];
    if (!isPlainRecord(entry)) { push(`OBSERVATION_NOT_AN_OBJECT position ${index + 1} is not an object`); continue; }
    if (expected === undefined) {
      push(`OBSERVATION_UNKNOWN_EVENT_GROUP ${namedValue(entry.event_group)} is outside the frozen SSOT 9.2 matrix`);
      continue;
    }
    if (entry.event_group !== expected.event_group) {
      push(`OBSERVATION_ORDER_BROKEN position ${index + 1} derives ${expected.event_group}`);
      continue;
    }
    for (const field of OBSERVATION_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`OBSERVATION_MISSING_FIELD ${expected.event_group} ${field} is required by the doctor contract`);
    }
    for (const field of Object.keys(entry)) {
      if (!OBSERVATION_FIELDS.includes(field)) push(`OBSERVATION_DEAD_FIELD ${expected.event_group} ${field} is not part of the doctor contract`);
    }
    for (const field of OBSERVATION_FIELDS) {
      if (!Object.hasOwn(entry, field)) continue;
      const value = expected[field as keyof Observation];
      const agrees = Array.isArray(value) ? sameList(entry[field], value) : entry[field] === value;
      if (!agrees) {
        const text = Array.isArray(value) ? listText(value) : String(value);
        push(`OBSERVATION_MISMATCH ${expected.event_group} ${field} derives ${text}`);
      }
    }
  }
};

// --- contract validation ------------------------------------------------------------------

type RowSpec = { kind: string; idField: string; fields: string[]; ids: string[] };

/**
 * The shared shape check for every frozen row table: exhaustive, ordered, once each, no dead
 * field. `perRow` receives only rows whose id is known and correctly placed, so a value check
 * never runs against a row that is already the wrong row.
 */
const validateTable = (
  declared: unknown,
  spec: RowSpec,
  push: (message: string) => void,
  perRow: (entry: Record<string, unknown>, index: number, id: string) => void
): void => {
  if (!Array.isArray(declared)) {
    push(`CONTRACT_TABLE_NOT_AN_ARRAY ${spec.kind} must declare ${spec.ids.length} rows`);
    return;
  }
  if (declared.length !== spec.ids.length) {
    push(`CONTRACT_TABLE_COUNT ${spec.kind} found ${declared.length} and not ${spec.ids.length}`);
  }
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { push(`CONTRACT_ROW_NOT_AN_OBJECT ${spec.kind} position ${index + 1}`); continue; }
    const id = entry[spec.idField];
    if (typeof id !== "string" || !spec.ids.includes(id)) {
      push(`CONTRACT_UNKNOWN_ROW ${spec.kind} ${namedValue(id)} is outside the frozen set`);
      continue;
    }
    if (seen.has(id)) { push(`CONTRACT_DUPLICATE_ROW ${spec.kind} ${id} appears more than once`); continue; }
    seen.add(id);
    for (const field of spec.fields) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_MISSING_ROW_FIELD ${spec.kind} ${id} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!spec.fields.includes(field)) push(`CONTRACT_ROW_DEAD_FIELD ${spec.kind} ${id} ${field}`);
    }
    const canonicalIndex = spec.ids.indexOf(id);
    if (canonicalIndex !== index) {
      push(`CONTRACT_ROW_ORDER_BROKEN ${spec.kind} ${id} sits at position ${index + 1} and not ${canonicalIndex + 1}`);
      continue;
    }
    if (Object.hasOwn(entry, "ordinal") && entry.ordinal !== canonicalIndex + 1) {
      push(`CONTRACT_ROW_ORDINAL_MISMATCH ${spec.kind} ${id} declares ${namedValue(entry.ordinal)}`);
    }
    // `statement` is prose the derivation never reads and is checked for presence only — that
    // proves the field exists, not that it says anything true. Every rule a row carries lives in
    // its pinned `source_clause`, `predicate`, `exit_code` or `verdict_id`; the statement beside
    // them may contradict all four and still be accepted, so it is documentation and never an
    // input. The declared-only statement names all nine of them for the same reason.
    if (Object.hasOwn(entry, "statement") && !isFilledString(entry.statement)) {
      push(`CONTRACT_EMPTY_TEXT ${spec.kind} ${id} statement`);
    }
    perRow(entry, canonicalIndex, id);
  }
  for (const id of spec.ids) {
    if (!seen.has(id)) push(`CONTRACT_ROW_GAP ${spec.kind} ${id} is absent from the contract`);
  }
};

const pinClause = (
  entry: Record<string, unknown>,
  kind: string,
  id: string,
  expected: string,
  push: (message: string) => void
): void => {
  if (Object.hasOwn(entry, "source_clause") && entry.source_clause !== expected) {
    push(`CONTRACT_CLAUSE_MISMATCH ${kind} ${id} must quote its SSOT clause verbatim`);
  }
};

const pinPredicate = (
  entry: Record<string, unknown>,
  kind: string,
  id: string,
  expected: string,
  push: (message: string) => void
): void => {
  if (Object.hasOwn(entry, "predicate") && entry.predicate !== expected) {
    push(`CONTRACT_PREDICATE_MISMATCH ${kind} ${id} must read ${expected}`);
  }
};

/** SSOT §9.2 line 945: the rows a runner reconstructs, and the only rows line 980 can unmake. */
const derivedGroup = (row: Record<string, unknown>): boolean =>
  Array.isArray(row.statuses) && (row.statuses as string[]).includes("DERIVED");

/**
 * Applies a frozen variant to the validated matrix. Only the blanked derivation proof is
 * declared; the resulting UNAVAILABLE status and the runtime's coverage lists are recomputed
 * from SSOT §9.2 line 980, and the result must still be a matrix capability.ts accepts.
 */
const variantMatrix = (
  matrix: unknown,
  runtimeId: string,
  unproven: string[],
  proofs: Record<string, unknown>
): unknown => {
  const clone = JSON.parse(JSON.stringify(matrix)) as Record<string, unknown>;
  const rows = clone.rows as Record<string, unknown>[];
  const cellOf = (row: Record<string, unknown>) =>
    (row.runtimes as Record<string, Record<string, unknown>>)[runtimeId];
  for (const row of rows.filter((entry) => derivedGroup(entry))) {
    const cell = cellOf(row);
    const isUnproven = unproven.includes(row.event_group as string);
    cell.derivation_proof = isUnproven ? null : proofs[row.event_group as string];
    cell.status = isUnproven ? UNAVAILABLE : (row.statuses as string[])[0];
  }
  const supported: string[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    (cellOf(row).status === UNAVAILABLE ? missing : supported).push(row.event_group as string);
  }
  const runtime = (clone.runtimes as Record<string, unknown>[])
    .find((entry) => entry.runtime_id === runtimeId) as Record<string, unknown>;
  runtime.supported_event_groups = supported;
  runtime.known_missing_events = missing;
  return clone;
};

const viewOf = (result: ReturnType<typeof validateCapabilityMatrix>): MatrixView => ({
  rows: result.rows as unknown as Record<string, unknown>[],
  coverage: result.coverage,
  required_event_groups: result.required_event_groups
});

const validateContract = (
  contract: unknown,
  matrix: unknown,
  view: MatrixView,
  corpus: Record<string, unknown>
): string[] => {
  if (!isPlainRecord(contract)) return ["CONTRACT_NOT_AN_OBJECT the doctor contract must be a JSON object"];
  const missing = CONTRACT_FIELDS.filter((field) => !Object.hasOwn(contract, field));
  if (missing.length > 0) return [`CONTRACT_MISSING_FIELD ${missing.join(",")} required by the doctor contract`];

  const errors: string[] = [];
  const push = (message: string) => { errors.push(message); };

  for (const field of Object.keys(contract)) {
    if (!CONTRACT_FIELDS.includes(field)) push(`CONTRACT_DEAD_FIELD ${field} is not part of the doctor contract`);
  }
  if (contract.contract_id !== CONTRACT_ID) push(`CONTRACT_ID expected ${CONTRACT_ID}`);
  if (contract.contract_version !== CONTRACT_VERSION) push(`CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  if (contract.source_authority !== SOURCE_AUTHORITY) push(`CONTRACT_SOURCE_AUTHORITY expected ${SOURCE_AUTHORITY}`);

  // The binding to the sibling. The expected values are read out of the matrix that was
  // handed in rather than restated here, so this is a comparison between two files and not a
  // third copy of the same string.
  const matrixRecord = matrix as Record<string, unknown>;
  if (contract.capability_contract_id !== matrixRecord.contract_id) {
    push(`CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_id must read ${String(matrixRecord.contract_id)}`);
  }
  if (contract.capability_contract_version !== matrixRecord.contract_version) {
    push(`CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_version must read ${String(matrixRecord.contract_version)}`);
  }

  if (contract.acceptance_clause !== ACCEPTANCE_CLAUSE) {
    push("CONTRACT_ACCEPTANCE_CLAUSE_MISMATCH the SSOT 9.2 doctor acceptance clause is frozen");
  }
  if (contract.no_silent_estimation_clause !== NO_SILENT_ESTIMATION_CLAUSE) {
    push("CONTRACT_NO_SILENT_ESTIMATION_CLAUSE_MISMATCH the SSOT 9.2 line 980 clause is frozen");
  }
  if (contract.not_user_failure_clause !== NOT_USER_FAILURE_CLAUSE) {
    push("CONTRACT_NOT_USER_FAILURE_CLAUSE_MISMATCH the SSOT 9.2 line 981 clause is frozen");
  }
  if (contract.declared_only_statement !== DECLARED_ONLY_STATEMENT) {
    push("CONTRACT_DECLARED_ONLY_STATEMENT_MISMATCH the statement of what a doctor verdict does not prove is frozen");
  }
  if (contract.command_template !== COMMAND_TEMPLATE) {
    push(`CONTRACT_COMMAND_TEMPLATE_MISMATCH expected ${COMMAND_TEMPLATE}`);
  }
  if (contract.version_token_max_chars !== VERSION_TOKEN_MAX_CHARS) {
    push(`CONTRACT_VERSION_TOKEN_BOUND_MISMATCH expected ${VERSION_TOKEN_MAX_CHARS}`);
  }
  if (contract.canonical_fixture_directory !== CANONICAL_FIXTURE_DIRECTORY) {
    push(`CONTRACT_FIXTURE_DIRECTORY_MISMATCH expected ${CANONICAL_FIXTURE_DIRECTORY}`);
  }
  if (contract.canonical_fixture_name_template !== CANONICAL_FIXTURE_NAME_TEMPLATE) {
    push(`CONTRACT_FIXTURE_TEMPLATE_MISMATCH expected ${CANONICAL_FIXTURE_NAME_TEMPLATE}`);
  }

  const lists: [string, readonly string[], string][] = [
    ["runtime_ids", RUNTIME_IDS, "CONTRACT_RUNTIME_IDS_MISMATCH"],
    ["capability_digest_fields", DIGEST_FIELDS, "CONTRACT_DIGEST_FIELDS_MISMATCH"],
    ["declared_digest_fields", DECLARED_DIGEST_FIELDS, "CONTRACT_DECLARED_DIGEST_FIELDS_MISMATCH"],
    ["derived_digest_fields", DERIVED_DIGEST_FIELDS, "CONTRACT_DERIVED_DIGEST_FIELDS_MISMATCH"],
    ["source_classes", SOURCE_CLASSES, "CONTRACT_SOURCE_CLASSES_MISMATCH"],
    ["report_fields", REPORT_FIELDS, "CONTRACT_REPORT_FIELDS_MISMATCH"],
    ["observation_fields", OBSERVATION_FIELDS, "CONTRACT_OBSERVATION_FIELDS_MISMATCH"],
    // Both of these are the matrix's own derivations, so the doctor contract cannot restate
    // them differently and cannot survive the matrix changing underneath it.
    ["event_groups", view.rows.map((row) => row.event_group as string), "CONTRACT_EVENT_GROUPS_MISMATCH"],
    ["unconditional_required_event_groups", view.required_event_groups, "CONTRACT_REQUIRED_GROUPS_MISMATCH"]
  ];
  for (const [field, expected, code] of lists) {
    if (!sameList(contract[field], expected)) push(`${code} ${field} must read ${listText(expected)}`);
  }

  // The two derivation proofs, pinned against the matrix rather than restated. E0B-001 left
  // `derivation_proof` free apart from being non-blank, so this is the first place the text
  // itself is held to a second file; a cell that carries one must carry this one.
  //
  // A cell whose proof is null pins nothing, and this text is not inert: `variantMatrix` writes
  // it back to restore the DERIVED cells a variant does not blank. So a group whose proof is
  // null in every runtime cell of the supplied matrix would let the contract resurrect that cell
  // from its own unchecked prose — a pin fed by an unpinned input, and exactly the defect this
  // contract exists to avoid. It is refused instead: at least one cell must carry the proof, and
  // every cell that carries one must carry this one. What remains is the inherited E0B-001
  // limit, which is a two-file coordinated edit and is recorded rather than closed: a matrix
  // cell and this document restating the same forged proof agree with each other.
  const derivedGroups = view.rows.filter(derivedGroup).map((row) => row.event_group as string);
  const proofs: Record<string, unknown> = {};
  validateTable(contract.derivation_proofs,
    { kind: "proof", idField: "event_group", fields: DERIVATION_PROOF_FIELDS, ids: derivedGroups },
    push, (entry, _index, id) => {
      proofs[id] = entry.proof;
      const row = view.rows.find((candidate) => candidate.event_group === id) as Record<string, unknown>;
      let pinned = false;
      for (const runtimeId of RUNTIME_IDS) {
        const declared = (row.runtimes as Record<string, Record<string, unknown>>)[runtimeId].derivation_proof;
        if (declared === null) continue;
        pinned = true;
        if (declared !== entry.proof) {
          push(`CONTRACT_DERIVATION_PROOF_MISMATCH ${id} ${runtimeId} must read ${String(declared)}`);
        }
      }
      if (!pinned) {
        push(`CONTRACT_DERIVATION_PROOF_UNPINNED ${id} carries no derivation proof in any runtime cell, so the contract text restoring it is checked against nothing`);
      }
    });

  validateTable(contract.assessment_modes, { kind: "mode", idField: "mode_id", fields: MODE_FIELDS, ids: MODE_IDS },
    push, (entry, _index, id) => { pinClause(entry, "mode", id, FROZEN_MODE_CLAUSES[id], push); });

  validateTable(contract.verdicts, { kind: "verdict", idField: "verdict_id", fields: VERDICT_FIELDS, ids: VERDICT_IDS },
    push, (entry, index, id) => {
      const [, exitCode, sourceClause, predicate] = FROZEN_VERDICTS[index];
      pinClause(entry, "verdict", id, sourceClause, push);
      pinPredicate(entry, "verdict", id, predicate, push);
      if (Object.hasOwn(entry, "exit_code") && entry.exit_code !== exitCode) {
        push(`CONTRACT_EXIT_CODE_MISMATCH ${id} derives ${exitCode}`);
      }
    });

  validateTable(contract.reason_codes, { kind: "reason", idField: "reason_code", fields: REASON_FIELDS, ids: REASON_CODES },
    push, (entry, index, id) => {
      const [, verdictId, predicate] = FROZEN_REASONS[index];
      pinPredicate(entry, "reason", id, predicate, push);
      if (Object.hasOwn(entry, "verdict_id") && entry.verdict_id !== verdictId) {
        push(`CONTRACT_REASON_VERDICT_MISMATCH ${id} derives ${verdictId}`);
      }
    });

  validateTable(contract.matrix_variants, { kind: "variant", idField: "variant_id", fields: VARIANT_FIELDS, ids: VARIANT_IDS },
    push, (entry, index, id) => {
      const [, sourceClause, unproven] = FROZEN_VARIANTS[index];
      pinClause(entry, "variant", id, sourceClause, push);
      if (!sameList(entry.unproven_derivations, unproven)) {
        push(`CONTRACT_VARIANT_GROUPS_MISMATCH ${id} must read ${listText(unproven)}`);
      }
    });

  const exercisedVerdicts = new Set<string>();
  const exercisedReasons = new Set<string>();
  validateTable(contract.canonical_reports,
    { kind: "canonical", idField: "report_id", fields: CANONICAL_FIELDS, ids: CANONICAL_REPORT_IDS },
    push, (entry, _index, id) => {
      const fixtureName = fixtureNameOf(id);
      if (!Object.hasOwn(corpus, fixtureName)) {
        push(`CONTRACT_CANONICAL_FIXTURE_MISSING ${fixtureName} is declared by the contract and absent from the corpus`);
        return;
      }
      const canonical = corpus[fixtureName];
      const declaredVariant = entry.matrix_variant;
      const variantIndex = typeof declaredVariant === "string" ? VARIANT_IDS.indexOf(declaredVariant) : -1;
      if (variantIndex === -1) {
        push(`CONTRACT_CANONICAL_VARIANT_UNKNOWN ${id} names ${namedValue(declaredVariant)}`);
        return;
      }
      const runtimeId = isPlainRecord(canonical) ? canonical.runtime_id : undefined;
      if (typeof runtimeId !== "string" || !RUNTIME_IDS.includes(runtimeId)) {
        push(`CONTRACT_CANONICAL_REPORT_INVALID ${id} UNKNOWN_RUNTIME ${namedValue(runtimeId)} is outside the frozen SSOT 9.2 runtime set`);
        return;
      }
      const perturbed = variantMatrix(matrix, runtimeId, FROZEN_VARIANTS[variantIndex][2], proofs);
      const perturbedResult = validateCapabilityMatrix(perturbed);
      if (!perturbedResult.ok) {
        push(`CONTRACT_VARIANT_INVALID ${VARIANT_IDS[variantIndex]} ${runtimeId} ${perturbedResult.errors[0]}`);
        return;
      }
      const derived = validateReport(canonical, viewOf(perturbedResult),
        (message) => { push(`CONTRACT_CANONICAL_REPORT_INVALID ${id} ${message}`); });
      if (derived === null) return;
      exercisedVerdicts.add(derived.verdict);
      for (const reason of derived.reasons) exercisedReasons.add(reason.split(" ")[0]);
    });

  // The corpus is exactly the declared set: a file the manifest does not name is a report
  // nothing recomputes, which is the shape a stale fixture takes.
  const declaredFixtures = new Set(CANONICAL_REPORT_IDS.map(fixtureNameOf));
  for (const name of Object.keys(corpus).sort()) {
    if (!declaredFixtures.has(name)) push(`CONTRACT_CANONICAL_FIXTURE_UNDECLARED ${name} is not declared by the doctor contract`);
  }

  for (const verdictId of VERDICT_IDS) {
    if (!exercisedVerdicts.has(verdictId)) push(`CONTRACT_VERDICT_UNEXERCISED ${verdictId} is the verdict of no canonical report`);
  }
  for (const reasonCode of REASON_CODES) {
    if (!exercisedReasons.has(reasonCode)) push(`CONTRACT_REASON_UNEXERCISED ${reasonCode} is reported by no canonical report`);
  }
  return errors;
};

/**
 * Validates one `aos doctor --capabilities --runtime <runtime>` output against the frozen
 * doctor contract, the frozen capability matrix and the canonical fixture corpus, deriving
 * every field any of them determines. `corpus` maps each `fixtures/doctor` file name to its
 * parsed content; the contract's manifest and that corpus must name exactly the same reports,
 * and every one of them is recomputed before this function will answer for the caller's report.
 * A matrix, contract or corpus that has drifted validates nothing: the result fails closed to
 * SCORE_BLOCKED carrying the defects, because a healthy answer derived from a broken rule is
 * worse than no answer.
 *
 * A report this function refuses fails closed by the same rule and for the same reason, so the
 * caller contract is one sentence with no exception in it: `ok === false` yields verdict
 * SCORE_BLOCKED, `exit_code` 30, no reasons and no projection. The alternative was to return the
 * verdict the matrix derives beside `ok: false`, and it is a trap — `process.exit(exit_code)` on
 * a rejected report would have exited zero whenever the matrix happened to derive COMPLETE, so a
 * report the doctor refused would have read as a runtime cleared to issue an official
 * AOS-Coding P0. Nothing is lost: `VERDICT_MISMATCH derives …` and `EXIT_CODE_MISMATCH derives …`
 * still carry the derived values, as diagnostics rather than as an answer.
 */
export const validateDoctorOutput = (
  report: unknown,
  contract: unknown,
  matrix: unknown,
  corpus: unknown
): DoctorResult => {
  const matrixResult = validateCapabilityMatrix(matrix);
  if (!matrixResult.ok) {
    return failClosed(matrixResult.errors.map((error) => `CAPABILITY_MATRIX_INVALID ${error}`));
  }
  if (!isPlainRecord(corpus)) {
    return failClosed(["CANONICAL_CORPUS_NOT_AN_OBJECT the canonical fixture corpus must be a map of file name to parsed report"]);
  }
  const view = viewOf(matrixResult);
  const contractErrors = validateContract(contract, matrix, view, corpus);
  if (contractErrors.length > 0) return failClosed(contractErrors);

  const errors: string[] = [];
  const derived = validateReport(report, view, (message) => { errors.push(message); });
  if (derived === null || errors.length > 0) return failClosed(errors);
  return {
    ok: true,
    errors,
    verdict: derived.verdict,
    exit_code: derived.exit_code,
    reasons: derived.reasons,
    human_projection: derived.human_projection
  };
};
