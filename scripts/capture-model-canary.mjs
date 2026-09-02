// Captures #561's runtime canary from real transcripts on the machine it is run on.
//
// The rest of the suite writes its own transcript rows, which proves the reader reads what the
// tests write and cannot prove the shapes are the ones Codex and Claude Code actually write. This
// records the real thing -- and records only the event this product carries forward plus the
// SHA-256 of each row's raw bytes, because the rows themselves are somebody's session.
//
//   node scripts/capture-model-canary.mjs <workspace> [<workspace>]
//
// Each argument is a directory some real session ran in. What comes out is
// `fixtures/model-identity/runtime-canary.json`, which `tests/product/model-canary.test.mjs`
// re-derives every verdict from. Re-run it when the alias or issuance policy changes: a canary
// that quietly disagrees with the runtimes it stands for is worse than none.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../lib/digest.mjs";
import {
  aliasClassOf,
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
    blockers.set(runtime, `no ${runtime} transcript naming a model was found under the workspaces given (${workspaces.join(", ")})`);
    continue;
  }
  // One agreement and one disagreement per runtime, which is what makes it a canary rather than a
  // demonstration: the declaration that is not what ran is the case an operator actually hits.
  const event = found[0].event;
  const ran = `${event.provider}/${event.model}`;
  const other = ran === "anthropic/claude-3-5-sonnet-20241022" ? "openai/gpt-4o-2024-08-06" : "anthropic/claude-3-5-sonnet-20241022";
  for (const declared of [ran, other]) {
    const provenance = resolveModelProvenance({ runtimeEvent: event, declared: { model: declared, provider: null } });
    const verification = verifyModelIdentity(provenance, [event], { runtime });
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: boundRuntimeIdentity(verifiedIdentity()) });
    const alias = aliasClassOf(ran);
    observations.push({
      runtime,
      workspace: found[0].workspace,
      provider: event.provider,
      model: event.model,
      row_digest: event.row_digest,
      // The transcript file is not named: which project somebody was working on is theirs. The
      // digest of the row above is what ties a re-capture to the same line.
      source_file_digest: sha256Bytes(Buffer.from(`${runtime} ${found[0].workspace}`, "utf8")),
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
    note: "No transcript content is copied. Each observation is the event this product carries forward plus the SHA-256 of the row's raw bytes on disk."
  },
  blockers: Object.fromEntries(blockers),
  observations
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${observations.length} observation(s) written to ${out}\n`);
