import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRun } from "../../lib/store.mjs";
import { run } from "./helpers.mjs";

// What a receiver was handed, checked rather than taken on its word.
//
// `handoff consume` recorded whatever digests it was given. A receiver could report having read an
// artifact it never saw -- or a different one -- and the handoff closed, which made the digest on
// the event decoration rather than evidence. The consume is now compared, exactly and in order,
// against what the matching `handoff created` recorded.

const A = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const B = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

const withRun = (body) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-handoff-"));
  try {
    run(cwd, ["init"]);
    const created = createRun(join(cwd, ".aos"), { mode: "PROJECT_OBSERVATION", agent_profile_id: "sender" });
    return body(cwd, created.runId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

const handoff = (cwd, runId, action, digests, expected) =>
  run(cwd, [
    "handoff", action, "--run", runId, "--from", "sender", "--to", "receiver", "--family", "FAM-3",
    ...digests.flatMap((digest) => ["--artifact", digest])
  ], expected);

test("a handoff consumed with the digests it was handed is accepted", () => {
  withRun((cwd, runId) => {
    handoff(cwd, runId, "create", [A, B], 0);
    handoff(cwd, runId, "consume", [A, B], 0);
  });
});

test("a handoff consumed with a digest that was not handed is refused", () => {
  withRun((cwd, runId) => {
    handoff(cwd, runId, "create", [A], 0);
    const wrong = handoff(cwd, runId, "consume", [B], 2);
    assert.match(wrong.stderr, /AOS_HANDOFF_DIGEST_MISMATCH/);
  });
});

test("a handoff consumed with a subset, a superset or a reordering of what was handed is refused", () => {
  withRun((cwd, runId) => {
    handoff(cwd, runId, "create", [A, B], 0);
    // Each of these would pass a check that compared lengths, or membership, or "at least one".
    assert.match(handoff(cwd, runId, "consume", [A], 2).stderr, /AOS_HANDOFF_DIGEST_MISMATCH/);
    assert.match(handoff(cwd, runId, "consume", [A, B, A], 2).stderr, /AOS_HANDOFF_DIGEST_MISMATCH/);
    assert.match(handoff(cwd, runId, "consume", [B, A], 2).stderr, /AOS_HANDOFF_DIGEST_MISMATCH/);
  });
});

test("a handoff consumed with nothing at all is refused", () => {
  withRun((cwd, runId) => {
    handoff(cwd, runId, "create", [A], 0);
    // The empty case is the one that matters most: a receiver that read nothing reports nothing,
    // and an unchecked consume would close the handoff on it.
    assert.match(handoff(cwd, runId, "consume", [], 2).stderr, /AOS_HANDOFF_DIGEST_MISMATCH/);
  });
});

test("a consume with no matching created handoff is refused rather than recorded", () => {
  withRun((cwd, runId) => {
    assert.match(handoff(cwd, runId, "consume", [A], 2).stderr, /AOS_HANDOFF_NOT_CREATED/);
    // Created for a different receiver is not created for this one.
    handoff(cwd, runId, "create", [A], 0);
    const other = run(cwd, [
      "handoff", "consume", "--run", runId, "--from", "sender", "--to", "someone-else",
      "--family", "FAM-3", "--artifact", A
    ], 2);
    assert.match(other.stderr, /AOS_HANDOFF_NOT_CREATED/);
  });
});

test("a legacy normalised digest is not accepted as an artifact digest", () => {
  withRun((cwd, runId) => {
    // Bare 64-character hex is what the old normalised-text digest looked like. It cannot say what
    // was hashed, and the value it carries was computed over decoded text, so admitting one here
    // would put a claim nobody can verify into the evidence beside ones they can.
    const legacy = "83d544ccc2230577ffffffffffffffffffffffffffffffffffffffffffffffff";
    const refused = handoff(cwd, runId, "create", [legacy], 2);
    assert.match(refused.stderr, /AOS_INVALID_ARTIFACT_DIGEST/);
    assert.match(handoff(cwd, runId, "create", ["sha256:not-hex"], 2).stderr, /AOS_INVALID_ARTIFACT_DIGEST/);
  });
});
