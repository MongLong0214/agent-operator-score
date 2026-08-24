import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  scoreHandoffIntegrity,
  scoreRetryIdempotency,
  type AdoptionRecord,
  type EffectRecord,
  type HandoffRecord
} from "../src/scorer/multi-agent-integrity.ts";
import { SCHEMA_ID, SCHEMA_VERSION, type MultiProducerEvent } from "../src/trace/multi-producer.ts";

const event = (over: Partial<MultiProducerEvent> = {}): MultiProducerEvent => ({
  schema_id: SCHEMA_ID,
  schema_version: SCHEMA_VERSION,
  event_id: "e",
  session_id: "s",
  producer_id: "p",
  producer_seq: 1,
  actor_kind: "agent",
  agent_instance_id: "a-01",
  agent_profile_id: "profile-a",
  collaboration_surface_id: null,
  workstream_id: "w1",
  task_id: null,
  event_type: "tool.call",
  event_group: "tool_call",
  parent_event_id: null,
  correlation_id: "c1",
  handoff_id: null,
  source_timestamp: null,
  observed_at: "1970-01-01T00:00:00.000Z",
  identity_digest: null,
  evidence_digest: null,
  redaction_state: "none",
  payload: null,
  ...over
});

const handoff = (over: Partial<HandoffRecord> = {}): HandoffRecord => ({
  handoff_id: "h1",
  from_instance: "a-01",
  to_instance: "b-01",
  workstream_id: "w1",
  carried: [],
  ...over
});

const kinds = (findings: readonly { kind: string }[]): string[] => findings.map((f) => f.kind).sort();

describe("M11 handoff, role and join integrity", () => {
  test("a closed handoff with its evidence present is clean", () => {
    const events = [
      event({ event_id: "e1", evidence_digest: "d1" }),
      event({ event_id: "e2", event_type: "handoff.consumed", handoff_id: "h1", agent_instance_id: "b-01" }),
      event({ event_id: "e3", evidence_digest: "d1", agent_instance_id: "b-01" })
    ];
    assert.deepEqual(scoreHandoffIntegrity(events, [handoff({ carried: ["d1"] })], []), []);
  });

  test("evidence declared but never seen again is context loss", () => {
    const events = [event({ event_id: "e1", event_type: "handoff.consumed", handoff_id: "h1", agent_instance_id: "b-01" })];
    const findings = scoreHandoffIntegrity(events, [handoff({ carried: ["d-missing"] })], []);
    assert.deepEqual(kinds(findings), ["CONTEXT_LOST_IN_HANDOFF"]);
  });

  test("a handoff nobody consumed is reported as never received, not as context loss", () => {
    // Different fixes: one means the receiver dropped something, the other means the receiver never
    // started. Reporting the second as the first sends the operator to the wrong agent.
    const findings = scoreHandoffIntegrity([event()], [handoff({ carried: ["d1"] })], []);
    assert.deepEqual(kinds(findings), ["HANDOFF_NEVER_RECEIVED"]);
  });

  test("sequential ownership through a handoff is not duplicate ownership", () => {
    // Every correct delegation has two instances on one workstream. Flagging that would make the
    // metric fire on exactly the behaviour it exists to reward.
    const events = [
      event({ event_id: "e1", agent_instance_id: "a-01" }),
      event({ event_id: "e2", event_type: "handoff.consumed", handoff_id: "h1", agent_instance_id: "b-01" }),
      event({ event_id: "e3", agent_instance_id: "b-01" })
    ];
    assert.deepEqual(scoreHandoffIntegrity(events, [handoff()], []), []);
  });

  test("two instances on one workstream with no handoff is duplicate ownership", () => {
    const events = [
      event({ event_id: "e1", agent_instance_id: "a-01" }),
      event({ event_id: "e2", agent_instance_id: "b-01" })
    ];
    const findings = scoreHandoffIntegrity(events, [], []);
    assert.deepEqual(kinds(findings), ["DUPLICATE_OWNERSHIP"]);
  });

  test("results produced and none adopted is a finding", () => {
    // Work that happened and was thrown away is invisible in any measure built on output volume.
    const adoption: AdoptionRecord = { workstream_id: "w1", adopted_digest: null, produced_digests: ["r1", "r2"] };
    assert.deepEqual(kinds(scoreHandoffIntegrity([], [], [adoption])), ["UNADOPTED_RESULT"]);
  });

  test("adopting something nobody produced is a finding", () => {
    const adoption: AdoptionRecord = { workstream_id: "w1", adopted_digest: "r9", produced_digests: ["r1"] };
    assert.deepEqual(kinds(scoreHandoffIntegrity([], [], [adoption])), ["UNADOPTED_RESULT"]);
  });

  test("a workstream that produced nothing is not an unadopted result", () => {
    const adoption: AdoptionRecord = { workstream_id: "w1", adopted_digest: null, produced_digests: [] };
    assert.deepEqual(scoreHandoffIntegrity([], [], [adoption]), []);
  });

  test("nothing in M11 reads a vendor, a profile, or a count of agents", () => {
    // PRD 6 forbids agent and provider counts from earning points, and the way to keep that true is
    // for the function never to see them. Same events, different profiles: same findings.
    const base = [event({ event_id: "e1", agent_instance_id: "a-01" }), event({ event_id: "e2", agent_instance_id: "b-01" })];
    const renamed = base.map((e) => ({ ...e, agent_profile_id: `${e.agent_profile_id}-renamed` }));
    assert.deepEqual(scoreHandoffIntegrity(base, [], []), scoreHandoffIntegrity(renamed, [], []));
  });
});

describe("M13 transition, retry and idempotency integrity", () => {
  const effect = (over: Partial<EffectRecord> = {}): EffectRecord => ({
    target: "src/a.ts",
    after_digest: "d1",
    correlation_id: "c1",
    ...over
  });

  test("a retry that lands the same content is idempotent and clean", () => {
    // This is what a safe retry looks like: the second attempt replaced the first.
    assert.deepEqual(scoreRetryIdempotency([effect(), effect()]), []);
  });

  test("a retry that lands different content is a duplicate effect", () => {
    // The second attempt added to the first, and the workspace now holds something no single
    // attempt produced.
    const findings = scoreRetryIdempotency([effect(), effect({ after_digest: "d2" })]);
    assert.equal(findings.some((f) => f.kind === "RETRY_NOT_IDEMPOTENT"), true);
  });

  test("two unrelated correlations on one target is a collision, not a retry failure", () => {
    // Calling it a retry failure would send the operator to fix the retry logic when the real
    // problem is that two pieces of work owned the same file.
    const findings = scoreRetryIdempotency([effect({ correlation_id: "c1" }), effect({ correlation_id: "c2" })]);
    assert.equal(findings.some((f) => f.kind === "DUPLICATE_EFFECT"), true);
    assert.equal(findings.some((f) => f.kind === "RETRY_NOT_IDEMPOTENT"), false);
  });

  test("separate targets under one correlation are clean", () => {
    assert.deepEqual(scoreRetryIdempotency([effect({ target: "a.ts" }), effect({ target: "b.ts" })]), []);
  });

  test("no effects is not a finding", () => {
    assert.deepEqual(scoreRetryIdempotency([]), []);
  });

  test("the number of attempts never appears in a finding", () => {
    // More retries is not worse by itself; only a duplicated effect is. A count in the output would
    // become a count in someone's dashboard.
    const many = [effect(), effect(), effect(), effect()];
    assert.deepEqual(scoreRetryIdempotency(many), []);
  });
});
