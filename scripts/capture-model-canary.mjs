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
import { boundRuntimeIdentity, identityDigestOf, IDENTITY_SCHEMA } from "../lib/runtime-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "fixtures", "model-identity", "runtime-canary.json");
const workspaces = process.argv.slice(2);
if (workspaces.length === 0) {
  process.stderr.write("usage: node scripts/capture-model-canary.mjs <workspace> [<workspace>]\n");
  process.exit(2);
}

// A verified executable, so that what the recorded policy reports is the model half of the profile
// and not the other one. The digest is recomputed from the record, the way binding does it.
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
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: boundRuntimeIdentity(verifiedIdentity()) });
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
  capture: {
    platform: process.platform,
    command: "observeModelEvents({ env: { HOME }, workspace, since: 0, runtime }) over the workspaces given to scripts/capture-model-canary.mjs",
    note: "No transcript content and no absolute path is copied. `event_line` is the canonical form of the event this product carries forward and `event_digest` is the SHA-256 of its bytes; `observed_row_digest` names the transcript row on the capture machine and cannot be verified from this file."
  },
  blockers: Object.fromEntries(blockers),
  observations
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${observations.length} observation(s) written to ${out}\n`);
