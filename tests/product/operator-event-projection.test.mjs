import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../../lib/core.mjs";
import { PROJECTED_FIELDS, loadOperatorEventSchema, mintOperatorEvent, projectOperatorEvent } from "../../lib/operator-events.mjs";

const SECRET = "51ab".repeat(16);
const RUN = "run-560-projection";

// The two strings a public result must never carry. The first is what an operator typed; the second
// is what their filesystem is called. Both are in the local record on purpose -- the store is the
// operator's own home -- and neither may cross into a projection.
const TYPED = "the production database password is hunter2 and the deploy key is in ~/.ssh/id_ed25519";
const PATH = "/Users/someone/clients/acme-confidential/docs/authoritative.md";

const event = mintOperatorEvent({
  run_id: RUN,
  source: "operator-file",
  decision_type: "context.include",
  construct_cell_id: "C2.OD.01",
  opportunity_id: "opp-d2-include",
  challenge_digest: { question: TYPED },
  value_digest: { answer: TYPED },
  named_evidence_ids: ["docs/authoritative.md"],
  state_revision: 1,
  candidate_source: { source_id: PATH, authority_class: "AUTHORITATIVE", version: "2026-08-01", untrusted_content: false, size_bytes: 4096 },
  file_provenance: { path_digest: `sha256:${"1".repeat(64)}`, file_digest: `sha256:${"2".repeat(64)}`, attested_by: "local-owner", attested_at: "2026-09-03T00:00:00Z" }
}, { secret: SECRET });

test("the projection carries digests and structural values, and no text the operator typed", () => {
  const projected = projectOperatorEvent(event);
  const rendered = canonicalJson(projected);
  assert.equal(rendered.includes("hunter2"), false, "the operator's own text reached the projection");
  assert.equal(rendered.includes("id_ed25519"), false);
  assert.equal(rendered.includes(PATH), false, "the operator's filesystem path reached the projection");
  assert.equal(rendered.includes("acme-confidential"), false);
  // The digests are there, so what was withheld is still checkable by anyone holding the original.
  assert.match(projected.value_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(projected.candidate_source.source_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(projected.candidate_source.authority_class, "AUTHORITATIVE");
  assert.equal(projected.candidate_source.untrusted_content, false);
});

test("the projection is an allowlist, so a field added to the schema is absent until somebody adds it here", () => {
  const declared = Object.keys(loadOperatorEventSchema().properties);
  const structural = ["candidate_source", "proactive_delegation", "declared_route", "relay_attestation", "file_provenance"];
  // Every projected field is a declared one, and every declared field is either projected, projected
  // in a reshaped form, or deliberately absent. The list is stated here rather than derived, because
  // "whatever the schema has" is exactly the default that publishes a field nobody considered.
  for (const field of PROJECTED_FIELDS) assert.equal(declared.includes(field), true, `${field} is not a field of this schema`);
  for (const field of declared) {
    assert.equal(PROJECTED_FIELDS.includes(field) || structural.includes(field), true, `${field} is neither projected nor named as a structural field`);
  }
  const projected = projectOperatorEvent({ ...event, invented_field: "leak me" });
  assert.equal(Object.hasOwn(projected, "invented_field"), false);
});

test("the projection carries nothing about how long the operator's text was or how many turns they took", () => {
  const projected = projectOperatorEvent(event);
  const keys = Object.keys(projected);
  for (const forbidden of ["instruction_length", "length", "turn_count", "turns", "duration_ms", "wall_clock_ms", "prompt_length"]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} is a prohibited value source and the projection carries it`);
  }
  // And the record it projects from carries none of them either: length and turn count are named
  // shortcut prohibitions in the #582 contract, and a schema that admitted one would put it in front
  // of every consumer downstream of this record.
  const schemaFields = Object.keys(loadOperatorEventSchema().properties);
  for (const forbidden of ["instruction_length", "turn_count", "duration_ms", "prompt_length"]) {
    assert.equal(schemaFields.includes(forbidden), false, `${forbidden} is a field of aos-operator-event.v2`);
  }
});

test("an operator event cannot be minted carrying a length or a turn count, whatever the caller passes", () => {
  // The record is assembled from named fields rather than from whatever the caller handed over, so
  // a runtime that decided to pass the instruction's length along cannot put it on the event. Length
  // and turn count are named shortcut prohibitions on the cells these events are evidence for.
  const minted = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-shortcut", value_digest: { goal: "x" }, state_revision: 1,
    instruction_length: 4096, turn_count: 12, duration_ms: 900, prompt_length: 77
  }, { secret: SECRET });
  for (const forbidden of ["instruction_length", "turn_count", "duration_ms", "prompt_length"]) {
    assert.equal(Object.hasOwn(minted, forbidden), false, `${forbidden} was minted onto an operator event`);
  }
  assert.equal(Object.hasOwn(projectOperatorEvent(minted), "instruction_length"), false);
});

test("two operator events that differ only in how much the operator wrote project the same structure", () => {
  const short = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-len", value_digest: { goal: "x" }, state_revision: 1,
    event_id: "operator-00000000-0000-4000-8000-000000000001", created_at: "2026-09-03T00:00:00Z"
  }, { secret: SECRET });
  const long = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-len", value_digest: { goal: "x".repeat(20000) }, state_revision: 1,
    event_id: "operator-00000000-0000-4000-8000-000000000001", created_at: "2026-09-03T00:00:00Z"
  }, { secret: SECRET });
  const shape = (projected) => Object.keys(projected).sort().map((key) => (key.endsWith("_digest") || key === "session_binding" ? key : [key, projected[key]]));
  assert.deepEqual(shape(projectOperatorEvent(short)), shape(projectOperatorEvent(long)),
    "the two projections differ in something other than their digests, so length reached a consumer");
  assert.notEqual(projectOperatorEvent(short).value_digest, projectOperatorEvent(long).value_digest);
});
