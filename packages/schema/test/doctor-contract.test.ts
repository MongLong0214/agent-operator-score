import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as doctorModule from "../src/doctor-contract.ts";
import { validateDoctorOutput } from "../src/doctor-contract.ts";
import { validateCapabilityMatrix } from "../src/capability.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const contractPath = resolve(repositoryRoot, "specs/doctor-output.v0.json");
const matrixPath = resolve(repositoryRoot, "specs/adapter-capabilities.v0.json");
const sourcePath = resolve(here, "../src/doctor-contract.ts");
const capabilitySourcePath = resolve(here, "../src/capability.ts");
// The corpus is read from the directory the frozen document names, so a document that points
// somewhere else stops finding its own canonical reports.
const fixtureDirectory = resolve(
  repositoryRoot, JSON.parse(readFileSync(contractPath, "utf8")).canonical_fixture_directory);
const readCorpusText = (directory: string): Record<string, string> => Object.fromEntries(
  readdirSync(directory).sort().map((name) => [name, readFileSync(resolve(directory, name), "utf8")]));
// A file the manifest does not declare is an error whatever it contains, so an unparseable one
// enters the corpus as its own raw text and reaches the contract. Parsing the directory eagerly
// instead killed the lane with a JSON.parse SyntaxError, which does fail closed but not by the
// named case the corpus rule claims; see `a-file-that-is-not-json-is-an-undeclared-fixture`.
const corpusOf = (text: Record<string, string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(text).map(([name, entry]) => {
    try { return [name, JSON.parse(entry)]; } catch { return [name, entry]; }
  }));
const fixtureText: Record<string, string> = readCorpusText(fixtureDirectory);

