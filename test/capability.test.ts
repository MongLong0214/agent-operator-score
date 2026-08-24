import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCapabilityMatrix } from "../src/schema/capability.ts";
import type { CapabilityRow, CapabilityStatus } from "../src/schema/capability.ts";

const here = dirname(fileURLToPath(import.meta.url));
const matrixPath = resolve(here, "../specs/adapter-capabilities.v0.json");

// specs/adapter-capabilities.v0.json freezes SSOT §9.2 — the five status definitions, the
// two runtime source-class declarations, the capability digest field list, and the v0 event
// coverage matrix. This test loads that frozen document and mutates copies of it, mirroring
// metric-registry.test.ts and issuance-contract.test.ts.
const frozen = () => JSON.parse(readFileSync(matrixPath, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const codes = (result: { errors: string[] }) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));

const rowOf = (doc: any, eventGroup: string) =>
  doc.rows.find((row: any) => row.event_group === eventGroup);
const cellOf = (doc: any, eventGroup: string, runtimeId: string) =>
  rowOf(doc, eventGroup).runtimes[runtimeId];
const runtimeOf = (doc: any, runtimeId: string) =>
  doc.runtimes.find((runtime: any) => runtime.runtime_id === runtimeId);

const RUNTIME_IDS = ["codex", "claude-code"];

// The five status definitions of SSOT §9.2 (lines 943-947), in canonical order.
const STATUS_ORDER: CapabilityStatus[] = ["REQUIRED", "CONDITIONAL", "DERIVED", "BEST_EFFORT", "UNAVAILABLE"];

// SSOT §9.2 line 939: the exact six fields a capability digest must carry.
const DIGEST_FIELDS = [
  "runtime_version",
  "protocol_or_schema_version",
  "adapter_version",
  "source_class",
  "supported_event_groups",
  "known_missing_events"
];

