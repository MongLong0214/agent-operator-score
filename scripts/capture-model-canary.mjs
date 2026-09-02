// Captures #561's runtime canary by running the runtimes and reading what they wrote.
//
// The rest of the suite writes its own transcript rows, which proves the reader reads what the
// tests write and cannot prove the shapes are the ones Codex and Claude Code actually write. This
// invokes each runtime with a trivial prompt in a temporary HOME, reads the transcript that
// invocation produced through the product's own reader, and records the result.
//
//   node scripts/capture-model-canary.mjs [--keep]
//
// What comes out is `fixtures/model-identity/runtime-canary.json`, which
// `tests/product/model-canary.test.mjs` re-derives every verdict from and re-computes every digest
// in. A runtime that is absent, unauthenticated or offline is recorded as a named blocker rather
// than skipped: "no canary" and "a canary nobody could run" are different statements.
//
// Two rules the fixture is written under, because it is committed and a session is somebody's:
//
//   - No absolute path leaves this script. Paths are recorded as SHA-256 of their bytes.
//   - Every digest in the file verifies against something else in the file: each observation
//     carries the canonical event line its `event_digest` is taken over, so a test recomputes it.
//     `observed_row_digest` names the row on the capture machine and is labelled as such.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
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
const keep = process.argv.includes("--keep");

const PROMPT = "reply with the single word ok";

// What each runtime needs from the operator's own configuration directory to authenticate, and how
// it is asked to answer once. Nothing else is copied: the temporary HOME exists so the transcript
// this capture reads is the one this capture produced.
const RUNTIMES = [
  {
    runtime: "codex",
    command: "codex",
    args: ["exec", "--skip-git-repo-check", PROMPT],
    configDir: ".codex",
    env: (home) => ({ CODEX_HOME: join(home, ".codex") }),
    copy: ["auth.json", "config.toml"]
  },
  {
    runtime: "claude-code",
    command: "claude",
    args: ["-p", PROMPT],
    configDir: ".claude",
    // This runtime keeps its credential in the login Keychain, which is per-account and not per
    // HOME, so a temporary configuration directory means "not logged in" and no capture at all.
    // It runs under the operator's own configuration and writes its transcript under a temporary
    // workspace, which is what ties the rows to this capture: the project directory it creates is
    // named after a directory that existed only for this invocation.
    home: () => homedir(),
    env: () => ({}),
    copy: []
  }
];

const runtimeVersion = (command) => {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 30000 });
  return probe.status === 0 ? (probe.stdout ?? "").trim().split("\n")[0] : null;
};

/** Runs one runtime once, in its own HOME, and reads the transcript that invocation wrote. */
function invoke(spec) {
  const version = runtimeVersion(spec.command);
  if (version === null) {
    return { blocker: `${spec.command} is not on PATH or does not answer --version on this machine` };
  }
  // The workspace is always fresh, because that is what makes a transcript row this capture's:
  // the runtime records the directory it ran in, and this one existed only for this invocation.
  const scratch = mkdtempSync(join(tmpdir(), `aos-canary-${spec.runtime}-`));
  const workspace = join(scratch, "workspace");
  mkdirSync(workspace, { recursive: true });
  const home = spec.home === undefined ? scratch : spec.home();
  if (spec.home === undefined) mkdirSync(join(home, spec.configDir), { recursive: true });
  // The credential, and only the credential. It is read from the operator's own configuration and
  // never recorded: what this file keeps is the model the runtime named, not how it authenticated.
  for (const name of spec.copy) {
    const source = join(homedir(), spec.configDir, name);
    if (existsSync(source)) cpSync(source, join(home, spec.configDir, name));
  }
  const cleanup = () => { if (!keep) rmSync(scratch, { recursive: true, force: true }); };
  const started = Date.now();
  const result = spawnSync(spec.command, spec.args, {
    cwd: workspace,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env, HOME: home, ...spec.env(home) }
  });
  const duration = Date.now() - started;
  if (result.status !== 0) {
    cleanup();
    const said = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim().split("\n").slice(-1)[0] ?? "";
    return { blocker: `${spec.command} exited ${result.status ?? "with a signal"} in this capture: ${said.slice(0, 200)}` };
  }
  const scan = observeModelEvents({
    env: { HOME: home, ...spec.env(home) },
    workspace,
    since: started,
    runtime: spec.runtime
  });
  const event = scan.events.find((entry) => typeof entry.model === "string") ?? null;
  cleanup();
  if (event === null) {
    return { blocker: `${spec.command} ran and exited 0, but wrote no transcript row naming a model under the HOME this capture gave it` };
  }
  return { version, duration, workspace, event, isolated_home: spec.home === undefined };
}

