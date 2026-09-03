// #574. What the operator has to type before a measurement can start, and what happens when the
// machine answers the question wrongly.
//
// Before this file there was no answer at all: `aos init` registered whatever wore the right name
// on PATH, `agent doctor` reported readiness one row at a time, and nothing composed identity,
// credential, model, environment and isolation into a single decision about whether this host may
// issue a profile-bound number. An operator reached that decision by reading five surfaces and
// making it themselves -- which is the setup this issue exists to remove, and which is also where
// the unsafe answers were reachable: a same-name binary registered by `init`, a credential resolved
// for an executable nobody had identified, BEST_EFFORT reported beside an official-looking profile.
//
// Every case below is built out of real files in a temporary directory, because the subject is the
// filesystem reading in #554 and the package-declaration reading in #556. A mock of either would
// agree with whatever this module believed.

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  ADAPTER_PRIORITY,
  DISCOVERABLE_RUNTIMES,
  DISCOVERY_SCHEMA,
  DISCOVERY_STAGES,
  NEXT_ACTION_KINDS,
  PROFILE_LEDGER_SCHEMA,
  REASON_CODES,
  TERMINAL_STATUSES,
  TIE_BREAK_SCHEMA,
  credentialReadiness,
  discover,
  discoveryMachine,
  readProfileLedger,
  selectRuntime,
  zeroInputCounters
} from "../../lib/discovery.mjs";
import { SUPPORT_MATRIX_SCHEMA } from "../../lib/confinement.mjs";
import { describeExecutable } from "../../lib/runtime-identity.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-discovery-"));

/**
 * A runtime installed the way npm installs one: a package directory whose manifest publishes the
 * name the adapter is the adapter for, with the executable underneath it.
 *
 * The manifest is not decoration. `runtimeIdentityMatches` in lib/confinement.mjs walks up from the
 * verified executable looking for it, and a binary that merely wears the runtime's name does not
 * find one -- which is the case several tests below are about.
 */
const installRuntime = (root, { package_name, binary, body = "exit 0", mode = 0o755 }) => {
  const dir = join(root, "node_modules", ...package_name.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  if (package_name !== "") writeFileSync(join(dir, "package.json"), JSON.stringify({ name: package_name, version: "1.0.0" }));
  const file = join(dir, "bin", binary);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, mode);
  return { file, pathDir: join(dir, "bin") };
};

