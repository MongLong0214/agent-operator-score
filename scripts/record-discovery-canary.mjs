// Records the discovery canary this release ships: what `aos discover` actually answers on a
// machine with the runtimes installed on it.
//
// Committed as a script rather than run by hand, because the fixture is evidence and evidence
// nobody can reproduce is a claim. It writes fixtures/discovery/local-canary.darwin.json and
// touches nothing in the operator's own store: both lanes run against temporary AOS homes.
//
// It reads the machine and never a provider: the record it writes carries names, statuses and
// digests, and `tests/product/discovery-canary.test.mjs` refuses it if an absolute path or
// anything credential-shaped ever reaches it.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discover } from "../lib/discovery.mjs";
import { addAgent, initHome } from "../lib/store.mjs";
import { describeExecutable } from "../lib/runtime-identity.mjs";

const root = mkdtempSync(join(tmpdir(), "aos-574-canary-"));

// Lane 1: nothing configured at all.
const bare = join(root, "zero-config");
const zero = discover({ home: bare });

// Lane 2: the operator has registered codex once, with the exact model they run it on.
const registered = join(root, "registered");
initHome(registered);
addAgent(registered, {
  id: "codex", command: "codex", args: ["exec", "--skip-git-repo-check"], adapter: "codex-cli.v1",
  runtime_name: "codex", allowed_env_names: ["CODEX_HOME"], model_id: "openai/gpt-5-2025-08-07",
  runtime_identity: describeExecutable("codex", { adapterId: "codex-cli.v1" })
});
const official = discover({ home: registered });

const os = spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim();
const kernel = spawnSync("/usr/bin/uname", ["-r"], { encoding: "utf8" }).stdout.trim();
const codexVersion = spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim();

const fixture = {
  schema: "aos-discovery-canary.v1",
  recorded_on: `darwin ${kernel} ${process.arch}, macOS ${os}`,
  runtime_observed: codexVersion,
  node_version: process.versions.node,
  note: "Produced by scripts/record-discovery-canary.mjs against the runtimes actually installed on that machine. Both lanes ran the real `aos discover` path: the real PATH, the real executable identity reading, the real seatbelt probe and the committed support matrix. Neither lane made a provider call, and neither read a credential value -- the record carries names and digests only, which is why it is committable.",
  lanes: [
    {
      lane: "zero-config",
      note: "A machine where nothing has been configured. Every term of the official conjunction is true except the model: nothing on the command line names one and nothing was declared, so the model is unknown and the honest ceiling is diagnostic. This is what a bare host reaches, and it is the reason the release cannot promise OFFICIAL_READY with no registration at all.",
      record: zero
    },
    {
      lane: "official-pairing",
      note: "The same machine after one registration carrying the exact model the operator runs codex on. Identity verified by #554, confirmed to be @openai/codex by #556, the runtime's own login present in its configuration directory, an exact-snapshot model, the allowlist environment granted, and the darwin/macos-seatbelt/codex-cli.v1 STRICT lane the release proved. That is the official pairing this issue requires evidence of.",
      record: official
    }
  ]
};
writeFileSync(new URL("../fixtures/discovery/local-canary.darwin.json", import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log("zero-config:", zero.status, zero.reason_code, "selected", zero.selected_runtime);
console.log("official   :", official.status, official.reason_code, "selected", official.selected_runtime, official.profile?.profile_digest);
