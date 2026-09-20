import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../../lib/core.mjs";
import { DERIVED_PROJECTION_FIELDS, PROJECTED_FIELDS, loadOperatorEventSchema, mintOperatorEvent, projectOperatorEvent } from "../../lib/operator-events.mjs";

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
  challenge: { question: TYPED },
  value: { answer: TYPED },
  named_evidence_ids: ["docs.authoritative.md"],
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
  const structural = [...DERIVED_PROJECTION_FIELDS];
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
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-shortcut", challenge: { asked: "x" }, value: { goal: "x" }, state_revision: 1,
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
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-len", challenge: { asked: "x" }, value: { goal: "x" }, state_revision: 1,
    event_id: "operator-00000000-0000-4000-8000-000000000001", created_at: "2026-09-03T00:00:00Z"
  }, { secret: SECRET });
  const long = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-len", challenge: { asked: "x" }, value: { goal: "x".repeat(20000) }, state_revision: 1,
    event_id: "operator-00000000-0000-4000-8000-000000000001", created_at: "2026-09-03T00:00:00Z"
  }, { secret: SECRET });
  const shape = (projected) => Object.keys(projected).sort().map((key) => (key.endsWith("_digest") || key === "session_binding" ? key : [key, projected[key]]));
  assert.deepEqual(shape(projectOperatorEvent(short)), shape(projectOperatorEvent(long)),
    "the two projections differ in something other than their digests, so length reached a consumer");
  assert.notEqual(projectOperatorEvent(short).value_digest, projectOperatorEvent(long).value_digest);
});

// --- round 2 ------------------------------------------------------------------------------------

// The strings a public projection publishes, and the values none of them may ever be.
const HOSTILE = [
  "secret:hunter2",
  "/Users/alice/.ssh/id_ed25519",
  "../../etc/passwd",
  "hunter2 password",
  "AKIAIOSFODNN7EXAMPLE=x",
  "~/clients/acme-confidential"
];

test("no string the projection publishes can be minted as a secret or a path", () => {
  // Round 1: `named_evidence_ids`, the candidate source's version and the relay id were copied
  // verbatim from a schema that permitted any 1-128 characters, so
  // ["secret:hunter2", "/Users/alice/.ssh/id_ed25519"] came out of the projection unchanged.
  for (const hostile of HOSTILE) {
    assert.throws(() => mintOperatorEvent({
      run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
      construct_cell_id: "C1.OF.01", opportunity_id: "opp-hostile",
      challenge: { asked: "x" }, value: { goal: "y" }, state_revision: 1,
      named_evidence_ids: [hostile]
    }, { secret: SECRET }), /AOS_INVALID_OPERATOR_EVENT/u, `named_evidence_ids accepted ${hostile}`);
    assert.throws(() => mintOperatorEvent({
      run_id: RUN, source: "interactive-tty", decision_type: "context.include",
      construct_cell_id: "C2.OD.01", opportunity_id: "opp-hostile",
      challenge: { asked: "x" }, value: { goal: "y" }, state_revision: 1,
      candidate_source: { source_id: "docs/a.md", authority_class: "AUTHORITATIVE", version: hostile, untrusted_content: false, size_bytes: 1 }
    }, { secret: SECRET }), /AOS_INVALID_OPERATOR_EVENT/u, `candidate_source.version accepted ${hostile}`);
    assert.throws(() => mintOperatorEvent({
      run_id: RUN, source: "interactive-tty", decision_type: "route.assign",
      construct_cell_id: "C2.OD.01", opportunity_id: "opp-hostile",
      challenge: { asked: "x" }, value: { goal: "y" }, state_revision: 1,
      declared_route: [hostile]
    }, { secret: SECRET }), /AOS_INVALID_OPERATOR_EVENT/u, `declared_route accepted ${hostile}`);
    assert.throws(() => mintOperatorEvent({
      run_id: RUN, source: "agent-relay", decision_type: "spec.goal",
      construct_cell_id: "C1.OF.01", opportunity_id: "opp-hostile",
      challenge: { asked: "x" }, value: { goal: "y" }, state_revision: 1,
      relay_attestation: { relay_id: hostile, owner_challenge_digest: `sha256:${"0".repeat(64)}`, attested_at: "2026-09-03T00:00:00Z" }
    }, { secret: SECRET }), /AOS_INVALID_OPERATOR_EVENT/u, `relay_id accepted ${hostile}`);
  }
});

