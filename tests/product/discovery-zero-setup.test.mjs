// #574, Gate U. The operator gives a repository URL and a sentence. Everything below is what the
// coding agent does instead of asking them for it.
//
// The counters are the acceptance condition and they are asserted over the happy path, through the
// real binary: terminal commands 0, config edits 0, manual registrations 0, setup questions 0. They
// are derived from the emitted record rather than declared beside it, and the negative cases below
// move them -- a counter that is always zero would be a constant wearing an assertion's clothes.

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REASON_CODES } from "../../lib/discovery.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const scratch = () => mkdtempSync(join(tmpdir(), "aos-zero-setup-"));

const installRuntime = (root, { package_name, binary }) => {
  const dir = join(root, "node_modules", ...package_name.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: package_name, version: "1.0.0" }));
  const file = join(dir, "bin", binary);
  // Answers `--version` and nothing else: a discovery that reached for anything more would hang or
  // exit non-zero here rather than quietly succeeding.
  writeFileSync(file, `#!/bin/sh\ncase "$1" in --version) echo "${binary}-cli 1.2.3";; *) exit 64;; esac\n`);
  chmodSync(file, 0o755);
  return { file, pathDir: join(dir, "bin") };
};

/**
 * A host with a runtime installed, an operator HOME holding that runtime's own login state, and an
 * AOS home that has never been touched. No PATH edit, no registration, no configuration.
 */
const readyHost = (root) => {
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = join(root, "operator-home");
  mkdirSync(join(operatorHome, ".codex"), { recursive: true });
  writeFileSync(join(operatorHome, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "x" } }), { mode: 0o600 });
  writeFileSync(join(operatorHome, ".codex", "config.toml"), 'model = "gpt-5-codex"\n', { mode: 0o600 });
  return { pathDir, operatorHome, home: join(root, "aos-home") };
};

const discoverCli = (root, { pathDir, operatorHome, home }, args = ["--agent-mode", "--json"]) =>
  spawnSync(process.execPath, [cli, "discover", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    // Deliberately not the parent's environment: an ambient credential or an inherited PATH would
    // make the result a fact about the machine running the suite.
    env: { PATH: [pathDir, "/usr/bin", "/bin"].join(delimiter), HOME: operatorHome, AOS_HOME: home, LANG: process.env.LANG ?? "en_US.UTF-8" }
  });

test("a ready host is discovered with no terminal command, config edit, registration or question", () => {
  const root = scratch();
  const host = readyHost(root);
  const result = discoverCli(root, host);

  const record = JSON.parse(result.stdout);
  assert.equal(record.schema_id, "aos-discovery.v2");
  assert.deepEqual(record.zero_input, {
    terminal_commands: 0,
    config_edits: 0,
    manual_registration: 0,
    setup_questions: 0
  });
  assert.equal(record.next_action, null);
  assert.equal(record.tie_break, null);
  assert.equal(record.selected_runtime, "codex");
  assert.match(record.profile.profile_digest, /^[0-9a-f]{64}$/u);
  assert.equal(result.status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("agent mode writes JSON to stdout and the human log to stderr, and nothing else", () => {
  const root = scratch();
  const host = readyHost(root);
  const result = discoverCli(root, host);

  // Exactly one JSON document, with nothing before or after it: a consumer parses stdout whole.
  assert.match(result.stdout, /^\{[\s\S]*\}\n$/u);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.ok(result.stderr.length > 0, "the human log belongs on stderr");
  assert.ok(result.stderr.includes("IDENTITY_CHECKING"), "the stages walked are what the log is for");
  assert.ok(!result.stderr.includes("{\"schema_id\""), "the record must not be duplicated onto stderr");
  rmSync(root, { recursive: true, force: true });
});

test("discovery does not register an agent or edit the operator's configuration", () => {
  const root = scratch();
  const host = readyHost(root);
  const before = readdirSync(join(host.operatorHome, ".codex")).sort();
  discoverCli(root, host);

  assert.deepEqual(readdirSync(join(host.operatorHome, ".codex")).sort(), before);
  // The store may hold what discovery itself produced and nothing more: no agent was registered.
  const config = JSON.parse(readFileSync(join(host.home, "agents.json"), "utf8"));
  assert.deepEqual(Object.keys(config.agents), []);
  assert.ok(existsSync(join(host.home, "discovery-profiles.json")));
  rmSync(root, { recursive: true, force: true });
});

test("a host with no runtime asks for an install and never invents a default", () => {
  const root = scratch();
  const operatorHome = join(root, "operator-home");
  mkdirSync(operatorHome, { recursive: true });
  const empty = join(root, "empty");
  mkdirSync(empty, { recursive: true });
  const result = discoverCli(root, { pathDir: empty, operatorHome, home: join(root, "aos-home") });

  const record = JSON.parse(result.stdout);
  assert.equal(record.status, "ACTION_REQUIRED");
  assert.equal(record.reason_code, REASON_CODES.NO_RUNTIME);
  assert.equal(record.next_action.kind, "install_runtime");
  assert.equal(record.selected_runtime, null);
  assert.equal(record.profile, null);
  assert.equal(result.status, 3);
  rmSync(root, { recursive: true, force: true });
});

test("a runtime whose login has not been done asks the runtime for it, never the operator for a token", () => {
  const root = scratch();
  const host = readyHost(root);
  // The runtime's own configuration directory, gone. That is a provider-native login, which is the
  // one action this product may ask for.
  rmSync(join(host.operatorHome, ".codex"), { recursive: true, force: true });
  const result = discoverCli(root, host);

  const record = JSON.parse(result.stdout);
  assert.equal(record.status, "ACTION_REQUIRED");
  assert.equal(record.reason_code, REASON_CODES.PROVIDER_LOGIN_REQUIRED);
  assert.equal(record.next_action.kind, "provider_login");
  assert.equal(record.zero_input.terminal_commands, 1);
  assert.equal(record.zero_input.config_edits, 0);
  const text = JSON.stringify(record);
  assert.ok(!/export |setenv|OPENAI_API_KEY=|--allow-runtime-auth/u.test(text), "the operator is never asked to copy or export a token");
  rmSync(root, { recursive: true, force: true });
});

test("the record is emitted on stdout even when the host cannot be used", () => {
  const root = scratch();
  const operatorHome = join(root, "operator-home");
  mkdirSync(operatorHome, { recursive: true });
  const open = join(root, "open-bin");
  mkdirSync(open, { recursive: true });
  chmodSync(open, 0o777);
  const impostor = join(open, "codex");
  writeFileSync(impostor, "#!/bin/sh\nexit 0\n");
  chmodSync(impostor, 0o755);

  const result = discoverCli(root, { pathDir: open, operatorHome, home: join(root, "aos-home") });
  const record = JSON.parse(result.stdout);
  assert.equal(record.status, "BLOCKED");
  assert.equal(record.selected_runtime, null);
  assert.equal(result.status, 3);
  rmSync(root, { recursive: true, force: true });
});