// Two small derivations deliberately accept their inputs from the validated matrix rather than
// from the frozen v0 corpus. The sibling currently supplies every source class and only null or
// text proofs, which cannot distinguish their boundary behavior. Expose only those local
// derivations from a disposable source copy so their contracts are exercised without widening
// this ticket's one-symbol public API.
const withDoctorInternals = async (
  assertInternals: (internals: {
    observationsOf: (runtimeId: string, view: { rows: any[] }) => any[];
    sourceClassInventory: (observations: { source_class: string }[]) => string[];
  }) => void | Promise<void>
) => {
  const directory = mkdtempSync(join(tmpdir(), "aos-doctor-internals-"));
  try {
    writeFileSync(join(directory, "capability.ts"), readFileSync(capabilitySourcePath, "utf8"));
    writeFileSync(
      join(directory, "doctor-contract.ts"),
      `${readFileSync(sourcePath, "utf8")}\nexport { observationsOf, sourceClassInventory };\n`
    );
    await assertInternals(await import(pathToFileURL(join(directory, "doctor-contract.ts")).href));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

// specs/doctor-output.v0.json freezes the SSOT §9.2 "Adapter acceptance" paragraph: the output
// `aos doctor --capabilities --runtime <runtime>` must produce, the four verdicts and their
// exit codes, the ordered reason catalogue, and eight canonical reports with the verdict each
// one derives. This test loads that frozen document and the frozen matrix it projects, and
// mutates copies of both, mirroring capability.test.ts and session-class.test.ts.
const frozen = () => JSON.parse(readFileSync(contractPath, "utf8"));
const frozenMatrix = () => JSON.parse(readFileSync(matrixPath, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Every canonical report is a file in fixtures/doctor holding exactly what the command prints.
// The corpus handed to the contract is the directory listing, so a stray file is an error and a
// missing one is an error; there is no second copy of a report anywhere to drift.
const corpus = () => corpusOf(fixtureText);
const fixtureOf = (reportId: string) => JSON.parse(fixtureText[`${reportId}.json`]);
const withFixture = (reportId: string, mutate: (report: any) => void) => {
  const mutated = corpus();
  mutate(mutated[`${reportId}.json`]);
  return mutated;
};
const validate = (report: unknown, contract: unknown, matrix: unknown, fixtures: unknown = corpus()) =>
  validateDoctorOutput(report, contract, matrix, fixtures);

const codes = (result: { errors: string[] }) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));
const messageFor = (result: { errors: string[] }, code: string) =>
  result.errors.find((entry) => entry.split(" ")[0] === code);

const entryOf = (doc: any, reportId: string) =>
  doc.canonical_reports.find((entry: any) => entry.report_id === reportId);
const observationOf = (report: any, eventGroup: string) =>
  report.observations.find((entry: any) => entry.event_group === eventGroup);
const verdictRow = (doc: any, verdictId: string) =>
  doc.verdicts.find((entry: any) => entry.verdict_id === verdictId);
const reasonRow = (doc: any, reasonCode: string) =>
  doc.reason_codes.find((entry: any) => entry.reason_code === reasonCode);
const modeRow = (doc: any, modeId: string) =>
  doc.assessment_modes.find((entry: any) => entry.mode_id === modeId);
const variantRow = (doc: any, variantId: string) =>
  doc.matrix_variants.find((entry: any) => entry.variant_id === variantId);

// An independent re-derivation of SSOT §9.2 line 980: blanking a DERIVED cell's derivation
// proof makes that cell UNAVAILABLE, which moves the group out of the runtime's supported
// coverage. The module performs the same perturbation internally for its canonical reports;
// doing it separately here means the two must agree.
const unproven = (matrix: any, runtimeId: string, groups: string[]) => {
  const copy = clone(matrix);
  for (const group of groups) {
    const cell = copy.rows.find((row: any) => row.event_group === group).runtimes[runtimeId];
    cell.derivation_proof = null;
    cell.status = "UNAVAILABLE";
  }
  const runtime = copy.runtimes.find((entry: any) => entry.runtime_id === runtimeId);
  runtime.supported_event_groups = copy.rows
    .filter((row: any) => row.runtimes[runtimeId].status !== "UNAVAILABLE")
    .map((row: any) => row.event_group);
  runtime.known_missing_events = copy.rows
    .filter((row: any) => row.runtimes[runtimeId].status === "UNAVAILABLE")
    .map((row: any) => row.event_group);
  return copy;
};

// An independent transcription of the SSOT §9.2 "v0 event coverage matrix" row order
// (lines 953-966), as the doctor must report it.
const EVENT_GROUPS = [
  "run_lifecycle", "runtime_identity", "user_instruction", "tool_call", "workspace_diff",
  "evidence_claim", "approval_safety", "context_selection", "retrieval_memory",
  "delegation_handoff", "plan_state", "token_cost", "human_active_time", "actor_attribution"
];
// The seven rows whose 계약 cell reads exactly "REQUIRED". "REQUIRED for M18/M20" is not one.
const REQUIRED_EVENT_GROUPS = [
  "run_lifecycle", "runtime_identity", "user_instruction", "tool_call",
  "evidence_claim", "approval_safety", "actor_attribution"
];
// SSOT §9.2 line 939, in document order.
const DIGEST_FIELDS = [
  "runtime_version", "protocol_or_schema_version", "adapter_version",
  "source_class", "supported_event_groups", "known_missing_events"
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
const RUNTIME_IDS = ["codex", "claude-code"];
const SOURCE_CLASSES = ["PRIMARY", "SECONDARY", "RUNNER_DERIVED"];
// SSOT §9.2 line 945 and the two rows whose 계약 cell names DERIVED: the only rows line 980
// can turn into UNAVAILABLE, and so the only ones a v0 doctor can report as unobservable.
const DERIVED_EVENT_GROUPS = ["workspace_diff", "plan_state"];

// SSOT §9.2 "Adapter acceptance", lines 977, 980 and 981, transcribed independently.
const ACCEPTANCE_CLAUSE =
  "aos doctor --capabilities --runtime <runtime>는 위 matrix의 실제 상태와 근거 source를 출력해야 한다.";
const NO_SILENT_ESTIMATION_CLAUSE =
  "native event가 없다는 이유로 조용히 추정하지 않는다. DERIVED 근거가 없으면 UNAVAILABLE이다.";
const NOT_USER_FAILURE_CLAUSE = "adapter coverage 부족을 사용자 능력 부족으로 해석하지 않는다.";
// SSOT §9.2 lines 970-971 and the two status definitions the verdicts rest on, lines 943/947.
const VERIFIED_CLAUSE =
  "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능";
const IMPORTED_CLAUSE = "Imported Session: 기존 Codex·Claude Code 기록의 사후 분석은 DIAGNOSTIC ONLY";
const REQUIRED_STATUS_CLAUSE = "REQUIRED: scored run에 반드시 필요. 누락 시 관련 metric 또는 전체 점수 차단";
const UNAVAILABLE_STATUS_CLAUSE = "UNAVAILABLE: adapter가 관찰할 수 없음. 관련 metric은 NOT OBSERVED";

const MODE_IDS = ["VERIFIED_ASSESSMENT", "IMPORTED_SESSION"];
const MODE_CLAUSES: Record<string, string> = {
  VERIFIED_ASSESSMENT: VERIFIED_CLAUSE,
  IMPORTED_SESSION: IMPORTED_CLAUSE
};
// Most severe first. Only COMPLETE exits zero.
const VERDICT_IDS = ["SCORE_BLOCKED", "IMPORTED_ONLY", "DEGRADED", "COMPLETE"];
const EXIT_CODES: Record<string, number> = {
  SCORE_BLOCKED: 30, IMPORTED_ONLY: 20, DEGRADED: 10, COMPLETE: 0
};
const VERDICT_CLAUSES: Record<string, string> = {
  SCORE_BLOCKED: REQUIRED_STATUS_CLAUSE,
  IMPORTED_ONLY: IMPORTED_CLAUSE,
  DEGRADED: UNAVAILABLE_STATUS_CLAUSE,
  COMPLETE: VERIFIED_CLAUSE
};
const REASON_CODES = [
  "BLOCKING_GROUP_UNAVAILABLE", "IMPORTED_SESSION_DIAGNOSTIC_ONLY", "DEGRADED_GROUP_UNAVAILABLE"
];
const VERDICT_OF_REASON: Record<string, string> = {
  BLOCKING_GROUP_UNAVAILABLE: "SCORE_BLOCKED",
  IMPORTED_SESSION_DIAGNOSTIC_ONLY: "IMPORTED_ONLY",
  DEGRADED_GROUP_UNAVAILABLE: "DEGRADED"
};
const VARIANT_IDS = [
  "as-declared", "plan-state-derivation-unproven", "workspace-diff-derivation-unproven",
  "both-derivations-unproven"
];
const CANONICAL_REPORT_IDS = [
  "complete", "degraded", "blocked", "imported-only", "imported-and-degraded", "blocked-and-imported",
  "blocking-and-degraded", "blocking-and-imported"
];
// Each canonical report with the DERIVED groups its matrix variant leaves unproven, so a case
// can rebuild the matrix that produced any fixture without restating the manifest.
const CANONICAL_CASES: [string, string[]][] = [
  ["complete", []],
  ["degraded", ["plan_state"]],
  ["blocked", ["workspace_diff"]],
  ["imported-only", []],
  ["imported-and-degraded", ["plan_state"]],
  ["blocked-and-imported", ["workspace_diff", "plan_state"]]
];

const PLAN_STATE_REASON =
  "DEGRADED_GROUP_UNAVAILABLE plan_state is UNAVAILABLE and its absence yields METRICS_BLOCKED,NOT_OBSERVED";
const WORKSPACE_DIFF_REASON =
  "BLOCKING_GROUP_UNAVAILABLE workspace_diff is UNAVAILABLE and its absence yields RUN_INVALID";
const IMPORTED_REASON =
  "IMPORTED_SESSION_DIAGNOSTIC_ONLY the report declares an imported session, so its output is DIAGNOSTIC ONLY";

describe("doctor-contract", () => {
  // AC-E0B-003-1
  test("complete", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, [], "the frozen complete report must validate with zero errors");
    assert.equal(result.ok, true);
    assert.equal(result.verdict, "COMPLETE");
    assert.equal(result.exit_code, 0);
    assert.deepEqual(result.reasons, []);

    // The report declares exactly what the derivation produces; because validateDoctorOutput
    // recomputes every canonical report before it validates anything, a zero-error result here
    // also proves the whole frozen document is self-consistent.
    assert.equal(report.verdict, result.verdict);
    assert.equal(report.exit_code, result.exit_code);
    assert.deepEqual(report.reasons, result.reasons);
    assert.deepEqual(report.human_projection, result.human_projection);

    // The ticket owns exactly one exported symbol.
    assert.deepEqual(Object.keys(doctorModule), ["validateDoctorOutput"]);

    // Report shape: the eleven fields, in order, and nothing else.
    assert.deepEqual(Object.keys(report), REPORT_FIELDS);
    assert.equal(report.contract_id, "doctor-output.v0");
    assert.equal(report.contract_version, "doctor-output-contract-v0");
    assert.equal(report.command, "aos doctor --capabilities --runtime codex");
    assert.equal(report.runtime_id, "codex");
    assert.equal(report.assessment_mode, "VERIFIED_ASSESSMENT");

    // The six SSOT §9.2 line 939 digest fields, exactly, in document order.
    assert.deepEqual(Object.keys(report.capability_digest), DIGEST_FIELDS);
    assert.deepEqual(report.capability_digest.source_class, SOURCE_CLASSES);
    assert.deepEqual(report.capability_digest.supported_event_groups, EVENT_GROUPS);
    assert.deepEqual(report.capability_digest.known_missing_events, []);

    // One observation per SSOT §9.2 row, in table order, each carrying its source and effect.
    assert.equal(report.observations.length, 14);
    assert.deepEqual(report.observations.map((entry: any) => entry.event_group), EVENT_GROUPS);
    for (const [index, observation] of report.observations.entries()) {
      assert.deepEqual(Object.keys(observation), OBSERVATION_FIELDS, observation.event_group);
      assert.equal(observation.ordinal, index + 1);
      assert.ok(observation.evidence_locator.length > 0, observation.event_group);
      assert.ok(observation.missing_effects.length > 0, observation.event_group);
    }

    // The stable human projection: four header lines, fourteen rows, no reason, one note.
    assert.equal(result.human_projection.length, 19);
    assert.equal(result.human_projection[0], "aos doctor --capabilities --runtime codex");
    assert.equal(result.human_projection[1], "verdict: COMPLETE exit=0 mode=VERIFIED_ASSESSMENT");
    assert.equal(
      result.human_projection[2],
      "digest: runtime_version=codex-0.0.0-fixture" +
      " protocol_or_schema_version=app-server-schema-0.0.0-fixture" +
      " adapter_version=aos-adapter-codex-0.0.0-fixture" +
      " source_class=PRIMARY,SECONDARY,RUNNER_DERIVED"
    );
    assert.equal(result.human_projection[3], "groups: supported=14 unavailable=0 required_observed=7/7");
    assert.equal(
      result.human_projection[4],
      "1. run_lifecycle REQUIRED contract=REQUIRED scope=UNCONDITIONAL_REQUIRED source=SECONDARY" +
      " evidence=controlled wrapper process supervisor record for task.started and task.ended" +
      " proof=none effect=run invalid effects=RUN_INVALID metrics=none"
    );
    assert.equal(result.human_projection[18], `note: ${NOT_USER_FAILURE_CLAUSE}`);

    // Exhaustive over the frozen surfaces the derivation reads.
    assert.equal(doc.source_authority, "docs/north-star/agent-operator-score-ssot-v1.0.md#9.2");
    assert.equal(doc.acceptance_clause, ACCEPTANCE_CLAUSE);
    assert.equal(doc.no_silent_estimation_clause, NO_SILENT_ESTIMATION_CLAUSE);
    assert.equal(doc.not_user_failure_clause, NOT_USER_FAILURE_CLAUSE);
    assert.equal(doc.command_template, "aos doctor --capabilities --runtime <runtime>");
    assert.deepEqual(doc.runtime_ids, RUNTIME_IDS);
    assert.deepEqual(doc.capability_digest_fields, DIGEST_FIELDS);
    assert.deepEqual(doc.declared_digest_fields, DIGEST_FIELDS.slice(0, 3));
    assert.deepEqual(doc.derived_digest_fields, DIGEST_FIELDS.slice(3));
    assert.deepEqual(doc.source_classes, SOURCE_CLASSES);
    assert.deepEqual(doc.report_fields, REPORT_FIELDS);
    assert.deepEqual(doc.observation_fields, OBSERVATION_FIELDS);
    assert.deepEqual(doc.event_groups, EVENT_GROUPS);
    assert.deepEqual(doc.unconditional_required_event_groups, REQUIRED_EVENT_GROUPS);
    assert.deepEqual(doc.derivation_proofs.map((entry: any) => entry.event_group), DERIVED_EVENT_GROUPS);
    assert.deepEqual(doc.assessment_modes.map((entry: any) => entry.mode_id), MODE_IDS);
    assert.deepEqual(doc.verdicts.map((entry: any) => entry.verdict_id), VERDICT_IDS);
    assert.deepEqual(doc.reason_codes.map((entry: any) => entry.reason_code), REASON_CODES);
    assert.deepEqual(doc.matrix_variants.map((entry: any) => entry.variant_id), VARIANT_IDS);
    assert.deepEqual(doc.canonical_reports.map((entry: any) => entry.report_id), CANONICAL_REPORT_IDS);

    // Cross-contract binding, asserted in both directions. The doctor reports on the E0B-001
    // matrix, so the fourteen groups and the seven unconditionally REQUIRED ones it names must
    // be the ones capability.ts derives from the SSOT §9.2 계약 column, and the document must
    // name the matrix contract it projects. Neither side can move alone.
    const validated = validateCapabilityMatrix(matrix);
    assert.deepEqual(validated.errors, []);
    assert.deepEqual(doc.event_groups, validated.rows.map((row: any) => row.event_group));
    assert.deepEqual(doc.unconditional_required_event_groups, validated.required_event_groups);
    assert.equal(doc.unconditional_required_event_groups.length, 7);
    assert.equal(doc.unconditional_required_event_groups.includes("human_active_time"), false);
    assert.equal(doc.capability_contract_id, matrix.contract_id);
    assert.equal(doc.capability_contract_version, matrix.contract_version);

    // Every observation repeats its matrix cell rather than restating it.
    const matrixRows: any[] = validated.rows;
    for (const observation of report.observations) {
      const row = matrixRows.find((entry) => entry.event_group === observation.event_group);
      const cell = row.runtimes.codex;
      assert.equal(observation.status, cell.status, observation.event_group);
      assert.equal(observation.source_class, cell.source_class, observation.event_group);
      assert.equal(observation.evidence_locator, cell.evidence_locator, observation.event_group);
      assert.equal(observation.derivation_proof, cell.derivation_proof ?? null, observation.event_group);
      assert.equal(observation.contract, row.contract, observation.event_group);
      assert.equal(observation.requirement_scope, row.requirement_scope, observation.event_group);
      assert.equal(observation.source_row, row.source_row, observation.event_group);
      assert.equal(observation.missing_effect, row.missing_effect, observation.event_group);
      assert.deepEqual(observation.missing_effects, row.missing_effects, observation.event_group);
      assert.deepEqual(observation.affected_metrics, row.affected_metrics, observation.event_group);
    }
    assert.deepEqual(report.capability_digest.supported_event_groups, validated.coverage.codex.supported_event_groups);
    assert.deepEqual(report.capability_digest.known_missing_events, validated.coverage.codex.known_missing_events);
  });

  // AC-E0B-003-2
  test("degraded", () => {
    const doc = frozen();
    // SSOT §9.2 line 980 applied to the plan_state row: no derivation proof, so the group is
    // UNAVAILABLE. Its 누락 처리 column falls to NOT OBSERVED, so the score is not blocked.
    const matrix = unproven(frozenMatrix(), "codex", ["plan_state"]);
    const report = fixtureOf("degraded");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    assert.equal(result.verdict, "DEGRADED");
    assert.equal(result.exit_code, 10);
    assert.deepEqual(result.reasons, [PLAN_STATE_REASON]);
    assert.equal(entryOf(doc, "degraded").matrix_variant, "plan-state-derivation-unproven");

    const planState = observationOf(report, "plan_state");
    assert.equal(planState.status, "UNAVAILABLE");
    assert.equal(planState.derivation_proof, null);
    assert.deepEqual(planState.missing_effects, ["METRICS_BLOCKED", "NOT_OBSERVED"]);
    assert.deepEqual(planState.affected_metrics, ["M12", "M13", "M14"]);
    // The group leaves the supported coverage and enters the known-missing list.
    assert.deepEqual(report.capability_digest.known_missing_events, ["plan_state"]);
    assert.equal(report.capability_digest.supported_event_groups.includes("plan_state"), false);
    assert.equal(report.capability_digest.supported_event_groups.length, 13);

    assert.equal(result.human_projection[1], "verdict: DEGRADED exit=10 mode=VERIFIED_ASSESSMENT");
    assert.equal(result.human_projection[3], "groups: supported=13 unavailable=1 required_observed=7/7");
    assert.equal(
      result.human_projection[14],
      "11. plan_state UNAVAILABLE contract=DERIVED/CONDITIONAL scope=CONDITIONAL source=RUNNER_DERIVED" +
      " evidence=runner state artifacts and the runner stall watchdog timeline proof=none" +
      " effect=M12–M14 blocked or NOT OBSERVED effects=METRICS_BLOCKED,NOT_OBSERVED metrics=M12,M13,M14"
    );
    assert.equal(result.human_projection[18], `reason: ${PLAN_STATE_REASON}`);
    assert.equal(result.human_projection[19], `note: ${NOT_USER_FAILURE_CLAUSE}`);

    // A degraded adapter is still a scoreable one; the verdict may not be promoted or demoted.
    const promoted = clone(report);
    promoted.verdict = "COMPLETE";
    assert.equal(messageFor(validate(promoted, doc, matrix), "VERDICT_MISMATCH"),
      "VERDICT_MISMATCH derives DEGRADED");
    const demoted = clone(report);
    demoted.verdict = "SCORE_BLOCKED";
    assert.ok(has(validate(demoted, doc, matrix), "VERDICT_MISMATCH derives DEGRADED"));

    // The same report read against the unperturbed matrix is wrong in every derived place,
    // which is what makes the verdict a function of the matrix and not of the report. The
    // refused report fails closed, and the verdict the matrix does derive is carried in the
    // error rather than returned as an answer.
    const againstDeclared = validate(report, doc, frozenMatrix());
    assert.equal(againstDeclared.ok, false);
    assert.equal(againstDeclared.verdict, "SCORE_BLOCKED");
    assert.equal(againstDeclared.exit_code, 30);
    assert.ok(has(againstDeclared, "VERDICT_MISMATCH derives COMPLETE"));
    assert.ok(has(againstDeclared, "OBSERVATION_MISMATCH plan_state status derives DERIVED"));
    assert.ok(has(againstDeclared, "DIGEST_KNOWN_MISSING_MISMATCH derives none"));
  });

  // AC-E0B-003-3
  test("blocked", () => {
    const doc = frozen();
    // The workspace_diff row is DERIVED and its 누락 처리 column reads "run invalid if
    // derivation fails", which never falls to NOT OBSERVED, so an unproven derivation blocks.
    const matrix = unproven(frozenMatrix(), "claude-code", ["workspace_diff"]);
    const report = fixtureOf("blocked");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, [WORKSPACE_DIFF_REASON]);
    assert.equal(report.runtime_id, "claude-code");
    assert.equal(report.command, "aos doctor --capabilities --runtime claude-code");

    const workspaceDiff = observationOf(report, "workspace_diff");
    assert.equal(workspaceDiff.status, "UNAVAILABLE");
    assert.equal(workspaceDiff.derivation_proof, null);
    assert.deepEqual(workspaceDiff.missing_effects, ["RUN_INVALID"]);

    // The blocking rule is the 누락 처리 column and not membership of the required set:
    // workspace_diff is not one of the seven unconditionally REQUIRED groups, so all seven are
    // still observed while the score is blocked anyway.
    assert.equal(REQUIRED_EVENT_GROUPS.includes("workspace_diff"), false);
    assert.equal(result.human_projection[3], "groups: supported=13 unavailable=1 required_observed=7/7");
    assert.equal(result.human_projection[1], "verdict: SCORE_BLOCKED exit=30 mode=VERIFIED_ASSESSMENT");
    assert.equal(result.human_projection[19], `note: ${NOT_USER_FAILURE_CLAUSE}`);

    // And the converse: an UNAVAILABLE group whose column does fall to NOT OBSERVED does not
    // block. The same mechanism, the other DERIVED row, a score that may still be issued.
    const stillScoreable = validate(
      fixtureOf("degraded"), doc, unproven(frozenMatrix(), "codex", ["plan_state"]));
    assert.deepEqual(stillScoreable.errors, []);
    assert.equal(stillScoreable.verdict, "DEGRADED");
    assert.equal(stillScoreable.exit_code, 10);
  });

  // AC-E0B-003-4
  test("imported-only", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("imported-only");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    assert.equal(result.verdict, "IMPORTED_ONLY");
    assert.equal(result.exit_code, 20);
    assert.deepEqual(result.reasons, [IMPORTED_REASON]);
    assert.equal(report.assessment_mode, "IMPORTED_SESSION");

    // A complete capability does not rescue an imported session: every group is observable and
    // the verdict is still IMPORTED_ONLY, because SSOT §9.2 line 971 admits it as DIAGNOSTIC
    // ONLY however good the adapter is.
    assert.deepEqual(report.capability_digest.known_missing_events, []);
    assert.equal(report.capability_digest.supported_event_groups.length, 14);
    assert.equal(result.human_projection[3], "groups: supported=14 unavailable=0 required_observed=7/7");
    assert.equal(result.human_projection[1], "verdict: IMPORTED_ONLY exit=20 mode=IMPORTED_SESSION");
    assert.equal(result.human_projection[18], `reason: ${IMPORTED_REASON}`);

    // The mode is load bearing in both directions: the same adapter reported as a controlled
    // assessment derives COMPLETE and exit 0. The report still declares the imported verdict, so
    // it is refused and fails closed, and the two derived values arrive as errors.
    const controlled = clone(report);
    controlled.assessment_mode = "VERIFIED_ASSESSMENT";
    const asControlled = validate(controlled, doc, matrix);
    assert.equal(asControlled.ok, false);
    assert.equal(asControlled.verdict, "SCORE_BLOCKED");
    assert.equal(asControlled.exit_code, 30);
    assert.deepEqual(asControlled.reasons, []);
    assert.ok(has(asControlled, "VERDICT_MISMATCH derives COMPLETE"));
    assert.ok(has(asControlled, "EXIT_CODE_MISMATCH derives 0"));

    // The mode is a caller assertion, so it is constrained to the two frozen SSOT classes and
    // to nothing else; it is never inferred from the report.
    const invented = clone(report);
    invented.assessment_mode = "PROBABLY_CONTROLLED";
    const rejected = validate(invented, doc, matrix);
    assert.equal(
      messageFor(rejected, "UNKNOWN_ASSESSMENT_MODE"),
      "UNKNOWN_ASSESSMENT_MODE PROBABLY_CONTROLLED is outside the frozen SSOT 9.2 session classes"
    );
    assert.equal(rejected.verdict, "SCORE_BLOCKED", "an unreadable report fails closed");
    assert.equal(rejected.exit_code, 30);
    assert.deepEqual(modeRow(doc, "IMPORTED_SESSION").source_clause, IMPORTED_CLAUSE);
    assert.deepEqual(modeRow(doc, "VERIFIED_ASSESSMENT").source_clause, VERIFIED_CLAUSE);
  });

  test("invalid-assessment-mode-stops-before-projection", () => {
    const report = fixtureOf("complete");
    report.assessment_mode = "PROBABLY_CONTROLLED";

    // validateReport cannot derive a projection for an unknown mode. It must return as soon as
    // it records that defect; continuing would add a misleading projection mismatch to the
    // one error the malformed report actually caused.
    const result = validate(report, frozen(), frozenMatrix());
    assert.deepEqual(result.errors, [
      "UNKNOWN_ASSESSMENT_MODE PROBABLY_CONTROLLED is outside the frozen SSOT 9.2 session classes"
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.human_projection, []);
  });

  // AC-E0B-003-5
  test("stable-order", () => {
    const doc = frozen();
    const matrix = unproven(frozenMatrix(), "codex", ["workspace_diff", "plan_state"]);
    const report = fixtureOf("blocked-and-imported");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    // Reasons are ordered by severity first and by SSOT §9.2 table row second. The verdict is
    // the verdict of the first reason, so ordering and verdict cannot disagree.
    assert.deepEqual(result.reasons, [WORKSPACE_DIFF_REASON, IMPORTED_REASON, PLAN_STATE_REASON]);
    assert.deepEqual(codes({ errors: result.reasons }), REASON_CODES);
    assert.equal(result.verdict, VERDICT_OF_REASON[REASON_CODES[0]]);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);

    // Precedence is total and it is exercised: a session that is both imported and degraded
    // reports the imported reason first and takes its verdict, and both reasons are kept.
    const degradedImported = validate(
      fixtureOf("imported-and-degraded"), doc, unproven(frozenMatrix(), "codex", ["plan_state"]));
    assert.deepEqual(degradedImported.errors, []);
    assert.deepEqual(degradedImported.reasons, [IMPORTED_REASON, PLAN_STATE_REASON]);
    assert.equal(degradedImported.verdict, "IMPORTED_ONLY");

    // Determinism: the same inputs produce the same output, twice.
    assert.deepEqual(validate(report, doc, matrix), result);

    // Key order in the JSON is not information. A report rebuilt with every object's keys
    // reversed derives the same verdict, reasons and projection.
    const reversedKeys = (value: any): any => {
      if (Array.isArray(value)) return value.map(reversedKeys);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reversedKeys(value[key])]));
    };
    // The one ordered key set in the report is the SSOT §9.2 line 939 digest, so it keeps its
    // order and everything else is reversed; the result is identical in every derived field.
    const shuffledReport = reversedKeys(report);
    shuffledReport.capability_digest = report.capability_digest;
    const shuffled = validate(shuffledReport, doc, matrix);
    assert.deepEqual(shuffled.errors, []);
    assert.equal(shuffled.verdict, result.verdict);
    assert.deepEqual(shuffled.reasons, result.reasons);
    assert.deepEqual(shuffled.human_projection, result.human_projection);
    // And the digest is the only thing that complains when it is reversed too: nothing else in
    // the output depends on JSON key order.
    assert.deepEqual([...new Set(codes(validate(reversedKeys(report), doc, matrix)))],
      ["DIGEST_FIELDS_MISMATCH"]);

    // Observation order is the SSOT §9.2 table order, not the report's choice.
    const swapped = clone(report);
    [swapped.observations[0], swapped.observations[1]] = [swapped.observations[1], swapped.observations[0]];
    const swapResult = validate(swapped, doc, matrix);
    assert.equal(messageFor(swapResult, "OBSERVATION_ORDER_BROKEN"),
      "OBSERVATION_ORDER_BROKEN position 1 derives run_lifecycle");
    // Each misplaced row is reported as misplaced once, and its values are not then compared
    // against the row that should have been there.
    assert.deepEqual(codes(swapResult), ["OBSERVATION_ORDER_BROKEN", "OBSERVATION_ORDER_BROKEN"]);

    // Reason order is derived, so a report may not reorder its own reasons.
    const reordered = clone(report);
    reordered.reasons = [...report.reasons].reverse();
    assert.equal(
      messageFor(validate(reordered, doc, matrix), "REASONS_MISMATCH"),
      "REASONS_MISMATCH derives BLOCKING_GROUP_UNAVAILABLE,IMPORTED_SESSION_DIAGNOSTIC_ONLY,DEGRADED_GROUP_UNAVAILABLE"
    );

    // The projection's own order: header, one line per group in table order, the reasons in
    // the same order, then the SSOT line 981 note last.
    assert.equal(result.human_projection.length, 22);
    assert.deepEqual(result.human_projection.slice(4, 18).map((line: string) => line.split(" ")[1]), EVENT_GROUPS);
    assert.deepEqual(result.human_projection.slice(18, 21), result.reasons.map((reason: string) => `reason: ${reason}`));
    assert.equal(result.human_projection.at(-1), `note: ${NOT_USER_FAILURE_CLAUSE}`);
    const shiftedProjection = clone(report);
    shiftedProjection.human_projection = [...report.human_projection].reverse();
    assert.ok(has(validate(shiftedProjection, doc, matrix), "HUMAN_PROJECTION_MISMATCH line 1 derives"));
    const truncatedProjection = clone(report);
    truncatedProjection.human_projection = report.human_projection.slice(0, -1);
    assert.equal(
      messageFor(validate(truncatedProjection, doc, matrix), "HUMAN_PROJECTION_LENGTH_MISMATCH"),
      "HUMAN_PROJECTION_LENGTH_MISMATCH derives 22 lines"
    );

    // Error order is stable too, so a receipt quoting one run stays comparable to the next.
    const broken = clone(report);
    broken.command = "aos doctor";
    broken.exit_code = 1;
    const first = validate(broken, doc, matrix);
    assert.deepEqual(codes(first), ["COMMAND_MISMATCH", "EXIT_CODE_MISMATCH"]);
    assert.deepEqual(validate(broken, doc, matrix).errors, first.errors);
  });

  // The ticket's pre-GREEN failure, turned into a standing guard: a doctor report may not omit
  // the source it rests on, the effect a gap carries, or the capability digest, and still be
  // read as healthy.
  test("source-effect-and-digest-cannot-be-omitted", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // Source. Dropping or blanking either half of "근거 source" is an error, per group.
    for (const field of ["source_class", "evidence_locator", "derivation_proof"]) {
      const dropped = clone(report);
      delete observationOf(dropped, "tool_call")[field];
      const result = validate(dropped, doc, matrix);
      assert.equal(
        messageFor(result, "OBSERVATION_MISSING_FIELD"),
        `OBSERVATION_MISSING_FIELD tool_call ${field} is required by the doctor contract`
      );
      assert.equal(result.ok, false, `${field} may not be omitted`);
      // Reported once as absent, not a second time as disagreeing with itself.
      assert.deepEqual(codes(result), ["OBSERVATION_MISSING_FIELD"], field);
    }
    const blanked = clone(report);
    observationOf(blanked, "tool_call").evidence_locator = "";
    assert.ok(has(validate(blanked, doc, matrix), "OBSERVATION_MISMATCH tool_call evidence_locator derives"));
    const invented = clone(report);
    observationOf(invented, "tool_call").evidence_locator = "the internal transcript, obviously";
    assert.ok(has(validate(invented, doc, matrix), "OBSERVATION_MISMATCH tool_call evidence_locator derives"));
    const reclassified = clone(report);
    observationOf(reclassified, "run_lifecycle").source_class = "PRIMARY";
    assert.equal(
      messageFor(validate(reclassified, doc, matrix), "OBSERVATION_MISMATCH"),
      "OBSERVATION_MISMATCH run_lifecycle source_class derives SECONDARY"
    );

    // Effect. The 누락 처리 column, its derived effect classes and its affected metrics are all
    // part of the output; none of the three may be dropped, emptied or rewritten.
    for (const field of ["missing_effect", "missing_effects", "affected_metrics"]) {
      const dropped = clone(report);
      delete observationOf(dropped, "evidence_claim")[field];
      assert.equal(
        messageFor(validate(dropped, doc, matrix), "OBSERVATION_MISSING_FIELD"),
        `OBSERVATION_MISSING_FIELD evidence_claim ${field} is required by the doctor contract`
      );
    }
    const emptiedEffects = clone(report);
    observationOf(emptiedEffects, "evidence_claim").missing_effects = [];
    assert.equal(
      messageFor(validate(emptiedEffects, doc, matrix), "OBSERVATION_MISMATCH"),
      "OBSERVATION_MISMATCH evidence_claim missing_effects derives METRICS_BLOCKED"
    );
    const emptiedMetrics = clone(report);
    observationOf(emptiedMetrics, "evidence_claim").affected_metrics = [];
    assert.equal(
      messageFor(validate(emptiedMetrics, doc, matrix), "OBSERVATION_MISMATCH"),
      "OBSERVATION_MISMATCH evidence_claim affected_metrics derives M15,M16,M17"
    );
    const rewritten = clone(report);
    observationOf(rewritten, "evidence_claim").missing_effect = "nothing much";
    assert.ok(has(validate(rewritten, doc, matrix), "OBSERVATION_MISMATCH evidence_claim missing_effect derives M15–M17 blocked"));

    // Digest. All six SSOT §9.2 line 939 fields, and no substitute for any of them.
    const noDigest = clone(report);
    delete noDigest.capability_digest;
    const missingDigest = validate(noDigest, doc, matrix);
    assert.ok(has(missingDigest, "REPORT_MISSING_FIELD capability_digest is required by the doctor contract"));
    assert.equal(missingDigest.ok, false);
    for (const field of DIGEST_FIELDS) {
      const thinned = clone(report);
      delete thinned.capability_digest[field];
      assert.equal(
        messageFor(validate(thinned, doc, matrix), "DIGEST_FIELDS_MISMATCH"),
        `DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`,
        `${field} may not be omitted from the digest`
      );
    }
    const notAnObject = clone(report);
    notAnObject.capability_digest = "codex@1";
    assert.equal(
      messageFor(validate(notAnObject, doc, matrix), "DIGEST_NOT_AN_OBJECT"),
      "DIGEST_NOT_AN_OBJECT the stored capability digest must be an object"
    );

    // And, the point of the whole case: none of these omissions may leave the report healthy.
    for (const mutate of [
      (r: any) => { delete observationOf(r, "tool_call").evidence_locator; },
      (r: any) => { delete observationOf(r, "tool_call").missing_effects; },
      (r: any) => { delete r.capability_digest; }
    ]) {
      const damaged = clone(report);
      mutate(damaged);
      const result = validate(damaged, doc, matrix);
      assert.equal(result.ok, false, "an omission left the report healthy");
      assert.ok(result.errors.length > 0);
    }
  });

  test("derived-fields-are-never-trusted", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // Every field the matrix determines is recomputed. A report cannot promote a status,
    // rename its own command, or restate coverage it does not have.
    const promotedStatus = clone(report);
    observationOf(promotedStatus, "plan_state").status = "REQUIRED";
    assert.equal(
      messageFor(validate(promotedStatus, doc, matrix), "OBSERVATION_MISMATCH"),
      "OBSERVATION_MISMATCH plan_state status derives DERIVED"
    );
    const renamedCommand = clone(report);
    renamedCommand.command = "aos doctor --capabilities --runtime claude-code";
    assert.equal(
      messageFor(validate(renamedCommand, doc, matrix), "COMMAND_MISMATCH"),
      "COMMAND_MISMATCH derives aos doctor --capabilities --runtime codex"
    );
    const invertedCoverage = clone(report);
    invertedCoverage.capability_digest.known_missing_events = ["plan_state"];
    assert.equal(
      messageFor(validate(invertedCoverage, doc, matrix), "DIGEST_KNOWN_MISSING_MISMATCH"),
      "DIGEST_KNOWN_MISSING_MISMATCH derives none"
    );
    const shortenedCoverage = clone(report);
    shortenedCoverage.capability_digest.supported_event_groups = EVENT_GROUPS.slice(0, 3);
    assert.ok(has(validate(shortenedCoverage, doc, matrix),
      `DIGEST_SUPPORTED_GROUPS_MISMATCH derives ${EVENT_GROUPS.join(",")}`));
    const forgedInventory = clone(report);
    forgedInventory.capability_digest.source_class = ["PRIMARY"];
    assert.equal(
      messageFor(validate(forgedInventory, doc, matrix), "DIGEST_SOURCE_CLASS_MISMATCH"),
      "DIGEST_SOURCE_CLASS_MISMATCH derives PRIMARY,SECONDARY,RUNNER_DERIVED"
    );
    const forgedOrdinal = clone(report);
    observationOf(forgedOrdinal, "tool_call").ordinal = 1;
    assert.equal(
      messageFor(validate(forgedOrdinal, doc, matrix), "OBSERVATION_MISMATCH"),
      "OBSERVATION_MISMATCH tool_call ordinal derives 4"
    );
    const forgedRuntime = clone(report);
    forgedRuntime.runtime_id = "gpt-vibes";
    const unknownRuntime = validate(forgedRuntime, doc, matrix);
    assert.equal(
      messageFor(unknownRuntime, "UNKNOWN_RUNTIME"),
      "UNKNOWN_RUNTIME gpt-vibes is outside the frozen SSOT 9.2 runtime set"
    );
    assert.equal(unknownRuntime.verdict, "SCORE_BLOCKED");

    // The document's own canonical verdicts are recomputed, never believed. A contract that
    // calls a blocked adapter COMPLETE validates nothing at all, and takes every other
    // report down with it rather than answering from a broken rule.
    const forged = validate(report, doc, matrix,
      withFixture("blocked", (canonical) => { canonical.verdict = "COMPLETE"; }));
    assert.equal(forged.ok, false);
    assert.equal(
      messageFor(forged, "CONTRACT_CANONICAL_REPORT_INVALID"),
      "CONTRACT_CANONICAL_REPORT_INVALID blocked VERDICT_MISMATCH derives SCORE_BLOCKED"
    );
    assert.equal(forged.verdict, "SCORE_BLOCKED", "a broken contract fails closed");
    assert.deepEqual(forged.reasons, []);
    assert.deepEqual(forged.human_projection, []);

    assert.ok(has(validate(report, doc, matrix,
      withFixture("blocked", (canonical) => { canonical.exit_code = 0; })),
      "CONTRACT_CANONICAL_REPORT_INVALID blocked EXIT_CODE_MISMATCH derives 30"));

    assert.ok(has(validate(report, doc, matrix,
      withFixture("degraded", (canonical) => { canonical.reasons = []; })),
      "CONTRACT_CANONICAL_REPORT_INVALID degraded REASONS_MISMATCH derives DEGRADED_GROUP_UNAVAILABLE"));

    assert.ok(has(validate(report, doc, matrix,
      withFixture("complete", (canonical) => { canonical.capability_digest.known_missing_events = ["token_cost"]; })),
      "CONTRACT_CANONICAL_REPORT_INVALID complete DIGEST_KNOWN_MISSING_MISMATCH derives none"));

    assert.ok(has(validate(report, doc, matrix,
      withFixture("complete", (canonical) => { canonical.runtime_id = "codex-next"; })),
      "CONTRACT_CANONICAL_REPORT_INVALID complete UNKNOWN_RUNTIME codex-next"));

    // A canonical entry may not point at a variant that does not exist.
    const forgedVariant = frozen();
    entryOf(forgedVariant, "degraded").matrix_variant = "everything-is-fine";
    assert.equal(
      messageFor(validate(report, forgedVariant, matrix), "CONTRACT_CANONICAL_VARIANT_UNKNOWN"),
      "CONTRACT_CANONICAL_VARIANT_UNKNOWN degraded names everything-is-fine"
    );
    // Or at the wrong one: a degraded report read against the identity variant stops deriving
    // its verdict, so the document no longer proves the verdict it claims to.
    const repointed = frozen();
    entryOf(repointed, "degraded").matrix_variant = "as-declared";
    const repointedResult = validate(report, repointed, matrix);
    assert.ok(has(repointedResult, "CONTRACT_CANONICAL_REPORT_INVALID degraded VERDICT_MISMATCH derives COMPLETE"));
    assert.ok(has(repointedResult, "CONTRACT_VERDICT_UNEXERCISED DEGRADED"));
  });

  test("matrix-drift-fails-closed", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");
    assert.equal(validate(report, doc, matrix).ok, true);

    // Drift on the matrix side. The doctor revalidates the E0B-001 contract on every call, so
    // a matrix that no longer matches SSOT §9.2 yields no verdict at all.
    const tampered = clone(matrix);
    tampered.rows[0].contract = "BEST_EFFORT";
    const rejected = validate(report, doc, tampered);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.verdict, "SCORE_BLOCKED");
    assert.equal(rejected.exit_code, 30);
    assert.deepEqual(rejected.human_projection, []);
    assert.deepEqual([...new Set(codes(rejected))], ["CAPABILITY_MATRIX_INVALID"]);
    assert.ok(has(rejected, "CONTRACT_TEXT_MISMATCH run_lifecycle must read REQUIRED"));

    const droppedRow = clone(matrix);
    droppedRow.rows.splice(4, 1);
    assert.ok(has(validate(report, doc, droppedRow), "CAPABILITY_MATRIX_INVALID ROW_COUNT_NOT_14"));

    const forgedProof = clone(matrix);
    forgedProof.rows[4].runtimes.codex.derivation_proof = null;
    assert.ok(has(validate(report, doc, forgedProof), "CAPABILITY_MATRIX_INVALID CELL_STATUS_MISMATCH"),
      "SSOT 9.2 line 980: a derived cell with no proof is UNAVAILABLE");

    // Drift on the doctor side. The contract names the matrix contract it projects and the
    // groups that matrix derives; restating either differently fails.
    const renamed = frozen();
    renamed.capability_contract_id = "adapter-capabilities.v1";
    assert.equal(
      messageFor(validate(report, renamed, matrix), "CONTRACT_CAPABILITY_BINDING_MISMATCH"),
      "CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_id must read adapter-capabilities.v0"
    );
    const revised = frozen();
    revised.capability_contract_version = "adapter-capability-contract-v1";
    assert.ok(has(validate(report, revised, matrix),
      "CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_version must read adapter-capability-contract-v0"));

    const forgedGroups = frozen();
    forgedGroups.event_groups = EVENT_GROUPS.filter((group) => group !== "workspace_diff");
    assert.ok(has(validate(report, forgedGroups, matrix),
      `CONTRACT_EVENT_GROUPS_MISMATCH event_groups must read ${EVENT_GROUPS.join(",")}`));

    const forgedRequired = frozen();
    forgedRequired.unconditional_required_event_groups = [...REQUIRED_EVENT_GROUPS, "human_active_time"];
    assert.ok(has(validate(report, forgedRequired, matrix),
      `CONTRACT_REQUIRED_GROUPS_MISMATCH unconditional_required_event_groups must read ${REQUIRED_EVENT_GROUPS.join(",")}`));

    const reorderedRequired = frozen();
    reorderedRequired.unconditional_required_event_groups = [...REQUIRED_EVENT_GROUPS].reverse();
    assert.ok(has(validate(report, reorderedRequired, matrix), "CONTRACT_REQUIRED_GROUPS_MISMATCH"));

    // The two derivation proofs are pinned across the two files. E0B-001 checked only that a
    // proof was non-blank, so this is the first place the text itself is held to a second
    // document; either side moving alone fails.
    const proofOf = (group: string) =>
      matrix.rows.find((row: any) => row.event_group === group).runtimes.codex.derivation_proof;
    for (const group of DERIVED_EVENT_GROUPS) {
      assert.equal(doc.derivation_proofs.find((entry: any) => entry.event_group === group).proof,
        proofOf(group), group);
      const restated = frozen();
      restated.derivation_proofs.find((entry: any) => entry.event_group === group).proof =
        "reconstruct it somehow";
      for (const runtimeId of RUNTIME_IDS) {
        assert.ok(has(validate(report, restated, matrix),
          `CONTRACT_DERIVATION_PROOF_MISMATCH ${group} ${runtimeId} must read ${proofOf(group)}`), `${group} ${runtimeId}`);
      }
      const movedMatrix = clone(matrix);
      movedMatrix.rows.find((row: any) => row.event_group === group).runtimes["claude-code"]
        .derivation_proof = "reconstruct it somehow";
      assert.ok(has(validate(report, doc, movedMatrix),
        `CONTRACT_DERIVATION_PROOF_MISMATCH ${group} claude-code must read reconstruct it somehow`), group);
    }

    // A blank proof is not a proof: SSOT §9.2 line 980 makes the restored cell UNAVAILABLE, the
    // variant stops producing a matrix capability.ts accepts, and the contract says so instead
    // of deriving a canonical verdict from a broken perturbation.
    const blankProof = frozen();
    blankProof.derivation_proofs.find((entry: any) => entry.event_group === "plan_state").proof = "";
    const blankResult = validate(report, blankProof, matrix);
    assert.equal(
      messageFor(blankResult, "CONTRACT_VARIANT_INVALID"),
      "CONTRACT_VARIANT_INVALID as-declared codex CELL_STATUS_MISMATCH plan_state codex derives UNAVAILABLE"
    );
    assert.equal(has(blankResult, "CONTRACT_CANONICAL_REPORT_INVALID"), false,
      "no canonical verdict may be derived from a matrix the sibling rejects");
  });

  test("frozen-contract-text-is-binding", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const tampers: [string, (contract: any) => void, string][] = [
      ["contract id", (c) => { c.contract_id = "doctor-output.v9"; }, "CONTRACT_ID expected doctor-output.v0"],
      ["contract version", (c) => { c.contract_version = "doctor-output-contract-v1"; }, "CONTRACT_VERSION expected doctor-output-contract-v0"],
      ["source authority", (c) => { c.source_authority = "https://evil.example/not-the-ssot"; }, "CONTRACT_SOURCE_AUTHORITY expected"],
      ["acceptance clause", (c) => { c.acceptance_clause = `${ACCEPTANCE_CLAUSE} (요약)`; }, "CONTRACT_ACCEPTANCE_CLAUSE_MISMATCH"],
      ["no silent estimation clause", (c) => { c.no_silent_estimation_clause = "적당히 추정한다"; }, "CONTRACT_NO_SILENT_ESTIMATION_CLAUSE_MISMATCH"],
      ["not user failure clause", (c) => { c.not_user_failure_clause = "사용자 탓이다"; }, "CONTRACT_NOT_USER_FAILURE_CLAUSE_MISMATCH"],
      ["declared only statement", (c) => { c.declared_only_statement = "everything here is verified"; }, "CONTRACT_DECLARED_ONLY_STATEMENT_MISMATCH"],
      ["command template", (c) => { c.command_template = "aos doctor"; }, "CONTRACT_COMMAND_TEMPLATE_MISMATCH expected aos doctor --capabilities --runtime <runtime>"],
      ["version token bound", (c) => { c.version_token_max_chars = 1_000_000; }, "CONTRACT_VERSION_TOKEN_BOUND_MISMATCH expected 64"],
      ["runtime ids", (c) => { c.runtime_ids = [...RUNTIME_IDS, "gemini"]; }, "CONTRACT_RUNTIME_IDS_MISMATCH"],
      ["digest fields", (c) => { c.capability_digest_fields = DIGEST_FIELDS.slice(0, 5); }, "CONTRACT_DIGEST_FIELDS_MISMATCH"],
      ["digest field order", (c) => { c.capability_digest_fields = [...DIGEST_FIELDS].reverse(); }, "CONTRACT_DIGEST_FIELDS_MISMATCH"],
      ["declared digest fields", (c) => { c.declared_digest_fields = DIGEST_FIELDS; }, "CONTRACT_DECLARED_DIGEST_FIELDS_MISMATCH"],
      ["derived digest fields", (c) => { c.derived_digest_fields = []; }, "CONTRACT_DERIVED_DIGEST_FIELDS_MISMATCH"],
      ["source classes", (c) => { c.source_classes = ["PRIMARY"]; }, "CONTRACT_SOURCE_CLASSES_MISMATCH"],
      ["report fields", (c) => { c.report_fields = REPORT_FIELDS.slice(0, 4); }, "CONTRACT_REPORT_FIELDS_MISMATCH"],
      ["observation fields", (c) => { c.observation_fields = [...OBSERVATION_FIELDS].reverse(); }, "CONTRACT_OBSERVATION_FIELDS_MISMATCH"],
      ["mode table shortened", (c) => { c.assessment_modes.pop(); }, "CONTRACT_TABLE_COUNT mode found 1 and not 2"],
      ["mode table not an array", (c) => { c.assessment_modes = {}; }, "CONTRACT_TABLE_NOT_AN_ARRAY mode must declare 2 rows"],
      ["mode row not an object", (c) => { c.assessment_modes[0] = "VERIFIED_ASSESSMENT"; }, "CONTRACT_ROW_NOT_AN_OBJECT mode position 1"],
      ["unknown mode", (c) => { c.assessment_modes[1].mode_id = "SEMI_CONTROLLED"; }, "CONTRACT_UNKNOWN_ROW mode SEMI_CONTROLLED is outside the frozen set"],
      ["duplicate mode", (c) => { c.assessment_modes[1] = clone(c.assessment_modes[0]); }, "CONTRACT_DUPLICATE_ROW mode VERIFIED_ASSESSMENT appears more than once"],
      ["mode order", (c) => { c.assessment_modes.reverse(); }, "CONTRACT_ROW_ORDER_BROKEN mode IMPORTED_SESSION sits at position 1 and not 2"],
      ["mode ordinal", (c) => { c.assessment_modes[0].ordinal = 7; }, "CONTRACT_ROW_ORDINAL_MISMATCH mode VERIFIED_ASSESSMENT declares 7"],
      ["mode field missing", (c) => { delete c.assessment_modes[0].statement; }, "CONTRACT_MISSING_ROW_FIELD mode VERIFIED_ASSESSMENT statement"],
      ["mode statement blank", (c) => { c.assessment_modes[0].statement = "   "; }, "CONTRACT_EMPTY_TEXT mode VERIFIED_ASSESSMENT statement"],
      ["mode clause", (c) => { c.assessment_modes[1].source_clause = "요약된 문장"; }, "CONTRACT_CLAUSE_MISMATCH mode IMPORTED_SESSION must quote its SSOT clause verbatim"],
      ["verdict clause", (c) => { verdictRow(c, "DEGRADED").source_clause = "대충"; }, "CONTRACT_CLAUSE_MISMATCH verdict DEGRADED must quote its SSOT clause verbatim"],
      ["verdict predicate", (c) => { verdictRow(c, "COMPLETE").predicate = "looks fine"; }, "CONTRACT_PREDICATE_MISMATCH verdict COMPLETE must read"],
      ["verdict order", (c) => { c.verdicts.reverse(); }, "CONTRACT_ROW_ORDER_BROKEN verdict COMPLETE sits at position 1 and not 4"],
      ["verdict gap", (c) => { c.verdicts = c.verdicts.filter((row: any) => row.verdict_id !== "DEGRADED"); }, "CONTRACT_ROW_GAP verdict DEGRADED is absent from the contract"],
      ["reason predicate", (c) => { reasonRow(c, "BLOCKING_GROUP_UNAVAILABLE").predicate = "something bad"; }, "CONTRACT_PREDICATE_MISMATCH reason BLOCKING_GROUP_UNAVAILABLE must read"],
      ["reason order", (c) => { [c.reason_codes[1], c.reason_codes[2]] = [c.reason_codes[2], c.reason_codes[1]]; }, "CONTRACT_ROW_ORDER_BROKEN reason DEGRADED_GROUP_UNAVAILABLE sits at position 2 and not 3"],
      ["variant clause", (c) => { variantRow(c, "plan-state-derivation-unproven").source_clause = ACCEPTANCE_CLAUSE; }, "CONTRACT_CLAUSE_MISMATCH variant plan-state-derivation-unproven must quote its SSOT clause verbatim"],
      ["variant groups", (c) => { variantRow(c, "plan-state-derivation-unproven").unproven_derivations = ["tool_call"]; }, "CONTRACT_VARIANT_GROUPS_MISMATCH plan-state-derivation-unproven must read plan_state"],
      ["identity variant groups", (c) => { variantRow(c, "as-declared").unproven_derivations = ["plan_state"]; }, "CONTRACT_VARIANT_GROUPS_MISMATCH as-declared must read none"],
      ["canonical order", (c) => { [c.canonical_reports[0], c.canonical_reports[1]] = [c.canonical_reports[1], c.canonical_reports[0]]; }, "CONTRACT_ROW_ORDER_BROKEN canonical degraded sits at position 1 and not 2"],
      ["canonical gap", (c) => { c.canonical_reports = c.canonical_reports.filter((row: any) => row.report_id !== "blocked"); }, "CONTRACT_ROW_GAP canonical blocked is absent from the contract"]
    ];
    for (const [label, tamper, expected] of tampers) {
      const tampered = frozen();
      tamper(tampered);
      const result = validate(report, tampered, matrix);
      assert.equal(result.ok, false, `accepted a tampered contract: ${label}`);
      assert.equal(result.verdict, "SCORE_BLOCKED", `did not fail closed: ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.errors.join("; ") || "no error"}`);
    }

    // The four SSOT clauses are quoted verbatim in the frozen document itself.
    assert.equal(verdictRow(doc, "SCORE_BLOCKED").source_clause, REQUIRED_STATUS_CLAUSE);
    assert.equal(verdictRow(doc, "DEGRADED").source_clause, UNAVAILABLE_STATUS_CLAUSE);
    assert.equal(verdictRow(doc, "IMPORTED_ONLY").source_clause, IMPORTED_CLAUSE);
    assert.equal(verdictRow(doc, "COMPLETE").source_clause, VERIFIED_CLAUSE);
    for (const verdictId of VERDICT_IDS) {
      assert.equal(verdictRow(doc, verdictId).source_clause, VERDICT_CLAUSES[verdictId], verdictId);
    }
    for (const modeId of MODE_IDS) {
      assert.equal(modeRow(doc, modeId).source_clause, MODE_CLAUSES[modeId], modeId);
    }
    assert.equal(variantRow(doc, "as-declared").source_clause, ACCEPTANCE_CLAUSE);
    for (const variantId of VARIANT_IDS.slice(1)) {
      assert.equal(variantRow(doc, variantId).source_clause, NO_SILENT_ESTIMATION_CLAUSE, variantId);
    }
    assert.deepEqual(variantRow(doc, "as-declared").unproven_derivations, []);
    assert.deepEqual(variantRow(doc, "both-derivations-unproven").unproven_derivations,
      ["workspace_diff", "plan_state"]);

    // A row that is not a row is reported once, and its id is not then read off a string.
    const rowNotAnObject = frozen();
    rowNotAnObject.assessment_modes[0] = "VERIFIED_ASSESSMENT";
    assert.deepEqual(codes(validate(report, rowNotAnObject, matrix)),
      ["CONTRACT_ROW_NOT_AN_OBJECT", "CONTRACT_ROW_GAP"]);

    // A misplaced row is reported as misplaced, and its value checks are not run against the
    // wrong row: the clause below belongs to the other mode and is not flagged as well.
    const misplaced = frozen();
    misplaced.assessment_modes.reverse();
    misplaced.assessment_modes[0].source_clause = "요약된 문장";
    assert.deepEqual(codes(validate(report, misplaced, matrix)),
      ["CONTRACT_ROW_ORDER_BROKEN", "CONTRACT_ROW_ORDER_BROKEN"]);

    // An absent pinned field is an absent field and nothing else; a pin is not applied to a
    // value that is not there.
    const absent: [string, (contract: any) => void][] = [
      ["mode source_clause", (c) => { delete modeRow(c, "IMPORTED_SESSION").source_clause; }],
      ["verdict predicate", (c) => { delete verdictRow(c, "COMPLETE").predicate; }],
      ["verdict exit_code", (c) => { delete verdictRow(c, "DEGRADED").exit_code; }],
      ["reason verdict_id", (c) => { delete reasonRow(c, "DEGRADED_GROUP_UNAVAILABLE").verdict_id; }],
    ];
    for (const [label, tamper] of absent) {
      const tampered = frozen();
      tamper(tampered);
      assert.deepEqual(codes(validate(report, tampered, matrix)),
        ["CONTRACT_MISSING_ROW_FIELD"], label);
    }
    // The variant group list is the exception: absent is also not the frozen list, so it is
    // reported both as missing and as wrong, on purpose.
    const noGroups = frozen();
    delete variantRow(noGroups, "plan-state-derivation-unproven").unproven_derivations;
    assert.deepEqual(codes(validate(report, noGroups, matrix)),
      ["CONTRACT_MISSING_ROW_FIELD", "CONTRACT_VARIANT_GROUPS_MISMATCH"]);

    // An unrecognised row is reported once and is not then measured against a position it
    // never had.
    const unknownRow = frozen();
    unknownRow.assessment_modes[1].mode_id = "SEMI_CONTROLLED";
    assert.deepEqual(codes(validate(report, unknownRow, matrix)),
      ["CONTRACT_UNKNOWN_ROW", "CONTRACT_ROW_GAP"]);

    // A one-character statement is short, not blank; the check is emptiness and nothing more.
    const terse = frozen();
    modeRow(terse, "VERIFIED_ASSESSMENT").statement = "x";
    assert.deepEqual(validate(report, terse, matrix).errors, []);
  });

  test("exit-codes-are-derived-from-the-verdict", () => {
    const doc = frozen();
    const matrix = frozenMatrix();

    // The four exit codes, frozen. Only COMPLETE exits zero: every state that cannot issue an
    // official AOS-Coding P0 is a non-zero exit, and the codes rise with severity.
    for (const verdictId of VERDICT_IDS) {
      assert.equal(verdictRow(doc, verdictId).exit_code, EXIT_CODES[verdictId], verdictId);
    }
    assert.deepEqual(doc.verdicts.map((row: any) => row.exit_code), [30, 20, 10, 0]);
    assert.equal(doc.verdicts.filter((row: any) => row.exit_code === 0).length, 1);
    assert.equal(new Set(doc.verdicts.map((row: any) => row.exit_code)).size, 4);

    // Each canonical report exits with the code of the verdict it derives, and no report may
    // declare a different one.
    const cases: [string, string[], string, number][] = [
      ["complete", [], "COMPLETE", 0],
      ["degraded", ["plan_state"], "DEGRADED", 10],
      ["blocked", ["workspace_diff"], "SCORE_BLOCKED", 30],
      ["imported-only", [], "IMPORTED_ONLY", 20],
      ["imported-and-degraded", ["plan_state"], "IMPORTED_ONLY", 20],
      ["blocked-and-imported", ["workspace_diff", "plan_state"], "SCORE_BLOCKED", 30]
    ];
    assert.deepEqual(cases.map(([reportId, groups]) => [reportId, groups]), CANONICAL_CASES);
    for (const [reportId, groups, verdict, exitCode] of cases) {
      const report = fixtureOf(reportId);
      const view = unproven(frozenMatrix(), report.runtime_id, groups);
      const result = validate(report, doc, view);
      assert.deepEqual(result.errors, [], reportId);
      assert.equal(result.verdict, verdict, reportId);
      assert.equal(result.exit_code, exitCode, reportId);
      assert.equal(report.exit_code, exitCode, reportId);
      assert.equal(result.human_projection[1], `verdict: ${verdict} exit=${exitCode} mode=${report.assessment_mode}`);

      const forged = clone(report);
      forged.exit_code = 0;
      const rejected = validate(forged, doc, view);
      if (exitCode === 0) {
        assert.deepEqual(rejected.errors, [], reportId);
      } else {
        assert.equal(messageFor(rejected, "EXIT_CODE_MISMATCH"), `EXIT_CODE_MISMATCH derives ${exitCode}`, reportId);
      }
    }

    // The frozen document may not re-map an exit code either.
    const remapped = frozen();
    verdictRow(remapped, "SCORE_BLOCKED").exit_code = 0;
    assert.equal(
      messageFor(validate(fixtureOf("complete"), remapped, matrix), "CONTRACT_EXIT_CODE_MISMATCH"),
      "CONTRACT_EXIT_CODE_MISMATCH SCORE_BLOCKED derives 30"
    );
    const remappedReason = frozen();
    reasonRow(remappedReason, "DEGRADED_GROUP_UNAVAILABLE").verdict_id = "COMPLETE";
    assert.equal(
      messageFor(validate(fixtureOf("complete"), remappedReason, matrix), "CONTRACT_REASON_VERDICT_MISMATCH"),
      "CONTRACT_REASON_VERDICT_MISMATCH DEGRADED_GROUP_UNAVAILABLE derives DEGRADED"
    );
  });

  test("canonical-reports-exercise-every-verdict", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // Eight canonical reports covering all four verdicts, all three reason codes, both runtimes,
    // both modes and all four variants; the contract refuses a set that stops covering them.
    // The old six left verified+both-derivations-unproven and imported+workspace-diff-only
    // unproven uncovered, so a mutant that reverses the reason order survived in exactly those
    // combinations; blocking-and-degraded and blocking-and-imported close that hole.
    const canonical = CANONICAL_REPORT_IDS.map((reportId) => fixtureOf(reportId));
    assert.deepEqual(canonical.map((entry: any) => entry.verdict),
      ["COMPLETE", "DEGRADED", "SCORE_BLOCKED", "IMPORTED_ONLY", "IMPORTED_ONLY", "SCORE_BLOCKED",
        "SCORE_BLOCKED", "SCORE_BLOCKED"]);
    assert.deepEqual([...new Set(canonical.map((entry: any) => entry.verdict))].sort(),
      [...VERDICT_IDS].sort());
    assert.deepEqual([...new Set(canonical.map((entry: any) => entry.runtime_id))].sort(),
      [...RUNTIME_IDS].sort());
    assert.deepEqual([...new Set(canonical.map((entry: any) => entry.assessment_mode))].sort(),
      [...MODE_IDS].sort());
    assert.deepEqual(doc.canonical_reports.map((entry: any) => entry.matrix_variant).sort(),
      ["as-declared", "as-declared", "both-derivations-unproven", "both-derivations-unproven",
        "plan-state-derivation-unproven", "plan-state-derivation-unproven",
        "workspace-diff-derivation-unproven", "workspace-diff-derivation-unproven"]);
    const reported = new Set(canonical.flatMap(
      (entry: any) => entry.reasons.map((reason: string) => reason.split(" ")[0])));
    assert.deepEqual([...reported].sort(), [...REASON_CODES].sort());

    // Remove the only report that proves a verdict and the contract says so by name.
    const withoutBlocked = frozen();
    withoutBlocked.canonical_reports = withoutBlocked.canonical_reports
      .filter((entry: any) => entry.report_id !== "blocked-and-imported")
      .map((entry: any, index: number) => ({ ...entry, ordinal: index + 1 }));
    const missingBlocked = validate(report, withoutBlocked, matrix);
    assert.ok(has(missingBlocked, "CONTRACT_ROW_GAP canonical blocked-and-imported"));

    // Repoint every report that derives a verdict away from it and the guard names it.
    const noImported = corpus();
    for (const reportId of ["imported-only", "imported-and-degraded", "blocked-and-imported",
      "blocking-and-imported"]) {
      noImported[`${reportId}.json`].assessment_mode = "VERIFIED_ASSESSMENT";
    }
    const withoutImported = validate(report, doc, matrix, noImported);
    assert.ok(has(withoutImported, "CONTRACT_VERDICT_UNEXERCISED IMPORTED_ONLY is the verdict of no canonical report"));
    assert.ok(has(withoutImported, "CONTRACT_REASON_UNEXERCISED IMPORTED_SESSION_DIAGNOSTIC_ONLY is reported by no canonical report"));

    const noDegradedReason = frozen();
    for (const reportId of ["degraded", "imported-and-degraded", "blocked-and-imported",
      "blocking-and-degraded"]) {
      entryOf(noDegradedReason, reportId).matrix_variant = "as-declared";
    }
    const withoutDegraded = validate(report, noDegradedReason, matrix);
    assert.ok(has(withoutDegraded, "CONTRACT_VERDICT_UNEXERCISED DEGRADED"));
    assert.ok(has(withoutDegraded, "CONTRACT_REASON_UNEXERCISED DEGRADED_GROUP_UNAVAILABLE"));
  });

  test("a-doctor-verdict-is-a-projection-not-a-probe", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");
    const source = readFileSync(sourcePath, "utf8");

    // The honesty paragraph is frozen in the document and asserted here, so removing the
    // statement of what a doctor verdict does not prove fails the lane on purpose.
    assert.match(doc.declared_only_statement, /not a probe of an installed runtime/);
    assert.match(doc.declared_only_statement, /assessment_mode names the session the caller asked about/);
    assert.match(doc.declared_only_statement, /checked for shape only/);
    assert.match(doc.declared_only_statement, /never\s+proved to name a source that exists or was read/);
    assert.match(source, /It is not a\s+\* probe of an installed runtime/);
    assert.match(source, /presence-and-shape check and it is worth\s+\*\s+exactly that much/);
    assert.match(source, /There is no signature, attestation or key material anywhere in this module/);

    // No trust root was invented: SSOT v1.0 §9.2 and §9.5 contain no signature, attestation or
    // key-management clause, and neither does this contract or the document it validates.
    const ssot = readFileSync(
      resolve(here, "../../../docs/north-star/agent-operator-score-ssot-v1.0.md"), "utf8");
    const section = ssot.slice(ssot.indexOf("9.2 Adapter Observability Contract"), ssot.indexOf("9.6 로컬 데이터 원칙"));
    for (const term of ["signature", "attestation", "서명", "keypair", "private key"]) {
      assert.equal(section.toLowerCase().includes(term.toLowerCase()), false, `SSOT 9.2-9.5 names ${term}`);
    }
    assert.equal(/sign|attest|ed25519|hmac|sha256|crypto/i.test(JSON.stringify(doc)), false);
    assert.equal(/require\(|node:crypto|createHash|verify\(/.test(source), false);

    // The three declared-only inputs are checked for shape and membership, and the module
    // claims nothing more for them. A blank or multi-token version is refused; a plausible
    // wrong one is not, and cannot be.
    for (const field of ["runtime_version", "protocol_or_schema_version", "adapter_version"]) {
      const blank = clone(report);
      blank.capability_digest[field] = "  ";
      assert.equal(
        messageFor(validate(blank, doc, matrix), "DIGEST_DECLARED_FIELD_INVALID"),
        `DIGEST_DECLARED_FIELD_INVALID ${field}    is not a version token`
      );
      const spaced = clone(report);
      spaced.capability_digest[field] = "version 1";
      assert.ok(has(validate(spaced, doc, matrix), `DIGEST_DECLARED_FIELD_INVALID ${field} version 1`));
      const overlong = clone(report);
      overlong.capability_digest[field] = "v".repeat(65);
      assert.ok(has(validate(overlong, doc, matrix), `DIGEST_DECLARED_FIELD_INVALID ${field}`));
      const notAString = clone(report);
      notAString.capability_digest[field] = 1;
      assert.ok(has(validate(notAString, doc, matrix), `DIGEST_DECLARED_FIELD_INVALID ${field} 1`));
      // One character is a short token, not a blank one; the shape check is emptiness,
      // whitespace and a length ceiling, and it claims nothing beyond those three.
      const terse = clone(report);
      terse.capability_digest[field] = "v";
      assert.equal(has(validate(terse, doc, matrix), "DIGEST_DECLARED_FIELD_INVALID"), false, field);
      const atTheBound = clone(report);
      atTheBound.capability_digest[field] = "v".repeat(64);
      assert.equal(has(validate(atTheBound, doc, matrix), "DIGEST_DECLARED_FIELD_INVALID"), false, field);

      // The limit, demonstrated rather than asserted in prose: a well-formed lie passes. The
      // digest line of the projection names each declared field as `field=value`, so the lie is
      // carried into it by substitution; the module still recomputes the whole projection, and a
      // zero-error result is what proves it derives exactly this one.
      const forged = "0.0.0-not-what-is-installed";
      const lying = clone(report);
      lying.capability_digest[field] = forged;
      lying.human_projection = report.human_projection.map((line: string) =>
        line.replace(`${field}=${report.capability_digest[field]}`, `${field}=${forged}`));
      const accepted = validate(lying, doc, matrix);
      assert.deepEqual(accepted.errors, [],
        `${field} is a presence-and-shape check, and this test records that it is only that`);
      assert.equal(accepted.ok, true);
      assert.equal(accepted.verdict, "COMPLETE");
    }

    // The same limit for the mode: nothing in a doctor report distinguishes a session the
    // wrapper really wrapped from one the caller labelled that way, and this contract does not
    // pretend otherwise. Declaring the controlled mode on a complete adapter yields COMPLETE.
    const claimed = clone(fixtureOf("imported-only"));
    claimed.assessment_mode = "VERIFIED_ASSESSMENT";
    claimed.verdict = "COMPLETE";
    claimed.exit_code = 0;
    claimed.reasons = [];
    // The projection follows the mode: the header line restates the verdict, exit code and mode,
    // and the imported reason line goes with the reason it reported. Written out here rather
    // than read back from the module, so a zero-error result proves the module derives it.
    claimed.human_projection = claimed.human_projection
      .filter((line: string) => !line.startsWith("reason: "))
      .map((line: string) => line === "verdict: IMPORTED_ONLY exit=20 mode=IMPORTED_SESSION"
        ? "verdict: COMPLETE exit=0 mode=VERIFIED_ASSESSMENT"
        : line);
    const promoted = validate(claimed, doc, matrix);
    assert.deepEqual(promoted.errors, [],
      "a caller may assert the controlled mode; this contract records the claim and cannot check it");
    assert.equal(promoted.verdict, "COMPLETE");
    assert.equal(promoted.exit_code, 0);
  });

  test("dead-fields-fail-closed", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // Top level of the report.
    const extraReportField = clone(report);
    extraReportField.overall_health = "green";
    assert.equal(
      messageFor(validate(extraReportField, doc, matrix), "REPORT_DEAD_FIELD"),
      "REPORT_DEAD_FIELD overall_health is not part of the doctor contract"
    );

    // Record level: one observation.
    const extraObservationField = clone(report);
    observationOf(extraObservationField, "tool_call").confidence = "high";
    assert.equal(
      messageFor(validate(extraObservationField, doc, matrix), "OBSERVATION_DEAD_FIELD"),
      "OBSERVATION_DEAD_FIELD tool_call confidence is not part of the doctor contract"
    );

    // Nested: inside the capability digest, where an extra key is caught by the exact key set.
    const extraDigestField = clone(report);
    extraDigestField.capability_digest.vendor_notes = "trust me";
    assert.ok(has(validate(extraDigestField, doc, matrix), "DIGEST_FIELDS_MISMATCH"));

    // Top level of the contract, and inside each of its five row tables.
    const extraContractField = frozen();
    extraContractField.waiver = "temporary";
    assert.equal(
      messageFor(validate(report, extraContractField, matrix), "CONTRACT_DEAD_FIELD"),
      "CONTRACT_DEAD_FIELD waiver is not part of the doctor contract"
    );
    const tables: [string, (contract: any) => void, string][] = [
      ["mode", (c) => { c.assessment_modes[0].note = "x"; }, "CONTRACT_ROW_DEAD_FIELD mode VERIFIED_ASSESSMENT note"],
      ["verdict", (c) => { verdictRow(c, "COMPLETE").severity = 0; }, "CONTRACT_ROW_DEAD_FIELD verdict COMPLETE severity"],
      ["reason", (c) => { reasonRow(c, "DEGRADED_GROUP_UNAVAILABLE").hint = "x"; }, "CONTRACT_ROW_DEAD_FIELD reason DEGRADED_GROUP_UNAVAILABLE hint"],
      ["variant", (c) => { variantRow(c, "as-declared").comment = "x"; }, "CONTRACT_ROW_DEAD_FIELD variant as-declared comment"],
      ["canonical", (c) => { entryOf(c, "complete").expected = {}; }, "CONTRACT_ROW_DEAD_FIELD canonical complete expected"]
    ];
    for (const [label, tamper, expected] of tables) {
      const tampered = frozen();
      tamper(tampered);
      const result = validate(report, tampered, matrix);
      assert.ok(has(result, expected), `${label}: ${result.errors.join("; ") || "no error"}`);
      assert.equal(result.ok, false, label);
    }

    // And a dead field inside a canonical report is caught by the same report-level rule.
    assert.ok(has(validate(report, doc, matrix,
      withFixture("complete", (canonical) => { canonical.remediation = "none needed"; })),
      "CONTRACT_CANONICAL_REPORT_INVALID complete REPORT_DEAD_FIELD remediation"));
  });

  test("report-shape-fails-closed", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    for (const value of [null, "healthy", 7, [], undefined]) {
      const result = validate(value, doc, matrix);
      assert.equal(messageFor(result, "REPORT_NOT_AN_OBJECT"), "REPORT_NOT_AN_OBJECT a doctor report must be a JSON object");
      assert.equal(result.verdict, "SCORE_BLOCKED");
      assert.equal(result.exit_code, 30);
      assert.deepEqual(result.reasons, []);
      assert.deepEqual(result.human_projection, []);
    }
    for (const field of REPORT_FIELDS) {
      const thinned = clone(report);
      delete thinned[field];
      const result = validate(thinned, doc, matrix);
      assert.ok(has(result, `REPORT_MISSING_FIELD ${field} is required by the doctor contract`), field);
      assert.equal(result.ok, false, field);
    }
    const wrongContract = clone(report);
    wrongContract.contract_id = "doctor-output.v1";
    assert.equal(messageFor(validate(wrongContract, doc, matrix), "REPORT_CONTRACT_ID"),
      "REPORT_CONTRACT_ID expected doctor-output.v0");
    const wrongVersion = clone(report);
    wrongVersion.contract_version = "doctor-output-contract-v1";
    assert.ok(has(validate(wrongVersion, doc, matrix), "REPORT_CONTRACT_VERSION expected doctor-output-contract-v0"));

    const noObservations = clone(report);
    noObservations.observations = "fourteen groups, all fine";
    assert.equal(
      messageFor(validate(noObservations, doc, matrix), "OBSERVATIONS_NOT_AN_ARRAY"),
      "OBSERVATIONS_NOT_AN_ARRAY the report must declare one observation per SSOT 9.2 event group"
    );
    const shortened = clone(report);
    shortened.observations = report.observations.slice(0, 13);
    assert.equal(
      messageFor(validate(shortened, doc, matrix), "OBSERVATION_COUNT_MISMATCH"),
      "OBSERVATION_COUNT_MISMATCH found 13 and not 14"
    );
    const grown = clone(report);
    grown.observations = [...report.observations, { ...observationOf(report, "tool_call"), event_group: "vibes" }];
    assert.equal(
      messageFor(validate(grown, doc, matrix), "OBSERVATION_UNKNOWN_EVENT_GROUP"),
      "OBSERVATION_UNKNOWN_EVENT_GROUP vibes is outside the frozen SSOT 9.2 matrix"
    );
    const notAnObject = clone(report);
    notAnObject.observations[3] = "tool_call is fine";
    const notAnObjectResult = validate(notAnObject, doc, matrix);
    assert.equal(
      messageFor(notAnObjectResult, "OBSERVATION_NOT_AN_OBJECT"),
      "OBSERVATION_NOT_AN_OBJECT position 4 is not an object"
    );
    // Reported once, and the value checks are not then run against a non-object.
    assert.deepEqual(codes(notAnObjectResult), ["OBSERVATION_NOT_AN_OBJECT"]);
    const noProjection = clone(report);
    noProjection.human_projection = "aos doctor";
    assert.ok(has(validate(noProjection, doc, matrix), "HUMAN_PROJECTION_LENGTH_MISMATCH derives 19 lines"));

    // The contract itself, and the shortest path to no answer at all.
    for (const value of [null, "doctor", 3, []]) {
      const result = validate(report, value, matrix);
      assert.deepEqual(result.errors, ["CONTRACT_NOT_AN_OBJECT the doctor contract must be a JSON object"]);
      assert.equal(result.verdict, "SCORE_BLOCKED");
    }
    const thinnedContract = frozen();
    delete thinnedContract.verdicts;
    delete thinnedContract.reason_codes;
    assert.deepEqual(validate(report, thinnedContract, matrix).errors,
      ["CONTRACT_MISSING_FIELD verdicts,reason_codes required by the doctor contract"]);
    // One absent field is enough; the contract does not need two to notice.
    for (const field of ["verdicts", "canonical_reports", "derivation_proofs", "event_groups"]) {
      const oneShort = frozen();
      delete oneShort[field];
      assert.deepEqual(validate(report, oneShort, matrix).errors,
        [`CONTRACT_MISSING_FIELD ${field} required by the doctor contract`], field);
    }
    for (const value of [null, "matrix", 5]) {
      const result = validate(report, doc, value);
      assert.equal(result.ok, false);
      assert.deepEqual([...new Set(codes(result))], ["CAPABILITY_MATRIX_INVALID"]);
    }
  });

  test("errors-name-the-value-that-is-wrong", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // Every error is a stable code followed by the detail, so a caller may partition on
    // `error.split(" ")[0]` exactly as the sibling contracts do.
    const damaged = clone(report);
    damaged.command = "aos doctor";
    damaged.verdict = "DEGRADED";
    damaged.exit_code = 10;
    damaged.reasons = ["DEGRADED_GROUP_UNAVAILABLE something"];
    const result = validate(damaged, doc, matrix);
    assert.deepEqual(codes(result),
      ["COMMAND_MISMATCH", "VERDICT_MISMATCH", "EXIT_CODE_MISMATCH", "REASONS_MISMATCH"]);
    for (const error of result.errors) {
      const [code, ...rest] = error.split(" ");
      assert.match(code, /^[A-Z][A-Z0-9_]+$/, error);
      assert.ok(rest.length > 0, `${code} carries no detail`);
    }
    assert.equal(messageFor(result, "REASONS_MISMATCH"), "REASONS_MISMATCH derives none");

    // The detail names the derived value, not just that something is wrong.
    assert.equal(messageFor(result, "VERDICT_MISMATCH"), "VERDICT_MISMATCH derives COMPLETE");
    assert.equal(messageFor(result, "EXIT_CODE_MISMATCH"), "EXIT_CODE_MISMATCH derives 0");
    assert.equal(messageFor(result, "COMMAND_MISMATCH"), "COMMAND_MISMATCH derives aos doctor --capabilities --runtime codex");

    // Contract errors follow the same rule.
    const tamperedContract = frozen();
    tamperedContract.event_groups = [];
    const contractResult = validate(report, tamperedContract, matrix);
    for (const error of contractResult.errors) {
      assert.match(error.split(" ")[0], /^CONTRACT_[A-Z0-9_]+$/, error);
    }
    // And matrix errors are prefixed once, so the sibling's own codes stay readable inside.
    const tamperedMatrix = clone(matrix);
    tamperedMatrix.rows[0].runtimes.codex.status = "BEST_EFFORT";
    const matrixResult = validate(report, doc, tamperedMatrix);
    assert.equal(
      messageFor(matrixResult, "CAPABILITY_MATRIX_INVALID"),
      "CAPABILITY_MATRIX_INVALID CELL_STATUS_MISMATCH run_lifecycle codex derives REQUIRED"
    );
  });
  // The frozen document holds the rules and a manifest; the reports themselves are files. This
  // case is the seam between the two: it must be impossible for a fixture to say one thing and
  // specs/doctor-output.v0.json another, and there must be no second copy of a report to drift.
  test("fixture-corpus-is-the-canonical-report-set", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // The document declares where the corpus lives and how a file is named, and this test read
    // the directory from that declaration rather than from a path of its own.
    assert.equal(doc.canonical_fixture_directory, "fixtures/doctor");
    assert.equal(doc.canonical_fixture_name_template, "<report_id>.json");
    assert.equal(fixtureDirectory, resolve(repositoryRoot, "fixtures/doctor"));
    const movedDirectory = frozen();
    movedDirectory.canonical_fixture_directory = "fixtures/doctor-v2";
    assert.equal(
      messageFor(validate(report, movedDirectory, matrix), "CONTRACT_FIXTURE_DIRECTORY_MISMATCH"),
      "CONTRACT_FIXTURE_DIRECTORY_MISMATCH expected fixtures/doctor"
    );
    const renamedTemplate = frozen();
    renamedTemplate.canonical_fixture_name_template = "doctor-<report_id>.json";
    assert.equal(
      messageFor(validate(report, renamedTemplate, matrix), "CONTRACT_FIXTURE_TEMPLATE_MISMATCH"),
      "CONTRACT_FIXTURE_TEMPLATE_MISMATCH expected <report_id>.json"
    );

    // The corpus on disk is exactly the manifest, file for file, and the name of each file is
    // derived from its report id rather than declared anywhere.
    assert.deepEqual(Object.keys(fixtureText),
      CANONICAL_REPORT_IDS.map((reportId) => `${reportId}.json`).sort());
    assert.deepEqual(doc.canonical_reports.map((entry: any) => entry.report_id), CANONICAL_REPORT_IDS);

    // No duplication: a manifest row carries an id, an ordinal and a variant, and no report.
    for (const entry of doc.canonical_reports) {
      assert.deepEqual(Object.keys(entry), ["report_id", "ordinal", "matrix_variant"], entry.report_id);
    }
    assert.equal(/"observations"|"human_projection"|"capability_digest"/.test(
      readFileSync(contractPath, "utf8").replace(/"(report|observation)_fields"[^\]]*\]/g, "")), false,
      "the frozen document must not carry a second copy of a report");

    // Each fixture is a doctor report and nothing else: the eleven fields, in order.
    for (const reportId of CANONICAL_REPORT_IDS) {
      assert.deepEqual(Object.keys(fixtureOf(reportId)), REPORT_FIELDS, reportId);
    }

    // A declared report with no file.
    const withoutComplete = corpus();
    delete withoutComplete["complete.json"];
    const missing = validate(report, doc, matrix, withoutComplete);
    assert.equal(
      messageFor(missing, "CONTRACT_CANONICAL_FIXTURE_MISSING"),
      "CONTRACT_CANONICAL_FIXTURE_MISSING complete.json is declared by the contract and absent from the corpus"
    );
    assert.ok(has(missing, "CONTRACT_VERDICT_UNEXERCISED COMPLETE"));
    assert.equal(missing.verdict, "SCORE_BLOCKED");
    // Reported as absent and not then recomputed from nothing.
    assert.equal(has(missing, "CONTRACT_CANONICAL_REPORT_INVALID"), false);
    assert.deepEqual([...new Set(codes(missing))],
      ["CONTRACT_CANONICAL_FIXTURE_MISSING", "CONTRACT_VERDICT_UNEXERCISED"]);

    // A file no report declares.
    const withStray = corpus();
    withStray["stale.json"] = fixtureOf("complete");
    assert.equal(
      messageFor(validate(report, doc, matrix, withStray), "CONTRACT_CANONICAL_FIXTURE_UNDECLARED"),
      "CONTRACT_CANONICAL_FIXTURE_UNDECLARED stale.json is not declared by the doctor contract"
    );

    // A renamed file is both at once, so a rename cannot slip past either check.
    const renamed = corpus();
    renamed["blocked-and-score-withheld.json"] = renamed["blocked.json"];
    delete renamed["blocked.json"];
    const renameResult = validate(report, doc, matrix, renamed);
    assert.ok(has(renameResult, "CONTRACT_CANONICAL_FIXTURE_MISSING blocked.json"));
    assert.ok(has(renameResult, "CONTRACT_CANONICAL_FIXTURE_UNDECLARED blocked-and-score-withheld.json"));

    // Drift inside a fixture is recomputed away, in every derived field including the human
    // projection, so the file cannot quietly stop matching the rules that produced it.
    assert.ok(has(validate(report, doc, matrix,
      withFixture("degraded", (canonical) => { canonical.human_projection[3] = "groups: supported=14 unavailable=0 required_observed=7/7"; })),
      "CONTRACT_CANONICAL_REPORT_INVALID degraded HUMAN_PROJECTION_MISMATCH line 4 derives groups: supported=13 unavailable=1"));
    assert.ok(has(validate(report, doc, matrix,
      withFixture("complete", (canonical) => { delete observationOf(canonical, "tool_call").evidence_locator; })),
      "CONTRACT_CANONICAL_REPORT_INVALID complete OBSERVATION_MISSING_FIELD tool_call evidence_locator"));

    // And a manifest row may not point its fixture at a variant that did not produce it.
    const repointed = frozen();
    entryOf(repointed, "blocked").matrix_variant = "plan-state-derivation-unproven";
    assert.ok(has(validate(report, repointed, matrix),
      "CONTRACT_CANONICAL_REPORT_INVALID blocked VERDICT_MISMATCH derives DEGRADED"));

    // The corpus is an input like the matrix, and an unreadable one yields no verdict.
    for (const value of [null, "fixtures/doctor", 4, []]) {
      const result = validate(report, doc, matrix, value);
      assert.deepEqual(result.errors,
        ["CANONICAL_CORPUS_NOT_AN_OBJECT the canonical fixture corpus must be a map of file name to parsed report"]);
      assert.equal(result.verdict, "SCORE_BLOCKED");
      assert.equal(result.exit_code, 30);
    }
  });

  test("empty-derivation-proof-is-preserved", async () => {
    await withDoctorInternals(({ observationsOf }) => {
      const [observation] = observationsOf("codex", {
        rows: [{
          event_group: "workspace_diff",
          ordinal: 5,
          source_row: "workspace diff",
          contract: "DERIVED",
          requirement_scope: "DERIVED",
          missing_effect: "run invalid",
          missing_effects: ["RUN_INVALID"],
          affected_metrics: [],
          runtimes: {
            codex: {
              status: "UNAVAILABLE",
              source_class: "RUNNER_DERIVED",
              evidence_locator: "runner snapshot",
              derivation_proof: ""
            }
          }
        }]
      });
      assert.equal(observation.derivation_proof, "",
        "an explicitly blank derivation proof is distinct from an absent proof");
    });
  });

  // The frozen matrix happens to exercise every source class for every runtime. That made the
  // old case a claim about the sibling's present contents, not a test of this derivation: both
  // deleting the filter and inverting its predicate still returned all three classes. Exercise
  // the inventory at its actual boundary instead.
  test("digest-source-class-inventory-selects-only-observed-classes", async () => {
    await withDoctorInternals(({ sourceClassInventory }) => {
      assert.deepEqual(sourceClassInventory([{ source_class: "PRIMARY" }]), ["PRIMARY"]);
      assert.deepEqual(sourceClassInventory([
        { source_class: "PRIMARY" }, { source_class: "RUNNER_DERIVED" }
      ]), ["PRIMARY", "RUNNER_DERIVED"]);
      assert.deepEqual(sourceClassInventory([
        { source_class: "RUNNER_DERIVED" }, { source_class: "SECONDARY" }, { source_class: "PRIMARY" }
      ]), SOURCE_CLASSES, "the inventory is canonical-order, not observation-order");
    });
  });

  // The pin whose input was free. The two derivation proofs are pinned against the matrix cells
  // that carry them, and the module writes the pinned text back to restore the DERIVED cells a
  // variant does not blank — so a group whose proof is null in every runtime cell let the
  // contract resurrect that cell out of its own unchecked prose, which is the exact defect this
  // contract exists to avoid. It is refused by name.
  test("a-derivation-proof-with-no-anchor-cell-is-refused", () => {
    const doc = frozen();
    const report = fixtureOf("degraded");

    // Both runtimes lose the plan_state derivation. SSOT §9.2 line 980 makes the cell
    // UNAVAILABLE for both, and the sibling still accepts the matrix, so nothing upstream
    // objects — but no report can be COMPLETE under it.
    const drifted = unproven(unproven(frozenMatrix(), "codex", ["plan_state"]), "claude-code", ["plan_state"]);
    const validated = validateCapabilityMatrix(drifted);
    assert.deepEqual(validated.errors, [], "the sibling accepts this matrix, so the guard must be this one's");
    for (const runtimeId of RUNTIME_IDS) {
      const cell = drifted.rows.find((row: any) => row.event_group === "plan_state").runtimes[runtimeId];
      assert.equal(cell.derivation_proof, null, runtimeId);
      assert.equal(cell.status, "UNAVAILABLE", runtimeId);
      assert.deepEqual(validated.coverage[runtimeId].known_missing_events, ["plan_state"], runtimeId);
    }

    const result = validate(report, doc, drifted);
    assert.equal(
      messageFor(result, "CONTRACT_DERIVATION_PROOF_UNPINNED"),
      "CONTRACT_DERIVATION_PROOF_UNPINNED plan_state carries no derivation proof in any runtime cell," +
      " so the contract text restoring it is checked against nothing"
    );
    assert.equal(result.ok, false, "a pin fed by an unpinned input may not report a healthy adapter");
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.human_projection, []);

    // The same for workspace_diff, and for both at once.
    const bothGroups = unproven(
      unproven(frozenMatrix(), "codex", DERIVED_EVENT_GROUPS), "claude-code", DERIVED_EVENT_GROUPS);
    const bothResult = validate(fixtureOf("blocked-and-imported"), doc, bothGroups);
    for (const group of DERIVED_EVENT_GROUPS) {
      assert.ok(has(bothResult, `CONTRACT_DERIVATION_PROOF_UNPINNED ${group}`), group);
    }
    const diffOnly = unproven(
      unproven(frozenMatrix(), "codex", ["workspace_diff"]), "claude-code", ["workspace_diff"]);
    const diffResult = validate(fixtureOf("blocked"), doc, diffOnly);
    assert.ok(has(diffResult, "CONTRACT_DERIVATION_PROOF_UNPINNED workspace_diff"));
    assert.equal(has(diffResult, "CONTRACT_DERIVATION_PROOF_UNPINNED plan_state"), false,
      "a group that is still anchored is not reported as unanchored");

    // And the guard is not simply refusing every perturbation: one runtime losing a derivation
    // is the ordinary degraded and blocked case, and the other runtime's cell still pins the
    // text, so those keep validating with zero errors.
    assert.deepEqual(validate(report, doc, unproven(frozenMatrix(), "codex", ["plan_state"])).errors, []);
    assert.deepEqual(
      validate(fixtureOf("blocked"), doc, unproven(frozenMatrix(), "claude-code", ["workspace_diff"])).errors, []);
  });

  // The projection reports `required_observed` as a constant because in every matrix
  // capability.ts accepts, the unconditionally REQUIRED groups and the groups that can reach
  // UNAVAILABLE are disjoint. That is a property of the sibling and not of this module, so it is
  // guarded rather than trusted: this case fails the moment the two sets overlap, and whoever
  // makes them overlap must put the subtraction back into the projection.
  test("required-groups-cannot-be-unavailable", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const validated = validateCapabilityMatrix(matrix);
    assert.deepEqual(validated.errors, []);
    const rows: any[] = validated.rows;

    // SSOT §9.2 line 980 is the only clause that makes a cell UNAVAILABLE and it reaches only a
    // row whose statuses include DERIVED. Neither DERIVED row is UNCONDITIONAL_REQUIRED.
    const canBeUnavailable = rows.filter((row) => row.statuses.includes("DERIVED")).map((row) => row.event_group);
    assert.deepEqual(canBeUnavailable, DERIVED_EVENT_GROUPS);
    assert.deepEqual(validated.required_event_groups, REQUIRED_EVENT_GROUPS);
    assert.deepEqual(REQUIRED_EVENT_GROUPS.filter((group) => canBeUnavailable.includes(group)), [],
      "a required group can now be UNAVAILABLE, so required_observed is no longer a constant");
    for (const group of REQUIRED_EVENT_GROUPS) {
      const row = rows.find((entry) => entry.event_group === group);
      assert.equal(row.statuses.includes("DERIVED"), false, group);
      assert.equal(row.requirement_scope, "UNCONDITIONAL_REQUIRED", group);
    }

    // The sibling enforces the disjointness rather than merely happening to satisfy it, so this
    // module can never be handed a matrix in which a required group is unobservable: such a
    // matrix is rejected upstream and yields no verdict at all.
    for (const group of REQUIRED_EVENT_GROUPS) {
      const forced = unproven(matrix, "codex", [group]);
      const rejectedMatrix = validateCapabilityMatrix(forced);
      assert.equal(rejectedMatrix.ok, false, group);
      assert.ok(rejectedMatrix.errors.some((error: string) => error.startsWith(`CELL_STATUS_MISMATCH ${group} codex`)), group);
      const result = validate(fixtureOf("complete"), doc, forced);
      assert.equal(result.ok, false, group);
      assert.ok(has(result, `CAPABILITY_MATRIX_INVALID CELL_STATUS_MISMATCH ${group} codex`), group);
    }

    // So every canonical report prints the same count, however unobservable its adapter is.
    for (const [reportId, groups] of CANONICAL_CASES) {
      const report = fixtureOf(reportId);
      const result = validate(report, doc, unproven(frozenMatrix(), report.runtime_id, groups));
      assert.deepEqual(result.errors, [], reportId);
      assert.equal(result.human_projection[3].endsWith(" required_observed=7/7"), true, reportId);
    }
  });

  // Exit codes are this ticket's Minimum GREEN, so the caller contract is asserted directly: a
  // caller running `process.exit(result.exit_code)` must never exit zero on a report the module
  // refused. `ok === false` is one shape, with no exception in it for a report-level defect.
  test("a-refused-report-never-exits-zero", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // The narrow case: a rejected report whose matrix derives COMPLETE, which used to return
    // verdict COMPLETE and exit code 0 beside ok=false.
    const narrowed = clone(report);
    narrowed.capability_digest.supported_event_groups = ["tool_call"];
    const rejected = validate(narrowed, doc, matrix);
    assert.equal(rejected.ok, false);
    assert.notEqual(rejected.exit_code, 0, "a report the doctor refused may not exit zero");
    assert.ok(has(rejected, `DIGEST_SUPPORTED_GROUPS_MISMATCH derives ${EVENT_GROUPS.join(",")}`));
    assert.ok(has(rejected, "VERDICT_MISMATCH") === false, "the report's own verdict still matched the matrix");

    // One shape for every refusal, at every level, whatever the matrix would have derived.
    const refusals: [string, () => ReturnType<typeof validate>][] = [
      ["report level, matrix derives COMPLETE", () => validate(narrowed, doc, matrix)],
      ["report level, matrix derives IMPORTED_ONLY", () => {
        const forged = clone(fixtureOf("imported-only"));
        forged.exit_code = 0;
        return validate(forged, doc, matrix);
      }],
      ["report level, matrix derives DEGRADED", () => {
        const forged = clone(fixtureOf("degraded"));
        forged.exit_code = 0;
        return validate(forged, doc, unproven(frozenMatrix(), "codex", ["plan_state"]));
      }],
      ["report level, matrix derives SCORE_BLOCKED", () => {
        const forged = clone(fixtureOf("blocked"));
        forged.exit_code = 0;
        return validate(forged, doc, unproven(frozenMatrix(), "claude-code", ["workspace_diff"]));
      }],
      ["report is not an object", () => validate(null, doc, matrix)],
      ["unknown runtime", () => {
        const forged = clone(report);
        forged.runtime_id = "gpt-vibes";
        return validate(forged, doc, matrix);
      }],
      ["contract level", () => {
        const tampered = frozen();
        tampered.contract_id = "doctor-output.v9";
        return validate(report, tampered, matrix);
      }],
      ["matrix level", () => {
        const tampered = clone(matrix);
        tampered.rows[0].contract = "BEST_EFFORT";
        return validate(report, doc, tampered);
      }],
      ["corpus level", () => validate(report, doc, matrix, "fixtures/doctor")],
      ["canonical report level", () => validate(report, doc, matrix,
        withFixture("blocked", (canonical) => { canonical.verdict = "COMPLETE"; }))]
    ];
    for (const [label, produce] of refusals) {
      const result = produce();
      assert.equal(result.ok, false, label);
      assert.ok(result.errors.length > 0, label);
      assert.equal(result.verdict, "SCORE_BLOCKED", label);
      assert.equal(result.exit_code, 30, label);
      assert.deepEqual(result.reasons, [], label);
      assert.deepEqual(result.human_projection, [], label);
    }

    // The converse, so the rule is a biconditional and not a blanket: an accepted report carries
    // the verdict its matrix derives, and exit zero belongs to COMPLETE alone.
    for (const [reportId, groups] of CANONICAL_CASES) {
      const canonical = fixtureOf(reportId);
      const accepted = validate(canonical, doc, unproven(frozenMatrix(), canonical.runtime_id, groups));
      assert.equal(accepted.ok, true, reportId);
      assert.equal(accepted.exit_code === 0, accepted.verdict === "COMPLETE", reportId);
      assert.equal(accepted.exit_code, EXIT_CODES[accepted.verdict], reportId);
    }
  });

  test("invalid-canonical-report-fails-closed-without-throwing", () => {
    const invalidCorpus = withFixture("complete", (canonical) => {
      canonical.assessment_mode = "PROBABLY_CONTROLLED";
    });
    let result!: ReturnType<typeof validate>;

    // Canonical fixtures are inputs too. Once one cannot be derived, it contributes named
    // contract errors and no verdict; it must never fall through to `derived.verdict` and throw.
    assert.doesNotThrow(() => {
      result = validate(fixtureOf("complete"), frozen(), frozenMatrix(), invalidCorpus);
    });
    assert.deepEqual(result.errors, [
      "CONTRACT_CANONICAL_REPORT_INVALID complete UNKNOWN_ASSESSMENT_MODE PROBABLY_CONTROLLED is outside the frozen SSOT 9.2 session classes",
      "CONTRACT_VERDICT_UNEXERCISED COMPLETE is the verdict of no canonical report"
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.human_projection, []);
  });

  // Nine `statement` fields — two assessment modes, four verdicts, three reason codes — are
  // prose the derivation never reads. They are checked for presence and non-emptiness and
  // nothing else, so a statement that contradicts its own row is accepted. The module labels
  // them in the same terms session-class.ts labels its own, the frozen document's honesty
  // paragraph names them as the fourth declared input, and this case demonstrates the limit
  // instead of leaving a reader to infer it.
  test("statement-fields-are-declared-prose", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const statementRows = [...doc.assessment_modes, ...doc.verdicts, ...doc.reason_codes];
    assert.equal(statementRows.length, 9);
    assert.equal(statementRows.every((row: any) => typeof row.statement === "string"), true);
    assert.equal(doc.matrix_variants.some((row: any) => Object.hasOwn(row, "statement")), false);
    assert.equal(doc.canonical_reports.some((row: any) => Object.hasOwn(row, "statement")), false);
    assert.equal(doc.derivation_proofs.some((row: any) => Object.hasOwn(row, "statement")), false);

    // The limit itself: the statement of the mode that SSOT §9.2 line 971 admits only as
    // DIAGNOSTIC ONLY may say the opposite of its own pinned source clause and every gate
    // accepts it. Recorded here so nobody reads a statement as a rule.
    const inverted = frozen();
    modeRow(inverted, "IMPORTED_SESSION").statement =
      "An imported session is fully equivalent to a controlled one and may be issued an official AOS-Coding P0";
    assert.deepEqual(validate(report, inverted, matrix).errors, [],
      "statement is prose; this test records that presence is all that is checked");
    assert.equal(modeRow(inverted, "IMPORTED_SESSION").source_clause, IMPORTED_CLAUSE,
      "the rule the row does carry is the pinned clause, and it is unchanged");

    // Every one of the nine, and every table, so the limit is stated for the whole surface.
    for (const [table, idField] of [
      ["assessment_modes", "mode_id"], ["verdicts", "verdict_id"], ["reason_codes", "reason_code"]
    ] as [string, string][]) {
      for (const row of doc[table]) {
        const rewritten = frozen();
        rewritten[table].find((entry: any) => entry[idField] === row[idField]).statement = "not true";
        assert.deepEqual(validate(report, rewritten, matrix).errors, [], `${table} ${row[idField]}`);
        // Presence and non-emptiness are checked, and that is the whole of it.
        const blanked = frozen();
        blanked[table].find((entry: any) => entry[idField] === row[idField]).statement = "  ";
        assert.deepEqual(codes(validate(report, blanked, matrix)), ["CONTRACT_EMPTY_TEXT"], `${table} ${row[idField]}`);
        const dropped = frozen();
        delete dropped[table].find((entry: any) => entry[idField] === row[idField]).statement;
        assert.deepEqual(codes(validate(report, dropped, matrix)), ["CONTRACT_MISSING_ROW_FIELD"], `${table} ${row[idField]}`);
      }
    }

    // The honesty paragraph enumerates four declared inputs, not three, and the fourth is this.
    assert.match(doc.declared_only_statement, /Four inputs are declared and unverifiable here/);
    assert.match(doc.declared_only_statement, /the nine statement fields of this document are checked for presence and non-emptiness only/);
    assert.match(doc.declared_only_statement, /no issuer may read a statement as a rule/);
    assert.equal(doc.declared_only_statement.includes("Three inputs are declared"), false);

    // And the module says it in the same words the sibling uses for the same limit, so the two
    // labels cannot drift into meaning different things.
    const flattened = (text: string) => text.replace(/^\s*(?:\/\/|\*)\s?/gm, "").replace(/\s+/g, " ");
    const label = /prose the derivation never reads and (?:is|are) checked for presence only — that proves the field exists, not that it says anything true/;
    assert.match(flattened(readFileSync(sourcePath, "utf8")), label);
    assert.match(flattened(readFileSync(resolve(here, "../src/session-class.ts"), "utf8")), label);
  });

  // A stray file in the fixture directory is an error whatever it contains, and the rule claims
  // it fails a named case. Reading the directory with an unconditional JSON.parse killed the
  // lane with a SyntaxError instead: fail-closed, but not by name.
  test("a-file-that-is-not-json-is-an-undeclared-fixture", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    // The live directory is the eight declared reports and nothing else; the smuggling is done in
    // a copy, because no test may write into the repository it is measuring.
    assert.deepEqual(Object.keys(fixtureText), CANONICAL_REPORT_IDS.map((reportId) => `${reportId}.json`).sort());
    const directory = mkdtempSync(join(tmpdir(), "aos-doctor-corpus-"));
    try {
      for (const [name, text] of Object.entries(fixtureText)) writeFileSync(join(directory, name), text);
      writeFileSync(join(directory, "evil.ts"), "export const evil = () => process.exit(0);\n");
      const smuggled = corpusOf(readCorpusText(directory));
      assert.deepEqual(Object.keys(smuggled).sort(),
        [...CANONICAL_REPORT_IDS.map((reportId) => `${reportId}.json`), "evil.ts"].sort());
      const result = validate(report, doc, matrix, smuggled);
      assert.equal(
        messageFor(result, "CONTRACT_CANONICAL_FIXTURE_UNDECLARED"),
        "CONTRACT_CANONICAL_FIXTURE_UNDECLARED evil.ts is not declared by the doctor contract"
      );
      assert.equal(result.ok, false);
      assert.equal(result.verdict, "SCORE_BLOCKED");
      assert.equal(result.exit_code, 30);

      // Well-formed JSON that is not a report is the same finding by the same rule, so the
      // check is the manifest and not the file extension.
      writeFileSync(join(directory, "notes.json"), "{\n  \"todo\": \"tidy up\"\n}\n");
      const both = validate(report, doc, matrix, corpusOf(readCorpusText(directory)));
      assert.ok(has(both, "CONTRACT_CANONICAL_FIXTURE_UNDECLARED evil.ts is not declared by the doctor contract"));
      assert.ok(has(both, "CONTRACT_CANONICAL_FIXTURE_UNDECLARED notes.json is not declared by the doctor contract"));

      // A declared report is still parsed, so the tolerant read does not weaken the recompute:
      // drift inside a real fixture is caught exactly as before.
      writeFileSync(join(directory, "complete.json"),
        JSON.stringify({ ...fixtureOf("complete"), exit_code: 1 }, null, 2));
      assert.ok(has(validate(report, doc, matrix, corpusOf(readCorpusText(directory))),
        "CONTRACT_CANONICAL_REPORT_INVALID complete EXIT_CODE_MISMATCH derives 0"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // Every error code the module can emit is asserted by exact code equality, and the inventory
  // is re-derived from the module source so a code with no case fails here. `has()` is a
  // substring test, so an assertion that quotes a code inside a longer message keeps passing
  // when a character is appended to the code itself; that is why a sweep saw error-string
  // mutants survive, and why this case matches `error.split(" ")[0]` and never a substring.
  test("every-error-code-is-emitted-and-asserted-exactly", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const withReport = (mutate: (draft: any) => void) => {
      const draft = clone(report);
      mutate(draft);
      return validate(draft, doc, matrix);
    };
    const withContract = (mutate: (draft: any) => void) => {
      const draft = frozen();
      mutate(draft);
      return validate(report, draft, matrix);
    };
    const unanchored = unproven(
      unproven(frozenMatrix(), "codex", DERIVED_EVENT_GROUPS), "claude-code", DERIVED_EVENT_GROUPS);

    // The whole message each input must produce, not a substring of it, so appending a
    // character to a code or to its detail fails here.
    const workspaceDiffProof = matrix.rows
      .find((row: any) => row.event_group === "workspace_diff").runtimes.codex.derivation_proof;
    const MESSAGES: Record<string, string> = {
      REPORT_NOT_AN_OBJECT: "REPORT_NOT_AN_OBJECT a doctor report must be a JSON object",
      REPORT_MISSING_FIELD: "REPORT_MISSING_FIELD command is required by the doctor contract",
      REPORT_DEAD_FIELD: "REPORT_DEAD_FIELD overall_health is not part of the doctor contract",
      REPORT_CONTRACT_ID: "REPORT_CONTRACT_ID expected doctor-output.v0",
      REPORT_CONTRACT_VERSION: "REPORT_CONTRACT_VERSION expected doctor-output-contract-v0",
      UNKNOWN_RUNTIME: "UNKNOWN_RUNTIME gpt-vibes is outside the frozen SSOT 9.2 runtime set",
      UNKNOWN_ASSESSMENT_MODE: "UNKNOWN_ASSESSMENT_MODE PROBABLY_CONTROLLED is outside the frozen SSOT 9.2 session classes",
      COMMAND_MISMATCH: "COMMAND_MISMATCH derives aos doctor --capabilities --runtime codex",
      VERDICT_MISMATCH: "VERDICT_MISMATCH derives COMPLETE",
      EXIT_CODE_MISMATCH: "EXIT_CODE_MISMATCH derives 0",
      REASONS_MISMATCH: "REASONS_MISMATCH derives none",
      HUMAN_PROJECTION_LENGTH_MISMATCH: "HUMAN_PROJECTION_LENGTH_MISMATCH derives 19 lines",
      HUMAN_PROJECTION_MISMATCH: "HUMAN_PROJECTION_MISMATCH line 1 derives aos doctor --capabilities --runtime codex",
      DIGEST_NOT_AN_OBJECT: "DIGEST_NOT_AN_OBJECT the stored capability digest must be an object",
      DIGEST_FIELDS_MISMATCH: `DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`,
      DIGEST_DECLARED_FIELD_INVALID: "DIGEST_DECLARED_FIELD_INVALID adapter_version    is not a version token",
      DIGEST_SOURCE_CLASS_MISMATCH: `DIGEST_SOURCE_CLASS_MISMATCH derives ${SOURCE_CLASSES.join(",")}`,
      DIGEST_SUPPORTED_GROUPS_MISMATCH: `DIGEST_SUPPORTED_GROUPS_MISMATCH derives ${EVENT_GROUPS.join(",")}`,
      DIGEST_KNOWN_MISSING_MISMATCH: "DIGEST_KNOWN_MISSING_MISMATCH derives none",
      OBSERVATIONS_NOT_AN_ARRAY: "OBSERVATIONS_NOT_AN_ARRAY the report must declare one observation per SSOT 9.2 event group",
      OBSERVATION_COUNT_MISMATCH: "OBSERVATION_COUNT_MISMATCH found 13 and not 14",
      OBSERVATION_NOT_AN_OBJECT: "OBSERVATION_NOT_AN_OBJECT position 4 is not an object",
      OBSERVATION_UNKNOWN_EVENT_GROUP: "OBSERVATION_UNKNOWN_EVENT_GROUP vibes is outside the frozen SSOT 9.2 matrix",
      OBSERVATION_ORDER_BROKEN: "OBSERVATION_ORDER_BROKEN position 1 derives run_lifecycle",
      OBSERVATION_MISSING_FIELD: "OBSERVATION_MISSING_FIELD tool_call evidence_locator is required by the doctor contract",
      OBSERVATION_DEAD_FIELD: "OBSERVATION_DEAD_FIELD tool_call confidence is not part of the doctor contract",
      OBSERVATION_MISMATCH: "OBSERVATION_MISMATCH plan_state status derives DERIVED",
      CONTRACT_NOT_AN_OBJECT: "CONTRACT_NOT_AN_OBJECT the doctor contract must be a JSON object",
      CONTRACT_MISSING_FIELD: "CONTRACT_MISSING_FIELD verdicts required by the doctor contract",
      CONTRACT_DEAD_FIELD: "CONTRACT_DEAD_FIELD waiver is not part of the doctor contract",
      CONTRACT_ID: "CONTRACT_ID expected doctor-output.v0",
      CONTRACT_VERSION: "CONTRACT_VERSION expected doctor-output-contract-v0",
      CONTRACT_SOURCE_AUTHORITY: "CONTRACT_SOURCE_AUTHORITY expected docs/north-star/agent-operator-score-ssot-v1.0.md#9.2",
      CONTRACT_CAPABILITY_BINDING_MISMATCH: "CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_id must read adapter-capabilities.v0",
      CONTRACT_ACCEPTANCE_CLAUSE_MISMATCH: "CONTRACT_ACCEPTANCE_CLAUSE_MISMATCH the SSOT 9.2 doctor acceptance clause is frozen",
      CONTRACT_NO_SILENT_ESTIMATION_CLAUSE_MISMATCH: "CONTRACT_NO_SILENT_ESTIMATION_CLAUSE_MISMATCH the SSOT 9.2 line 980 clause is frozen",
      CONTRACT_NOT_USER_FAILURE_CLAUSE_MISMATCH: "CONTRACT_NOT_USER_FAILURE_CLAUSE_MISMATCH the SSOT 9.2 line 981 clause is frozen",
      CONTRACT_DECLARED_ONLY_STATEMENT_MISMATCH: "CONTRACT_DECLARED_ONLY_STATEMENT_MISMATCH the statement of what a doctor verdict does not prove is frozen",
      CONTRACT_COMMAND_TEMPLATE_MISMATCH: "CONTRACT_COMMAND_TEMPLATE_MISMATCH expected aos doctor --capabilities --runtime <runtime>",
      CONTRACT_VERSION_TOKEN_BOUND_MISMATCH: "CONTRACT_VERSION_TOKEN_BOUND_MISMATCH expected 64",
      CONTRACT_FIXTURE_DIRECTORY_MISMATCH: "CONTRACT_FIXTURE_DIRECTORY_MISMATCH expected fixtures/doctor",
      CONTRACT_FIXTURE_TEMPLATE_MISMATCH: "CONTRACT_FIXTURE_TEMPLATE_MISMATCH expected <report_id>.json",
      CONTRACT_RUNTIME_IDS_MISMATCH: `CONTRACT_RUNTIME_IDS_MISMATCH runtime_ids must read ${RUNTIME_IDS.join(",")}`,
      CONTRACT_DIGEST_FIELDS_MISMATCH: `CONTRACT_DIGEST_FIELDS_MISMATCH capability_digest_fields must read ${DIGEST_FIELDS.join(",")}`,
      CONTRACT_DECLARED_DIGEST_FIELDS_MISMATCH: `CONTRACT_DECLARED_DIGEST_FIELDS_MISMATCH declared_digest_fields must read ${DIGEST_FIELDS.slice(0, 3).join(",")}`,
      CONTRACT_DERIVED_DIGEST_FIELDS_MISMATCH: `CONTRACT_DERIVED_DIGEST_FIELDS_MISMATCH derived_digest_fields must read ${DIGEST_FIELDS.slice(3).join(",")}`,
      CONTRACT_SOURCE_CLASSES_MISMATCH: `CONTRACT_SOURCE_CLASSES_MISMATCH source_classes must read ${SOURCE_CLASSES.join(",")}`,
      CONTRACT_REPORT_FIELDS_MISMATCH: `CONTRACT_REPORT_FIELDS_MISMATCH report_fields must read ${REPORT_FIELDS.join(",")}`,
      CONTRACT_OBSERVATION_FIELDS_MISMATCH: `CONTRACT_OBSERVATION_FIELDS_MISMATCH observation_fields must read ${OBSERVATION_FIELDS.join(",")}`,
      CONTRACT_EVENT_GROUPS_MISMATCH: `CONTRACT_EVENT_GROUPS_MISMATCH event_groups must read ${EVENT_GROUPS.join(",")}`,
      CONTRACT_REQUIRED_GROUPS_MISMATCH: `CONTRACT_REQUIRED_GROUPS_MISMATCH unconditional_required_event_groups must read ${REQUIRED_EVENT_GROUPS.join(",")}`,
      CONTRACT_TABLE_NOT_AN_ARRAY: "CONTRACT_TABLE_NOT_AN_ARRAY mode must declare 2 rows",
      CONTRACT_TABLE_COUNT: "CONTRACT_TABLE_COUNT mode found 1 and not 2",
      CONTRACT_ROW_NOT_AN_OBJECT: "CONTRACT_ROW_NOT_AN_OBJECT mode position 1",
      CONTRACT_UNKNOWN_ROW: "CONTRACT_UNKNOWN_ROW mode SEMI_CONTROLLED is outside the frozen set",
      CONTRACT_DUPLICATE_ROW: "CONTRACT_DUPLICATE_ROW mode VERIFIED_ASSESSMENT appears more than once",
      CONTRACT_MISSING_ROW_FIELD: "CONTRACT_MISSING_ROW_FIELD verdict COMPLETE predicate",
      CONTRACT_ROW_DEAD_FIELD: "CONTRACT_ROW_DEAD_FIELD verdict COMPLETE severity",
      CONTRACT_ROW_ORDER_BROKEN: "CONTRACT_ROW_ORDER_BROKEN verdict COMPLETE sits at position 1 and not 4",
      CONTRACT_ROW_ORDINAL_MISMATCH: "CONTRACT_ROW_ORDINAL_MISMATCH mode VERIFIED_ASSESSMENT declares 7",
      CONTRACT_EMPTY_TEXT: "CONTRACT_EMPTY_TEXT mode VERIFIED_ASSESSMENT statement",
      CONTRACT_ROW_GAP: "CONTRACT_ROW_GAP verdict DEGRADED is absent from the contract",
      CONTRACT_CLAUSE_MISMATCH: "CONTRACT_CLAUSE_MISMATCH verdict DEGRADED must quote its SSOT clause verbatim",
      CONTRACT_PREDICATE_MISMATCH: "CONTRACT_PREDICATE_MISMATCH verdict COMPLETE must read no event group is UNAVAILABLE and the report declares a controlled assessment",
      CONTRACT_EXIT_CODE_MISMATCH: "CONTRACT_EXIT_CODE_MISMATCH SCORE_BLOCKED derives 30",
      CONTRACT_REASON_VERDICT_MISMATCH: "CONTRACT_REASON_VERDICT_MISMATCH DEGRADED_GROUP_UNAVAILABLE derives DEGRADED",
      CONTRACT_VARIANT_GROUPS_MISMATCH: "CONTRACT_VARIANT_GROUPS_MISMATCH as-declared must read none",
      CONTRACT_DERIVATION_PROOF_MISMATCH: `CONTRACT_DERIVATION_PROOF_MISMATCH workspace_diff codex must read ${workspaceDiffProof}`,
      CONTRACT_DERIVATION_PROOF_UNPINNED: "CONTRACT_DERIVATION_PROOF_UNPINNED workspace_diff carries no derivation proof in any runtime cell, so the contract text restoring it is checked against nothing",
      CONTRACT_VARIANT_INVALID: "CONTRACT_VARIANT_INVALID as-declared codex CELL_STATUS_MISMATCH plan_state codex derives UNAVAILABLE",
      CONTRACT_CANONICAL_VARIANT_UNKNOWN: "CONTRACT_CANONICAL_VARIANT_UNKNOWN degraded names everything-is-fine",
      CONTRACT_CANONICAL_REPORT_INVALID: "CONTRACT_CANONICAL_REPORT_INVALID blocked VERDICT_MISMATCH derives SCORE_BLOCKED",
      CONTRACT_CANONICAL_FIXTURE_MISSING: "CONTRACT_CANONICAL_FIXTURE_MISSING complete.json is declared by the contract and absent from the corpus",
      CONTRACT_CANONICAL_FIXTURE_UNDECLARED: "CONTRACT_CANONICAL_FIXTURE_UNDECLARED stale.json is not declared by the doctor contract",
      CONTRACT_VERDICT_UNEXERCISED: "CONTRACT_VERDICT_UNEXERCISED IMPORTED_ONLY is the verdict of no canonical report",
      CONTRACT_REASON_UNEXERCISED: "CONTRACT_REASON_UNEXERCISED DEGRADED_GROUP_UNAVAILABLE is reported by no canonical report",
      CAPABILITY_MATRIX_INVALID: "CAPABILITY_MATRIX_INVALID MATRIX_NOT_AN_OBJECT the capability matrix must be a JSON object",
      CANONICAL_CORPUS_NOT_AN_OBJECT: "CANONICAL_CORPUS_NOT_AN_OBJECT the canonical fixture corpus must be a map of file name to parsed report"
    };

    // [code, the smallest input that emits it]
    const emitters: [string, () => ReturnType<typeof validate>][] = [
      ["REPORT_NOT_AN_OBJECT", () => validate("healthy", doc, matrix)],
      ["REPORT_MISSING_FIELD", () => withReport((r) => { delete r.command; })],
      ["REPORT_DEAD_FIELD", () => withReport((r) => { r.overall_health = "green"; })],
      ["REPORT_CONTRACT_ID", () => withReport((r) => { r.contract_id = "doctor-output.v1"; })],
      ["REPORT_CONTRACT_VERSION", () => withReport((r) => { r.contract_version = "v1"; })],
      ["UNKNOWN_RUNTIME", () => withReport((r) => { r.runtime_id = "gpt-vibes"; })],
      ["UNKNOWN_ASSESSMENT_MODE", () => withReport((r) => { r.assessment_mode = "PROBABLY_CONTROLLED"; })],
      ["COMMAND_MISMATCH", () => withReport((r) => { r.command = "aos doctor"; })],
      ["VERDICT_MISMATCH", () => withReport((r) => { r.verdict = "DEGRADED"; })],
      ["EXIT_CODE_MISMATCH", () => withReport((r) => { r.exit_code = 7; })],
      ["REASONS_MISMATCH", () => withReport((r) => { r.reasons = ["DEGRADED_GROUP_UNAVAILABLE something"]; })],
      ["HUMAN_PROJECTION_LENGTH_MISMATCH", () => withReport((r) => { r.human_projection = []; })],
      ["HUMAN_PROJECTION_MISMATCH", () => withReport((r) => { r.human_projection[0] = "aos doctor"; })],
      ["DIGEST_NOT_AN_OBJECT", () => withReport((r) => { r.capability_digest = "codex@1"; })],
      ["DIGEST_FIELDS_MISMATCH", () => withReport((r) => { r.capability_digest.vendor_notes = "trust me"; })],
      ["DIGEST_DECLARED_FIELD_INVALID", () => withReport((r) => { r.capability_digest.adapter_version = "  "; })],
      ["DIGEST_SOURCE_CLASS_MISMATCH", () => withReport((r) => { r.capability_digest.source_class = ["PRIMARY"]; })],
      ["DIGEST_SUPPORTED_GROUPS_MISMATCH", () => withReport((r) => { r.capability_digest.supported_event_groups = ["tool_call"]; })],
      ["DIGEST_KNOWN_MISSING_MISMATCH", () => withReport((r) => { r.capability_digest.known_missing_events = ["plan_state"]; })],
      ["OBSERVATIONS_NOT_AN_ARRAY", () => withReport((r) => { r.observations = "fourteen groups, all fine"; })],
      ["OBSERVATION_COUNT_MISMATCH", () => withReport((r) => { r.observations = r.observations.slice(0, 13); })],
      ["OBSERVATION_NOT_AN_OBJECT", () => withReport((r) => { r.observations[3] = "tool_call is fine"; })],
      ["OBSERVATION_UNKNOWN_EVENT_GROUP", () => withReport((r) => {
        r.observations.push({ ...observationOf(r, "tool_call"), event_group: "vibes" });
      })],
      ["OBSERVATION_ORDER_BROKEN", () => withReport((r) => {
        [r.observations[0], r.observations[1]] = [r.observations[1], r.observations[0]];
      })],
      ["OBSERVATION_MISSING_FIELD", () => withReport((r) => { delete observationOf(r, "tool_call").evidence_locator; })],
      ["OBSERVATION_DEAD_FIELD", () => withReport((r) => { observationOf(r, "tool_call").confidence = "high"; })],
      ["OBSERVATION_MISMATCH", () => withReport((r) => { observationOf(r, "plan_state").status = "REQUIRED"; })],
      ["CONTRACT_NOT_AN_OBJECT", () => validate(report, "doctor", matrix)],
      ["CONTRACT_MISSING_FIELD", () => withContract((c) => { delete c.verdicts; })],
      ["CONTRACT_DEAD_FIELD", () => withContract((c) => { c.waiver = "temporary"; })],
      ["CONTRACT_ID", () => withContract((c) => { c.contract_id = "doctor-output.v9"; })],
      ["CONTRACT_VERSION", () => withContract((c) => { c.contract_version = "doctor-output-contract-v1"; })],
      ["CONTRACT_SOURCE_AUTHORITY", () => withContract((c) => { c.source_authority = "https://evil.example"; })],
      ["CONTRACT_CAPABILITY_BINDING_MISMATCH", () => withContract((c) => { c.capability_contract_id = "adapter-capabilities.v1"; })],
      ["CONTRACT_ACCEPTANCE_CLAUSE_MISMATCH", () => withContract((c) => { c.acceptance_clause = `${ACCEPTANCE_CLAUSE} (요약)`; })],
      ["CONTRACT_NO_SILENT_ESTIMATION_CLAUSE_MISMATCH", () => withContract((c) => { c.no_silent_estimation_clause = "적당히 추정한다"; })],
      ["CONTRACT_NOT_USER_FAILURE_CLAUSE_MISMATCH", () => withContract((c) => { c.not_user_failure_clause = "사용자 탓이다"; })],
      ["CONTRACT_DECLARED_ONLY_STATEMENT_MISMATCH", () => withContract((c) => { c.declared_only_statement = "everything here is verified"; })],
      ["CONTRACT_COMMAND_TEMPLATE_MISMATCH", () => withContract((c) => { c.command_template = "aos doctor"; })],
      ["CONTRACT_VERSION_TOKEN_BOUND_MISMATCH", () => withContract((c) => { c.version_token_max_chars = 1_000_000; })],
      ["CONTRACT_FIXTURE_DIRECTORY_MISMATCH", () => withContract((c) => { c.canonical_fixture_directory = "fixtures/doctor-v2"; })],
      ["CONTRACT_FIXTURE_TEMPLATE_MISMATCH", () => withContract((c) => { c.canonical_fixture_name_template = "doctor-<report_id>.json"; })],
      ["CONTRACT_RUNTIME_IDS_MISMATCH", () => withContract((c) => { c.runtime_ids = [...RUNTIME_IDS, "gemini"]; })],
      ["CONTRACT_DIGEST_FIELDS_MISMATCH", () => withContract((c) => { c.capability_digest_fields = DIGEST_FIELDS.slice(0, 5); })],
      ["CONTRACT_DECLARED_DIGEST_FIELDS_MISMATCH", () => withContract((c) => { c.declared_digest_fields = DIGEST_FIELDS; })],
      ["CONTRACT_DERIVED_DIGEST_FIELDS_MISMATCH", () => withContract((c) => { c.derived_digest_fields = []; })],
      ["CONTRACT_SOURCE_CLASSES_MISMATCH", () => withContract((c) => { c.source_classes = ["PRIMARY"]; })],
      ["CONTRACT_REPORT_FIELDS_MISMATCH", () => withContract((c) => { c.report_fields = REPORT_FIELDS.slice(0, 4); })],
      ["CONTRACT_OBSERVATION_FIELDS_MISMATCH", () => withContract((c) => { c.observation_fields = [...OBSERVATION_FIELDS].reverse(); })],
      ["CONTRACT_EVENT_GROUPS_MISMATCH", () => withContract((c) => { c.event_groups = EVENT_GROUPS.slice(0, 13); })],
      ["CONTRACT_REQUIRED_GROUPS_MISMATCH", () => withContract((c) => { c.unconditional_required_event_groups = [...REQUIRED_EVENT_GROUPS].reverse(); })],
      ["CONTRACT_TABLE_NOT_AN_ARRAY", () => withContract((c) => { c.assessment_modes = {}; })],
      ["CONTRACT_TABLE_COUNT", () => withContract((c) => { c.assessment_modes.pop(); })],
      ["CONTRACT_ROW_NOT_AN_OBJECT", () => withContract((c) => { c.assessment_modes[0] = "VERIFIED_ASSESSMENT"; })],
      ["CONTRACT_UNKNOWN_ROW", () => withContract((c) => { c.assessment_modes[1].mode_id = "SEMI_CONTROLLED"; })],
      ["CONTRACT_DUPLICATE_ROW", () => withContract((c) => { c.assessment_modes[1] = clone(c.assessment_modes[0]); })],
      ["CONTRACT_MISSING_ROW_FIELD", () => withContract((c) => { delete verdictRow(c, "COMPLETE").predicate; })],
      ["CONTRACT_ROW_DEAD_FIELD", () => withContract((c) => { verdictRow(c, "COMPLETE").severity = 0; })],
      ["CONTRACT_ROW_ORDER_BROKEN", () => withContract((c) => { c.verdicts.reverse(); })],
      ["CONTRACT_ROW_ORDINAL_MISMATCH", () => withContract((c) => { c.assessment_modes[0].ordinal = 7; })],
      ["CONTRACT_EMPTY_TEXT", () => withContract((c) => { c.assessment_modes[0].statement = "   "; })],
      ["CONTRACT_ROW_GAP", () => withContract((c) => { c.verdicts = c.verdicts.filter((row: any) => row.verdict_id !== "DEGRADED"); })],
      ["CONTRACT_CLAUSE_MISMATCH", () => withContract((c) => { verdictRow(c, "DEGRADED").source_clause = "대충"; })],
      ["CONTRACT_PREDICATE_MISMATCH", () => withContract((c) => { verdictRow(c, "COMPLETE").predicate = "looks fine"; })],
      ["CONTRACT_EXIT_CODE_MISMATCH", () => withContract((c) => { verdictRow(c, "SCORE_BLOCKED").exit_code = 0; })],
      ["CONTRACT_REASON_VERDICT_MISMATCH", () => withContract((c) => { reasonRow(c, "DEGRADED_GROUP_UNAVAILABLE").verdict_id = "COMPLETE"; })],
      ["CONTRACT_VARIANT_GROUPS_MISMATCH", () => withContract((c) => { variantRow(c, "as-declared").unproven_derivations = ["plan_state"]; })],
      ["CONTRACT_DERIVATION_PROOF_MISMATCH", () => withContract((c) => { c.derivation_proofs[0].proof = "reconstruct it somehow"; })],
      ["CONTRACT_DERIVATION_PROOF_UNPINNED", () => validate(fixtureOf("blocked-and-imported"), doc, unanchored)],
      ["CONTRACT_VARIANT_INVALID", () => withContract((c) => {
        c.derivation_proofs.find((entry: any) => entry.event_group === "plan_state").proof = "";
      })],
      ["CONTRACT_CANONICAL_VARIANT_UNKNOWN", () => withContract((c) => { entryOf(c, "degraded").matrix_variant = "everything-is-fine"; })],
      ["CONTRACT_CANONICAL_REPORT_INVALID", () => validate(report, doc, matrix,
        withFixture("blocked", (canonical) => { canonical.verdict = "COMPLETE"; }))],
      ["CONTRACT_CANONICAL_FIXTURE_MISSING", () => {
        const thinned = corpus();
        delete thinned["complete.json"];
        return validate(report, doc, matrix, thinned);
      }],
      ["CONTRACT_CANONICAL_FIXTURE_UNDECLARED", () => {
        const stray = corpus();
        stray["stale.json"] = fixtureOf("complete");
        return validate(report, doc, matrix, stray);
      }],
      ["CONTRACT_VERDICT_UNEXERCISED", () => {
        const withoutImported: Record<string, any> = corpus();
        for (const reportId of ["imported-only", "imported-and-degraded", "blocked-and-imported"]) {
          withoutImported[`${reportId}.json`].assessment_mode = "VERIFIED_ASSESSMENT";
        }
        return validate(report, doc, matrix, withoutImported);
      }],
      ["CONTRACT_REASON_UNEXERCISED", () => {
        const withoutDegraded = frozen();
        for (const reportId of ["degraded", "imported-and-degraded", "blocked-and-imported",
          "blocking-and-degraded"]) {
          entryOf(withoutDegraded, reportId).matrix_variant = "as-declared";
        }
        return validate(report, withoutDegraded, matrix);
      }],
      ["CAPABILITY_MATRIX_INVALID", () => validate(report, doc, "matrix")],
      ["CANONICAL_CORPUS_NOT_AN_OBJECT", () => validate(report, doc, matrix, null)]
    ];

    for (const [code, produce] of emitters) {
      const result = produce();
      // `codes()` is `error.split(" ")[0]`, so this is code equality and never a substring, and
      // the message is compared whole so the detail cannot drift either.
      assert.ok(codes(result).includes(code),
        `${code} was emitted by nothing; got ${result.errors.join("; ") || "no error"}`);
      assert.equal(messageFor(result, code), MESSAGES[code], code);
    }
    assert.deepEqual(Object.keys(MESSAGES).sort(), emitters.map(([code]) => code).sort());

    // The five row-table kind names and the proof table's own kind appear only inside error
    // text, so each is pinned by an exact message rather than by the code alone.
    const kinds: [string, (contract: any) => void, string][] = [
      ["proof", (c) => { delete c.derivation_proofs[0].proof; }, "CONTRACT_MISSING_ROW_FIELD proof workspace_diff proof"],
      ["mode", (c) => { delete modeRow(c, "VERIFIED_ASSESSMENT").statement; }, "CONTRACT_MISSING_ROW_FIELD mode VERIFIED_ASSESSMENT statement"],
      ["verdict", (c) => { delete verdictRow(c, "COMPLETE").statement; }, "CONTRACT_MISSING_ROW_FIELD verdict COMPLETE statement"],
      ["reason", (c) => { delete reasonRow(c, "DEGRADED_GROUP_UNAVAILABLE").statement; }, "CONTRACT_MISSING_ROW_FIELD reason DEGRADED_GROUP_UNAVAILABLE statement"],
      ["variant", (c) => { delete variantRow(c, "as-declared").source_clause; }, "CONTRACT_MISSING_ROW_FIELD variant as-declared source_clause"],
      ["canonical", (c) => { delete entryOf(c, "complete").ordinal; }, "CONTRACT_MISSING_ROW_FIELD canonical complete ordinal"]
    ];
    for (const [kind, tamper, expected] of kinds) {
      assert.equal(messageFor(withContract(tamper), "CONTRACT_MISSING_ROW_FIELD"), expected, kind);
    }

    // Two codes are emitted from more than one place, and each place carries its own text.
    assert.equal(
      messageFor(withContract((c) => { c.capability_contract_version = "adapter-capability-contract-v1"; }),
        "CONTRACT_CAPABILITY_BINDING_MISMATCH"),
      `CONTRACT_CAPABILITY_BINDING_MISMATCH capability_contract_version must read ${matrix.contract_version}`
    );
    assert.equal(
      messageFor(validate(report, doc, matrix,
        withFixture("complete", (canonical) => { canonical.runtime_id = "codex-next"; })),
        "CONTRACT_CANONICAL_REPORT_INVALID"),
      "CONTRACT_CANONICAL_REPORT_INVALID complete UNKNOWN_RUNTIME codex-next is outside the frozen SSOT 9.2 runtime set"
    );

    // A duplicated row is reported once and is not then measured as a misplaced row, so the
    // `continue` that stops the second pass is load bearing and is asserted exactly.
    const duplicated = frozen();
    duplicated.assessment_modes[1] = clone(duplicated.assessment_modes[0]);
    assert.deepEqual(codes(validate(report, duplicated, matrix)),
      ["CONTRACT_DUPLICATE_ROW", "CONTRACT_ROW_GAP"]);

    // And the inventory is re-derived from the module rather than maintained by hand, so a new
    // code that no case produces fails here instead of shipping unasserted. Comments are
    // stripped first; every message this module emits begins with its code and a space, and the
    // two codes it interpolates are read from the frozen list table they come from.
    const stripped = readFileSync(sourcePath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    const inSource = new Set<string>();
    for (const match of stripped.matchAll(/["`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+) /g)) inSource.add(match[1]);
    for (const match of stripped.matchAll(/,\s*"(CONTRACT_[A-Z0-9_]+_MISMATCH)"\]/g)) inSource.add(match[1]);
    const asserted = new Set(emitters.map(([code]) => code));
    assert.equal(asserted.size, emitters.length, "an error code is listed twice");
    assert.deepEqual([...inSource].filter((code) => !asserted.has(code)).sort(), [],
      "the module can emit an error code that no case asserts");
    assert.deepEqual([...asserted].filter((code) => !inSource.has(code)).sort(), [],
      "a case asserts an error code the module does not carry");
    assert.equal(asserted.size, 78);
  });

  test("blocking-and-degraded", () => {
    const doc = frozen();
    // SSOT §9.2 line 980 applied to both DERIVED rows at once: neither carries a derivation
    // proof, so both are UNAVAILABLE. workspace_diff's 누락 처리 column invalidates the run,
    // so the verdict is SCORE_BLOCKED and the degraded reason follows in severity order.
    const matrix = unproven(frozenMatrix(), "claude-code", ["workspace_diff", "plan_state"]);
    const report = fixtureOf("blocking-and-degraded");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, [WORKSPACE_DIFF_REASON, PLAN_STATE_REASON]);
    assert.equal(report.runtime_id, "claude-code");
    assert.equal(report.assessment_mode, "VERIFIED_ASSESSMENT");
    assert.equal(report.verdict, result.verdict);
    assert.equal(report.exit_code, result.exit_code);
    assert.deepEqual(report.reasons, result.reasons);
    assert.deepEqual(report.human_projection, result.human_projection);

    assert.equal(observationOf(report, "workspace_diff").status, "UNAVAILABLE");
    assert.equal(observationOf(report, "plan_state").status, "UNAVAILABLE");
    assert.equal(result.human_projection[3], "groups: supported=12 unavailable=2 required_observed=7/7");
    assert.equal(result.human_projection[1], "verdict: SCORE_BLOCKED exit=30 mode=VERIFIED_ASSESSMENT");
    assert.equal(result.human_projection[20], `note: ${NOT_USER_FAILURE_CLAUSE}`);
  });

  test("blocking-and-imported", () => {
    const doc = frozen();
    // Only workspace_diff loses its derivation proof, so the run is invalid and the imported
    // session keeps its DIAGNOSTIC ONLY reason after the blocking one; plan_state stays
    // derived, so no degraded reason appears.
    const matrix = unproven(frozenMatrix(), "codex", ["workspace_diff"]);
    const report = fixtureOf("blocking-and-imported");
    const result = validate(report, doc, matrix);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.verdict, "SCORE_BLOCKED");
    assert.equal(result.exit_code, 30);
    assert.deepEqual(result.reasons, [WORKSPACE_DIFF_REASON, IMPORTED_REASON]);
    assert.equal(report.runtime_id, "codex");
    assert.equal(report.assessment_mode, "IMPORTED_SESSION");
    assert.equal(report.verdict, result.verdict);
    assert.equal(report.exit_code, result.exit_code);
    assert.deepEqual(report.reasons, result.reasons);
    assert.deepEqual(report.human_projection, result.human_projection);

    assert.equal(observationOf(report, "workspace_diff").status, "UNAVAILABLE");
    assert.equal(observationOf(report, "plan_state").status, "DERIVED");
    assert.equal(result.human_projection[3], "groups: supported=13 unavailable=1 required_observed=7/7");
    assert.equal(result.human_projection[1], "verdict: SCORE_BLOCKED exit=30 mode=IMPORTED_SESSION");
    assert.equal(result.human_projection[20], `note: ${NOT_USER_FAILURE_CLAUSE}`);
  });

  // The manifest names one frozen matrix variant per canonical report, and the variant is
  // read as a string, never coerced: an earlier String(...) coercion let a one-element array
  // naming the id pass as the id itself, validating a wrong-shaped contract to COMPLETE.
  test("canonical-matrix-variant-is-read-as-a-string-not-coerced", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const nonStrings: [string, unknown, string][] = [
      ["one-element array", ["as-declared"], "<unnamed>"],
      ["number", 0, "0"],
      ["plain object", { variant_id: "as-declared" }, "<unnamed>"],
      ["null-prototype object", Object.create(null), "<unnamed>"]
    ];
    for (const [label, variant, named] of nonStrings) {
      const tampered = frozen();
      entryOf(tampered, "complete").matrix_variant = variant;
      const result = validate(report, tampered, matrix);
      assert.equal(result.ok, false, label);
      assert.equal(
        messageFor(result, "CONTRACT_CANONICAL_VARIANT_UNKNOWN"),
        `CONTRACT_CANONICAL_VARIANT_UNKNOWN complete names ${named}`, label);
      assert.equal(result.verdict, "SCORE_BLOCKED", label);
      assert.equal(result.exit_code, 30, label);
    }
  });

  // A value with no prototype carries no primitive coercion at all, so a naming site that
  // calls String(...) throws a TypeError instead of refusing the value. Every site names the
  // value through the same helper, so a null-prototype value fails closed with the value
  // unnamed — in the contract's row tables and inside a canonical fixture alike.
  test("null-prototype-values-fail-closed-without-throwing", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const cases: [string, () => ReturnType<typeof validate>, string[]][] = [
      ["canonical fixture runtime_id", () => validate(report, doc, matrix,
        withFixture("complete", (canonical) => { canonical.runtime_id = Object.create(null); })),
        ["CONTRACT_CANONICAL_REPORT_INVALID complete UNKNOWN_RUNTIME <unnamed> is outside the frozen SSOT 9.2 runtime set",
          "CONTRACT_VERDICT_UNEXERCISED COMPLETE is the verdict of no canonical report"]],
      ["mode row id", () => {
        const tampered = frozen();
        tampered.assessment_modes[0].mode_id = Object.create(null);
        return validate(report, tampered, matrix);
      },
        ["CONTRACT_UNKNOWN_ROW mode <unnamed> is outside the frozen set",
          "CONTRACT_ROW_GAP mode VERIFIED_ASSESSMENT is absent from the contract"]],
      ["mode row ordinal", () => {
        const tampered = frozen();
        tampered.assessment_modes[0].ordinal = Object.create(null);
        return validate(report, tampered, matrix);
      },
        ["CONTRACT_ROW_ORDINAL_MISMATCH mode VERIFIED_ASSESSMENT declares <unnamed>"]]
    ];
    for (const [label, produce, expected] of cases) {
      let result!: ReturnType<typeof validate>;
      assert.doesNotThrow(() => { result = produce(); }, label);
      assert.deepEqual(result.errors, expected, label);
      assert.equal(result.ok, false, label);
      assert.equal(result.verdict, "SCORE_BLOCKED", label);
      assert.equal(result.exit_code, 30, label);
      assert.deepEqual(result.reasons, [], label);
      assert.deepEqual(result.human_projection, [], label);
    }
  });

  // A version token is echoed into the projection, so the shape check refuses control and
  // bidi characters: an escape sequence forges terminal output, a NUL breaks log parsing and
  // a bidi override disguises direction. The refusal is the existing shape error, and it
  // holds even for a report that is otherwise perfectly self-consistent.
  test("version-tokens-refuse-control-and-bidi-characters", () => {
    const doc = frozen();
    const matrix = frozenMatrix();
    const report = fixtureOf("complete");

    const smuggled: [string, string][] = [
      ["escape", "\u001b[2JFAKE_COMPLETE"],
      ["nul", "\u0000"],
      ["bidi override", "\u202e"]
    ];
    for (const [label, token] of smuggled) {
      const forged = clone(report);
      forged.capability_digest.runtime_version = token;
      // The forgery is complete: the projection line carries the same token, so nothing but
      // the token shape check can refuse it.
      forged.human_projection = report.human_projection.map((line: string) =>
        line.replace(`runtime_version=${report.capability_digest.runtime_version}`, `runtime_version=${token}`));
      const result = validate(forged, doc, matrix);
      assert.equal(result.ok, false, label);
      assert.deepEqual(result.errors,
        [`DIGEST_DECLARED_FIELD_INVALID runtime_version ${token} is not a version token`], label);
      assert.equal(result.verdict, "SCORE_BLOCKED", label);
      assert.equal(result.exit_code, 30, label);
    }
  });
});
