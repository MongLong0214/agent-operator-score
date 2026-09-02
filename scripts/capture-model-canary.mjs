// Captures #561's runtime canary from real transcripts on the machine it is run on.
//
// The rest of the suite writes its own transcript rows, which proves the reader reads what the
// tests write and cannot prove the shapes are the ones Codex and Claude Code actually write. This
// records the real thing.
//
//   node scripts/capture-model-canary.mjs <workspace> [<workspace>]
//
// Each argument is a directory some real session ran in. What comes out is
// `fixtures/model-identity/runtime-canary.json`, which `tests/product/model-canary.test.mjs`
// re-derives every verdict from and re-computes every digest in.
//
// Two rules the fixture is written under, because it is committed and the sessions are somebody's:
//
//   - No absolute path leaves this script. A workspace is recorded as the SHA-256 of its bytes,
//     which is enough to tell two observations apart and nothing else.
//   - Every digest in the file verifies against something else in the file. Each observation
//     carries a canonical event line -- one JSON object holding exactly the fields the reader
//     extracts, with no session content in it -- and `event_digest` is the SHA-256 of that line's
//     bytes, so a test can recompute it. The digest of the row as it was on disk is recorded
//     separately and labelled as what it is: a name for that line on the capture machine, which
//     nothing offline can verify.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../lib/digest.mjs";
import {
  aliasClassOf,
  canonicalModelEventLine,
  issuancePolicyFor,
  observeModelEvents,
  resolveModelProvenance,
  verifyModelIdentity
} from "../lib/model-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "fixtures", "model-identity", "runtime-canary.json");
const workspaces = process.argv.slice(2);
if (workspaces.length === 0) {
  process.stderr.write("usage: node scripts/capture-model-canary.mjs <workspace> [<workspace>]\n");
  process.exit(2);
}

// No executable identity is invented here. An earlier version of this script supplied a made-up
// VERIFIED record so the recorded policy would report the model half alone; that put a fictional
// digest in a file whose whole purpose is to record what a machine actually produced. The policy
// is recorded with no runtime identity, which is what this capture actually knows, and the
// executable half of every recorded issuance therefore reads RUNTIME_IDENTITY_UNVERIFIED.

const observations = [];
// A Map, because the keys are runtime names read from a loop and a plain object as a keyed store
// is the shape the defect-class scanner refuses. Serialised below with Object.fromEntries.
const blockers = new Map();
for (const runtime of ["codex", "claude-code"]) {
  const found = [];
  for (const workspace of workspaces) {
    for (const event of observeModelEvents({ env: { HOME: process.env.HOME }, workspace, since: 0, runtime })) {
      if (typeof event.model !== "string") continue;
      found.push({ workspace, event });
    }
  }
  if (found.length === 0) {
    blockers.set(runtime, `no ${runtime} transcript naming a model was found under the workspaces given to this script`);
    continue;
  }
  // One agreement and one disagreement per runtime, which is what makes it a canary rather than a
  // demonstration: the declaration that is not what ran is the case an operator actually hits.
  const { event, workspace } = found[0];
  const ran = `${event.provider}/${event.model}`;
  const other = ran === "anthropic/claude-3-5-sonnet-20241022" ? "openai/gpt-4o-2024-08-06" : "anthropic/claude-3-5-sonnet-20241022";
  for (const declared of [ran, other]) {
    const provenance = resolveModelProvenance({ runtimeEvent: event, declared: { model: declared, provider: null } });
    const verification = verifyModelIdentity(provenance, [event], { runtime });
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: null });
    const alias = aliasClassOf(ran);
    const line = canonicalModelEventLine(event);
    observations.push({
      runtime,
      // The path is a digest. Which project somebody was working on is theirs, and this file ships.
      workspace_digest: sha256Bytes(Buffer.from(workspace, "utf8")),
      provider: event.provider,
      model: event.model,
      event_line: line,
      event_digest: sha256Bytes(Buffer.from(line, "utf8")),
      observed_row_digest: event.row_digest,
      alias_class: alias.alias_class,
      mutable_alias: alias.mutable_alias,
      declared,
      verification: verification.status,
      issuance: { status: policy.profile_bound_aggregation.status, reason: policy.profile_bound_aggregation.reason }
    });
  }
}

const record = {
  schema_id: "aos-model-canary.v1",
  captured_at: new Date().toISOString(),
  // What this file is, stated where a reader meets it. It is a replay fixture: a recording of a
  // real capture on one machine, and nothing in it proves that capture to anyone else. The
  // transcripts are local files with no signature and there is no attestation channel between the
  // machine that read them and this repository, so a reviewer holding only the repository cannot
  // distinguish this from a well-formed invention. What it does establish is that the reader, the
  // alias policy and the issuance rules produce these verdicts for the shapes Codex and Claude
  // Code actually write -- and that a later change to any of them shows up here as a failure.
  kind: "replay-fixture",
  unverifiable_from_repository: "The capture happened on one operator machine against unsigned local transcript files. No attestation channel exists between that machine and this repository, so the capture itself is asserted by the committed record and not proved by it.",
  capture: {
    platform: process.platform,
    command: "observeModelEvents({ env: { HOME }, workspace, since: 0, runtime }) over the workspaces given to scripts/capture-model-canary.mjs",
    note: "No transcript content and no absolute path is copied. `event_line` is the canonical form of the event this product carries forward and `event_digest` is the SHA-256 of its bytes, so the derived verdicts can be recomputed from what is written here."
  },
  blockers: Object.fromEntries(blockers),
  observations
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${observations.length} observation(s) written to ${out}\n`);