test("a named evidence id reaches the projection as a digest, not as itself", () => {
  const minted = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-evidence",
    challenge: { asked: "x" }, value: { goal: "y" }, state_revision: 1,
    named_evidence_ids: ["migrations.0042.sql"]
  }, { secret: SECRET });
  const projected = projectOperatorEvent(minted);
  const rendered = canonicalJson(projected);
  assert.equal(rendered.includes("migrations.0042.sql"), false, "a named evidence id was published verbatim");
  assert.equal(Array.isArray(projected.named_evidence_digests), true);
  assert.match(projected.named_evidence_digests[0], /^sha256:[0-9a-f]{64}$/u);
});

test("every string field the projection publishes is a digest, an enum, or a constrained token", () => {
  // Stated as a property of the schema rather than of one fixture, because the round-1 test put its
  // secret only in fields that were already hashed and so could not have caught this class.
  const schema = loadOperatorEventSchema();
  const unconstrained = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "string" || (Array.isArray(node.type) && node.type.includes("string"))) {
      if (node.enum === undefined && node.const === undefined && node.pattern === undefined) unconstrained.push(path);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${key}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(schema, "$");
  assert.deepEqual(unconstrained, [], `these string fields accept anything: ${unconstrained.join(", ")}`);
});

test("the projection publishes no string the operator typed, whatever the character grammar allows", () => {
  // Round 2: constraining the grammar was not enough. A token grammar that admits an agent called
  // `alpha` admits `AKIAIOSFODNN7EXAMPLE`, and `declared_route` published exactly that. Nothing here
  // can tell an agent id from a credential by looking at it, so the projection stops looking.
  const CREDENTIALS = ["AKIAIOSFODNN7EXAMPLE", "hunter2", "sk-live-1234567890abcdef", "acme-confidential"];
  for (const credential of CREDENTIALS) {
    const minted = mintOperatorEvent({
      run_id: RUN, source: "agent-relay", decision_type: "route.assign",
      construct_cell_id: "C2.OD.01", opportunity_id: "opp-credential",
      challenge: { asked: "route it" }, value: { route: credential }, state_revision: 1,
      named_evidence_ids: [credential],
      declared_route: [credential],
      candidate_source: { source_id: `docs/${credential}.md`, authority_class: "AUTHORITATIVE", version: credential, untrusted_content: false, size_bytes: 1 },
      relay_attestation: { relay_id: credential, owner_challenge_digest: `sha256:${"0".repeat(64)}`, attested_at: "2026-09-03T00:00:00Z" }
    }, { secret: SECRET });
    const rendered = canonicalJson(projectOperatorEvent(minted));
    assert.equal(rendered.includes(credential), false, `${credential} reached the projection verbatim`);
  }
});

test("every string the projection publishes is a fixed vocabulary, an identifier this product generated, or a digest", () => {
  // Stated over the projection's own output rather than over one fixture, because the round-2 hole
  // was a field nobody thought to put a secret in.
  const minted = mintOperatorEvent({
    run_id: RUN, source: "agent-relay", decision_type: "route.assign",
    construct_cell_id: "C2.OD.01", opportunity_id: "opp-vocabulary",
    challenge: { asked: "x" }, value: { y: 1 }, state_revision: 3,
    named_evidence_ids: ["one", "two"],
    declared_route: ["alpha", "beta"],
    proactive_delegation: "DELEGATE",
    candidate_source: { source_id: "docs/a.md", authority_class: "AUTHORITATIVE", version: "1.2.3", untrusted_content: true, size_bytes: 9 },
    relay_attestation: { relay_id: "relay-1", owner_challenge_digest: `sha256:${"0".repeat(64)}`, attested_at: "2026-09-03T00:00:00Z" }
  }, { secret: SECRET });
  const projected = projectOperatorEvent(minted);
  // Identifiers this product generates or the caller addresses the contract with. Everything else
  // that is a string has to be a digest or come from a closed vocabulary.
  const GENERATED = new Set(["schema_id", "event_id", "run_id", "producer", "construct_cell_id", "opportunity_id", "created_at", "attested_at"]);
  const VOCABULARY = new Set(["source", "authority", "provenance", "confidence", "decision_type", "proactive_delegation", "authority_class", "attested_by"]);
  const walk = (node, path) => {
    if (typeof node === "string") {
      const field = path.split(".").at(-1).replace(/\[\d+\]$/u, "");
      if (GENERATED.has(field) || VOCABULARY.has(field)) return;
      assert.match(node, /^sha256:[0-9a-f]{64}$/u, `${path} publishes a string that is neither generated, a vocabulary word, nor a digest`);
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  walk(projected, "$");
  assert.equal(projected.declared_route_digests.length, 2);
  assert.equal(projected.candidate_source.version_digest !== null, true);
  assert.equal(Object.hasOwn(projected.relay_attestation, "relay_id"), false);
});
