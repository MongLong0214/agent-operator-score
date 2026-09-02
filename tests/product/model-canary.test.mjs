// #561's runtime canary, as an artefact rather than a sentence in a pull request.
//
// Every other test in this area builds its own transcript rows, which proves the reader reads what
// the tests write. What it cannot prove is that the shapes are the ones Codex and Claude Code
// actually write: a reader that agreed with a fixture and disagreed with both real runtimes would
// pass every one of them. So the observation is committed -- captured from real transcripts on a
// real machine by `scripts/capture-model-canary.mjs`, recorded as the events this product carries
// forward plus the SHA-256 of each row's raw bytes, with no transcript content copied -- and this
// file re-derives every verdict from it and recomputes every digest it can.
//
// What it is not: proof that the capture happened. The transcripts are unsigned local files on one
// operator machine and there is no attestation channel between that machine and this repository,
// so a reviewer holding only the repository cannot tell this from a well-formed invention. The
// fixture says so in its own `kind` and `unverifiable_from_repository` fields, and the first test
// below asserts that it says so -- because the failure mode here is not a wrong digest, it is a
// record that reads as evidence for more than it holds. What it does establish is that the reader,
// the alias policy and the issuance rules produce these verdicts for the shapes Codex and Claude
// Code actually write, and that a change to any of them shows up here as a failure.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../../lib/digest.mjs";
import {
  aliasClassOf,
  canonicalModelEventLine,
  issuancePolicyFor,
  resolveModelProvenance,
  verifyModelIdentity
} from "../../lib/model-identity.mjs";


const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const path = join(root, "fixtures", "model-identity", "runtime-canary.json");
const canary = JSON.parse(readFileSync(path, "utf8"));

const eventOf = (observation) => ({
  runtime: observation.runtime,
  provider: observation.provider,
  model: observation.model,
  row_digest: observation.observed_row_digest,
  value_digest: null
});

test("the canary says what it is: a replay fixture, and what it cannot prove", () => {
  // The claim this file makes about itself is the thing most worth checking, because an
  // overclaiming fixture is worse than none: it reads as a canary and is a recording.
  assert.equal(canary.kind, "replay-fixture");
  assert.match(canary.unverifiable_from_repository, /not proved by it/u);
  assert.match(canary.capture.command, /observeModelEvents/u);
  // And no fabricated executable identity: the capture records the model half it observed, so the
  // issuance it recorded is the one with no runtime identity in hand.
  for (const observation of canary.observations) {
    assert.equal(observation.issuance.status, "withheld");
  }
});

test("the canary was captured from both runtimes this product reads, or says why it was not", () => {
  assert.equal(canary.schema_id, "aos-model-canary.v1");
  assert.match(canary.captured_at, /^\d{4}-\d{2}-\d{2}T/u);
  assert.ok(canary.capture.command.length > 0, "how it was captured is part of the record");
  const runtimes = new Set(canary.observations.map((one) => one.runtime));
  for (const runtime of ["codex", "claude-code"]) {
    const blocker = canary.blockers?.[runtime] ?? null;
    assert.ok(runtimes.has(runtime) || typeof blocker === "string",
      `${runtime}: neither observed nor named as a blocker`);
  }
  assert.ok(canary.observations.length >= 2, "a canary of one runtime is half a canary");
});

test("no transcript content and no absolute path was copied into the canary", () => {
  // The rows are somebody's session and this file ships in the repository. What is recorded is the
  // event, its digest, and digests of the things that would otherwise be paths. This is the test
  // that keeps it that way when the fixture is next re-captured.
  const text = readFileSync(path, "utf8");
  for (const key of ["\"content\"", "\"text\"", "\"message\"", "/Users/", "/home/", "/tmp/", "/private/"]) {
    assert.equal(text.includes(key), false, `${key} appears in the canary`);
  }
  for (const observation of canary.observations) {
    assert.deepEqual(
      Object.keys(observation).sort(),
      ["alias_class", "declared", "event_digest", "event_line", "issuance", "model", "mutable_alias", "observed_row_digest", "provider", "runtime", "verification", "workspace_digest"]
    );
    for (const field of ["event_digest", "observed_row_digest", "workspace_digest"]) {
      assert.match(observation[field], /^sha256:[0-9a-f]{64}$/u, field);
    }
  }
});

test("every digest the canary can verify is recomputed from what the canary carries", () => {
  // The point of the fixture is that it cannot be edited into agreement. Its event digests are
  // over the canonical event line stored beside them, so replacing a digest -- or the line -- makes
  // this fail. The row digest names a line on the capture machine and is labelled as such: the
  // note has to say so, because a digest nothing checks reads as proof of something.
  for (const observation of canary.observations) {
    const line = canonicalModelEventLine(eventOf(observation));
    assert.equal(observation.event_line, line, `${observation.model}: the canonical event line`);
    assert.equal(observation.event_digest, sha256Bytes(Buffer.from(observation.event_line, "utf8")), `${observation.model}: event digest`);
    assert.notEqual(observation.event_digest, observation.observed_row_digest);
  }
  assert.match(canary.capture.note, /recomputed from what is written here/u);
  // Two observations of different runtimes are two different digests, so a fixture that repeated
  // one row four times could not pass either.
  const digests = new Set(canary.observations.map((one) => one.event_digest));
  assert.ok(digests.size >= 2, "every observation digested to the same value");
});

test("every recorded verdict is the verdict this product reaches from the recorded observation", () => {
  let checked = 0;
  for (const observation of canary.observations) {
    const alias = aliasClassOf(`${observation.provider}/${observation.model}`);
    assert.equal(alias.alias_class, observation.alias_class, `${observation.model}: alias class`);
    assert.equal(alias.mutable_alias, observation.mutable_alias, `${observation.model}: mutability`);

    const provenance = resolveModelProvenance({
      runtimeEvent: eventOf(observation),
      declared: observation.declared === null ? null : { model: observation.declared, provider: null }
    });
    const verification = verifyModelIdentity(provenance, [eventOf(observation)], { runtime: observation.runtime });
    assert.equal(verification.status, observation.verification, `${observation.model}: verification`);
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: null });
    assert.equal(policy.profile_bound_aggregation.status, observation.issuance.status, `${observation.model}: issuance`);
    assert.equal(policy.profile_bound_aggregation.reason, observation.issuance.reason, `${observation.model}: reason`);
    checked += 1;
  }
  assert.ok(checked >= 2, `only ${checked} observations were re-derived`);
});

test("the canary carries a real disagreement, not only agreements", () => {
  // A canary of confirmations alone says the happy path works on this machine. The one that
  // matters is a real model name against a declaration that is not it: that is the case an
  // operator hits when they change model and forget to say so.
  const mismatch = canary.observations.find((one) => one.verification === "MISMATCH");
  assert.ok(mismatch, "no mismatch was recorded");
  assert.equal(mismatch.issuance.reason, "MODEL_IDENTITY_MISMATCH");
  assert.notEqual(mismatch.declared, `${mismatch.provider}/${mismatch.model}`);
  // And its digest is over the canonical line, so the mismatch case is verifiable too.
  assert.equal(mismatch.event_digest, sha256Bytes(Buffer.from(mismatch.event_line, "utf8")));
});