// An independent transcription of the SSOT §9.2 "v0 event coverage matrix" table
// (lines 951-966). Columns: event_group id, Event group, 계약, Codex adapter v0,
// Claude Code adapter v0, 누락 처리. Every cell is quoted verbatim; the ids are the
// stable keys the contract uses for the same rows.
const SSOT_MATRIX: [string, string, string, string, string, string][] = [
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

const EVENT_GROUPS = SSOT_MATRIX.map(([eventGroup]) => eventGroup);

// The seven rows whose 계약 cell is exactly "REQUIRED". This list is the same set
// issuance-contract.ts gates on as REQUIRED_ADAPTER_EVENT_GROUPS; the two frozen
// contracts must not be allowed to drift apart. "human active time·takeover" is
// "REQUIRED for M18/M20" and is deliberately absent.
const UNCONDITIONAL_REQUIRED = [
  "run_lifecycle",
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "evidence_claim",
  "approval_safety",
  "actor_attribution"
];

// SSOT §9.2 lines 937-938: the only source classes each runtime may draw on, and the
// sources each one forbids outright.
const FORBIDDEN_SOURCES: Record<string, string[]> = {
  codex: ["experimental websocket", "private DB", "undocumented log"],
  "claude-code": ["internal transcript", "internal cache", "internal log"]
};

const DERIVED_ROWS = ["workspace_diff", "plan_state"];

describe("adapter-capability-matrix", () => {
  // AC-E0B-001-1
  test("complete-matrix", () => {
    const result = validateCapabilityMatrix(frozen());
    assert.deepEqual(result.errors, [], "the frozen §9.2 matrix must validate with zero errors");
    assert.equal(result.ok, true);

    // Exhaustive over event groups: all fourteen SSOT rows, in table order, once each.
    assert.equal(result.rows.length, SSOT_MATRIX.length);
    assert.deepEqual(result.rows.map((row: CapabilityRow) => row.event_group), EVENT_GROUPS);

    const doc = frozen();
    for (const [eventGroup, sourceRow, contract, codexCapture, claudeCapture, missingEffect] of SSOT_MATRIX) {
      const row = rowOf(doc, eventGroup);
      assert.ok(row, `${eventGroup} is absent from the frozen matrix`);
      assert.equal(row.source_row, sourceRow, eventGroup);
      assert.equal(row.contract, contract, eventGroup);
      assert.equal(row.missing_effect, missingEffect, eventGroup);

      // Exhaustive over runtimes: exactly the two adapters, each with the SSOT capture cell.
      assert.deepEqual(Object.keys(row.runtimes), RUNTIME_IDS, eventGroup);
      assert.equal(row.runtimes.codex.capture, codexCapture, eventGroup);
      assert.equal(row.runtimes["claude-code"].capture, claudeCapture, eventGroup);
    }

    // The conditional-requirement row is never admitted into the unconditional set.
    assert.deepEqual(result.required_event_groups, UNCONDITIONAL_REQUIRED);
    assert.equal(result.required_event_groups.includes("human_active_time"), false);
    assert.equal(rowOf(doc, "human_active_time").requirement_scope, "CONDITIONAL");
    assert.deepEqual(rowOf(doc, "human_active_time").condition_metrics, ["M18", "M20"]);

    // Every cell of the frozen matrix names a capture mechanism, so nothing is missing.
    for (const runtimeId of RUNTIME_IDS) {
      assert.deepEqual(result.coverage[runtimeId].supported_event_groups, EVENT_GROUPS, runtimeId);
      assert.deepEqual(result.coverage[runtimeId].known_missing_events, [], runtimeId);
    }

    assert.deepEqual(doc.capability_digest_fields, DIGEST_FIELDS);
    assert.deepEqual(doc.status_definitions.map((entry: any) => entry.status), STATUS_ORDER);
    assert.deepEqual(doc.runtimes.map((entry: any) => entry.runtime_id), RUNTIME_IDS);

    // Structural mutation guards on the fourteen-row declaration itself.
    const extended = frozen();
    extended.rows.push({ ...clone(rowOf(extended, "run_lifecycle")), event_group: "hidden_reasoning", ordinal: 15 });
    const extendedResult = validateCapabilityMatrix(extended);
    assert.equal(extendedResult.ok, false);
    assert.ok(has(extendedResult, "UNKNOWN_EVENT_GROUP hidden_reasoning"), extendedResult.errors.join("; "));
    assert.ok(codes(extendedResult).includes("ROW_COUNT_NOT_14"), extendedResult.errors.join("; "));

    const shuffled = frozen();
    [shuffled.rows[3], shuffled.rows[4]] = [shuffled.rows[4], shuffled.rows[3]];
    const shuffledResult = validateCapabilityMatrix(shuffled);
    assert.equal(shuffledResult.ok, false);
    assert.ok(codes(shuffledResult).includes("ROW_ORDER_BROKEN"), shuffledResult.errors.join("; "));

    const duplicated = frozen();
    duplicated.rows[9] = { ...clone(duplicated.rows[8]), ordinal: 10 };
    const duplicatedResult = validateCapabilityMatrix(duplicated);
    assert.equal(duplicatedResult.ok, false);
    assert.ok(has(duplicatedResult, "DUPLICATE_EVENT_GROUP retrieval_memory"), duplicatedResult.errors.join("; "));
    assert.ok(has(duplicatedResult, "EVENT_GROUP_GAP delegation_handoff"), duplicatedResult.errors.join("; "));
    // A repeat is also an order break: the fourteen rows are strictly increasing.
    assert.ok(codes(duplicatedResult).includes("ROW_ORDER_BROKEN"), duplicatedResult.errors.join("; "));

    const drifted = frozen();
    rowOf(drifted, "token_cost").ordinal = 3;
    assert.ok(has(validateCapabilityMatrix(drifted), "ROW_ORDINAL_MISMATCH token_cost"));
  });

  // AC-E0B-001-2
  test("missing-row", () => {
    // Every one of the fourteen event groups is load-bearing: dropping any one fails closed.
    for (const eventGroup of EVENT_GROUPS) {
      const doc = frozen();
      doc.rows = doc.rows.filter((row: any) => row.event_group !== eventGroup);
      for (const runtime of doc.runtimes) {
        runtime.supported_event_groups = runtime.supported_event_groups.filter(
          (entry: string) => entry !== eventGroup
        );
      }
      doc.unconditional_required_event_groups = doc.unconditional_required_event_groups.filter(
        (entry: string) => entry !== eventGroup
      );
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping ${eventGroup} was accepted`);
      assert.ok(has(result, `EVENT_GROUP_GAP ${eventGroup}`), result.errors.join("; "));
      assert.ok(codes(result).includes("ROW_COUNT_NOT_14"), result.errors.join("; "));
    }

    // A missing (event group x runtime) cell fails closed rather than defaulting.
    for (const eventGroup of EVENT_GROUPS) {
      for (const runtimeId of RUNTIME_IDS) {
        const doc = frozen();
        delete rowOf(doc, eventGroup).runtimes[runtimeId];
        const result = validateCapabilityMatrix(doc);
        assert.equal(result.ok, false, `dropping ${eventGroup}/${runtimeId} was accepted`);
        assert.ok(
          has(result, `RUNTIME_CELL_GAP ${eventGroup} ${runtimeId}`),
          result.errors.join("; ")
        );
      }
    }

    // An extra cell is equally rejected: the matrix is exhaustive, not open.
    const extra = frozen();
    rowOf(extra, "tool_call").runtimes.gemini = clone(cellOf(extra, "tool_call", "codex"));
    const extraResult = validateCapabilityMatrix(extra);
    assert.equal(extraResult.ok, false);
    assert.ok(has(extraResult, "UNKNOWN_RUNTIME_CELL tool_call gemini"), extraResult.errors.join("; "));

    // A row whose runtimes column is not a cell map has no cells at all.
    const notAMap = frozen();
    rowOf(notAMap, "evidence_claim").runtimes = "both adapters";
    const notAMapResult = validateCapabilityMatrix(notAMap);
    assert.equal(notAMapResult.ok, false);
    assert.ok(has(notAMapResult, "RUNTIME_CELLS_INVALID evidence_claim"), notAMapResult.errors.join("; "));
    for (const runtimeId of RUNTIME_IDS) {
      assert.ok(has(notAMapResult, `RUNTIME_CELL_GAP evidence_claim ${runtimeId}`), notAMapResult.errors.join("; "));
    }

    // Whole-runtime declarations are exhaustive too.
    const droppedRuntime = frozen();
    droppedRuntime.runtimes = droppedRuntime.runtimes.filter((entry: any) => entry.runtime_id !== "claude-code");
    const droppedResult = validateCapabilityMatrix(droppedRuntime);
    assert.equal(droppedResult.ok, false);
    assert.ok(has(droppedResult, "RUNTIME_GAP claude-code"), droppedResult.errors.join("; "));
    assert.ok(codes(droppedResult).includes("RUNTIME_COUNT_NOT_2"), droppedResult.errors.join("; "));

    const swappedRuntimes = frozen();
    [swappedRuntimes.runtimes[0], swappedRuntimes.runtimes[1]] =
      [swappedRuntimes.runtimes[1], swappedRuntimes.runtimes[0]];
    const swappedResult = validateCapabilityMatrix(swappedRuntimes);
    assert.equal(swappedResult.ok, false);
    assert.ok(codes(swappedResult).includes("RUNTIME_ORDER_BROKEN"), swappedResult.errors.join("; "));

    // Every runtime declaration field is required.
    const runtimeFields = Object.keys(runtimeOf(frozen(), "codex"));
    assert.ok(runtimeFields.length >= 7, `runtime shape collapsed to ${runtimeFields.join(",")}`);
    for (const field of runtimeFields) {
      const doc = frozen();
      delete runtimeOf(doc, "codex")[field];
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping runtime field ${field} was accepted`);
      assert.ok(
        has(result, `MISSING_RUNTIME_FIELD codex ${field}`) || has(result, "UNKNOWN_RUNTIME"),
        `${field} produced ${result.errors.join("; ") || "no error"}`
      );
    }

    // Every row field is required; none may be silently defaulted.
    const rowFields = Object.keys(rowOf(frozen(), "plan_state"));
    assert.ok(rowFields.length >= 11, `row shape collapsed to ${rowFields.join(",")}`);
    for (const field of rowFields) {
      const doc = frozen();
      delete rowOf(doc, "plan_state")[field];
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping row field ${field} was accepted`);
      assert.ok(
        has(result, `MISSING_ROW_FIELD`) || has(result, "EVENT_GROUP_GAP"),
        `${field} produced ${result.errors.join("; ") || "no error"}`
      );
    }
  });

  // AC-E0B-001-3
  test("missing-source", () => {
    // A source-less cell is never admitted, for any of the 28 (event group x runtime) cells.
    for (const eventGroup of EVENT_GROUPS) {
      for (const runtimeId of RUNTIME_IDS) {
        const dropped = frozen();
        delete cellOf(dropped, eventGroup, runtimeId).evidence_locator;
        const droppedResult = validateCapabilityMatrix(dropped);
        assert.equal(droppedResult.ok, false, `${eventGroup}/${runtimeId} without a locator was accepted`);
        assert.ok(
          has(droppedResult, `MISSING_CELL_FIELD ${eventGroup} ${runtimeId} evidence_locator`),
          droppedResult.errors.join("; ")
        );

        const blank = frozen();
        cellOf(blank, eventGroup, runtimeId).evidence_locator = "   ";
        const blankResult = validateCapabilityMatrix(blank);
        assert.equal(blankResult.ok, false, `${eventGroup}/${runtimeId} with a blank locator was accepted`);
        assert.ok(
          has(blankResult, `EMPTY_EVIDENCE_LOCATOR ${eventGroup} ${runtimeId}`),
          blankResult.errors.join("; ")
        );
      }
    }

    // Every cell field is load-bearing.
    const cellFields = Object.keys(cellOf(frozen(), "tool_call", "codex"));
    assert.ok(cellFields.length >= 7, `cell shape collapsed to ${cellFields.join(",")}`);
    for (const field of cellFields) {
      const doc = frozen();
      delete cellOf(doc, "tool_call", "codex")[field];
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping cell field ${field} was accepted`);
      assert.ok(
        has(result, `MISSING_CELL_FIELD tool_call codex ${field}`),
        `${field} produced ${result.errors.join("; ") || "no error"}`
      );
    }

    // SSOT §9.2 forbids a named source class outright per runtime; a cell that reaches
    // for one is refused even though it does name "a" source.
    for (const runtimeId of RUNTIME_IDS) {
      for (const forbidden of FORBIDDEN_SOURCES[runtimeId]) {
        const doc = frozen();
        cellOf(doc, "tool_call", runtimeId).evidence_locator = `captured from the ${forbidden} surface`;
        const result = validateCapabilityMatrix(doc);
        assert.equal(result.ok, false, `${runtimeId} accepted the forbidden source ${forbidden}`);
        assert.ok(
          has(result, `FORBIDDEN_SOURCE tool_call ${runtimeId} ${forbidden}`),
          result.errors.join("; ")
        );
      }
    }

    // The runtime source declarations themselves are frozen prose the guards depend on.
    const clauseTamper = frozen();
    runtimeOf(clauseTamper, "codex").source_clause = "Codex v0 primary는 무엇이든 된다.";
    assert.ok(
      has(validateCapabilityMatrix(clauseTamper), "RUNTIME_SOURCE_CLAUSE_MISMATCH codex"),
      "the SSOT source-class clause must be quoted verbatim"
    );

    const inventoryTamper = frozen();
    runtimeOf(inventoryTamper, "claude-code").forbidden_sources = [];
    const inventoryResult = validateCapabilityMatrix(inventoryTamper);
    assert.equal(inventoryResult.ok, false, "emptying the forbidden-source list was accepted");
    assert.ok(
      has(inventoryResult, "RUNTIME_SOURCE_INVENTORY_MISMATCH claude-code forbidden_sources"),
      inventoryResult.errors.join("; ")
    );

    for (const listField of ["primary_sources", "secondary_sources"]) {
      const doc = frozen();
      runtimeOf(doc, "codex")[listField] = [...runtimeOf(doc, "codex")[listField]].reverse();
      assert.ok(
        has(validateCapabilityMatrix(doc), `RUNTIME_SOURCE_INVENTORY_MISMATCH codex ${listField}`),
        `${listField} order is not pinned`
      );
    }

    // Redaction is part of the source contract: no cell may drop it. SSOT §9.2 line 935.
    for (const drop of ["raw_secret", "hidden_reasoning"]) {
      const doc = frozen();
      const cell = cellOf(doc, "user_instruction", "claude-code");
      cell.redaction = cell.redaction.filter((entry: string) => entry !== drop);
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `a cell that stops redacting ${drop} was accepted`);
      assert.ok(
        has(result, "REDACTION_MISMATCH user_instruction claude-code"),
        result.errors.join("; ")
      );
    }
    const policyTamper = frozen();
    policyTamper.redaction_policy.never_stored = ["raw_secret"];
    assert.ok(
      has(validateCapabilityMatrix(policyTamper), "REDACTION_POLICY_MISMATCH"),
      "the global redaction policy must be frozen"
    );

    // The runtime/version constraint is derived from the source class, never declared freely.
    const constraintTamper = frozen();
    cellOf(constraintTamper, "workspace_diff", "codex").runtime_constraint = [
      "runtime_version",
      "protocol_or_schema_version",
      "adapter_version"
    ];
    const constraintResult = validateCapabilityMatrix(constraintTamper);
    assert.equal(constraintResult.ok, false);
    assert.ok(
      has(constraintResult, "RUNTIME_CONSTRAINT_MISMATCH workspace_diff codex"),
      constraintResult.errors.join("; ")
    );
    const digestTamper = frozen();
    digestTamper.capability_digest_fields = DIGEST_FIELDS.filter((entry) => entry !== "known_missing_events");
    assert.ok(has(validateCapabilityMatrix(digestTamper), "DIGEST_FIELDS_MISMATCH"));
  });

  // AC-E0B-001-4
  test("invalid-derived", () => {
    // SSOT §9.2 line 980: "DERIVED 근거가 없으면 UNAVAILABLE이다." A derived cell without a
    // derivation proof falls to UNAVAILABLE; it may not keep presenting as DERIVED.
    for (const eventGroup of DERIVED_ROWS) {
      for (const emptyProof of [null, "", "   "]) {
        const promoted = frozen();
        cellOf(promoted, eventGroup, "codex").derivation_proof = emptyProof;
        const promotedResult = validateCapabilityMatrix(promoted);
        assert.equal(promotedResult.ok, false, `${eventGroup} kept DERIVED without a proof`);
        assert.ok(
          has(promotedResult, `CELL_STATUS_MISMATCH ${eventGroup} codex derives UNAVAILABLE`),
          promotedResult.errors.join("; ")
        );
        // The declared coverage cannot paper over it either.
        assert.ok(
          has(promotedResult, "COVERAGE_MISMATCH codex"),
          promotedResult.errors.join("; ")
        );
      }

      // Declared honestly, the same document validates and the group is reported missing.
      const honest = frozen();
      cellOf(honest, eventGroup, "codex").derivation_proof = null;
      cellOf(honest, eventGroup, "codex").status = "UNAVAILABLE";
      const codexRuntime = runtimeOf(honest, "codex");
      codexRuntime.supported_event_groups = codexRuntime.supported_event_groups.filter(
        (entry: string) => entry !== eventGroup
      );
      codexRuntime.known_missing_events = [eventGroup];
      const honestResult = validateCapabilityMatrix(honest);
      assert.deepEqual(honestResult.errors, [], `${eventGroup} honest UNAVAILABLE declaration`);
      assert.deepEqual(honestResult.coverage.codex.known_missing_events, [eventGroup]);
      assert.equal(honestResult.coverage.codex.supported_event_groups.includes(eventGroup), false);
      // The other runtime is untouched: coverage is per adapter, not global.
      assert.deepEqual(honestResult.coverage["claude-code"].known_missing_events, []);
    }

    // A non-derived cell may not carry a derivation proof; that would let a wrapper capture
    // masquerade as a deterministic reconstruction.
    const unexpected = frozen();
    cellOf(unexpected, "tool_call", "codex").derivation_proof = "recomputed from the runner filesystem";
    const unexpectedResult = validateCapabilityMatrix(unexpected);
    assert.equal(unexpectedResult.ok, false);
    assert.ok(
      has(unexpectedResult, "DERIVATION_PROOF_UNEXPECTED tool_call codex"),
      unexpectedResult.errors.join("; ")
    );

    // The source class of a derived row is itself derived from the 계약 column.
    for (const eventGroup of DERIVED_ROWS) {
      const doc = frozen();
      cellOf(doc, eventGroup, "claude-code").source_class = "PRIMARY";
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `${eventGroup} accepted a non-runner source class`);
      assert.ok(
        has(result, `SOURCE_CLASS_MISMATCH ${eventGroup} claude-code`),
        result.errors.join("; ")
      );
    }
    const overReach = frozen();
    cellOf(overReach, "run_lifecycle", "codex").source_class = "RUNNER_DERIVED";
    assert.ok(
      has(validateCapabilityMatrix(overReach), "SOURCE_CLASS_MISMATCH run_lifecycle codex"),
      "a non-derived row may not claim to be runner derived"
    );
    const bogusClass = frozen();
    cellOf(bogusClass, "run_lifecycle", "codex").source_class = "VIBES";
    assert.ok(has(validateCapabilityMatrix(bogusClass), "UNKNOWN_SOURCE_CLASS run_lifecycle codex VIBES"));

    // A declared coverage list may not invent support the cells do not show.
    const forgedCoverage = frozen();
    runtimeOf(forgedCoverage, "claude-code").known_missing_events = ["token_cost"];
    const forgedResult = validateCapabilityMatrix(forgedCoverage);
    assert.equal(forgedResult.ok, false);
    assert.ok(has(forgedResult, "COVERAGE_MISMATCH claude-code"), forgedResult.errors.join("; "));
  });

  // AC-E0B-001-5
  test("invalid-status", () => {
    for (const bogus of ["SUPPORTED", "required", "", "DERIVED/CONDITIONAL"]) {
      const doc = frozen();
      rowOf(doc, "token_cost").statuses = [bogus];
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `status ${bogus} was silently accepted`);
      assert.ok(codes(result).includes("UNKNOWN_STATUS"), result.errors.join("; "));
    }
    const bogusCell = frozen();
    cellOf(bogusCell, "token_cost", "codex").status = "PROBABLY_FINE";
    assert.ok(has(validateCapabilityMatrix(bogusCell), "UNKNOWN_STATUS token_cost codex PROBABLY_FINE"));

    // A 계약 cell that is neither a status enum, a "/"-joined pair of them, nor the
    // "REQUIRED for <metrics>" form carries no derivable requirement level at all.
    for (const bogusContract of ["MOSTLY", "REQUIRED for everything", "UNAVAILABLE", "REQUIRED/BEST_EFFORT"]) {
      const doc = frozen();
      rowOf(doc, "token_cost").contract = bogusContract;
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `contract ${bogusContract} was accepted`);
      assert.ok(
        has(result, "CONTRACT_UNPARSEABLE token_cost"),
        `${bogusContract} produced ${result.errors.join("; ") || "no error"}`
      );
    }

    // The conditional-requirement row must never be promoted into the unconditional set,
    // by any route: rewriting the 계약 cell, or simply declaring the wrong scope.
    const promotedContract = frozen();
    rowOf(promotedContract, "human_active_time").contract = "REQUIRED";
    rowOf(promotedContract, "human_active_time").statuses = ["REQUIRED"];
    rowOf(promotedContract, "human_active_time").requirement_scope = "UNCONDITIONAL_REQUIRED";
    rowOf(promotedContract, "human_active_time").condition_metrics = [];
    promotedContract.unconditional_required_event_groups = [
      ...UNCONDITIONAL_REQUIRED.slice(0, 6),
      "human_active_time",
      "actor_attribution"
    ];
    const promotedResult = validateCapabilityMatrix(promotedContract);
    assert.equal(promotedResult.ok, false, "the conditional row was promoted");
    assert.ok(has(promotedResult, "CONTRACT_TEXT_MISMATCH human_active_time"), promotedResult.errors.join("; "));
    // A REQUIRED row whose absence is only NOT OBSERVED is internally incoherent.
    assert.ok(has(promotedResult, "MISSING_EFFECT_INCOHERENT human_active_time"), promotedResult.errors.join("; "));

    const promotedScope = frozen();
    rowOf(promotedScope, "human_active_time").requirement_scope = "UNCONDITIONAL_REQUIRED";
    const scopeResult = validateCapabilityMatrix(promotedScope);
    assert.equal(scopeResult.ok, false);
    assert.ok(has(scopeResult, "REQUIREMENT_SCOPE_MISMATCH human_active_time"), scopeResult.errors.join("; "));

    const forgedRequiredSet = frozen();
    forgedRequiredSet.unconditional_required_event_groups = [...UNCONDITIONAL_REQUIRED, "human_active_time"];
    const forgedSetResult = validateCapabilityMatrix(forgedRequiredSet);
    assert.equal(forgedSetResult.ok, false);
    assert.ok(codes(forgedSetResult).includes("REQUIRED_SET_MISMATCH"), forgedSetResult.errors.join("; "));

    const droppedFromSet = frozen();
    droppedFromSet.unconditional_required_event_groups = UNCONDITIONAL_REQUIRED.filter(
      (entry) => entry !== "approval_safety"
    );
    assert.ok(codes(validateCapabilityMatrix(droppedFromSet)).includes("REQUIRED_SET_MISMATCH"));

    // The five status definitions are exhaustive and frozen.
    for (const status of STATUS_ORDER) {
      const doc = frozen();
      doc.status_definitions = doc.status_definitions.filter((entry: any) => entry.status !== status);
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping the ${status} definition was accepted`);
      assert.ok(has(result, `STATUS_DEFINITION_GAP ${status}`), result.errors.join("; "));
      assert.ok(codes(result).includes("STATUS_DEFINITION_COUNT_NOT_5"), result.errors.join("; "));
    }
    const reworded = frozen();
    reworded.status_definitions[4].source_clause = "UNAVAILABLE: 그냥 넘어간다";
    assert.ok(has(validateCapabilityMatrix(reworded), "STATUS_DEFINITION_MISMATCH UNAVAILABLE"));

    const emptied = frozen();
    emptied.status_definitions[1].definition = "  ";
    assert.ok(has(validateCapabilityMatrix(emptied), "EMPTY_CONTRACT_TEXT CONDITIONAL definition"));

    const reordered = frozen();
    [reordered.status_definitions[0], reordered.status_definitions[1]] =
      [reordered.status_definitions[1], reordered.status_definitions[0]];
    assert.ok(codes(validateCapabilityMatrix(reordered)).includes("STATUS_DEFINITION_ORDER_BROKEN"));

    const driftedOrdinal = frozen();
    driftedOrdinal.status_definitions[3].ordinal = 1;
    assert.ok(has(validateCapabilityMatrix(driftedOrdinal), "STATUS_DEFINITION_ORDINAL_MISMATCH BEST_EFFORT"));

    const repeated = frozen();
    repeated.status_definitions[3] = clone(repeated.status_definitions[2]);
    const repeatedResult = validateCapabilityMatrix(repeated);
    assert.equal(repeatedResult.ok, false);
    assert.ok(has(repeatedResult, "DUPLICATE_STATUS_DEFINITION DERIVED"), repeatedResult.errors.join("; "));
    assert.ok(has(repeatedResult, "STATUS_DEFINITION_GAP BEST_EFFORT"), repeatedResult.errors.join("; "));

    // Every status definition field is required.
    const definitionFields = Object.keys(frozen().status_definitions[2]);
    assert.ok(definitionFields.length >= 4, `status definition shape collapsed to ${definitionFields.join(",")}`);
    for (const field of definitionFields) {
      const doc = frozen();
      delete doc.status_definitions[2][field];
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `dropping status definition field ${field} was accepted`);
      assert.ok(
        has(result, `MISSING_STATUS_DEFINITION_FIELD DERIVED ${field}`) || has(result, "UNKNOWN_STATUS"),
        `${field} produced ${result.errors.join("; ") || "no error"}`
      );
    }
  });

  // Every column of the frozen table is prose the derivations read; none of it is decorative.
  test("frozen-matrix-text-is-binding", () => {
    for (const [eventGroup, sourceRow, contract, codexCapture, claudeCapture, missingEffect] of SSOT_MATRIX) {
      const tampers: [string, (doc: any) => void, string][] = [
        ["event group label", (d) => { rowOf(d, eventGroup).source_row = `${sourceRow} (revised)`; }, `SOURCE_ROW_MISMATCH ${eventGroup}`],
        ["missing effect", (d) => { rowOf(d, eventGroup).missing_effect = "nothing happens"; }, `MISSING_EFFECT_TEXT_MISMATCH ${eventGroup}`],
        ["codex capture", (d) => { cellOf(d, eventGroup, "codex").capture = `${codexCapture} or vibes`; }, `CAPTURE_TEXT_MISMATCH ${eventGroup} codex`],
        ["claude capture", (d) => { cellOf(d, eventGroup, "claude-code").capture = `${claudeCapture} or vibes`; }, `CAPTURE_TEXT_MISMATCH ${eventGroup} claude-code`]
      ];
      if (contract !== "REQUIRED") {
        tampers.push(["contract cell", (d) => { rowOf(d, eventGroup).contract = "REQUIRED"; }, `CONTRACT_TEXT_MISMATCH ${eventGroup}`]);
      } else {
        tampers.push(["contract cell", (d) => { rowOf(d, eventGroup).contract = "BEST_EFFORT"; }, `CONTRACT_TEXT_MISMATCH ${eventGroup}`]);
      }
      for (const [label, tamper, expected] of tampers) {
        const doc = frozen();
        tamper(doc);
        const result = validateCapabilityMatrix(doc);
        assert.equal(result.ok, false, `${eventGroup} accepted a rewritten ${label}`);
        assert.ok(
          has(result, expected),
          `${eventGroup} ${label} produced ${result.errors.join("; ") || "no error"} and not ${expected}`
        );
      }
    }

    const identity: [string, (doc: any) => void, string][] = [
      ["contract id", (d) => { d.contract_id = "adapter-capabilities.v9"; }, "MATRIX_CONTRACT_ID"],
      ["contract version", (d) => { d.contract_version = "adapter-capability-contract-v1"; }, "MATRIX_CONTRACT_VERSION"],
      ["source authority", (d) => { d.source_authority = "https://evil.example/not-the-ssot"; }, "MATRIX_SOURCE_AUTHORITY"],
      ["redaction clause", (d) => { d.redaction_policy.source_clause = "적당히 저장한다"; }, "REDACTION_POLICY_MISMATCH"],
      ["digest field order", (d) => { d.capability_digest_fields = [...DIGEST_FIELDS].reverse(); }, "DIGEST_FIELDS_MISMATCH"]
    ];
    for (const [label, tamper, expected] of identity) {
      const doc = frozen();
      tamper(doc);
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `accepted a tampered matrix: ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.errors.join("; ") || "no error"}`);
    }

    assert.equal(validateCapabilityMatrix(null).ok, false);
    assert.deepEqual(codes(validateCapabilityMatrix(null)), ["MATRIX_NOT_AN_OBJECT"]);
    assert.deepEqual(codes(validateCapabilityMatrix({ rows: "all of them" })), ["MATRIX_ROWS_MISSING"]);
    const notAnObject = frozen();
    notAnObject.rows[2] = "user instruction";
    assert.ok(codes(validateCapabilityMatrix(notAnObject)).includes("ROW_NOT_AN_OBJECT"));
    const cellNotAnObject = frozen();
    rowOf(cellNotAnObject, "tool_call").runtimes.codex = "app-server";
    assert.ok(has(validateCapabilityMatrix(cellNotAnObject), "CELL_NOT_AN_OBJECT tool_call codex"));
  });

  // Nothing the frozen table determines is read from the document.
  test("derived-columns-are-never-trusted", () => {
    const forgeries: [string, (doc: any) => void, string][] = [
      ["statuses", (d) => { rowOf(d, "plan_state").statuses = ["DERIVED"]; }, "STATUSES_MISMATCH plan_state"],
      ["statuses order", (d) => { rowOf(d, "plan_state").statuses = ["CONDITIONAL", "DERIVED"]; }, "STATUSES_MISMATCH plan_state"],
      ["requirement scope", (d) => { rowOf(d, "token_cost").requirement_scope = "CONDITIONAL"; }, "REQUIREMENT_SCOPE_MISMATCH token_cost"],
      ["condition metrics", (d) => { rowOf(d, "human_active_time").condition_metrics = ["M18"]; }, "CONDITION_METRICS_MISMATCH human_active_time"],
      ["condition on an unconditional row", (d) => { rowOf(d, "tool_call").condition_metrics = ["M01"]; }, "CONDITION_METRICS_MISMATCH tool_call"],
      ["affected metrics narrowed", (d) => { rowOf(d, "user_instruction").affected_metrics = ["M01"]; }, "AFFECTED_METRICS_MISMATCH user_instruction"],
      ["affected metrics widened", (d) => { rowOf(d, "evidence_claim").affected_metrics = ["M15", "M16", "M17", "M18"]; }, "AFFECTED_METRICS_MISMATCH evidence_claim"],
      ["missing effect class", (d) => { rowOf(d, "approval_safety").missing_effects = ["METRICS_BLOCKED"]; }, "MISSING_EFFECTS_MISMATCH approval_safety"],
      ["degraded substitute hidden", (d) => { rowOf(d, "token_cost").missing_effects = ["NOT_OBSERVED"]; }, "MISSING_EFFECTS_MISMATCH token_cost"],
      ["cell status", (d) => { cellOf(d, "context_selection", "codex").status = "REQUIRED"; }, "CELL_STATUS_MISMATCH context_selection codex"]
    ];
    for (const [label, tamper, expected] of forgeries) {
      const doc = frozen();
      tamper(doc);
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `accepted a forged derivation: ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.errors.join("; ") || "no error"}`);
    }

    // The derived M-id expansion is real arithmetic over the frozen prose, not a copy:
    // "M01–M04 blocked" names four metrics and "M05/M07 NOT OBSERVED" names two.
    const doc = frozen();
    assert.deepEqual(rowOf(doc, "user_instruction").affected_metrics, ["M01", "M02", "M03", "M04"]);
    assert.deepEqual(rowOf(doc, "context_selection").affected_metrics, ["M05", "M07"]);
    assert.deepEqual(rowOf(doc, "plan_state").affected_metrics, ["M12", "M13", "M14"]);
    assert.deepEqual(rowOf(doc, "run_lifecycle").affected_metrics, []);

    // A REQUIRED row whose consequence is merely NOT OBSERVED, or a conditional row whose
    // consequence blocks unconditionally, is an incoherent contract in either direction.
    const softenedRequired = frozen();
    const softened = rowOf(softenedRequired, "actor_attribution");
    softened.missing_effect = "M18/M20 NOT OBSERVED";
    softened.missing_effects = ["NOT_OBSERVED"];
    softened.affected_metrics = ["M18", "M20"];
    assert.ok(
      has(validateCapabilityMatrix(softenedRequired), "MISSING_EFFECT_INCOHERENT actor_attribution"),
      "a REQUIRED row cannot degrade to NOT OBSERVED"
    );

    // A consequence that names no effect at all leaves the row's absence undefined, at
    // every requirement level — including the unconditional one, where "not NOT OBSERVED"
    // is vacuously true for an empty effect set.
    for (const eventGroup of ["actor_attribution", "workspace_diff", "token_cost"]) {
      const silentConsequence = frozen();
      const silent = rowOf(silentConsequence, eventGroup);
      silent.missing_effect = "the report simply moves on";
      silent.missing_effects = [];
      silent.affected_metrics = [];
      assert.ok(
        has(validateCapabilityMatrix(silentConsequence), `MISSING_EFFECT_INCOHERENT ${eventGroup}`),
        `${eventGroup} with no stated consequence was admitted`
      );
    }

    const hardenedConditional = frozen();
    const hardened = rowOf(hardenedConditional, "retrieval_memory");
    hardened.missing_effect = "score blocked";
    hardened.missing_effects = ["SCORE_BLOCKED"];
    hardened.affected_metrics = [];
    assert.ok(
      has(validateCapabilityMatrix(hardenedConditional), "MISSING_EFFECT_INCOHERENT retrieval_memory"),
      "a CONDITIONAL row cannot block the score unconditionally"
    );
  });

  // Dead fields are refused at every level of the document.
  test("dead-fields-fail-closed", () => {
    const mutations: [string, (doc: any) => void, string][] = [
      ["top level", (d) => { d.learned_weights = { M01: 0.4 }; }, "MATRIX_DEAD_FIELD learned_weights"],
      ["row", (d) => { rowOf(d, "tool_call").native_support = true; }, "ROW_DEAD_FIELD tool_call native_support"],
      ["cell", (d) => { cellOf(d, "tool_call", "codex").hidden_reasoning = "kept"; }, "CELL_DEAD_FIELD tool_call codex hidden_reasoning"],
      ["status definition", (d) => { d.status_definitions[0].fallback = "assume it"; }, "STATUS_DEFINITION_DEAD_FIELD REQUIRED fallback"],
      ["runtime declaration", (d) => { runtimeOf(d, "codex").private_db = "/var/codex.db"; }, "RUNTIME_DEAD_FIELD codex private_db"]
    ];
    for (const [label, tamper, expected] of mutations) {
      const doc = frozen();
      tamper(doc);
      const result = validateCapabilityMatrix(doc);
      assert.equal(result.ok, false, `accepted a dead field at the ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.errors.join("; ") || "no error"}`);
    }

    const unknownRuntime = frozen();
    runtimeOf(unknownRuntime, "codex").runtime_id = "codex-next";
    const unknownResult = validateCapabilityMatrix(unknownRuntime);
    assert.equal(unknownResult.ok, false);
    assert.ok(has(unknownResult, "UNKNOWN_RUNTIME codex-next"), unknownResult.errors.join("; "));
    assert.ok(has(unknownResult, "RUNTIME_GAP codex"), unknownResult.errors.join("; "));

    const duplicateRuntime = frozen();
    duplicateRuntime.runtimes[1] = clone(duplicateRuntime.runtimes[0]);
    const duplicateResult = validateCapabilityMatrix(duplicateRuntime);
    assert.equal(duplicateResult.ok, false);
    assert.ok(has(duplicateResult, "DUPLICATE_RUNTIME codex"), duplicateResult.errors.join("; "));
    assert.ok(has(duplicateResult, "RUNTIME_GAP claude-code"), duplicateResult.errors.join("; "));
  });

  // The source class of every cell is frozen. Leaving PRIMARY versus SECONDARY free let a
  // cell drop protocol_or_schema_version from its invalidation set by relabelling itself.
  test("source-class-is-frozen-per-cell", () => {
    const flips: [string, string, string][] = [
      ["tool_call", "codex", "SECONDARY"],
      ["run_lifecycle", "codex", "PRIMARY"],
      ["approval_safety", "claude-code", "SECONDARY"],
      ["actor_attribution", "codex", "PRIMARY"],
      ["retrieval_memory", "claude-code", "SECONDARY"]
    ];
    for (const [eventGroup, runtimeId, wrongClass] of flips) {
      const document = frozen();
      const cell = document.rows.find((row: any) => row.event_group === eventGroup).runtimes[runtimeId];
      cell.source_class = wrongClass;
      cell.runtime_constraint =
        wrongClass === "PRIMARY"
          ? ["runtime_version", "protocol_or_schema_version", "adapter_version"]
          : ["runtime_version", "adapter_version"];
      const result = validateCapabilityMatrix(document);
      assert.equal(result.ok, false, `${eventGroup}/${runtimeId} accepted ${wrongClass}`);
      assert.ok(
        result.errors.some((entry: string) => entry.includes("SOURCE_CLASS_MISMATCH")),
        result.errors.join("; ")
      );
    }
  });
});
