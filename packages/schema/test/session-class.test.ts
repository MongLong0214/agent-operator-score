import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { classifySession, assertVerifiedEligibility } from "../src/session-class.ts";
import { validateCapabilityMatrix } from "../src/capability.ts";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../../specs/session-class.v0.json");
const matrixPath = resolve(here, "../../../specs/adapter-capabilities.v0.json");

// specs/session-class.v0.json freezes the SSOT §9.2 "Verified Assessment와 Imported Session"
// paragraph: the two session classes, the four conditions a controlled session must prove,
// the §9.5 standard-trace event contract those conditions read, and nine canonical session
// records with their expected verdicts. This test loads that frozen document and mutates
// copies of it, mirroring capability.test.ts and issuance-contract.test.ts.
const frozen = () => JSON.parse(readFileSync(contractPath, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const codes = (verdict: { blockers: string[] }) => verdict.blockers.map((entry) => entry.split(" ")[0]);
const has = (verdict: { blockers: string[] }, needle: string) =>
  verdict.blockers.some((entry) => entry.includes(needle));
const messageFor = (verdict: { blockers: string[] }, code: string) =>
  verdict.blockers.find((entry) => entry.split(" ")[0] === code);

const entryOf = (doc: any, sessionId: string) =>
  doc.canonical_sessions.find((entry: any) => entry.session.session_id === sessionId);
const sessionOf = (doc: any, sessionId: string) => entryOf(doc, sessionId).session;
const eventOf = (session: any, eventId: string) =>
  session.events.find((event: any) => event.event_id === eventId);
const gateOf = (doc: any, gateId: string) =>
  doc.requirements.find((requirement: any) => requirement.gate_id === gateId);
const classOf = (doc: any, classId: string) =>
  doc.classes.find((entry: any) => entry.class_id === classId);

// SSOT §9.2 lines 970-971. The two classes and nothing between them.
const CLASS_IDS = ["CONTROLLED_VERIFIED", "IMPORTED_DIAGNOSTIC"];
const CLASS_CLAUSES: Record<string, string> = {
  CONTROLLED_VERIFIED:
    "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
  IMPORTED_DIAGNOSTIC: "Imported Session: 기존 Codex·Claude Code 기록의 사후 분석은 DIAGNOSTIC ONLY"
};
const DIAGNOSTIC_LABEL = "DIAGNOSTIC ONLY";

// SSOT §9.2 line 973, the sentence that says why an imported session is never issued a score.
const IMPORTED_INCOMPLETENESS_CLAUSE =
  "Imported Session에는 clarification, human active time, approval, evidence invalidation, completion claim이 완전하지 않을 수 있으므로 공식 점수를 발급하지 않는다.";

// The four conditions the ticket's Minimum GREEN names, each carrying the SSOT clause it
// comes from: §9.2 line 970 (start-to-end wrapper), §9.2 line 978 (capability snapshot at
// run start), §9.5 line 1090 (the identity common field), §6.1 gate 8 (required event set).
const GATE_IDS = [
  "WRAPPER_START_END_CORRELATION",
  "CAPABILITY_SNAPSHOT",
  "RUNTIME_IDENTITY",
  "REQUIRED_EVENT_COMPLETENESS"
];
const GATE_CLAUSES: Record<string, string> = {
  WRAPPER_START_END_CORRELATION:
    "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
  CAPABILITY_SNAPSHOT: "run 시작 시 capability snapshot과 adapter digest를 저장한다.",
  RUNTIME_IDENTITY: "model·runtime·harness identity",
  REQUIRED_EVENT_COMPLETENESS: "adapter core events: REQUIRED event set 완전"
};

// An independent transcription of the SSOT §9.5 "최소 event" list (lines 1062-1082), in
// document order, each mapped onto the SSOT §9.2 event group that owns it.
const SSOT_EVENT_VOCABULARY: [string, string][] = [
  ["assessment.started", "run_lifecycle"],
  ["assessment.ended", "run_lifecycle"],
  ["adapter.capability_declared", "runtime_identity"],
  ["task.started", "run_lifecycle"],
  ["task.ended", "run_lifecycle"],
  ["user.instruction", "user_instruction"],
  ["user.clarification", "user_instruction"],
  ["context.selected", "context_selection"],
  ["context.injected", "context_selection"],
  ["context.compacted", "context_selection"],
  ["retrieval.query", "retrieval_memory"],
  ["retrieval.result", "retrieval_memory"],
  ["memory.read", "retrieval_memory"],
  ["memory.written", "retrieval_memory"],
  ["memory.invalidated", "retrieval_memory"],
  ["tool.call", "tool_call"],
  ["tool.result", "tool_call"],
  ["tool.error", "tool_call"],
  ["agent.delegated", "delegation_handoff"],
  ["agent.returned", "delegation_handoff"],
  ["handoff.created", "delegation_handoff"],
  ["handoff.consumed", "delegation_handoff"],
  ["plan.created", "plan_state"],
  ["plan.revised", "plan_state"],
  ["state.transition", "plan_state"],
  ["state.checkpoint", "plan_state"],
  ["intervention.occurred", "human_active_time"],
  ["approval.requested", "approval_safety"],
  ["approval.granted", "approval_safety"],
  ["approval.denied", "approval_safety"],
  ["evidence.created", "evidence_claim"],
  ["evidence.invalidated", "evidence_claim"],
  ["completion.claimed", "evidence_claim"],
  ["safety.event", "approval_safety"],
  ["budget.updated", "token_cost"],
  ["run.stalled", "plan_state"],
  ["run.resumed", "run_lifecycle"],
  ["run.cancelled", "run_lifecycle"]
];

// An independent transcription of the SSOT §9.5 "공통 필드" bullets, one field per bullet
// and in document order, plus the derived event_group. Every one of these is mandatory on
// every event: a controlled trace that carries task ID, parent ID, artifact digest,
// redaction state and bounded payload is conformant, not malformed.
const SSOT_EVENT_COMMON_FIELDS = [
  "event_id", "run_id", "task_id", "timestamp", "actor", "event_type", "event_group",
  "parent_id", "correlation_id", "identity", "evidence_digest", "redaction_state", "payload"
];
const REDACTION_STATES = ["none", "redacted"];
const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
const MINIMUM_OBSERVATION_MS = 1;

// SSOT §9.2 line 939.
const DIGEST_FIELDS = [
  "runtime_version",
  "protocol_or_schema_version",
  "adapter_version",
  "source_class",
  "supported_event_groups",
  "known_missing_events"
];

// SSOT §6.7 line 720; line 721 names the unknown marker separately.
const ATTRIBUTION_CLASSES = ["agent", "human/takeover", "external_mutation"];
const UNKNOWN_ATTRIBUTION = "actor.attribution_unknown";
const WRAPPER_ACTOR = "wrapper";

// SSOT §9.2 line 973, in the order the sentence lists them.
const INCOMPLETENESS_ITEMS = [
  "clarification",
  "human_active_time",
  "approval",
  "evidence_invalidation",
  "completion_claim"
];

const CANONICAL_SESSION_IDS = [
  "controlled-complete",
  "missing-start",
  "missing-end",
  "imported",
  "identity-gap",
  "snapshot-late",
  "required-event-gap",
  "attribution-unknown",
  "trailing-event"
];

const CONTROLLED_IDENTITY_ID = "codex|gpt-5.6-sol|aos-controlled-wrapper-v0";

// Which gates a verdict leaves unmet, in frozen order. `satisfied_gates` is a public
// verdict field, so this is the observable side of the blocker-to-gate table.
const unmetGates = (verdict: { satisfied_gates: string[] }) =>
  GATE_IDS.filter((gateId) => !verdict.satisfied_gates.includes(gateId));

describe("session-class", () => {
  // AC-E0B-002-1
  test("controlled-complete", () => {
    const doc = frozen();
    const entry = entryOf(doc, "controlled-complete");
    const verdict = classifySession(entry.session, doc);

    assert.deepEqual(verdict.blockers, [], "the frozen controlled session must classify with zero blockers");
    assert.equal(verdict.classification, "CONTROLLED_VERIFIED");
    assert.equal(verdict.official_score_eligible, true);
    assert.equal(verdict.diagnostic_label, null);
    assert.deepEqual(verdict.satisfied_gates, GATE_IDS);
    assert.deepEqual(verdict.imported_incompleteness, []);
    assert.equal(verdict.identity_id, CONTROLLED_IDENTITY_ID);

    // The frozen document declares exactly what the derivation produces. Because
    // classifySession recomputes every canonical verdict before it will classify anything,
    // a zero-blocker result here also proves the whole document is self-consistent.
    assert.deepEqual(entry.expected, verdict);

    // assertVerifiedEligibility is the fail-closed gate; on a verified session it returns.
    assert.deepEqual(assertVerifiedEligibility(entry.session, doc), verdict);

    // The bracket spans real time: 09:00:00.000Z to 09:06:00.000Z.
    const bracket = Date.parse(eventOf(entry.session, "e15").timestamp) -
      Date.parse(eventOf(entry.session, "e01").timestamp);
    assert.ok(bracket >= MINIMUM_OBSERVATION_MS, `the verified fixture brackets ${bracket}ms`);

    // Exhaustive over the frozen SSOT surfaces the derivation reads.
    assert.deepEqual(
      doc.event_vocabulary.map((row: any) => [row.event_type, row.event_group]),
      SSOT_EVENT_VOCABULARY
    );
    assert.equal(doc.event_vocabulary.length, 38);
    assert.deepEqual(doc.event_common_fields, SSOT_EVENT_COMMON_FIELDS);
    assert.deepEqual(doc.redaction_states, REDACTION_STATES);
    assert.equal(doc.bounded_payload_max_chars, BOUNDED_PAYLOAD_MAX_CHARS);
    assert.equal(doc.minimum_observation_ms, MINIMUM_OBSERVATION_MS);
    assert.deepEqual(doc.capability_digest_fields, DIGEST_FIELDS);
    assert.deepEqual(doc.attribution_classes, ATTRIBUTION_CLASSES);
    assert.equal(doc.unknown_attribution_marker, UNKNOWN_ATTRIBUTION);
    assert.equal(doc.wrapper_actor, WRAPPER_ACTOR);
    assert.equal(doc.imported_incompleteness_clause, IMPORTED_INCOMPLETENESS_CLAUSE);
    assert.deepEqual(
      doc.imported_incompleteness_items.map((item: any) => item.item_id),
      INCOMPLETENESS_ITEMS
    );
    assert.deepEqual(doc.classes.map((entry: any) => entry.class_id), CLASS_IDS);
    assert.deepEqual(doc.requirements.map((entry: any) => entry.gate_id), GATE_IDS);
    assert.deepEqual(
      doc.canonical_sessions.map((entry: any) => entry.session.session_id),
      CANONICAL_SESSION_IDS
    );

    // Cross-contract binding. E0B-001 recorded that the unconditionally REQUIRED event set
    // matched the issuance contract's "by construction, not by a cross-file assertion".
    // Here it is asserted: this contract's required set is the set capability.ts derives
    // from the SSOT §9.2 계약 column, so the two cannot drift apart silently.
    const matrix = validateCapabilityMatrix(JSON.parse(readFileSync(matrixPath, "utf8")));
    assert.deepEqual(matrix.errors, []);
    assert.deepEqual(doc.required_event_groups, matrix.required_event_groups);
    assert.equal(doc.required_event_groups.length, 7);
    assert.equal(doc.required_event_groups.includes("human_active_time"), false);

    // Every group named by the vocabulary is a real SSOT §9.2 event group.
    const matrixGroups = matrix.rows.map((row: any) => row.event_group);
    for (const [eventType, eventGroup] of SSOT_EVENT_VOCABULARY) {
      assert.ok(matrixGroups.includes(eventGroup), `${eventType} names ${eventGroup}`);
    }
  });

  // AC-E0B-002-2
  test("missing-start", () => {
    const doc = frozen();
    const entry = entryOf(doc, "missing-start");
    const verdict = classifySession(entry.session, doc);

    assert.equal(verdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.equal(verdict.official_score_eligible, false);
    assert.equal(verdict.diagnostic_label, DIAGNOSTIC_LABEL);
    assert.deepEqual(verdict.blockers, [
      "WRAPPER_START_MISSING the trace records no wrapper assessment.started"
    ]);
    assert.deepEqual(entry.expected, verdict);
    // The defect is the only one: the wrapper condition is the sole unmet gate.
    assert.deepEqual(unmetGates(verdict), ["WRAPPER_START_END_CORRELATION"]);

    // The fixture is not vacuous: restoring the dropped start event verifies the session.
    const repaired = clone(entry.session);
    repaired.events.unshift(clone(eventOf(sessionOf(doc, "controlled-complete"), "e01")));
    const repairedVerdict = classifySession(repaired, doc);
    assert.deepEqual(repairedVerdict.blockers, []);
    assert.equal(repairedVerdict.classification, "CONTROLLED_VERIFIED");

    // Every route to a half-open bracket fails closed, not only a deleted event.
    const forgedActor = clone(sessionOf(doc, "controlled-complete"));
    eventOf(forgedActor, "e01").actor = "agent";
    const forgedResult = classifySession(forgedActor, doc);
    assert.equal(forgedResult.classification, "IMPORTED_DIAGNOSTIC");
    assert.equal(
      messageFor(forgedResult, "WRAPPER_BRACKET_ACTOR_MISMATCH"),
      "WRAPPER_BRACKET_ACTOR_MISMATCH e01 does not declare the wrapper actor"
    );

    // A duplicated bracket half is reported with the type and the count, in both halves.
    const twoStarts = clone(sessionOf(doc, "controlled-complete"));
    twoStarts.events.splice(1, 0, { ...clone(eventOf(twoStarts, "e01")), event_id: "e01b" });
    assert.equal(
      messageFor(classifySession(twoStarts, doc), "WRAPPER_BRACKET_DUPLICATE"),
      "WRAPPER_BRACKET_DUPLICATE assessment.started appears 2 times"
    );
    const twoEnds = clone(sessionOf(doc, "controlled-complete"));
    twoEnds.events.push({ ...clone(eventOf(twoEnds, "e15")), event_id: "e15b" });
    assert.equal(
      messageFor(classifySession(twoEnds, doc), "WRAPPER_BRACKET_DUPLICATE"),
      "WRAPPER_BRACKET_DUPLICATE assessment.ended appears 2 times"
    );
    const threeEnds = clone(sessionOf(doc, "controlled-complete"));
    threeEnds.events.push({ ...clone(eventOf(threeEnds, "e15")), event_id: "e15b" });
    threeEnds.events.push({ ...clone(eventOf(threeEnds, "e15")), event_id: "e15c" });
    assert.equal(
      messageFor(classifySession(threeEnds, doc), "WRAPPER_BRACKET_DUPLICATE"),
      "WRAPPER_BRACKET_DUPLICATE assessment.ended appears 3 times"
    );

    // A duplicated start is not silently resolved to whichever copy happens to be first:
    // with no single start the bracket does not exist, so no containment claim is made.
    const lateDuplicate = clone(sessionOf(doc, "controlled-complete"));
    lateDuplicate.events.unshift({
      ...clone(eventOf(lateDuplicate, "e01")),
      event_id: "e00b",
      timestamp: "2026-08-08T09:03:30.000Z"
    });
    assert.deepEqual(classifySession(lateDuplicate, doc).blockers, [
      "WRAPPER_BRACKET_DUPLICATE assessment.started appears 2 times"
    ]);

    const uncorrelated = clone(sessionOf(doc, "controlled-complete"));
    eventOf(uncorrelated, "e15").correlation_id = "corr-somewhere-else";
    const uncorrelatedResult = classifySession(uncorrelated, doc);
    assert.ok(has(uncorrelatedResult, "WRAPPER_BRACKET_UNCORRELATED"), uncorrelatedResult.blockers.join("; "));

    const strayRun = clone(sessionOf(doc, "controlled-complete"));
    eventOf(strayRun, "e08").run_id = "run-codex-9999";
    assert.equal(
      messageFor(classifySession(strayRun, doc), "RUN_ID_MISMATCH"),
      "RUN_ID_MISMATCH e08 reports run-codex-9999"
    );

    const strayCorrelation = clone(sessionOf(doc, "controlled-complete"));
    eventOf(strayCorrelation, "e08").correlation_id = "corr-codex-9999";
    assert.equal(
      messageFor(classifySession(strayCorrelation, doc), "CORRELATION_GAP"),
      "CORRELATION_GAP e08 is outside the wrapper run correlation"
    );

    const forgedWrapper = clone(sessionOf(doc, "controlled-complete"));
    eventOf(forgedWrapper, "e08").actor = WRAPPER_ACTOR;
    assert.equal(
      messageFor(classifySession(forgedWrapper, doc), "WRAPPER_ACTOR_MISUSED"),
      "WRAPPER_ACTOR_MISUSED e08 declares the wrapper actor"
    );
  });

  // AC-E0B-002-3
  test("missing-end", () => {
    const doc = frozen();
    const entry = entryOf(doc, "missing-end");
    const verdict = classifySession(entry.session, doc);

    assert.equal(verdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.deepEqual(verdict.blockers, [
      "WRAPPER_END_MISSING the trace records no wrapper assessment.ended"
    ]);
    assert.deepEqual(entry.expected, verdict);
    assert.deepEqual(unmetGates(verdict), ["WRAPPER_START_END_CORRELATION"]);

    const repaired = clone(entry.session);
    repaired.events.push(clone(eventOf(sessionOf(doc, "controlled-complete"), "e15")));
    assert.deepEqual(classifySession(repaired, doc).blockers, []);

    // "시작부터 종료까지 감싼" is containment, not merely the presence of two markers. A
    // trace whose activity continues after the wrapper closed was not wrapped end to end.
    const trailing = entryOf(doc, "trailing-event");
    const trailingVerdict = classifySession(trailing.session, doc);
    assert.equal(trailingVerdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.deepEqual(trailingVerdict.blockers, [
      "WRAPPER_BRACKET_NOT_CONTAINING e16 lies outside the wrapper assessment bracket"
    ]);
    assert.deepEqual(trailing.expected, trailingVerdict);
    assert.deepEqual(unmetGates(trailingVerdict), ["WRAPPER_START_END_CORRELATION"]);
    const trimmed = clone(trailing.session);
    trimmed.events = trimmed.events.filter((event: any) => event.event_id !== "e16");
    assert.deepEqual(classifySession(trimmed, doc).blockers, []);

    // The same containment check catches an event that predates the wrapper start.
    const preceding = clone(sessionOf(doc, "controlled-complete"));
    preceding.events.unshift({
      ...clone(eventOf(preceding, "e08")),
      event_id: "e00",
      timestamp: "2026-08-08T08:59:00.000Z"
    });
    assert.equal(
      messageFor(classifySession(preceding, doc), "WRAPPER_BRACKET_NOT_CONTAINING"),
      "WRAPPER_BRACKET_NOT_CONTAINING e00 lies outside the wrapper assessment bracket"
    );

    // An inverted bracket is diagnosed as an inverted bracket and nothing else: the
    // containment claim is withheld rather than reported against a bracket that runs
    // backwards, which would bury the real defect under thirteen derived ones.
    const inverted = clone(sessionOf(doc, "controlled-complete"));
    const start = eventOf(inverted, "e01");
    const end = eventOf(inverted, "e15");
    [start.timestamp, end.timestamp] = [end.timestamp, start.timestamp];
    assert.deepEqual(classifySession(inverted, doc).blockers, [
      "WRAPPER_BRACKET_INVERTED assessment.ended precedes assessment.started"
    ]);
  });

  // AC-E0B-002-4
  test("imported", () => {
    const doc = frozen();
    const entry = entryOf(doc, "imported");
    const verdict = classifySession(entry.session, doc);

    assert.equal(verdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.equal(verdict.official_score_eligible, false);
    assert.equal(verdict.diagnostic_label, DIAGNOSTIC_LABEL);
    assert.equal(verdict.identity_id, null);
    assert.deepEqual(verdict.satisfied_gates, []);
    assert.deepEqual(entry.expected, verdict);

    // A post-hoc Codex or Claude Code record has no wrapper bracket, no capability
    // snapshot taken at run start, and no recorded identity, so it fails every gate.
    assert.deepEqual(codes(verdict), [
      "WRAPPER_START_MISSING",
      "WRAPPER_END_MISSING",
      "CAPABILITY_SNAPSHOT_MISSING",
      "CAPABILITY_SNAPSHOT_NOT_STORED",
      "IDENTITY_NOT_DECLARED",
      "REQUIRED_EVENT_GROUP_GAP",
      "REQUIRED_EVENT_GROUP_GAP",
      "REQUIRED_EVENT_GROUP_GAP"
    ]);
    for (const group of ["runtime_identity", "evidence_claim", "approval_safety"]) {
      assert.equal(
        messageFor(verdict, "REQUIRED_EVENT_GROUP_GAP") !== undefined &&
          has(verdict, `REQUIRED_EVENT_GROUP_GAP ${group} is absent from the trace`),
        true,
        verdict.blockers.join("; ")
      );
    }
    assert.equal(
      messageFor(verdict, "CAPABILITY_SNAPSHOT_MISSING"),
      "CAPABILITY_SNAPSHOT_MISSING the trace records no adapter.capability_declared event"
    );

    // SSOT §9.2 line 973, reported rather than guessed at: exactly which of the five
    // lifecycle items the sentence names are absent from this record.
    assert.deepEqual(verdict.imported_incompleteness, INCOMPLETENESS_ITEMS);

    // It is the evidence that classifies the session, never a declared label: the
    // imported record cannot be promoted by adding fields, only by carrying the proof.
    assert.equal(Object.hasOwn(entry.session, "classification"), false);
    const relabelled: any = clone(entry.session);
    relabelled.classification = "CONTROLLED_VERIFIED";
    const relabelledVerdict = classifySession(relabelled, doc);
    assert.equal(relabelledVerdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.ok(has(relabelledVerdict, "SESSION_DEAD_FIELD classification"), relabelledVerdict.blockers.join("; "));

    // The capability snapshot gate is separable, and is not satisfied by a stored object
    // alone: SSOT §9.2 requires it recorded at run start.
    const late = entryOf(doc, "snapshot-late");
    const lateVerdict = classifySession(late.session, doc);
    assert.equal(lateVerdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.deepEqual(lateVerdict.blockers, [
      "CAPABILITY_SNAPSHOT_LATE e03 precedes the capability snapshot",
      "CAPABILITY_SNAPSHOT_LATE e04 precedes the capability snapshot",
      "CAPABILITY_SNAPSHOT_LATE e05 precedes the capability snapshot"
    ]);
    assert.deepEqual(late.expected, lateVerdict);
    assert.deepEqual(unmetGates(lateVerdict), ["CAPABILITY_SNAPSHOT"]);

    // "run 시작 시" is strict precedence, and the boundary is checked in both directions.
    // An event sharing the snapshot's instant was not preceded by it: the snapshot then
    // describes an adapter that was already doing the work it claims to describe.
    const snapshotAt = Date.parse(eventOf(sessionOf(doc, "controlled-complete"), "e02").timestamp);
    const relativeToSnapshot = (offsetMs: number) => {
      const session = clone(sessionOf(doc, "controlled-complete"));
      eventOf(session, "e03").timestamp = new Date(snapshotAt + offsetMs).toISOString();
      return codes(classifySession(session, doc));
    };
    for (const offset of [-1000, -1, 0]) {
      assert.deepEqual(
        relativeToSnapshot(offset),
        ["CAPABILITY_SNAPSHOT_LATE"],
        `an event ${offset}ms from the snapshot was not preceded by it`
      );
    }
    for (const offset of [1, 1000]) {
      assert.deepEqual(
        relativeToSnapshot(offset),
        [],
        `an event ${offset}ms after the snapshot was preceded by it`
      );
    }

    const unstored = clone(sessionOf(doc, "controlled-complete"));
    unstored.capability_snapshot = null;
    assert.equal(
      messageFor(classifySession(unstored, doc), "CAPABILITY_SNAPSHOT_NOT_STORED"),
      "CAPABILITY_SNAPSHOT_NOT_STORED the run stored no capability snapshot"
    );

    // The stored snapshot must carry exactly the six SSOT §9.2 digest fields.
    for (const field of DIGEST_FIELDS) {
      const thinned = clone(sessionOf(doc, "controlled-complete"));
      delete thinned.capability_snapshot[field];
      assert.equal(
        messageFor(classifySession(thinned, doc), "CAPABILITY_DIGEST_FIELDS_MISMATCH"),
        `CAPABILITY_DIGEST_FIELDS_MISMATCH the stored snapshot must carry exactly ${DIGEST_FIELDS.join(",")}`,
        `dropping ${field} from the snapshot was accepted`
      );
    }
    const padded = clone(sessionOf(doc, "controlled-complete"));
    padded.capability_snapshot.hidden_reasoning = "kept";
    assert.ok(has(classifySession(padded, doc), "CAPABILITY_DIGEST_FIELDS_MISMATCH"));

    const unsigned = clone(sessionOf(doc, "controlled-complete"));
    eventOf(unsigned, "e02").actor = "agent";
    assert.equal(
      messageFor(classifySession(unsigned, doc), "CAPABILITY_SNAPSHOT_ACTOR_MISMATCH"),
      "CAPABILITY_SNAPSHOT_ACTOR_MISMATCH e02 does not declare the wrapper actor"
    );

    const twice = clone(sessionOf(doc, "controlled-complete"));
    twice.events.splice(2, 0, { ...clone(eventOf(twice, "e02")), event_id: "e02b" });
    assert.equal(
      messageFor(classifySession(twice, doc), "CAPABILITY_SNAPSHOT_DUPLICATE"),
      "CAPABILITY_SNAPSHOT_DUPLICATE adapter.capability_declared appears 2 times"
    );

    // With no single snapshot there is no instant to measure precedence against, so the
    // lateness claim is withheld rather than asserted against whichever copy came first.
    const twiceLate = clone(sessionOf(doc, "snapshot-late"));
    twiceLate.events.splice(5, 0, { ...clone(eventOf(twiceLate, "e02")), event_id: "e02b" });
    assert.deepEqual(classifySession(twiceLate, doc).blockers, [
      "CAPABILITY_SNAPSHOT_DUPLICATE adapter.capability_declared appears 2 times"
    ]);
  });

  // AC-E0B-002-5
  test("identity-gap", () => {
    const doc = frozen();
    const entry = entryOf(doc, "identity-gap");
    const verdict = classifySession(entry.session, doc);

    assert.equal(verdict.classification, "IMPORTED_DIAGNOSTIC");
    assert.deepEqual(verdict.blockers, [
      "IDENTITY_MISMATCH e08 reports codex|gpt-5.6-thinking|aos-controlled-wrapper-v0"
    ]);
    assert.deepEqual(entry.expected, verdict);
    assert.deepEqual(unmetGates(verdict), ["RUNTIME_IDENTITY"]);

    // Not vacuous: this session is complete in every other respect, so the identity
    // mismatch alone is what withholds Verified.
    const repaired = clone(entry.session);
    eventOf(repaired, "e08").identity = CONTROLLED_IDENTITY_ID;
    assert.deepEqual(classifySession(repaired, doc).blockers, []);

    // The identity id is derived from the declared triple, never read from the record.
    assert.equal(verdict.identity_id, CONTROLLED_IDENTITY_ID);
    const renamed = clone(sessionOf(doc, "controlled-complete"));
    renamed.identity.model = "gpt-5.6-thinking";
    const renamedVerdict = classifySession(renamed, doc);
    assert.equal(renamedVerdict.identity_id, "codex|gpt-5.6-thinking|aos-controlled-wrapper-v0");
    // and every event is now the one that disagrees, not the session
    assert.equal(codes(renamedVerdict).filter((code) => code === "IDENTITY_MISMATCH").length, 15);

    for (const field of ["runtime", "model", "harness"]) {
      const thinned = clone(sessionOf(doc, "controlled-complete"));
      delete thinned.identity[field];
      assert.equal(
        messageFor(classifySession(thinned, doc), "IDENTITY_INCOMPLETE"),
        `IDENTITY_INCOMPLETE ${field} is missing from the session identity`,
        `dropping identity.${field} was accepted`
      );
      const blank = clone(sessionOf(doc, "controlled-complete"));
      blank.identity[field] = "   ";
      assert.ok(has(classifySession(blank, doc), `IDENTITY_INCOMPLETE ${field}`));
    }

    // "filled" means one character, not two: a terse harness name is a harness name.
    const terse = clone(sessionOf(doc, "controlled-complete"));
    terse.identity.harness = "w";
    const terseVerdict = classifySession(terse, doc);
    assert.equal(codes(terseVerdict).includes("IDENTITY_INCOMPLETE"), false, terseVerdict.blockers.join("; "));
    assert.equal(terseVerdict.identity_id, "codex|gpt-5.6-sol|w");

    const extra = clone(sessionOf(doc, "controlled-complete"));
    extra.identity.temperature = "0.2";
    assert.equal(
      messageFor(classifySession(extra, doc), "IDENTITY_DEAD_FIELD"),
      "IDENTITY_DEAD_FIELD temperature is not part of the session identity"
    );

    // FR-01 and SSOT §9.2: the runtime must be one the adapter contract knows, and the
    // session's declared runtime must be the one its identity reports.
    const alien = clone(sessionOf(doc, "controlled-complete"));
    alien.runtime_id = "gemini-cli";
    assert.equal(
      messageFor(classifySession(alien, doc), "UNKNOWN_RUNTIME"),
      "UNKNOWN_RUNTIME gemini-cli is outside the frozen SSOT 9.2 runtime set"
    );

    const crossed = clone(sessionOf(doc, "controlled-complete"));
    crossed.runtime_id = "claude-code";
    assert.equal(
      messageFor(classifySession(crossed, doc), "IDENTITY_RUNTIME_MISMATCH"),
      "IDENTITY_RUNTIME_MISMATCH the session declares claude-code and its identity reports codex"
    );

    // An incomplete identity yields no identity id at all, so the session is reported as
    // missing its identity once and not as fifteen events disagreeing with a half-built id.
    const partial = clone(sessionOf(doc, "controlled-complete"));
    delete partial.identity.model;
    const partialVerdict = classifySession(partial, doc);
    assert.equal(partialVerdict.identity_id, null);
    assert.equal(codes(partialVerdict).includes("IDENTITY_MISMATCH"), false, partialVerdict.blockers.join("; "));

    const undeclared = clone(sessionOf(doc, "controlled-complete"));
    undeclared.identity = null;
    const undeclaredVerdict = classifySession(undeclared, doc);
    assert.equal(
      messageFor(undeclaredVerdict, "IDENTITY_NOT_DECLARED"),
      "IDENTITY_NOT_DECLARED the session records no runtime, model and harness identity"
    );
    assert.equal(undeclaredVerdict.identity_id, null);
    // A session with no identity is not also reported as 15 separate mismatches.
    assert.equal(codes(undeclaredVerdict).includes("IDENTITY_MISMATCH"), false);
  });

  // The honest limit of this contract, exercised rather than asserted in prose. A party
  // able to author a trace can author a conforming controlled record, because every field
  // that would distinguish a capture from a reconstruction is a field the author writes.
  // This test performs the promotion the adversarial review demonstrated and asserts that
  // it SUCCEEDS. It is not a bug being tolerated: it is the boundary of what a schema over
  // trace content can decide, recorded so that no reader mistakes CONTROLLED_VERIFIED for
  // evidence that a run was observed. Closing it needs a trust root the SSOT does not
  // define; that is escalated to the owning ADR/PRD, not approximated here.
  test("controlled-verified-is-a-claim-not-a-proof", () => {
    const doc = frozen();
    const controlled = sessionOf(doc, "controlled-complete");

    const promoted: any = clone(sessionOf(doc, "imported"));
    assert.equal(classifySession(promoted, doc).classification, "IMPORTED_DIAGNOSTIC");
    const promotedIdentity = "claude-code|claude-opus-4-6|aos-controlled-wrapper-v0";
    promoted.identity = { runtime: "claude-code", model: "claude-opus-4-6", harness: "aos-controlled-wrapper-v0" };
    promoted.capability_snapshot = clone(controlled.capability_snapshot);
    for (const event of promoted.events) event.identity = promotedIdentity;
    const synthetic = (eventId: string, eventType: string, group: string, at: string, actor: string) => ({
      event_id: eventId,
      run_id: promoted.run_id,
      task_id: null,
      timestamp: at,
      actor,
      event_type: eventType,
      event_group: group,
      parent_id: null,
      correlation_id: "corr-claude-import-0007",
      identity: promotedIdentity,
      evidence_digest: null,
      redaction_state: "none",
      payload: null
    });
    promoted.events = [
      synthetic("f01", "assessment.started", "run_lifecycle", "2026-07-30T13:59:00.000Z", WRAPPER_ACTOR),
      synthetic("f02", "adapter.capability_declared", "runtime_identity", "2026-07-30T13:59:01.000Z", WRAPPER_ACTOR),
      ...promoted.events,
      synthetic("f03", "approval.granted", "approval_safety", "2026-07-30T14:21:00.000Z", "human/takeover"),
      synthetic("f04", "evidence.created", "evidence_claim", "2026-07-30T14:22:00.000Z", "agent"),
      synthetic("f05", "assessment.ended", "run_lifecycle", "2026-07-30T14:23:00.000Z", WRAPPER_ACTOR)
    ];

    // Five synthetic events, an identity triple and a snapshot promote a reconstruction.
    const promotedVerdict = classifySession(promoted, doc);
    assert.equal(promotedVerdict.classification, "CONTROLLED_VERIFIED");
    assert.equal(promotedVerdict.official_score_eligible, true);
    assert.deepEqual(promotedVerdict.blockers, []);
    assert.deepEqual(promotedVerdict.satisfied_gates, GATE_IDS);
    // And the fail-closed issuer gate lets it through, which is the consequence that
    // matters: this schema is not the thing standing between a reconstruction and a P0.
    assert.equal(assertVerifiedEligibility(promoted, doc).classification, "CONTROLLED_VERIFIED");

    // The one thing the record cannot do is say so directly. Every field the verdict is
    // built from is derived, so the gap is in what a trace can attest, not in what this
    // module chooses to believe about a declared verdict.
    for (const [field, value] of [
      ["classification", "CONTROLLED_VERIFIED"],
      ["official_score_eligible", true],
      ["diagnostic_label", null],
      ["verified", true]
    ] as [string, unknown][]) {
      const declared: any = clone(promoted);
      declared[field] = value;
      assert.ok(
        has(classifySession(declared, doc), `SESSION_DEAD_FIELD ${field}`),
        `a session may not declare ${field}`
      );
    }

    // What the schema does catch is every incompleteness in the claim. Removing any one
    // part of what was added puts the record back in IMPORTED_DIAGNOSTIC, so the gates are
    // load-bearing against a partial capture even though they are not proof of capture.
    for (const [label, spoil] of [
      ["the start event", (session: any) => { session.events = session.events.filter((e: any) => e.event_id !== "f01"); }],
      ["the end event", (session: any) => { session.events = session.events.filter((e: any) => e.event_id !== "f05"); }],
      ["the capability snapshot event", (session: any) => { session.events = session.events.filter((e: any) => e.event_id !== "f02"); }],
      ["the stored snapshot", (session: any) => { session.capability_snapshot = null; }],
      ["the identity triple", (session: any) => { session.identity = null; }],
      ["the approval event", (session: any) => { session.events = session.events.filter((e: any) => e.event_id !== "f03"); }],
      ["the evidence event", (session: any) => { session.events = session.events.filter((e: any) => e.event_id !== "f04"); }]
    ] as [string, (session: any) => void][]) {
      const spoiled = clone(promoted);
      spoil(spoiled);
      assert.equal(
        classifySession(spoiled, doc).classification,
        "IMPORTED_DIAGNOSTIC",
        `${label} was not load-bearing`
      );
    }

    // The module says all of this in its own words, and the frozen document does not
    // claim more than the module can do. Nothing here promises attestation.
    const moduleText = readFileSync(resolve(here, "../src/session-class.ts"), "utf8");
    assert.match(moduleText, /This is a claim schema over trace content\. It is not a proof of observation/);
    assert.match(moduleText, /a party able to author a trace can author a record this module classifies/i);
    assert.match(moduleText, /SSOT v1\.0 requires none of it/);
    const contractText = readFileSync(contractPath, "utf8");
    for (const forbidden of ["signature", "attestation", "public_key", "ed25519"]) {
      assert.equal(
        contractText.toLowerCase().includes(forbidden),
        false,
        `the frozen contract claims ${forbidden}, which SSOT v1.0 does not define and this module does not check`
      );
    }
  });

  // SSOT §9.2 admits a session the wrapper watched from start to end. A bracket of zero
  // duration is not an observation; it is one clock reading applied to a whole run.
  test("bracket-must-span-a-positive-duration", () => {
    const doc = frozen();
    const controlled = sessionOf(doc, "controlled-complete");
    const startAt = Date.parse(eventOf(controlled, "e01").timestamp);
    const stamp = (offsetMs: number) => new Date(startAt + offsetMs).toISOString();

    // Collapse the whole trace onto the start instant, then re-open the bracket by
    // exactly the minimum observation. Below it the record is refused; at it, it passes.
    const collapsed = (endOffsetMs: number) => {
      const session = clone(controlled);
      for (const event of session.events) event.timestamp = stamp(0);
      eventOf(session, "e02").timestamp = stamp(0);
      for (const event of session.events) {
        if (!["e01", "e02", "e15"].includes(event.event_id)) event.timestamp = stamp(1);
      }
      eventOf(session, "e15").timestamp = stamp(endOffsetMs);
      return classifySession(session, doc);
    };
    assert.deepEqual(codes(collapsed(0)).slice(0, 1), ["WRAPPER_BRACKET_ZERO_DURATION"]);
    assert.equal(
      messageFor(collapsed(0), "WRAPPER_BRACKET_ZERO_DURATION"),
      `WRAPPER_BRACKET_ZERO_DURATION the bracket opens and closes at ${stamp(0)}`
    );
    assert.equal(codes(collapsed(MINIMUM_OBSERVATION_MS)).includes("WRAPPER_BRACKET_ZERO_DURATION"), false);
    assert.equal(codes(collapsed(1000)).includes("WRAPPER_BRACKET_ZERO_DURATION"), false);
    // One millisecond is the whole of the difference: the bracket at the minimum carries
    // no defect the bracket at 1000ms does not also carry.
    assert.deepEqual(codes(collapsed(MINIMUM_OBSERVATION_MS)), codes(collapsed(1000)));
    assert.deepEqual(codes(collapsed(MINIMUM_OBSERVATION_MS)), []);

    // The zero-duration guard is a claim about the bracket, not about the events inside
    // it: a genuine bracket that contains simultaneous events is untouched.
    const simultaneous = clone(controlled);
    eventOf(simultaneous, "e09").timestamp = eventOf(simultaneous, "e08").timestamp;
    assert.deepEqual(classifySession(simultaneous, doc).blockers, []);

    // An inverted bracket is reported as inverted and not also as zero duration.
    const inverted = clone(controlled);
    const first = eventOf(inverted, "e01");
    const last = eventOf(inverted, "e15");
    [first.timestamp, last.timestamp] = [last.timestamp, first.timestamp];
    assert.equal(codes(classifySession(inverted, doc)).includes("WRAPPER_BRACKET_ZERO_DURATION"), false);

    // The frozen document declares the same minimum this module applies.
    const tampered = frozen();
    tampered.minimum_observation_ms = 0;
    assert.ok(
      has(classifySession(controlled, tampered), `CONTRACT_MINIMUM_OBSERVATION_MISMATCH expected ${MINIMUM_OBSERVATION_MS}`),
      "the minimum observation is not pinned"
    );
  });

  // SSOT §9.5 "공통 필드" is the event contract. A controlled trace that carries every
  // field the SSOT mandates must classify, not be rejected as malformed.
  test("event-contract-is-the-ssot-9.5-common-field-set", () => {
    const doc = frozen();
    const controlled = sessionOf(doc, "controlled-complete");

    // Every §9.5 bullet is present on every event of the verified fixture, in the frozen
    // order, and nothing else is.
    for (const event of controlled.events) {
      assert.deepEqual(Object.keys(event), SSOT_EVENT_COMMON_FIELDS, event.event_id);
    }
    assert.deepEqual(doc.event_common_fields, SSOT_EVENT_COMMON_FIELDS);
    // The five fields an earlier revision of this contract refused outright.
    for (const field of ["task_id", "parent_id", "evidence_digest", "redaction_state", "payload"]) {
      assert.ok(SSOT_EVENT_COMMON_FIELDS.includes(field), `${field} is mandated by SSOT 9.5`);
    }
    assert.equal(classifySession(controlled, doc).classification, "CONTROLLED_VERIFIED");

    // Each is mandatory: the contract does not accept a trace that omits a §9.5 field.
    for (const field of SSOT_EVENT_COMMON_FIELDS) {
      const session = clone(controlled);
      delete eventOf(session, "e09")[field];
      const label = field === "event_id" ? "#8" : "e09";
      assert.equal(
        messageFor(classifySession(session, doc), "EVENT_MISSING_FIELD"),
        `EVENT_MISSING_FIELD ${label} ${field} is required by the trace event contract`,
        `dropping ${field} was accepted`
      );
    }

    // task id, parent id and evidence digest name something outside the event, so each is
    // a non-empty string or an explicit null, never an empty string standing in for one.
    for (const field of ["task_id", "parent_id", "evidence_digest"]) {
      const blank = clone(controlled);
      eventOf(blank, "e09")[field] = "   ";
      assert.equal(
        messageFor(classifySession(blank, doc), "EVENT_FIELD_INVALID"),
        `EVENT_FIELD_INVALID e09 ${field} must be a non-empty string or null`
      );
      const nulled = clone(controlled);
      eventOf(nulled, "e09")[field] = null;
      assert.equal(codes(classifySession(nulled, doc)).includes("EVENT_FIELD_INVALID"), false, field);
    }

    // Redaction state is a frozen two-value vocabulary, and both values are accepted.
    for (const state of REDACTION_STATES) {
      const session = clone(controlled);
      eventOf(session, "e09").redaction_state = state;
      assert.equal(codes(classifySession(session, doc)).includes("EVENT_REDACTION_STATE_INVALID"), false, state);
    }
    const invented = clone(controlled);
    eventOf(invented, "e09").redaction_state = "partially";
    assert.equal(
      messageFor(classifySession(invented, doc), "EVENT_REDACTION_STATE_INVALID"),
      "EVENT_REDACTION_STATE_INVALID e09 partially is outside the frozen redaction states"
    );
    const tamperedStates = frozen();
    tamperedStates.redaction_states = [...REDACTION_STATES, "partially"];
    assert.ok(
      has(classifySession(controlled, tamperedStates), "CONTRACT_REDACTION_STATES_MISMATCH"),
      "the redaction vocabulary is not pinned"
    );

    // "bounded payload" is bounded: the frozen bound is exact in both directions.
    const withPayload = (length: number) => {
      const session = clone(controlled);
      eventOf(session, "e09").payload = "x".repeat(length);
      return classifySession(session, doc);
    };
    assert.equal(codes(withPayload(BOUNDED_PAYLOAD_MAX_CHARS)).includes("EVENT_PAYLOAD_UNBOUNDED"), false);
    assert.equal(
      messageFor(withPayload(BOUNDED_PAYLOAD_MAX_CHARS + 1), "EVENT_PAYLOAD_UNBOUNDED"),
      `EVENT_PAYLOAD_UNBOUNDED e09 carries ${BOUNDED_PAYLOAD_MAX_CHARS + 1} characters and the bound is ${BOUNDED_PAYLOAD_MAX_CHARS}`
    );
    const structured = clone(controlled);
    eventOf(structured, "e09").payload = { transcript: ["everything"] };
    assert.equal(
      messageFor(classifySession(structured, doc), "EVENT_PAYLOAD_INVALID"),
      "EVENT_PAYLOAD_INVALID e09 a bounded payload is a string or null"
    );
    const tamperedBound = frozen();
    tamperedBound.bounded_payload_max_chars = BOUNDED_PAYLOAD_MAX_CHARS + 1;
    assert.ok(
      has(classifySession(controlled, tamperedBound), `CONTRACT_PAYLOAD_BOUND_MISMATCH expected ${BOUNDED_PAYLOAD_MAX_CHARS}`),
      "the payload bound is not pinned"
    );
    const tamperedFields = frozen();
    tamperedFields.event_common_fields = SSOT_EVENT_COMMON_FIELDS.slice(0, 8);
    assert.ok(
      has(classifySession(controlled, tamperedFields), "CONTRACT_EVENT_COMMON_FIELDS_MISMATCH"),
      "the SSOT 9.5 common field list is not pinned"
    );

    // §9.6: hidden chain-of-thought is not stored, so a field invented to carry it is dead.
    const hidden = clone(controlled);
    eventOf(hidden, "e09").hidden_reasoning = "the model was thinking about";
    assert.equal(
      messageFor(classifySession(hidden, doc), "EVENT_DEAD_FIELD"),
      "EVENT_DEAD_FIELD e09 hidden_reasoning is not part of the trace event contract"
    );
  });

  // `satisfied_gates` is a public verdict field, so every row of the blocker-to-gate table
  // is pinned here: re-pointing any one row changes an observable answer below.
  test("every-blocker-is-pinned-to-its-gate", () => {
    const doc = frozen();
    const from = (sessionId: string, tamper?: (session: any) => void) => {
      const session = clone(sessionOf(doc, sessionId));
      tamper?.(session);
      return classifySession(session, doc);
    };
    const G1 = "WRAPPER_START_END_CORRELATION";
    const G2 = "CAPABILITY_SNAPSHOT";
    const G3 = "RUNTIME_IDENTITY";
    const G4 = "REQUIRED_EVENT_COMPLETENESS";

    // Each row states the exact gates the verdict then reports unmet, so re-pointing any
    // single row of the table moves an observable answer here.
    const rows: [string, string[], () => { blockers: string[]; satisfied_gates: string[] }][] = [
      ["WRAPPER_START_MISSING", [G1], () => from("missing-start")],
      ["WRAPPER_END_MISSING", [G1], () => from("missing-end")],
      ["WRAPPER_BRACKET_DUPLICATE", [G1], () => from("controlled-complete", (session) => {
        session.events.push({ ...clone(eventOf(session, "e15")), event_id: "e15b" });
      })],
      ["WRAPPER_BRACKET_ACTOR_MISMATCH", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e01").actor = "agent";
      })],
      ["WRAPPER_ACTOR_MISUSED", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e08").actor = WRAPPER_ACTOR;
      })],
      ["WRAPPER_BRACKET_INVERTED", [G1], () => from("controlled-complete", (session) => {
        const first = eventOf(session, "e01");
        const last = eventOf(session, "e15");
        [first.timestamp, last.timestamp] = [last.timestamp, first.timestamp];
      })],
      ["WRAPPER_BRACKET_ZERO_DURATION", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e15").timestamp = eventOf(session, "e01").timestamp;
      })],
      ["WRAPPER_BRACKET_UNCORRELATED", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e15").correlation_id = "corr-somewhere-else";
      })],
      ["RUN_ID_MISMATCH", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e08").run_id = "run-codex-9999";
      })],
      ["CORRELATION_GAP", [G1], () => from("controlled-complete", (session) => {
        eventOf(session, "e08").correlation_id = "corr-codex-9999";
      })],
      ["WRAPPER_BRACKET_NOT_CONTAINING", [G1], () => from("trailing-event")],
      // Dropping the snapshot event also drops the only runtime_identity event, so this
      // row is expected to implicate gate 4 as well; re-pointing it still moves the set.
      ["CAPABILITY_SNAPSHOT_MISSING", [G2, G4], () => from("controlled-complete", (session) => {
        session.events = session.events.filter((event: any) => event.event_id !== "e02");
      })],
      ["CAPABILITY_SNAPSHOT_DUPLICATE", [G2], () => from("controlled-complete", (session) => {
        session.events.splice(2, 0, { ...clone(eventOf(session, "e02")), event_id: "e02b" });
      })],
      ["CAPABILITY_SNAPSHOT_ACTOR_MISMATCH", [G2], () => from("controlled-complete", (session) => {
        eventOf(session, "e02").actor = "agent";
      })],
      ["CAPABILITY_SNAPSHOT_LATE", [G2], () => from("snapshot-late")],
      ["CAPABILITY_SNAPSHOT_NOT_STORED", [G2], () => from("controlled-complete", (session) => {
        session.capability_snapshot = null;
      })],
      ["CAPABILITY_DIGEST_FIELDS_MISMATCH", [G2], () => from("controlled-complete", (session) => {
        delete session.capability_snapshot.source_class;
      })],
      ["IDENTITY_NOT_DECLARED", [G3], () => from("controlled-complete", (session) => {
        session.identity = null;
      })],
      ["IDENTITY_INCOMPLETE", [G3], () => from("controlled-complete", (session) => {
        session.identity.model = "";
      })],
      ["IDENTITY_COMPONENT_DELIMITER", [G3], () => from("controlled-complete", (session) => {
        session.identity.model = "gpt-5.6|sol";
      })],
      ["IDENTITY_DEAD_FIELD", [G3], () => from("controlled-complete", (session) => {
        session.identity.temperature = "0.2";
      })],
      ["UNKNOWN_RUNTIME", [G3], () => from("controlled-complete", (session) => {
        session.runtime_id = "gemini-cli";
      })],
      ["IDENTITY_RUNTIME_MISMATCH", [G3], () => from("controlled-complete", (session) => {
        session.runtime_id = "claude-code";
      })],
      ["IDENTITY_MISMATCH", [G3], () => from("identity-gap")],
      ["REQUIRED_EVENT_GROUP_GAP", [G4], () => from("required-event-gap")],
      ["ATTRIBUTION_UNKNOWN", [G4], () => from("attribution-unknown")]
    ];

    assert.equal(rows.length, 26, "the blocker-to-gate table lost or gained a row");
    assert.equal(new Set(rows.map(([code]) => code)).size, rows.length, "a blocker code is pinned twice");
    for (const [code, expected, run] of rows) {
      const verdict = run();
      assert.ok(codes(verdict).includes(code), `${code} did not occur: ${verdict.blockers.join("; ") || "none"}`);
      assert.deepEqual(unmetGates(verdict), expected, `${code} implicates the wrong gate`);
      // Nothing outside the expected gates is reported unmet, and the codes seen all
      // belong to one of them, so the row cannot be pinned by an unrelated blocker.
      for (const seen of codes(verdict)) {
        assert.ok(rows.some(([known]) => known === seen), `${seen} is not in the blocker-to-gate table`);
      }
    }
  });

  // The four gates are separable, and the fixture set proves each one alone.
  test("canonical-fixtures-exercise-every-gate", () => {
    const doc = frozen();
    const soleGateOf = (sessionId: string) => {
      const unmet = unmetGates(classifySession(sessionOf(doc, sessionId), doc));
      assert.equal(unmet.length, 1, `${sessionId} implicates ${unmet.join(",") || "no gate"}`);
      return unmet[0];
    };
    assert.equal(soleGateOf("missing-start"), "WRAPPER_START_END_CORRELATION");
    assert.equal(soleGateOf("missing-end"), "WRAPPER_START_END_CORRELATION");
    assert.equal(soleGateOf("trailing-event"), "WRAPPER_START_END_CORRELATION");
    assert.equal(soleGateOf("snapshot-late"), "CAPABILITY_SNAPSHOT");
    assert.equal(soleGateOf("identity-gap"), "RUNTIME_IDENTITY");
    assert.equal(soleGateOf("required-event-gap"), "REQUIRED_EVENT_COMPLETENESS");
    assert.equal(soleGateOf("attribution-unknown"), "REQUIRED_EVENT_COMPLETENESS");

    // The contract refuses to classify anything against a fixture set that stops proving
    // a gate, so a deleted or weakened fixture cannot pass unnoticed.
    for (const [sessionId, gateId] of [
      ["missing-start", "WRAPPER_START_END_CORRELATION"],
      ["snapshot-late", "CAPABILITY_SNAPSHOT"],
      ["identity-gap", "RUNTIME_IDENTITY"],
      ["required-event-gap", "REQUIRED_EVENT_COMPLETENESS"]
    ] as [string, string][]) {
      const thinned = frozen();
      thinned.canonical_sessions = thinned.canonical_sessions.filter(
        (entry: any) => entry.session.session_id !== sessionId
      );
      const result = classifySession(sessionOf(doc, "controlled-complete"), thinned);
      assert.ok(
        has(result, "CONTRACT_CANONICAL_SESSION_GAP") || has(result, `CONTRACT_GATE_UNEXERCISED ${gateId}`),
        result.blockers.join("; ")
      );
    }
    // Dropping the one verified fixture removes the proof that any session can pass.
    const noVerified = frozen();
    noVerified.canonical_sessions = noVerified.canonical_sessions.filter(
      (entry: any) => entry.session.session_id !== "controlled-complete"
    );
    assert.ok(
      has(classifySession(sessionOf(doc, "imported"), noVerified),
        "no canonical session proves that a controlled session can be verified"),
      "a fixture set with nothing verified was accepted"
    );

    // A fixture that keeps its place but stops isolating its condition is the subtler
    // decay, and it is caught too: identity-gap given a second, unrelated defect leaves
    // RUNTIME_IDENTITY proven by nothing, even with its expected verdict recomputed.
    const blurred = frozen();
    const blurredEntry = entryOf(blurred, "identity-gap");
    blurredEntry.session.events = blurredEntry.session.events.filter(
      (event: any) => !["e06", "e07"].includes(event.event_id)
    );
    blurredEntry.expected = classifySession(blurredEntry.session, frozen());
    const blurredResult = classifySession(sessionOf(doc, "controlled-complete"), blurred);
    assert.equal(has(blurredResult, "CONTRACT_SESSION_VERDICT_MISMATCH"), false, blurredResult.blockers.join("; "));
    assert.ok(has(blurredResult, "CONTRACT_GATE_UNEXERCISED RUNTIME_IDENTITY"), blurredResult.blockers.join("; "));

    // A required-event gap is not the same failure as an unknown attribution, and both
    // are real: SSOT §9.2 says an unknown actor withholds the score.
    const gapVerdict = classifySession(sessionOf(doc, "required-event-gap"), doc);
    assert.deepEqual(gapVerdict.blockers, [
      "REQUIRED_EVENT_GROUP_GAP approval_safety is absent from the trace"
    ]);
    assert.deepEqual(entryOf(doc, "required-event-gap").expected, gapVerdict);
    assert.deepEqual(gapVerdict.imported_incompleteness, ["approval"]);

    const unknownVerdict = classifySession(sessionOf(doc, "attribution-unknown"), doc);
    assert.deepEqual(unknownVerdict.blockers, [
      "ATTRIBUTION_UNKNOWN e09 records actor.attribution_unknown"
    ]);
    assert.deepEqual(entryOf(doc, "attribution-unknown").expected, unknownVerdict);

    // Each of the seven REQUIRED groups is load-bearing on its own.
    for (const group of doc.required_event_groups) {
      const stripped = clone(sessionOf(doc, "controlled-complete"));
      if (group === "actor_attribution") {
        for (const event of stripped.events) {
          if (event.actor !== WRAPPER_ACTOR) event.actor = WRAPPER_ACTOR;
        }
      } else {
        const types = SSOT_EVENT_VOCABULARY.filter(([, owner]) => owner === group).map(([type]) => type);
        stripped.events = stripped.events.filter((event: any) => !types.includes(event.event_type));
      }
      const result = classifySession(stripped, doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `${group} was optional`);
      assert.ok(has(result, `REQUIRED_EVENT_GROUP_GAP ${group} is absent from the trace`), `${group}: ${result.blockers.join("; ")}`);
    }

    // A conditional group is not required: dropping every human_active_time event, which
    // SSOT §9.2 marks conditional, leaves the session verified.
    const withoutConditional = clone(sessionOf(doc, "controlled-complete"));
    withoutConditional.events = withoutConditional.events.filter(
      (event: any) => event.event_type !== "intervention.occurred"
    );
    const conditionalVerdict = classifySession(withoutConditional, doc);
    assert.deepEqual(conditionalVerdict.blockers, []);
    assert.deepEqual(conditionalVerdict.imported_incompleteness, ["human_active_time"]);
    assert.ok(conditionalVerdict.satisfied_gates.includes("REQUIRED_EVENT_COMPLETENESS"));
  });

  // The identity id is a join, so the join character may not hide inside a component.
  test("identity-id-is-injective", () => {
    const doc = frozen();
    const withIdentity = (identity: Record<string, string>) => {
      const session = clone(sessionOf(doc, "controlled-complete"));
      session.identity = identity;
      return classifySession(session, doc);
    };
    // Two different triples that a naive join would collapse into one id.
    const left = withIdentity({ runtime: "codex", model: "gpt-5|turbo", harness: "wrap" });
    const right = withIdentity({ runtime: "codex", model: "gpt-5", harness: "turbo|wrap" });
    assert.equal(left.identity_id, null);
    assert.equal(right.identity_id, null);
    for (const [label, verdict, field] of [["left", left, "model"], ["right", right, "harness"]] as
      [string, typeof left, string][]) {
      assert.equal(
        messageFor(verdict, "IDENTITY_COMPONENT_DELIMITER"),
        `IDENTITY_COMPONENT_DELIMITER ${field} contains the | the identity id joins on`,
        label
      );
      assert.equal(verdict.classification, "IMPORTED_DIAGNOSTIC");
    }
    // And the runtime component is checked too, not only the two the id joins after it.
    const runtime = withIdentity({ runtime: "co|dex", model: "gpt-5", harness: "wrap" });
    assert.ok(has(runtime, "IDENTITY_COMPONENT_DELIMITER runtime"), runtime.blockers.join("; "));

    // A component free of the delimiter still produces the id it always did, and distinct
    // triples still produce distinct ids.
    assert.equal(
      withIdentity({ runtime: "codex", model: "gpt-5", harness: "wrap" }).identity_id,
      "codex|gpt-5|wrap"
    );
    assert.notEqual(
      withIdentity({ runtime: "codex", model: "gpt-5", harness: "wrap" }).identity_id,
      withIdentity({ runtime: "codex", model: "gpt-5", harness: "wrap2" }).identity_id
    );
  });

  // SSOT §9.5 says nothing about the order of the events array; the timestamps carry the
  // ordering. A serialization convention may not decide eligibility, and it may not mask
  // a real gate blocker either.
  test("array-order-is-not-an-invariant", () => {
    const doc = frozen();
    const shuffled = clone(sessionOf(doc, "controlled-complete"));
    [shuffled.events[7], shuffled.events[8]] = [shuffled.events[8], shuffled.events[7]];
    const shuffledVerdict = classifySession(shuffled, doc);
    assert.deepEqual(shuffledVerdict.blockers, [], "re-serializing the array changed the verdict");
    assert.equal(shuffledVerdict.classification, "CONTROLLED_VERIFIED");

    const reversed = clone(sessionOf(doc, "controlled-complete"));
    reversed.events = [...reversed.events].reverse();
    assert.deepEqual(classifySession(reversed, doc).blockers, []);

    // A genuinely inverted bracket is diagnosed as one, and loses exactly the gate it
    // belongs to, rather than being reported as an array-ordering defect that costs all
    // four. The two cases are told apart by the timestamps, which is where the SSOT put
    // the ordering.
    const inverted = clone(sessionOf(doc, "controlled-complete"));
    const first = eventOf(inverted, "e01");
    const last = eventOf(inverted, "e15");
    [first.timestamp, last.timestamp] = [last.timestamp, first.timestamp];
    const invertedVerdict = classifySession(inverted, doc);
    assert.deepEqual(codes(invertedVerdict), ["WRAPPER_BRACKET_INVERTED"]);
    assert.deepEqual(unmetGates(invertedVerdict), ["WRAPPER_START_END_CORRELATION"]);
    assert.deepEqual(invertedVerdict.satisfied_gates, [
      "CAPABILITY_SNAPSHOT", "RUNTIME_IDENTITY", "REQUIRED_EVENT_COMPLETENESS"
    ]);
  });

  // Nothing the frozen contract determines is read from the document or the session.
  test("derived-fields-are-never-trusted", () => {
    const doc = frozen();

    // The event group of every event is derived from its type through the frozen §9.5
    // vocabulary. Relabelling an event cannot manufacture a REQUIRED group.
    const relabelled = clone(sessionOf(doc, "required-event-gap"));
    eventOf(relabelled, "e08").event_group = "approval_safety";
    const relabelledVerdict = classifySession(relabelled, doc);
    assert.equal(messageFor(relabelledVerdict, "EVENT_GROUP_MISMATCH"), "EVENT_GROUP_MISMATCH e08 derives tool_call");
    assert.equal(relabelledVerdict.classification, "IMPORTED_DIAGNOSTIC");

    const invented = clone(sessionOf(doc, "controlled-complete"));
    eventOf(invented, "e08").event_type = "tool.vibes";
    assert.equal(
      messageFor(classifySession(invented, doc), "UNKNOWN_EVENT_TYPE"),
      "UNKNOWN_EVENT_TYPE e08 tool.vibes is outside the frozen SSOT 9.5 event vocabulary"
    );

    const strangeActor = clone(sessionOf(doc, "controlled-complete"));
    eventOf(strangeActor, "e08").actor = "the intern";
    assert.equal(
      messageFor(classifySession(strangeActor, doc), "UNKNOWN_ACTOR"),
      "UNKNOWN_ACTOR e08 the intern is outside the frozen actor set"
    );

    // The document's own declared verdicts are recomputed, never believed. A document
    // that calls a partial trace verified is rejected, and takes every other
    // classification down with it rather than answering from a broken contract.
    const forgedClass = frozen();
    entryOf(forgedClass, "missing-start").expected.classification = "CONTROLLED_VERIFIED";
    const forgedResult = classifySession(sessionOf(doc, "controlled-complete"), forgedClass);
    assert.equal(forgedResult.classification, "IMPORTED_DIAGNOSTIC");
    assert.equal(
      messageFor(forgedResult, "CONTRACT_SESSION_VERDICT_MISMATCH"),
      "CONTRACT_SESSION_VERDICT_MISMATCH missing-start derives IMPORTED_DIAGNOSTIC with WRAPPER_START_MISSING"
    );

    const forgedEligibility = frozen();
    entryOf(forgedEligibility, "imported").expected.official_score_eligible = true;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedEligibility), "CONTRACT_SESSION_VERDICT_MISMATCH imported")
    );

    const forgedBlockers = frozen();
    entryOf(forgedBlockers, "imported").expected.blockers = [];
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedBlockers), "CONTRACT_SESSION_VERDICT_MISMATCH imported")
    );

    const forgedIncompleteness = frozen();
    entryOf(forgedIncompleteness, "imported").expected.imported_incompleteness = [];
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedIncompleteness), "CONTRACT_SESSION_VERDICT_MISMATCH imported")
    );

    const forgedGates = frozen();
    entryOf(forgedGates, "identity-gap").expected.satisfied_gates = GATE_IDS;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedGates), "CONTRACT_SESSION_VERDICT_MISMATCH identity-gap")
    );

    const forgedIdentity = frozen();
    entryOf(forgedIdentity, "imported").expected.identity_id = CONTROLLED_IDENTITY_ID;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedIdentity), "CONTRACT_SESSION_VERDICT_MISMATCH imported")
    );

    const forgedLabelExpectation = frozen();
    entryOf(forgedLabelExpectation, "imported").expected.diagnostic_label = null;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedLabelExpectation), "CONTRACT_SESSION_VERDICT_MISMATCH imported")
    );

    // A canonical session that derives no blocker at all is still reported by name.
    const forgedVerified = frozen();
    entryOf(forgedVerified, "controlled-complete").expected.classification = "IMPORTED_DIAGNOSTIC";
    assert.equal(
      messageFor(classifySession(sessionOf(doc, "controlled-complete"), forgedVerified), "CONTRACT_SESSION_VERDICT_MISMATCH"),
      "CONTRACT_SESSION_VERDICT_MISMATCH controlled-complete derives CONTROLLED_VERIFIED with no blocker"
    );

    // The declared verdict must be complete before it can be compared at all.
    for (const field of [
      "classification", "official_score_eligible", "diagnostic_label", "identity_id",
      "blockers", "satisfied_gates", "imported_incompleteness"
    ]) {
      const thinnedExpected = frozen();
      delete entryOf(thinnedExpected, "imported").expected[field];
      assert.ok(
        has(classifySession(sessionOf(doc, "controlled-complete"), thinnedExpected), `CONTRACT_EXPECTED_MISSING_FIELD imported ${field}`),
        `expected.${field} may not be omitted`
      );
    }

    // The two class rows are derivations too: only the controlled class may declare that
    // an official score can be issued, and only the imported class carries the label.
    const forgedClassRow = frozen();
    classOf(forgedClassRow, "IMPORTED_DIAGNOSTIC").official_score_eligible = true;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedClassRow), "CONTRACT_CLASS_ELIGIBILITY_MISMATCH IMPORTED_DIAGNOSTIC")
    );
    const forgedLabel = frozen();
    classOf(forgedLabel, "CONTROLLED_VERIFIED").diagnostic_label = DIAGNOSTIC_LABEL;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), forgedLabel), "CONTRACT_CLASS_LABEL_MISMATCH CONTROLLED_VERIFIED")
    );
    const droppedLabel = frozen();
    classOf(droppedLabel, "IMPORTED_DIAGNOSTIC").diagnostic_label = null;
    assert.ok(
      has(classifySession(sessionOf(doc, "controlled-complete"), droppedLabel), "CONTRACT_CLASS_LABEL_MISMATCH IMPORTED_DIAGNOSTIC")
    );
  });

  // Every clause the derivation depends on is pinned; none of it is decorative prose.
  test("frozen-contract-text-is-binding", () => {
    const identity: [string, (doc: any) => void, string][] = [
      ["contract id", (d) => { d.contract_id = "session-class.v9"; }, "CONTRACT_ID"],
      ["contract version", (d) => { d.contract_version = "session-class-contract-v1"; }, "CONTRACT_VERSION"],
      ["source authority", (d) => { d.source_authority = "https://evil.example/not-the-ssot"; }, "CONTRACT_SOURCE_AUTHORITY"],
      ["incompleteness clause", (d) => { d.imported_incompleteness_clause = "대충 넘어간다"; }, "CONTRACT_INCOMPLETENESS_CLAUSE_MISMATCH"],
      ["digest fields", (d) => { d.capability_digest_fields = DIGEST_FIELDS.slice(0, 5); }, "CONTRACT_DIGEST_FIELDS_MISMATCH"],
      ["digest field order", (d) => { d.capability_digest_fields = [...DIGEST_FIELDS].reverse(); }, "CONTRACT_DIGEST_FIELDS_MISMATCH"],
      ["attribution classes", (d) => { d.attribution_classes = [...ATTRIBUTION_CLASSES, "vibes"]; }, "CONTRACT_ATTRIBUTION_CLASSES_MISMATCH"],
      ["unknown marker", (d) => { d.unknown_attribution_marker = "dunno"; }, "CONTRACT_UNKNOWN_ATTRIBUTION_MISMATCH"],
      ["wrapper actor", (d) => { d.wrapper_actor = "anyone"; }, "CONTRACT_WRAPPER_ACTOR_MISMATCH"],
      ["event common fields", (d) => { d.event_common_fields = [...SSOT_EVENT_COMMON_FIELDS].reverse(); }, "CONTRACT_EVENT_COMMON_FIELDS_MISMATCH"],
      ["redaction states", (d) => { d.redaction_states = ["none"]; }, "CONTRACT_REDACTION_STATES_MISMATCH"],
      ["payload bound", (d) => { d.bounded_payload_max_chars = 1_000_000; }, "CONTRACT_PAYLOAD_BOUND_MISMATCH"],
      ["minimum observation", (d) => { d.minimum_observation_ms = 60_000; }, "CONTRACT_MINIMUM_OBSERVATION_MISMATCH"],
      ["required groups", (d) => { d.required_event_groups = [...d.required_event_groups, "token_cost"]; }, "CONTRACT_REQUIRED_GROUPS_MISMATCH"],
      ["required group order", (d) => { d.required_event_groups = [...d.required_event_groups].reverse(); }, "CONTRACT_REQUIRED_GROUPS_MISMATCH"],
      ["required group dropped", (d) => { d.required_event_groups = d.required_event_groups.filter((g: string) => g !== "actor_attribution"); }, "CONTRACT_REQUIRED_GROUPS_MISMATCH"],
      ["incompleteness items", (d) => { d.imported_incompleteness_items.pop(); }, "CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH"],
      ["incompleteness event types", (d) => { d.imported_incompleteness_items[0].event_types = ["user.instruction"]; }, "CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH"],
      ["incompleteness row not an object", (d) => { d.imported_incompleteness_items[2] = "approval"; }, "CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH approval is not an object"],
      ["vocabulary row not an object", (d) => { d.event_vocabulary[3] = "task.started"; }, "CONTRACT_EVENT_VOCABULARY_MISMATCH row 4 is not an object"],
      ["vocabulary grown", (d) => { d.event_vocabulary.push({ event_type: "vibes.emitted", event_group: "tool_call" }); }, "CONTRACT_EVENT_VOCABULARY_MISMATCH vibes.emitted is outside the frozen SSOT 9.5 vocabulary"],
      ["canonical session order", (d) => { [d.canonical_sessions[1], d.canonical_sessions[2]] = [d.canonical_sessions[2], d.canonical_sessions[1]]; }, "CONTRACT_CANONICAL_SESSION_ORDER_BROKEN"]
    ];
    for (const [label, tamper, expected] of identity) {
      const doc = frozen();
      tamper(doc);
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `accepted a tampered contract: ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.blockers.join("; ") || "no blocker"}`);
    }

    // The two SSOT class clauses and the four gate clauses are quoted verbatim.
    for (const classId of CLASS_IDS) {
      const doc = frozen();
      classOf(doc, classId).source_clause = `${CLASS_CLAUSES[classId]} (요약)`;
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), doc), `CONTRACT_CLASS_CLAUSE_MISMATCH ${classId}`),
        `${classId} clause is not pinned`
      );
      assert.equal(classOf(frozen(), classId).source_clause, CLASS_CLAUSES[classId]);
    }
    for (const gateId of GATE_IDS) {
      const clauseTamper = frozen();
      gateOf(clauseTamper, gateId).source_clause = "적당히 확인한다";
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), clauseTamper), `CONTRACT_GATE_CLAUSE_MISMATCH ${gateId}`),
        `${gateId} clause is not pinned`
      );
      assert.equal(gateOf(frozen(), gateId).source_clause, GATE_CLAUSES[gateId]);

      const predicateTamper = frozen();
      gateOf(predicateTamper, gateId).predicate = "anything goes";
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), predicateTamper), `CONTRACT_GATE_PREDICATE_MISMATCH ${gateId}`),
        `${gateId} predicate is not pinned`
      );
    }

    // The predicates say what the code does, including the four properties an earlier
    // revision claimed and did not have.
    const predicateOf = (gateId: string) => gateOf(frozen(), gateId).predicate;
    assert.match(predicateOf("WRAPPER_START_END_CORRELATION"), /declare the wrapper actor/);
    assert.match(predicateOf("WRAPPER_START_END_CORRELATION"), /span at least one millisecond/);
    assert.match(predicateOf("CAPABILITY_SNAPSHOT"), /strictly precedes every non-bracket event/);
    // No predicate promises verification, attestation or a signature.
    for (const gateId of GATE_IDS) {
      assert.doesNotMatch(predicateOf(gateId), /attest|signature|verifies under|key/i, gateId);
    }
    assert.match(predicateOf("RUNTIME_IDENTITY"), /no component containing the identity delimiter/);

    // Each of the 38 SSOT §9.5 event types is pinned to the group that owns it.
    for (const [index, [eventType, eventGroup]] of SSOT_EVENT_VOCABULARY.entries()) {
      const doc = frozen();
      doc.event_vocabulary[index].event_group = eventGroup === "tool_call" ? "plan_state" : "tool_call";
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), doc), `CONTRACT_EVENT_GROUP_MISMATCH ${eventType}`),
        `${eventType} group is not pinned`
      );
      const renamed = frozen();
      renamed.event_vocabulary[index].event_type = `${eventType}.v2`;
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), renamed), `CONTRACT_EVENT_VOCABULARY_MISMATCH position ${index + 1} must read ${eventType}`),
        `${eventType} is not pinned`
      );
    }
    const shortened = frozen();
    shortened.event_vocabulary.pop();
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), shortened), "CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38 found 37")
    );

    // Ordinals and ordering of both frozen tables.
    const classOrdinal = frozen();
    classOf(classOrdinal, "IMPORTED_DIAGNOSTIC").ordinal = 1;
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), classOrdinal), "CONTRACT_CLASS_ORDINAL_MISMATCH IMPORTED_DIAGNOSTIC")
    );
    const classOrder = frozen();
    [classOrder.classes[0], classOrder.classes[1]] = [classOrder.classes[1], classOrder.classes[0]];
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), classOrder), "CONTRACT_CLASS_ORDER_BROKEN")
    );
    const gateOrdinal = frozen();
    gateOf(gateOrdinal, "RUNTIME_IDENTITY").ordinal = 1;
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), gateOrdinal), "CONTRACT_GATE_ORDINAL_MISMATCH RUNTIME_IDENTITY")
    );
    const gateOrder = frozen();
    [gateOrder.requirements[0], gateOrder.requirements[1]] = [gateOrder.requirements[1], gateOrder.requirements[0]];
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), gateOrder), "CONTRACT_GATE_ORDER_BROKEN")
    );

    // Exhaustiveness of both frozen tables in both directions.
    for (const classId of CLASS_IDS) {
      const dropped = frozen();
      dropped.classes = dropped.classes.filter((entry: any) => entry.class_id !== classId);
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), dropped);
      assert.ok(has(result, `CONTRACT_CLASS_GAP ${classId}`), result.blockers.join("; "));
      assert.ok(has(result, "CONTRACT_CLASS_COUNT_NOT_2 found 1"), result.blockers.join("; "));
    }
    for (const gateId of GATE_IDS) {
      const dropped = frozen();
      dropped.requirements = dropped.requirements.filter((entry: any) => entry.gate_id !== gateId);
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), dropped);
      assert.ok(has(result, `CONTRACT_GATE_GAP ${gateId}`), result.blockers.join("; "));
      assert.ok(has(result, "CONTRACT_GATE_COUNT_NOT_4 found 3"), result.blockers.join("; "));
    }
    const unknownClass = frozen();
    unknownClass.classes[1].class_id = "PROBABLY_FINE";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), unknownClass), "CONTRACT_UNKNOWN_CLASS PROBABLY_FINE")
    );
    const unknownGate = frozen();
    unknownGate.requirements[2].gate_id = "VIBES";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), unknownGate), "CONTRACT_UNKNOWN_GATE VIBES")
    );
    const duplicateGate = frozen();
    duplicateGate.requirements[3] = clone(duplicateGate.requirements[2]);
    const duplicateResult = classifySession(sessionOf(frozen(), "controlled-complete"), duplicateGate);
    assert.ok(has(duplicateResult, "CONTRACT_DUPLICATE_GATE RUNTIME_IDENTITY"), duplicateResult.blockers.join("; "));
    const duplicateSession = frozen();
    duplicateSession.canonical_sessions[1] = clone(duplicateSession.canonical_sessions[0]);
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), duplicateSession), "CONTRACT_CANONICAL_SESSION_ORDER_BROKEN")
    );

    // `statement` and `failure_mode` are prose the derivation does not read; they are
    // checked for presence only. That is the limit of this check and it is deliberate:
    // a non-blank assertion proves the field exists, not that it says anything true.
    for (const field of ["statement", "failure_mode"]) {
      const doc = frozen();
      gateOf(doc, "CAPABILITY_SNAPSHOT")[field] = "   ";
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), doc), `CONTRACT_EMPTY_TEXT CAPABILITY_SNAPSHOT ${field}`),
        `${field} may not be blank`
      );
    }
    const blankStatement = frozen();
    classOf(blankStatement, "CONTROLLED_VERIFIED").statement = "";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), blankStatement), "CONTRACT_EMPTY_TEXT CONTROLLED_VERIFIED statement")
    );

    // Each frozen table declares complete rows, and each is a table rather than prose.
    const classFields = Object.keys(classOf(frozen(), "IMPORTED_DIAGNOSTIC"));
    assert.ok(classFields.length >= 6, `class shape collapsed to ${classFields.join(",")}`);
    for (const field of classFields) {
      const doc = frozen();
      delete classOf(doc, "IMPORTED_DIAGNOSTIC")[field];
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      const expected = field === "class_id" ? "CONTRACT_UNKNOWN_CLASS" : `CONTRACT_MISSING_CLASS_FIELD IMPORTED_DIAGNOSTIC ${field}`;
      assert.ok(has(result, expected), `${field} produced ${result.blockers.join("; ") || "no blocker"}`);
    }
    const gateFields = Object.keys(gateOf(frozen(), "RUNTIME_IDENTITY"));
    assert.ok(gateFields.length >= 6, `requirement shape collapsed to ${gateFields.join(",")}`);
    for (const field of gateFields) {
      const doc = frozen();
      delete gateOf(doc, "RUNTIME_IDENTITY")[field];
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      const expected = field === "gate_id" ? "CONTRACT_UNKNOWN_GATE" : `CONTRACT_MISSING_GATE_FIELD RUNTIME_IDENTITY ${field}`;
      assert.ok(has(result, expected), `${field} produced ${result.blockers.join("; ") || "no blocker"}`);
    }
    for (const field of ["event_type", "event_group"]) {
      const doc = frozen();
      delete doc.event_vocabulary[15][field];
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), doc), `CONTRACT_VOCABULARY_MISSING_FIELD`),
        `vocabulary ${field} may not be omitted`
      );
    }
    for (const field of ["item_id", "event_types"]) {
      const doc = frozen();
      delete doc.imported_incompleteness_items[2][field];
      assert.ok(
        has(classifySession(sessionOf(frozen(), "controlled-complete"), doc), `CONTRACT_INCOMPLETENESS_ITEM_MISSING_FIELD`),
        `incompleteness item ${field} may not be omitted`
      );
    }
    for (const field of ["session", "expected"]) {
      const doc = frozen();
      delete doc.canonical_sessions[3][field];
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      const expected = field === "session" ? "CONTRACT_CANONICAL_MISSING_FIELD #4 session" : "CONTRACT_CANONICAL_MISSING_FIELD imported expected";
      assert.ok(has(result, expected), `${field} produced ${result.blockers.join("; ") || "no blocker"}`);
    }

    const classNotAnObject = frozen();
    classNotAnObject.classes[1] = "imported";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), classNotAnObject), "CONTRACT_CLASS_NOT_AN_OBJECT")
    );
    const gateNotAnObject = frozen();
    gateNotAnObject.requirements[1] = "capability snapshot";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), gateNotAnObject), "CONTRACT_GATE_NOT_AN_OBJECT")
    );
    const duplicateClass = frozen();
    duplicateClass.classes[1] = clone(duplicateClass.classes[0]);
    const duplicateClassResult = classifySession(sessionOf(frozen(), "controlled-complete"), duplicateClass);
    assert.ok(has(duplicateClassResult, "CONTRACT_DUPLICATE_CLASS CONTROLLED_VERIFIED"), duplicateClassResult.blockers.join("; "));
    assert.ok(has(duplicateClassResult, "CONTRACT_CLASS_GAP IMPORTED_DIAGNOSTIC"), duplicateClassResult.blockers.join("; "));
    const canonicalNotAnObject = frozen();
    canonicalNotAnObject.canonical_sessions[4] = "identity-gap";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), canonicalNotAnObject), "CONTRACT_CANONICAL_MALFORMED 5")
    );
    const expectedNotAnObject = frozen();
    entryOf(expectedNotAnObject, "imported").expected = "diagnostic";
    assert.ok(
      has(classifySession(sessionOf(frozen(), "controlled-complete"), expectedNotAnObject), "CONTRACT_CANONICAL_MALFORMED imported has no expected verdict")
    );

    // Each frozen table must be a list; prose in its place is refused rather than indexed.
    for (const [field, expected] of [
      ["classes", "CONTRACT_CLASS_COUNT_NOT_2"],
      ["requirements", "CONTRACT_GATE_COUNT_NOT_4"],
      ["event_vocabulary", "CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38"],
      ["canonical_sessions", "CONTRACT_CANONICAL_SESSION_GAP"]
    ] as [string, string][]) {
      const doc = frozen();
      doc[field] = "see the SSOT";
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      assert.ok(has(result, expected), `${field} produced ${result.blockers.join("; ") || "no blocker"}`);
    }

    assert.equal(classifySession(sessionOf(frozen(), "controlled-complete"), null).classification, "IMPORTED_DIAGNOSTIC");
    assert.deepEqual(
      codes(classifySession(sessionOf(frozen(), "controlled-complete"), null)),
      ["CONTRACT_NOT_AN_OBJECT"]
    );
    assert.deepEqual(
      codes(classifySession(sessionOf(frozen(), "controlled-complete"), { contract_id: "session-class.v0" })),
      ["CONTRACT_MISSING_FIELD"]
    );
  });

  // A contract defect is reported by name and by the value that is wrong. These messages
  // are the only thing a maintainer sees when a frozen document drifts, so each one is
  // compared in full rather than by its code.
  test("contract-blockers-name-the-value-that-is-wrong", () => {
    const controlled = sessionOf(frozen(), "controlled-complete");
    const only = (tamper: (doc: any) => void) => {
      const doc = frozen();
      tamper(doc);
      return classifySession(controlled, doc).blockers;
    };

    // Every top-level field is required, and the one that is missing is named.
    for (const field of Object.keys(frozen())) {
      assert.deepEqual(
        only((doc) => { delete doc[field]; }),
        [`CONTRACT_MISSING_FIELD ${field} required by the session-class contract`],
        field
      );
    }
    assert.deepEqual(
      only((doc) => { delete doc.classes; delete doc.requirements; }),
      ["CONTRACT_MISSING_FIELD classes,requirements required by the session-class contract"]
    );

    const messages: [string, (doc: any) => void, string[]][] = [
      ["contract id", (d) => { d.contract_id = "session-class.v9"; },
        ["CONTRACT_ID expected session-class.v0"]],
      ["contract version", (d) => { d.contract_version = "session-class-contract-v1"; },
        ["CONTRACT_VERSION expected session-class-contract-v0"]],
      ["source authority", (d) => { d.source_authority = "https://evil.example/not-the-ssot"; },
        ["CONTRACT_SOURCE_AUTHORITY expected docs/north-star/agent-operator-score-ssot-v1.0.md#9.2"]],
      ["digest fields", (d) => { d.capability_digest_fields = DIGEST_FIELDS.slice(0, 5); },
        [`CONTRACT_DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`]],
      ["attribution classes", (d) => { d.attribution_classes = [...ATTRIBUTION_CLASSES, "vibes"]; },
        [`CONTRACT_ATTRIBUTION_CLASSES_MISMATCH the SSOT 6.7 attribution classes are ${ATTRIBUTION_CLASSES.join(",")}`]],
      ["unknown marker", (d) => { d.unknown_attribution_marker = "dunno"; },
        [`CONTRACT_UNKNOWN_ATTRIBUTION_MISMATCH expected ${UNKNOWN_ATTRIBUTION}`]],
      ["wrapper actor", (d) => { d.wrapper_actor = "anyone"; },
        [`CONTRACT_WRAPPER_ACTOR_MISMATCH expected ${WRAPPER_ACTOR}`]],
      ["event common fields", (d) => { d.event_common_fields = [...SSOT_EVENT_COMMON_FIELDS].reverse(); },
        [`CONTRACT_EVENT_COMMON_FIELDS_MISMATCH the SSOT 9.5 common fields are ${SSOT_EVENT_COMMON_FIELDS.join(",")}`]],
      ["redaction states", (d) => { d.redaction_states = ["none"]; },
        [`CONTRACT_REDACTION_STATES_MISMATCH the frozen redaction states are ${REDACTION_STATES.join(",")}`]],
      ["payload bound", (d) => { d.bounded_payload_max_chars = 4096; },
        [`CONTRACT_PAYLOAD_BOUND_MISMATCH expected ${BOUNDED_PAYLOAD_MAX_CHARS}`]],
      ["minimum observation", (d) => { d.minimum_observation_ms = 60_000; },
        [`CONTRACT_MINIMUM_OBSERVATION_MISMATCH expected ${MINIMUM_OBSERVATION_MS}`]],
      ["required groups", (d) => { d.required_event_groups = [...d.required_event_groups, "token_cost"]; },
        ["CONTRACT_REQUIRED_GROUPS_MISMATCH the unconditionally REQUIRED groups are run_lifecycle,runtime_identity,user_instruction,tool_call,evidence_claim,approval_safety,actor_attribution"]],
      ["incompleteness count", (d) => { d.imported_incompleteness_items.pop(); },
        ["CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH the SSOT 9.2 sentence names 5 items"]],
      ["incompleteness types", (d) => { d.imported_incompleteness_items[2].event_types = ["approval.granted"]; },
        ["CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH approval must read approval.requested,approval.granted,approval.denied"]],
      ["incompleteness field", (d) => { delete d.imported_incompleteness_items[2].item_id; },
        ["CONTRACT_INCOMPLETENESS_ITEM_MISSING_FIELD approval item_id",
          "CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH approval must read approval.requested,approval.granted,approval.denied"]],
      ["incompleteness dead field", (d) => { d.imported_incompleteness_items[0].optional = true; },
        ["CONTRACT_INCOMPLETENESS_ITEM_DEAD_FIELD clarification optional"]],
      ["class ordinal", (d) => { classOf(d, "IMPORTED_DIAGNOSTIC").ordinal = 1; },
        ["CONTRACT_CLASS_ORDINAL_MISMATCH IMPORTED_DIAGNOSTIC declares 1"]],
      ["class order", (d) => { [d.classes[0], d.classes[1]] = [d.classes[1], d.classes[0]]; },
        ["CONTRACT_CLASS_ORDER_BROKEN IMPORTED_DIAGNOSTIC sits at position 1 and not 2",
          "CONTRACT_CLASS_ORDER_BROKEN CONTROLLED_VERIFIED sits at position 2 and not 1"]],
      ["class eligibility", (d) => { classOf(d, "IMPORTED_DIAGNOSTIC").official_score_eligible = true; },
        ["CONTRACT_CLASS_ELIGIBILITY_MISMATCH IMPORTED_DIAGNOSTIC derives false"]],
      ["class label", (d) => { classOf(d, "CONTROLLED_VERIFIED").diagnostic_label = DIAGNOSTIC_LABEL; },
        ["CONTRACT_CLASS_LABEL_MISMATCH CONTROLLED_VERIFIED derives null"]],
      ["gate ordinal", (d) => { gateOf(d, "RUNTIME_IDENTITY").ordinal = 1; },
        ["CONTRACT_GATE_ORDINAL_MISMATCH RUNTIME_IDENTITY declares 1"]],
      ["gate order", (d) => { [d.requirements[0], d.requirements[1]] = [d.requirements[1], d.requirements[0]]; },
        ["CONTRACT_GATE_ORDER_BROKEN CAPABILITY_SNAPSHOT sits at position 1 and not 2",
          "CONTRACT_GATE_ORDER_BROKEN WRAPPER_START_END_CORRELATION sits at position 2 and not 1"]],
      ["gate predicate", (d) => { gateOf(d, "CAPABILITY_SNAPSHOT").predicate = "close enough"; },
        ["CONTRACT_GATE_PREDICATE_MISMATCH CAPABILITY_SNAPSHOT must read one adapter.capability_declared event declaring the wrapper actor strictly precedes every non-bracket event and the stored snapshot carries exactly the six capability digest fields"]],
      ["vocabulary missing field", (d) => { delete d.event_vocabulary[15].event_group; },
        ["CONTRACT_VOCABULARY_MISSING_FIELD tool.call event_group",
          "CONTRACT_EVENT_GROUP_MISMATCH tool.call must read tool_call"]],
      ["vocabulary group", (d) => { d.event_vocabulary[15].event_group = "plan_state"; },
        ["CONTRACT_EVENT_GROUP_MISMATCH tool.call must read tool_call"]],
      ["vocabulary renamed", (d) => { d.event_vocabulary[15].event_type = "tool.invoke"; },
        ["CONTRACT_EVENT_VOCABULARY_MISMATCH position 16 must read tool.call"]],
      ["vocabulary shortened", (d) => { d.event_vocabulary.pop(); },
        ["CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38 found 37"]],
      ["canonical order", (d) => { [d.canonical_sessions[1], d.canonical_sessions[2]] = [d.canonical_sessions[2], d.canonical_sessions[1]]; },
        ["CONTRACT_CANONICAL_SESSION_ORDER_BROKEN missing-end sits at position 2",
          "CONTRACT_CANONICAL_SESSION_ORDER_BROKEN missing-start sits at position 3"]],
      ["canonical gap", (d) => { d.canonical_sessions.pop(); },
        ["CONTRACT_CANONICAL_SESSION_GAP trailing-event is absent from the contract"]]
    ];
    for (const [label, tamper, expected] of messages) {
      assert.deepEqual(only(tamper), expected, label);
    }

    // A row the contract cannot read is reported once and skipped, never parsed anyway.
    const unreadable: [string, (doc: any) => void, string[]][] = [
      ["class row", (d) => { d.classes[1] = "imported"; },
        ["CONTRACT_CLASS_NOT_AN_OBJECT a class row is not an object",
          "CONTRACT_CLASS_GAP IMPORTED_DIAGNOSTIC is absent from the contract"]],
      ["unknown class", (d) => { d.classes[1].class_id = "PROBABLY_FINE"; },
        ["CONTRACT_UNKNOWN_CLASS PROBABLY_FINE is outside the frozen SSOT 9.2 class set",
          "CONTRACT_CLASS_GAP IMPORTED_DIAGNOSTIC is absent from the contract"]],
      ["gate row", (d) => { d.requirements[1] = "capability snapshot"; },
        ["CONTRACT_GATE_NOT_AN_OBJECT a requirement row is not an object",
          "CONTRACT_GATE_GAP CAPABILITY_SNAPSHOT is absent from the contract"]],
      ["unknown gate", (d) => { d.requirements[2].gate_id = "VIBES"; },
        ["CONTRACT_UNKNOWN_GATE VIBES is outside the frozen condition set",
          "CONTRACT_GATE_GAP RUNTIME_IDENTITY is absent from the contract"]],
      ["vocabulary row", (d) => { d.event_vocabulary[3] = "task.started"; },
        ["CONTRACT_EVENT_VOCABULARY_MISMATCH row 4 is not an object"]],
      ["vocabulary grown", (d) => { d.event_vocabulary.push({ event_type: "vibes.emitted", event_group: "tool_call" }); },
        ["CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38 found 39",
          "CONTRACT_EVENT_VOCABULARY_MISMATCH vibes.emitted is outside the frozen SSOT 9.5 vocabulary"]],
      ["incompleteness row", (d) => { d.imported_incompleteness_items[2] = "approval"; },
        ["CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH approval is not an object"]],
      ["canonical row", (d) => { d.canonical_sessions[4] = "identity-gap"; },
        ["CONTRACT_CANONICAL_MALFORMED 5 is not an object",
          "CONTRACT_CANONICAL_SESSION_GAP identity-gap is absent from the contract",
          "CONTRACT_GATE_UNEXERCISED RUNTIME_IDENTITY is not the sole unmet gate of any canonical session"]],
      ["blocker gate row", (d) => { d.blocker_gates[2] = "WRAPPER_BRACKET_DUPLICATE"; },
        ["CONTRACT_BLOCKER_GATES_MISMATCH row 3 is not an object"]]
    ];
    for (const [label, tamper, expected] of unreadable) {
      assert.deepEqual(only(tamper), expected, label);
    }

    // The blocker-to-gate table `satisfied_gates` is computed from is published in full,
    // so a reader can audit it and a document that disagrees classifies nothing.
    const blockerGates = frozen().blocker_gates;
    assert.equal(blockerGates.length, 26);
    assert.deepEqual(
      blockerGates.filter((row: any) => row.gate_id === "WRAPPER_START_END_CORRELATION").map((row: any) => row.blocker),
      [
        "WRAPPER_START_MISSING", "WRAPPER_END_MISSING", "WRAPPER_BRACKET_DUPLICATE",
        "WRAPPER_BRACKET_ACTOR_MISMATCH", "WRAPPER_ACTOR_MISUSED", "WRAPPER_BRACKET_INVERTED",
        "WRAPPER_BRACKET_ZERO_DURATION", "WRAPPER_BRACKET_UNCORRELATED", "RUN_ID_MISMATCH",
        "CORRELATION_GAP", "WRAPPER_BRACKET_NOT_CONTAINING"
      ]
    );
    for (const [index, row] of blockerGates.entries()) {
      assert.deepEqual(Object.keys(row), ["blocker", "gate_id"], row.blocker);
      assert.ok(GATE_IDS.includes(row.gate_id), `${row.blocker} names ${row.gate_id}`);
      assert.deepEqual(
        only((doc) => {
          doc.blocker_gates[index].gate_id = row.gate_id === GATE_IDS[0] ? GATE_IDS[3] : GATE_IDS[0];
        }),
        [`CONTRACT_BLOCKER_GATE_MISMATCH ${row.blocker} answers to ${row.gate_id}`],
        row.blocker
      );
      assert.deepEqual(
        only((doc) => { doc.blocker_gates[index].blocker = `${row.blocker}_V2`; }),
        [`CONTRACT_BLOCKER_GATES_MISMATCH position ${index + 1} must read ${row.blocker}`],
        row.blocker
      );
    }
    assert.deepEqual(
      only((doc) => { doc.blocker_gates.pop(); }),
      ["CONTRACT_BLOCKER_GATES_MISMATCH the contract must declare all 26 blocker-to-gate rows"]
    );
    assert.deepEqual(
      only((doc) => { doc.blocker_gates[0].note = "probably"; }),
      ["CONTRACT_BLOCKER_GATE_DEAD_FIELD WRAPPER_START_MISSING note"]
    );
  });

  // Dead fields are refused at every level of both the contract and the session record.
  test("dead-fields-fail-closed", () => {
    const contractMutations: [string, (doc: any) => void, string][] = [
      ["top level", (d) => { d.learned_threshold = 0.4; }, "CONTRACT_DEAD_FIELD learned_threshold"],
      ["class row", (d) => { classOf(d, "CONTROLLED_VERIFIED").fallback = "assume it"; }, "CONTRACT_CLASS_DEAD_FIELD CONTROLLED_VERIFIED fallback"],
      ["gate row", (d) => { gateOf(d, "RUNTIME_IDENTITY").optional = true; }, "CONTRACT_GATE_DEAD_FIELD RUNTIME_IDENTITY optional"],
      ["vocabulary row", (d) => { d.event_vocabulary[0].native = true; }, "CONTRACT_VOCABULARY_DEAD_FIELD assessment.started native"],
      ["incompleteness item", (d) => { d.imported_incompleteness_items[0].optional = true; }, "CONTRACT_INCOMPLETENESS_ITEM_DEAD_FIELD clarification optional"],
      ["canonical entry", (d) => { d.canonical_sessions[0].note = "trust me"; }, "CONTRACT_CANONICAL_DEAD_FIELD controlled-complete note"],
      ["expected verdict", (d) => { d.canonical_sessions[0].expected.score = 80; }, "CONTRACT_EXPECTED_DEAD_FIELD controlled-complete score"]
    ];
    for (const [label, tamper, expected] of contractMutations) {
      const doc = frozen();
      tamper(doc);
      const result = classifySession(sessionOf(frozen(), "controlled-complete"), doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `accepted a dead field on the ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.blockers.join("; ") || "no blocker"}`);
    }

    const doc = frozen();
    const sessionMutations: [string, (session: any) => void, string][] = [
      ["session", (s) => { s.verified = true; }, "SESSION_DEAD_FIELD verified is not part of the session contract"],
      ["event", (s) => { eventOf(s, "e08").hidden_reasoning = "kept"; }, "EVENT_DEAD_FIELD e08 hidden_reasoning is not part of the trace event contract"]
    ];
    for (const [label, tamper, expected] of sessionMutations) {
      const session = clone(sessionOf(doc, "controlled-complete"));
      tamper(session);
      const result = classifySession(session, doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `accepted a dead field on the ${label}`);
      assert.ok(has(result, expected), `${label} produced ${result.blockers.join("; ") || "no blocker"}`);
    }
  });

  // A malformed session record is classified IMPORTED_DIAGNOSTIC, never guessed at.
  test("session-shape-fails-closed", () => {
    const doc = frozen();
    assert.deepEqual(codes(classifySession(null, doc)), ["SESSION_NOT_AN_OBJECT"]);
    assert.deepEqual(codes(classifySession([], doc)), ["SESSION_NOT_AN_OBJECT"]);
    // Failing closed means failing closed on every field of the verdict, not only on the
    // class: an unreadable record is never reported as eligible for an official score.
    for (const failed of [classifySession(null, doc), classifySession(sessionOf(doc, "controlled-complete"), null)]) {
      assert.equal(failed.classification, "IMPORTED_DIAGNOSTIC");
      assert.equal(failed.official_score_eligible, false);
      assert.equal(failed.diagnostic_label, DIAGNOSTIC_LABEL);
      assert.deepEqual(failed.satisfied_gates, []);
    }

    const sessionFields = Object.keys(sessionOf(doc, "controlled-complete"));
    assert.deepEqual(sessionFields, [
      "session_id", "run_id", "runtime_id", "identity", "capability_snapshot", "events"
    ]);
    for (const field of sessionFields) {
      const session = clone(sessionOf(doc, "controlled-complete"));
      delete session[field];
      const result = classifySession(session, doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `dropping ${field} was accepted`);
      assert.ok(
        has(result, `SESSION_MISSING_FIELD ${field} is required by the session contract`),
        `${field} produced ${result.blockers.join("; ") || "no blocker"}`
      );
    }

    const eventFields = Object.keys(eventOf(sessionOf(doc, "controlled-complete"), "e08"));
    assert.equal(eventFields.length, 13, `event shape collapsed to ${eventFields.join(",")}`);
    for (const field of eventFields) {
      const session = clone(sessionOf(doc, "controlled-complete"));
      delete eventOf(session, "e08")[field];
      const result = classifySession(session, doc);
      assert.equal(result.classification, "IMPORTED_DIAGNOSTIC", `dropping event ${field} was accepted`);
      // e08 sits at index 7; an event that lost its own id is reported positionally.
      const label = field === "event_id" ? "#7" : "e08";
      assert.ok(
        has(result, `EVENT_MISSING_FIELD ${label} ${field}`),
        `${field} produced ${result.blockers.join("; ") || "no blocker"}`
      );
    }

    const noEvents = clone(sessionOf(doc, "controlled-complete"));
    noEvents.events = [];
    assert.ok(has(classifySession(noEvents, doc), "SESSION_EVENTS_EMPTY"));
    const notAList = clone(sessionOf(doc, "controlled-complete"));
    notAList.events = "all of them";
    assert.deepEqual(codes(classifySession(notAList, doc)), ["SESSION_EVENTS_INVALID"]);
    const notAnObject = clone(sessionOf(doc, "controlled-complete"));
    notAnObject.events[3] = "user said hello";
    // Reported once and skipped: an entry that is not a trace event is not read as one.
    assert.deepEqual(classifySession(notAnObject, doc).blockers, [
      "EVENT_NOT_AN_OBJECT 3 is not a trace event"
    ]);

    const repeated = clone(sessionOf(doc, "controlled-complete"));
    repeated.events[4] = { ...clone(repeated.events[3]), timestamp: repeated.events[4].timestamp };
    assert.ok(has(classifySession(repeated, doc), "DUPLICATE_EVENT_ID e04 appears more than once"));

    const badStamp = clone(sessionOf(doc, "controlled-complete"));
    eventOf(badStamp, "e08").timestamp = "yesterday afternoon";
    assert.equal(
      messageFor(classifySession(badStamp, doc), "EVENT_TIMESTAMP_INVALID"),
      "EVENT_TIMESTAMP_INVALID e08 yesterday afternoon is not an ISO-8601 UTC instant"
    );
    const localStamp = clone(sessionOf(doc, "controlled-complete"));
    eventOf(localStamp, "e08").timestamp = "2026-08-08T09:01:10";
    assert.ok(has(classifySession(localStamp, doc), "EVENT_TIMESTAMP_INVALID e08"));

    const blankId = clone(sessionOf(doc, "controlled-complete"));
    blankId.session_id = "  ";
    assert.equal(
      messageFor(classifySession(blankId, doc), "SESSION_ID_INVALID"),
      "SESSION_ID_INVALID    is not a session id"
    );
    const blankRun = clone(sessionOf(doc, "controlled-complete"));
    blankRun.run_id = "";
    assert.equal(
      messageFor(classifySession(blankRun, doc), "RUN_ID_INVALID"),
      "RUN_ID_INVALID  is not a run id"
    );

    const identityNotAnObject = clone(sessionOf(doc, "controlled-complete"));
    identityNotAnObject.identity = "codex";
    assert.ok(has(classifySession(identityNotAnObject, doc), "IDENTITY_NOT_AN_OBJECT"));
    const snapshotNotAnObject = clone(sessionOf(doc, "controlled-complete"));
    snapshotNotAnObject.capability_snapshot = "declared";
    assert.ok(has(classifySession(snapshotNotAnObject, doc), "CAPABILITY_SNAPSHOT_NOT_AN_OBJECT"));

    // A structurally broken record short-circuits: no gate is reported satisfied on a
    // session the contract could not read.
    const broken = clone(sessionOf(doc, "controlled-complete"));
    delete broken.events;
    const brokenVerdict = classifySession(broken, doc);
    // An absent events array is a missing field, not also an invalid one.
    assert.deepEqual(brokenVerdict.blockers, [
      "SESSION_MISSING_FIELD events is required by the session contract"
    ]);
    assert.deepEqual(brokenVerdict.satisfied_gates, []);
    assert.equal(brokenVerdict.identity_id, null);
    assert.deepEqual(brokenVerdict.imported_incompleteness, []);
  });

  // The gate the issuer calls. SSOT §9.2 and final decision 9: only a controlled session
  // reaches official issuance, and everything else is DIAGNOSTIC ONLY.
  test("assert-verified-eligibility-fails-closed", () => {
    const doc = frozen();
    for (const sessionId of CANONICAL_SESSION_IDS) {
      const session = sessionOf(doc, sessionId);
      if (sessionId === "controlled-complete") {
        assert.equal(assertVerifiedEligibility(session, doc).classification, "CONTROLLED_VERIFIED");
        continue;
      }
      let thrown: Error | null = null;
      try {
        assertVerifiedEligibility(session, doc);
      } catch (caught) {
        thrown = caught as Error;
      }
      assert.ok(thrown, `${sessionId} was admitted to Verified`);
      assert.match(thrown!.message, new RegExp(`^VERIFIED_INELIGIBLE ${sessionId} `));
      const reported = thrown!.message.split(" ").slice(2).join(" ");
      assert.deepEqual(reported.split(","), codes(classifySession(session, doc)));
    }

    // A broken contract never yields a verified session either.
    assert.throws(
      () => assertVerifiedEligibility(sessionOf(doc, "controlled-complete"), null),
      /^Error: VERIFIED_INELIGIBLE controlled-complete CONTRACT_NOT_AN_OBJECT$/
    );
    assert.throws(() => assertVerifiedEligibility(null, doc), /^Error: VERIFIED_INELIGIBLE <unnamed> /);
  });
});