/** A binary wearing a runtime's name with no package behind it. */
const plainBinary = (root, name, { body = "exit 0", directoryMode = 0o755 } = {}) => {
  const dir = join(root, `bin-${name}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, directoryMode);
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return { file, pathDir: dir };
};

/** An AOS home with the given agents already registered, written the way `lib/store.mjs` writes. */
const homeWith = (root, agents = {}) => {
  const home = join(root, "aos-home");
  mkdirSync(join(home, "runs"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "agents.json"), JSON.stringify({ schema_id: "aos-config.v1", agents, collaboration_surfaces: {} }, null, 2));
  return home;
};

/** The operator's own HOME, with a runtime configuration directory in it when asked for. */
const operatorHomeWith = (root, { codexConfig = false } = {}) => {
  const home = join(root, "operator-home");
  mkdirSync(home, { recursive: true });
  if (codexConfig) {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: SECRET } }), { mode: 0o600 });
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt-5-codex"\n', { mode: 0o600 });
  }
  return home;
};

// A value shaped like nothing else in this repository, so its appearance anywhere in a discovery
// record is unambiguous.
const SECRET = "sk-aos-574-this-token-must-never-be-emitted";

const matrix = JSON.parse(readFileSync(new URL("../../fixtures/confinement/support-matrix.json", import.meta.url), "utf8"));

/** A backend probe that answers for a platform the test host may not be. */
const backendStub = (result) => () => ({ id: result.backend, platform: "test", probe: () => result });
const seatbeltAvailable = backendStub({ available: true, backend: "macos-seatbelt", level_ceiling: "STRICT", reason: null, deprecated: true });
const noBackend = backendStub({ available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: "AOS_ISOLATION_BACKEND_ABSENT sandbox-exec is not on PATH" });

// The version probe never runs a real binary in these tests: what it would return is the runtime's
// self-reported version, which is not what any assertion here is about.
const versionProbe = () => "codex-cli 1.2.3";

const baseOptions = (root, { home, pathDirs, operatorHome, platform = "darwin", backendFor = seatbeltAvailable, env = {} }) => ({
  home,
  platform,
  arch: "arm64",
  env: { PATH: pathDirs.join(delimiter), HOME: operatorHome, ...env },
  operatorHome,
  backendFor,
  matrix,
  probe: versionProbe
});

const agent = (id, command, adapter, extra = {}) => ({
  id,
  display_name: id,
  runtime_name: id,
  command,
  args: [],
  adapter,
  allowed_env_names: [],
  runtime_auth_env_names: [],
  transport_env_names: [],
  auto_runtime_auth: true,
  runtime_identity: null,
  model_id: null,
  config_digest: `sha256:${"0".repeat(64)}`,
  ...extra
});

// ------------------------------------------------------------------------------------------- //
// The state machine, and the one ordering the issue states as a rule rather than as a sequence.

test("the discovery stages are walked in the declared order and nothing may skip ahead", () => {
  const machine = discoveryMachine();
  for (const stage of DISCOVERY_STAGES) machine.enter(stage);
  assert.deepEqual(machine.visited, [...DISCOVERY_STAGES]);

  const skipping = discoveryMachine();
  skipping.enter("DISCOVERING");
  assert.throws(() => skipping.enter("ISOLATION_CHECKING"), /AOS_DISCOVERY_STAGE_OUT_OF_ORDER/u);
});

test("a credential is never looked up before the identity stage has run", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const home = homeWith(root, { claude: agent("claude", "claude", "claude-code.v1") });
  const operatorHome = operatorHomeWith(root);

  const machine = discoveryMachine();
  machine.enter("DISCOVERING");
  // The identity stage has not been entered, so there is no identity for a credential to be bound
  // to. Refusing afterwards does not put the credential back.
  assert.throws(
    () => credentialReadiness(machine, { adapter_id: "claude-code.v1", identity: { identity_status: "VERIFIED" } }, {
      env: { PATH: pathDir, HOME: operatorHome },
      operatorHome
    }),
    /AOS_DISCOVERY_CREDENTIAL_BEFORE_IDENTITY/u
  );
  rmSync(root, { recursive: true, force: true });
  assert.ok(home);
});

test("an unverified executable gets no credential lookup even inside the auth stage", () => {
  const root = scratch();
  const machine = discoveryMachine();
  machine.enter("DISCOVERING");
  machine.enter("IDENTITY_CHECKING");
  const operatorHome = operatorHomeWith(root);
  let reached = 0;
  const readiness = credentialReadiness(machine, {
    adapter_id: "claude-code.v1",
    identity: { identity_status: "UNTRUSTED", untrusted_reasons: ["world_writable /tmp"] },
    entry: agent("claude", "claude", "claude-code.v1")
  }, { env: { HOME: operatorHome }, operatorHome, resolveCredential: () => { reached += 1; return { name: "X", value: SECRET, source: "keychain" }; } });
  assert.equal(readiness.status, "BLOCKED");
  assert.equal(reached, 0, "the credential resolver must not be reached for an unverified executable");
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------- //
// The eleven scenarios the issue names.

test("a verified Codex install is discovered, selected and reported without anything to configure", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  assert.equal(record.schema_id, DISCOVERY_SCHEMA);
  assert.equal(record.selected_runtime, "codex");
  const codex = record.candidates.find((one) => one.id === "codex");
  assert.equal(codex.adapter_id, "codex-cli.v1");
  assert.equal(codex.identity.status, "VERIFIED");
  assert.equal(codex.identity.adapter_runtime_match, true);
  assert.deepEqual(record.zero_input, { terminal_commands: 0, config_edits: 0, manual_registration: 0, setup_questions: 0 });
  assert.equal(record.next_action, null);
  rmSync(root, { recursive: true, force: true });
});

test("a verified Claude Code install is discovered and selected when it is the only runtime", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const operatorHome = operatorHomeWith(root);
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  assert.equal(record.selected_runtime, "claude");
  const claude = record.candidates.find((one) => one.id === "claude");
  assert.equal(claude.identity.status, "VERIFIED");
  // Its STRICT lane is NOT_OBSERVED in the release table, so the honest ceiling is diagnostic.
  assert.notEqual(claude.support_status, "OFFICIAL");
  assert.notEqual(record.status, "OFFICIAL_READY");
  rmSync(root, { recursive: true, force: true });
});

test("both runtimes installed produces one deterministic winner and no question", () => {
  const root = scratch();
  const codex = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const claude = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [codex.pathDir, claude.pathDir], operatorHome }));

  assert.equal(record.candidates.length, 2);
  assert.equal(record.selected_runtime, "codex");
  assert.equal(record.tie_break, null);
  assert.equal(record.zero_input.setup_questions, 0);

  // And the same answer with the two runtimes in the other order on PATH: the winner is decided by
  // the priority list, not by which directory came first.
  const reversed = discover(baseOptions(root, { home, pathDirs: [claude.pathDir, codex.pathDir], operatorHome }));
  assert.equal(reversed.selected_runtime, "codex");
  rmSync(root, { recursive: true, force: true });
});

test("an existing profile for this exact configuration outranks a runtime with better official support", () => {
  const root = scratch();
  const codex = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const claude = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  // Codex carries an exact model, so on the seatbelt lane it is the host's one OFFICIAL runtime --
  // priority 3. Claude is diagnostic-only whatever it carries, because its STRICT lane is
  // NOT_OBSERVED in the release table.
  const home = homeWith(root, {
    codex: agent("codex", "codex", "codex-cli.v1", { model_id: "openai/gpt-4o-2024-08-06" }),
    claude: agent("claude", "claude", "claude-code.v1")
  });

  // Claude alone first, which files Claude's profile and nothing else.
  const claudeOnly = discover(baseOptions(root, { home, pathDirs: [claude.pathDir], operatorHome }));
  assert.equal(claudeOnly.selected_runtime, "claude");

  const both = discover(baseOptions(root, { home, pathDirs: [codex.pathDir, claude.pathDir], operatorHome }));
  assert.equal(both.candidates.find((one) => one.id === "codex").support_status, "OFFICIAL");
  assert.equal(both.candidates.find((one) => one.id === "claude").existing_profile, true);
  assert.equal(both.candidates.find((one) => one.id === "codex").existing_profile, false);
  assert.equal(both.selected_runtime, "claude");
  rmSync(root, { recursive: true, force: true });
});

test("no runtime on this machine is ACTION_REQUIRED with no selection and no default", () => {
  const root = scratch();
  const empty = join(root, "empty-path");
  mkdirSync(empty, { recursive: true });
  const operatorHome = operatorHomeWith(root);
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [empty], operatorHome }));

  assert.equal(record.status, "ACTION_REQUIRED");
  assert.equal(record.reason_code, REASON_CODES.NO_RUNTIME);
  assert.equal(record.selected_runtime, null);
  assert.equal(record.profile, null);
  assert.deepEqual(record.candidates, []);
  rmSync(root, { recursive: true, force: true });
});

test("a same-name binary in a directory somebody else can write is blocked, never selected", () => {
  const root = scratch();
  // A world-writable directory holding a program called `codex`. #554 records the executable as
  // UNTRUSTED; discovery must refuse it rather than rank it.
  const impostor = plainBinary(root, "codex", { directoryMode: 0o777 });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [impostor.pathDir], operatorHome }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.equal(candidate.identity.status, "UNTRUSTED");
  assert.equal(candidate.support_status, "BLOCKED");
  // Two gates refuse this candidate independently, and BLOCKED on its own names neither of them:
  // the support verdict reads #554's status back for itself, and the credential gate refuses to
  // look anything up for an executable that is not VERIFIED, which arrives here as `auth.status`.
  // Delete either one and the other still returns BLOCKED, so a test that stops at the outcome
  // holds neither. `blocked_reasons` is where they are individually visible -- one entry per gate
  // that refused, which is why the same code appears twice for one untrusted executable.
  assert.equal(candidate.auth.status, "BLOCKED");
  assert.deepEqual(candidate.blocked_reasons, [REASON_CODES.IDENTITY_UNVERIFIED, REASON_CODES.IDENTITY_UNVERIFIED]);
  assert.equal(record.selected_runtime, null);
  assert.equal(record.status, "BLOCKED");
  assert.equal(record.reason_code, REASON_CODES.ALL_CANDIDATES_BLOCKED);
  rmSync(root, { recursive: true, force: true });
});

test("a same-name binary the operator owns is not the adapter's runtime, so no credential is resolved for it", () => {
  const root = scratch();
  // Owned by this account, in a private directory: #554 verifies it. What it is not is the package
  // the adapter names, and the credential the adapter would resolve belongs to that package.
  const impostor = plainBinary(root, "claude");
  const operatorHome = operatorHomeWith(root);
  const home = homeWith(root, { claude: agent("claude", "claude", "claude-code.v1") });
  let resolverCalls = 0;
  const record = discover({
    ...baseOptions(root, { home, pathDirs: [impostor.pathDir], operatorHome }),
    resolveCredential: () => { resolverCalls += 1; return { name: "CLAUDE_CODE_OAUTH_TOKEN", value: SECRET, source: "keychain" }; }
  });

  const candidate = record.candidates.find((one) => one.id === "claude");
  assert.equal(candidate.identity.status, "VERIFIED");
  assert.equal(candidate.identity.adapter_runtime_match, false);
  assert.equal(candidate.auth.credential_withheld, true);
  assert.equal(resolverCalls, 0, "AOS must not read the operator's credential store for an executable it could not confirm is the runtime");
  assert.notEqual(candidate.support_status, "OFFICIAL");
  rmSync(root, { recursive: true, force: true });
});

test("a binary replaced since registration is reported as drift and the stored agent is not rewritten", () => {
  const root = scratch();
  const { pathDir, file } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });

  // Registered with the identity of the file as it is now, then the bytes are replaced.
  const registered = describeExecutable("codex", { env: { PATH: pathDir, HOME: operatorHome }, adapterId: "codex-cli.v1" });
  assert.equal(registered.identity_status, "VERIFIED");
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1", { runtime_identity: registered }) });
  writeFileSync(file, "#!/bin/sh\necho replaced\n");
  chmodSync(file, 0o755);

  const before = readFileSync(join(home, "agents.json"), "utf8");
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));
  assert.deepEqual(record.candidates.find((one) => one.id === "codex").identity.drift, ["file_fingerprint"]);
  assert.equal(readFileSync(join(home, "agents.json"), "utf8"), before, "discovery must not rewrite the registered identity");
  rmSync(root, { recursive: true, force: true });
});

test("an unknown model never reaches OFFICIAL_READY however good the rest of the host is", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1", { model_id: null }) });
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.equal(candidate.model.status, "WITHHELD");
  assert.equal(candidate.model.withheld_reason, "MODEL_UNKNOWN");
  assert.equal(candidate.model.id, null);
  assert.notEqual(candidate.support_status, "OFFICIAL");
  assert.equal(record.status, "DIAGNOSTIC_ONLY");
  rmSync(root, { recursive: true, force: true });
});

test("a mutable alias is not an exact model, so it is withheld rather than approved", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1", { model_id: "gpt-5-codex-latest" }) });
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.equal(candidate.model.status, "WITHHELD");
  assert.equal(candidate.model.withheld_reason, "MODEL_MUTABLE_ALIAS");
  assert.notEqual(candidate.support_status, "OFFICIAL");
  rmSync(root, { recursive: true, force: true });
});

test("a declared model the command line contradicts is a mismatch and blocks the candidate", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, {
    codex: agent("codex", "codex", "codex-cli.v1", { model_id: "openai/gpt-4o-2024-08-06", args: ["--model", "openai/gpt-4.1-2025-04-14"] })
  });
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.equal(candidate.model.status, "MISMATCH");
  assert.equal(candidate.support_status, "BLOCKED");
  // The mismatch is the whole reason, and saying so is what keeps this test a witness for the
  // model term rather than for whatever else might block a candidate one fixture change from now.
  assert.deepEqual(candidate.blocked_reasons, [REASON_CODES.MODEL_MISMATCH]);
  assert.equal(record.status, "BLOCKED");
  rmSync(root, { recursive: true, force: true });
});

test("STRICT unavailable on this host is DIAGNOSTIC_ONLY and never OFFICIAL_READY", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1", { model_id: "openai/gpt-4o-2024-08-06" }) });
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome, backendFor: noBackend }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.equal(candidate.isolation.backend_available, false);
  assert.equal(candidate.isolation.level, "BEST_EFFORT_CLI");
  assert.equal(candidate.support_status, "DIAGNOSTIC_ONLY");
  assert.equal(record.status, "DIAGNOSTIC_ONLY");
  assert.equal(record.reason_code, REASON_CODES.ISOLATION_NOT_STRICT);
  rmSync(root, { recursive: true, force: true });
});

test("an exact tie asks once, with a typed request and no answer of its own", () => {
  const root = scratch();
  const first = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const second = installRuntime(join(root, "second"), { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, {
    "codex-a": agent("codex-a", first.file, "codex-cli.v1"),
    "codex-b": agent("codex-b", second.file, "codex-cli.v1")
  });
  const record = discover(baseOptions(root, { home, pathDirs: [first.pathDir], operatorHome }));

  assert.equal(record.status, "ACTION_REQUIRED");
  assert.equal(record.reason_code, REASON_CODES.RUNTIME_TIE);
  assert.equal(record.selected_runtime, null);
  assert.equal(record.tie_break.schema_id, TIE_BREAK_SCHEMA);
  assert.deepEqual(record.tie_break.options.map((one) => one.id).sort(), ["codex-a", "codex-b"]);
  assert.equal(record.tie_break.asked_at_most_once, true);
  assert.equal(record.zero_input.setup_questions, 1);
  // Once, not once per discovery: a second run of the same host asks the same question under the
  // same id, so a relay that has already carried it has something to recognise it by.
  const again = discover(baseOptions(root, { home, pathDirs: [first.pathDir], operatorHome }));
  assert.equal(again.tie_break.question_id, record.tie_break.question_id);
  assert.equal(again.zero_input.setup_questions, 1);
  rmSync(root, { recursive: true, force: true });
});

test("repeated discovery creates no second profile and writes nothing", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const options = baseOptions(root, { home, pathDirs: [pathDir], operatorHome });

  const first = discover(options);
  const ledgerAfterFirst = readFileSync(join(home, "discovery-profiles.json"), "utf8");
  const second = discover(options);
  const ledgerAfterSecond = readFileSync(join(home, "discovery-profiles.json"), "utf8");

  assert.equal(first.profile.profile_digest, second.profile.profile_digest);
  assert.equal(ledgerAfterFirst, ledgerAfterSecond, "a repeat of the same discovery must write nothing");
  const ledger = readProfileLedger(home);
  assert.equal(ledger.schema_id, PROFILE_LEDGER_SCHEMA);
  assert.equal(ledger.profiles.length, 1);
  assert.equal(second.profile_reuse.reused, true);
  assert.equal(second.profile_reuse.created, false);
  rmSync(root, { recursive: true, force: true });
});

test("a changed host is a new profile beside the old one, and the old entry is left as it was", () => {
  const root = scratch();
  const { pathDir, file } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const options = baseOptions(root, { home, pathDirs: [pathDir], operatorHome });

  const first = discover(options);
  writeFileSync(file, "#!/bin/sh\necho rebuilt\n");
  chmodSync(file, 0o755);
  const second = discover(options);

  assert.notEqual(first.profile.profile_digest, second.profile.profile_digest);
  const ledger = readProfileLedger(home);
  assert.equal(ledger.profiles.length, 2);
  assert.ok(ledger.profiles.some((one) => one.profile_digest === first.profile.profile_digest));
  assert.equal(second.profile_reuse.created, true);
  rmSync(root, { recursive: true, force: true });
});

test("an open cycle is never rewritten by discovery, and a profile that no longer matches it is named", () => {
  const root = scratch();
  const { pathDir, file } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const options = baseOptions(root, { home, pathDirs: [pathDir], operatorHome });

  const first = discover(options);
  writeFileSync(join(home, "cycle.json"), JSON.stringify({
    schema_id: "aos-cycle.v1", cycle_id: "cycle-574", profile_digest: first.profile.profile_digest,
    suite_major: 1, scorer_major: 1, seeds: ["a1", "b2", "c3"], runs: []
  }, null, 2));
  const before = readFileSync(join(home, "cycle.json"), "utf8");

  writeFileSync(file, "#!/bin/sh\necho rebuilt\n");
  chmodSync(file, 0o755);
  const second = discover(options);

  assert.equal(readFileSync(join(home, "cycle.json"), "utf8"), before, "discovery must not write the open cycle");
  assert.equal(second.profile_reuse.active_cycle_matches, false);
  assert.equal(second.profile_reuse.active_cycle_profile_digest, first.profile.profile_digest);
  rmSync(root, { recursive: true, force: true });
});

test("a ledger entry that claims a status does not supply one: every fact is re-read", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const options = baseOptions(root, { home, pathDirs: [pathDir], operatorHome });

  discover(options);
  const ledger = JSON.parse(readFileSync(join(home, "discovery-profiles.json"), "utf8"));
  // A cache that could speak would be an authority. It is asked one question -- have I seen this
  // digest -- and everything else on it is ignored.
  ledger.profiles[0].support_status = "OFFICIAL";
  ledger.profiles[0].model_id = "openai/gpt-4o-2024-08-06";
  writeFileSync(join(home, "discovery-profiles.json"), JSON.stringify(ledger, null, 2));

  const second = discover(options);
  assert.notEqual(second.status, "OFFICIAL_READY");
  assert.equal(second.candidates.find((one) => one.id === "codex").model.id, null);
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------- //
// What must never reach the operator's terminal or a pasted record.

test("no credential value and no path from this machine reaches the discovery record", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1") });
  const record = discover({
    ...baseOptions(root, { home, pathDirs: [pathDir], operatorHome, env: { OPENAI_API_KEY: SECRET, CLAUDE_CODE_OAUTH_TOKEN: SECRET } }),
    resolveCredential: () => ({ name: "OPENAI_API_KEY", value: SECRET, source: "environment" })
  });
  const text = JSON.stringify(record);

  assert.ok(!text.includes(SECRET), "a credential value must never reach the record");
  assert.ok(!text.includes(operatorHome), "the operator's home must never reach the record");
  assert.ok(!text.includes(pathDir), "the resolved executable path must never reach the record");
  const absolute = [];
  const walk = (value) => {
    if (typeof value === "string") { if (value.startsWith("/")) absolute.push(value); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(record);
  assert.deepEqual(absolute, [], "no absolute path may appear anywhere in the record");
  rmSync(root, { recursive: true, force: true });
});

test("a refused candidate names the class of problem and never the path it was found at", () => {
  const root = scratch();
  const impostor = plainBinary(root, "codex", { directoryMode: 0o777 });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const record = discover(baseOptions(root, { home, pathDirs: [impostor.pathDir], operatorHome }));

  const candidate = record.candidates.find((one) => one.id === "codex");
  assert.deepEqual(candidate.identity.untrusted_reasons, ["world_writable"]);
  const text = JSON.stringify(record);
  assert.ok(!text.includes(impostor.pathDir), "the directory the refused binary was found in is a private path");
  assert.ok(!text.includes(root));
  rmSync(root, { recursive: true, force: true });
});

test("a resolved credential reaches the record as a name and a source, never as a value", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const operatorHome = operatorHomeWith(root);
  const home = homeWith(root, { claude: agent("claude", "claude", "claude-code.v1") });
  const record = discover({
    ...baseOptions(root, { home, pathDirs: [pathDir], operatorHome }),
    resolveCredential: () => ({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: SECRET, source: "keychain" })
  });

  const candidate = record.candidates.find((one) => one.id === "claude");
  assert.equal(candidate.auth.status, "RESOLVED");
  assert.deepEqual(candidate.auth.credential, { name: "CLAUDE_CODE_OAUTH_TOKEN", source: "keychain" });
  assert.ok(!JSON.stringify(record).includes(SECRET), "the credential value must not survive into the record");
  rmSync(root, { recursive: true, force: true });
});

test("an explanation borrowed from another module reaches the record without the paths it named", () => {
  const root = scratch();
  // Claude Code, because its adapter has a credential resolver: that is what takes the identity
  // gate past its early exit and produces #554's own refusal, which quotes the configured command
  // and the remedy -- two absolute paths, in prose written for a terminal.
  const { pathDir, file } = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const operatorHome = operatorHomeWith(root);
  const registered = describeExecutable(file, { env: { PATH: pathDir, HOME: operatorHome }, adapterId: "claude-code.v1" });
  const home = homeWith(root, { claude: agent("claude", file, "claude-code.v1", { runtime_identity: registered }) });
  writeFileSync(file, "#!/bin/sh\necho replaced\n");
  chmodSync(file, 0o755);

  const record = discover({
    ...baseOptions(root, { home, pathDirs: [pathDir], operatorHome }),
    // A backend whose refusal quotes a path as well, which is the other side of the same class.
    backendFor: () => ({ id: "macos-seatbelt", platform: "test", probe: () => ({ available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: `AOS_ISOLATION_BACKEND_ABSENT ${join(root, "nowhere", "sandbox-exec")} did not apply` }) }),
    resolveCredential: () => null
  });

  const candidate = record.candidates.find((one) => one.id === "claude");
  assert.deepEqual(candidate.identity.drift, ["file_fingerprint"]);
  assert.equal(candidate.auth.reason, "AOS_RUNTIME_IDENTITY_DRIFT");
  assert.ok(candidate.auth.detail.includes("<path>"), `the borrowed refusal kept its paths: ${candidate.auth.detail}`);
  assert.ok(candidate.isolation.probe_reason.includes("<path>"));
  assert.ok(!JSON.stringify(record).includes(root), "no path on this machine may reach the record");
  rmSync(root, { recursive: true, force: true });
});

test("the login this product asks for names the runtime it belongs to", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  // No configuration directory: the runtime has never been signed in to on this machine.
  const operatorHome = operatorHomeWith(root);
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1", { model_id: "openai/gpt-4o-2024-08-06" }) });
  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));

  assert.equal(record.status, "ACTION_REQUIRED");
  assert.equal(record.next_action.kind, "provider_login");
  assert.equal(record.next_action.runtime, "codex");
  assert.ok(record.next_action.detail.includes("codex-cli.v1"), record.next_action.detail);
  assert.ok(!record.next_action.detail.includes("undefined"));
  rmSync(root, { recursive: true, force: true });
});

test("a cycle file this product cannot read is not reported as no cycle at all", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  writeFileSync(join(home, "cycle.json"), "{ not json");

  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));
  assert.equal(record.profile_reuse.active_cycle_unreadable, true);
  assert.equal(record.profile_reuse.active_cycle_profile_digest, null);
  assert.equal(record.profile_reuse.active_cycle_matches, null);
  rmSync(root, { recursive: true, force: true });
});

test("a store this product cannot read is said, not presented as a machine with no history", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  writeFileSync(join(home, "agents.json"), "{ not json");

  const record = discover(baseOptions(root, { home, pathDirs: [pathDir], operatorHome }));
  assert.equal(record.store_unreadable, true);
  // And the answer is still an answer: the runtime on PATH is measured either way.
  assert.equal(record.selected_runtime, "codex");
  rmSync(root, { recursive: true, force: true });
});

test("the platform a caller describes never decides how this machine's filesystem is read", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root);
  const asked = [];
  // Describing darwin from wherever this runs. The lane, the backend and the profile are darwin's;
  // the executable identity is this machine's, because that is the only machine whose ACLs, owners
  // and modes exist. A described platform handed to #554 skips the ACL walk on a host that has
  // ACLs, and an executable anybody could replace comes back VERIFIED.
  discover({
    ...baseOptions(root, { home, pathDirs: [pathDir], operatorHome, platform: "darwin" }),
    identify: (command, options) => {
      asked.push(options.platform);
      return describeExecutable(command, options);
    }
  });
  assert.ok(asked.length > 0);
  for (const platform of asked) assert.equal(platform, process.platform);
  rmSync(root, { recursive: true, force: true });
});

test("the runtime is invoked with nothing but --version, so discovery spends no provider quota", () => {
  const root = scratch();
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = operatorHomeWith(root, { codexConfig: true });
  const home = homeWith(root, { codex: agent("codex", "codex", "codex-cli.v1") });
  const invocations = [];
  discover({
    ...baseOptions(root, { home, pathDirs: [pathDir], operatorHome }),
    probe: (command, args) => { invocations.push(args); return "codex-cli 1.2.3"; }
  });
  assert.ok(invocations.length > 0, "the version probe is expected to run");
  for (const args of invocations) assert.deepEqual(args, ["--version"]);
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------- //
// Selection, one priority at a time.

const rank = (over) => ({
  id: "x",
  adapter_id: "codex-cli.v1",
  support_status: "DIAGNOSTIC_ONLY",
  orchestrating: false,
  reliably_identified: true,
  existing_profile: false,
  evidence_completeness: 0,
  ...over
});

test("selection priority 1: a reliably identified runtime that is currently orchestrating wins", () => {
  const { selected } = selectRuntime([
    rank({ id: "other", support_status: "OFFICIAL", evidence_completeness: 4 }),
    rank({ id: "host", orchestrating: true, support_status: "DIAGNOSTIC_ONLY" })
  ]);
  assert.equal(selected.id, "host");
});

test("an orchestration signal on a runtime this product could not identify does not reach priority 1", () => {
  const { selected } = selectRuntime([
    rank({ id: "claimant", orchestrating: true, reliably_identified: false, evidence_completeness: 4 }),
    rank({ id: "official", support_status: "OFFICIAL", evidence_completeness: 0 })
  ]);
  assert.equal(selected.id, "official");
});

test("selection priority 2: an existing exact profile wins over better official support", () => {
  const { selected } = selectRuntime([
    rank({ id: "official", support_status: "OFFICIAL", evidence_completeness: 4 }),
    rank({ id: "known", existing_profile: true })
  ]);
  assert.equal(selected.id, "known");
});

test("selection priority 3: actual official support wins over evidence completeness", () => {
  const { selected } = selectRuntime([
    rank({ id: "complete", evidence_completeness: 4 }),
    rank({ id: "official", support_status: "OFFICIAL", evidence_completeness: 1 })
  ]);
  assert.equal(selected.id, "official");
});

test("selection priority 4: more complete identity, model and auth evidence wins", () => {
  const { selected } = selectRuntime([
    rank({ id: "thin", evidence_completeness: 1 }),
    rank({ id: "thick", evidence_completeness: 3 })
  ]);
  assert.equal(selected.id, "thick");
});

test("selection priority 5: adapters break the remaining ties in a declared order", () => {
  const { selected, tie } = selectRuntime([
    rank({ id: "generic", adapter_id: "generic-command.v1" }),
    rank({ id: "codex", adapter_id: "codex-cli.v1" })
  ]);
  assert.equal(selected.id, "codex");
  assert.equal(tie, null);
  assert.deepEqual(ADAPTER_PRIORITY, ["codex-cli.v1", "claude-code.v1", "generic-command.v1"]);
});

test("a blocked candidate is never selected, even when it is the only one left", () => {
  const { selected, tie } = selectRuntime([rank({ id: "unsafe", support_status: "BLOCKED", evidence_completeness: 4 })]);
  assert.equal(selected, null);
  assert.equal(tie, null);
});

test("an orchestration signal cannot upgrade a blocked candidate or invent one", () => {
  const { selected } = selectRuntime([
    rank({ id: "unsafe", support_status: "BLOCKED", orchestrating: true, evidence_completeness: 4 }),
    rank({ id: "safe" })
  ]);
  assert.equal(selected.id, "safe");
});

test("two candidates equal on every priority are a tie rather than an arbitrary winner", () => {
  const { selected, tie } = selectRuntime([rank({ id: "a" }), rank({ id: "b" })]);
  assert.equal(selected, null);
  assert.deepEqual(tie.map((one) => one.id).sort(), ["a", "b"]);
});

// ------------------------------------------------------------------------------------------- //
// The counters, and the shape of what may be asked.

test("the zero-input counters are derived from the record and are not constants", () => {
  const happy = zeroInputCounters({ next_action: null, tie_break: null });
  assert.deepEqual(happy, { terminal_commands: 0, config_edits: 0, manual_registration: 0, setup_questions: 0 });

  const asked = zeroInputCounters({ next_action: { kind: "provider_login" }, tie_break: { options: [] } });
  assert.equal(asked.terminal_commands, 1);
  assert.equal(asked.setup_questions, 1);
});

test("no next action this module can emit asks for a config edit, a token or a manual registration", () => {
  assert.deepEqual([...NEXT_ACTION_KINDS].sort(), ["install_runtime", "provider_login", "resolve_runtime_tie", "review_blocked_runtime"]);
  for (const kind of NEXT_ACTION_KINDS) {
    assert.ok(!/token|export|env|config|register/u.test(kind), `${kind} would be setup work the operator must not be asked for`);
  }
});

test("the discovery vocabulary is exactly what the issue declares", () => {
  assert.deepEqual([...DISCOVERY_STAGES], [
    "DISCOVERING", "IDENTITY_CHECKING", "AUTH_CHECKING", "MODEL_CHECKING", "ENV_CHECKING", "ISOLATION_CHECKING", "PROFILE_BUILDING"
  ]);
  assert.deepEqual([...TERMINAL_STATUSES], ["OFFICIAL_READY", "DIAGNOSTIC_ONLY", "ACTION_REQUIRED", "BLOCKED", "FAILED"]);
  assert.equal(matrix.schema, SUPPORT_MATRIX_SCHEMA);
  assert.deepEqual(DISCOVERABLE_RUNTIMES.map((one) => one.id), ["codex", "claude"]);
});