const observations = [];
// A Map, because the keys are runtime names read from a loop and a plain object as a keyed store
// is the shape the defect-class scanner refuses. Serialised below with Object.fromEntries.
const blockers = new Map();

for (const spec of RUNTIMES) {
  const outcome = invoke(spec);
  if (outcome.blocker !== undefined) {
    blockers.set(spec.runtime, outcome.blocker);
    continue;
  }
  const { event, version, duration, workspace, isolated_home: isolatedHome } = outcome;
  const ran = `${event.provider}/${event.model}`;
  // One agreement and one disagreement per runtime, which is what makes it a canary rather than a
  // demonstration: the declaration that is not what ran is the case an operator actually hits.
  const other = ran === "anthropic/claude-3-5-sonnet-20241022" ? "openai/gpt-4o-2024-08-06" : "anthropic/claude-3-5-sonnet-20241022";
  for (const declared of [ran, other]) {
    const provenance = resolveModelProvenance({ runtimeEvent: event, declared: { model: declared, provider: null } });
    const verification = verifyModelIdentity(provenance, [event], { runtime: spec.runtime });
    // No executable identity is invented here: an earlier version of this script supplied a
    // made-up VERIFIED record so the recorded policy would report the model half alone, which put
    // a fictional digest in a file whose whole purpose is to record what a machine produced.
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: null });
    const alias = aliasClassOf(ran);
    const line = canonicalModelEventLine(event);
    observations.push({
      runtime: spec.runtime,
      runtime_version: version,
      invocation: {
        command: `${spec.command} ${spec.args.slice(0, -1).join(" ")} <prompt>`.trim(),
        prompt: PROMPT,
        exit_code: 0,
        duration_ms: duration,
        // Whether the runtime ran under a HOME made for this capture, or under the operator's own
        // configuration because its credential lives in a per-account keychain. Either way the
        // workspace was fresh, which is what ties the transcript rows to this invocation.
        isolated_home: isolatedHome,
        // The path is a digest. Which directory this ran in is not information anybody needs.
        workspace_digest: sha256Bytes(Buffer.from(workspace, "utf8"))
      },
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
  // What this file is, stated where a reader meets it. Each observation is a real invocation of a
  // real runtime on one machine, read back through the product's own transcript reader -- and
  // nothing committed here proves that to anyone else, because the transcripts are unsigned local
  // files and there is no attestation channel between that machine and this repository. A reviewer
  // holding only the repository can check that the verdicts follow from the recorded events and
  // that the digests recompute; the capture itself is asserted, and says so.
  kind: "live-capture-replay",
  unverifiable_from_repository: "Each observation came from invoking the runtime and reading the transcript that invocation wrote. The transcripts are unsigned local files with no attestation channel to this repository, so the capture is asserted by this record and not proved by it. Re-run scripts/capture-model-canary.mjs to reproduce it on a machine with both runtimes authenticated.",
  capture: {
    platform: process.platform,
    command: "node scripts/capture-model-canary.mjs -- invokes each runtime once with a trivial prompt in a temporary HOME and reads the transcript that invocation wrote",
    note: "No transcript content and no absolute path is copied. `event_line` is the canonical form of the event this product carries forward and `event_digest` is the SHA-256 of its bytes, so the derived verdicts can be recomputed from what is written here."
  },
  blockers: Object.fromEntries(blockers),
  observations
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${observations.length} observation(s), ${blockers.size} blocker(s), written to ${out}\n`);
for (const [runtime, blocker] of blockers) process.stdout.write(`  blocked ${runtime}: ${blocker}\n`);
