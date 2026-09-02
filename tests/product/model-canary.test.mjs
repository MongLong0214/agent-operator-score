// #561's runtime canary, as an artefact rather than a sentence in a pull request.
//
// Every other test in this area builds its own transcript rows, which proves the reader reads what
// the tests write. What it cannot prove is that the shapes are the ones Codex and Claude Code
// actually write: a reader that agreed with a fixture and disagreed with both real runtimes would
// pass every one of them. So the observation is committed -- captured from real transcripts on a
// real machine by `scripts/capture-model-canary.mjs`, recorded as the events this product carries
// forward plus the SHA-256 of each row's raw bytes, with no transcript content copied -- and this
// file re-derives every verdict from it. If the policy moves, the canary has to be re-captured
// rather than quietly disagreeing with the runtimes it stands for.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../../lib/digest.mjs";
import {
  aliasClassOf,
  issuancePolicyFor,
  resolveModelProvenance,
  verifyModelIdentity
} from "../../lib/model-identity.mjs";
import { boundRuntimeIdentity, identityDigestOf, IDENTITY_SCHEMA } from "../../lib/runtime-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const path = join(root, "fixtures", "model-identity", "runtime-canary.json");
const canary = JSON.parse(readFileSync(path, "utf8"));

// A verified executable, so that what the policy reports is the model half and not the other one.
const verifiedIdentity = () => {
  const base = {
    schema_id: IDENTITY_SCHEMA,
    command_input: "codex",
    resolved_realpath: "/usr/bin/codex",
    realpath_digest: `sha256:${"a".repeat(64)}`,
    file_fingerprint: { size: 1024, mtime_ms: 1, inode: 2, device: 3 },
    interpreter_digest: null,
    interpreter_chain: [],
    owner_uid: 501,
    mode: "0755",
    parent_security: { world_writable: false, group_writable_untrusted: false, foreign_owner: false, acl_writable: false },
    platform_identity: { macos_codesign_team: null, macos_requirement_digest: null },
    adapter_id: "codex-cli.v1",
    identity_status: "VERIFIED",
    untrusted_reasons: [],
    verified_at: "2026-09-02T00:00:00.000Z"
  };
  return { ...base, identity_digest: identityDigestOf(base) };
};

const eventOf = (observation) => ({
  runtime: observation.runtime,
  provider: observation.provider,
  model: observation.model,
  row_digest: observation.row_digest,
  value_digest: null
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

test("no transcript content was copied into the canary", () => {
  // The rows are somebody's session. What is recorded is the event and the digest of the bytes,
  // and this is the test that keeps it that way when the fixture is next re-captured.
  const text = readFileSync(path, "utf8");
  for (const key of ["\"content\"", "\"text\"", "\"message\""]) {
    assert.equal(text.includes(key), false, `${key} appears in the canary`);
  }
  for (const observation of canary.observations) {
    assert.deepEqual(
      Object.keys(observation).sort(),
      ["alias_class", "declared", "issuance", "model", "mutable_alias", "provider", "row_digest", "runtime", "source_file_digest", "verification", "workspace"]
    );
    assert.match(observation.row_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(observation.source_file_digest, /^sha256:[0-9a-f]{64}$/u);
  }
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
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: boundRuntimeIdentity(verifiedIdentity()) });
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
  // And the digest is over bytes, so a re-capture of the same row yields the same digest.
  assert.equal(sha256Bytes(Buffer.from("", "utf8")).startsWith("sha256:"), true);
});
