import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAgentEnv, isolationRecord } from "../../lib/isolation.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import { addAgent } from "../../lib/store.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const temporary = () => mkdtempSync(join(tmpdir(), "aos-runtime-auth-"));

const aos = (home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, AOS_HOME: home, HOME: home }
  });

// #459. The refusal that sent an operator here read "point the runtime at a config directory
// instead", which is a claim about every runtime made from one of them. Codex reads
// CODEX_HOME/auth.json, so it is true there. Claude Code on macOS keeps its credential in the
// login Keychain, and the Keychain is found through HOME -- the one thing isolation replaces. The
// config directory carried nothing, all six families exited 1 with `Not logged in · Please run
// /login`, and 4 of 20 metrics were observed, so the score was withheld for coverage. The run
// measured an authentication boundary and reported it as operator behaviour.
test("the claude-code adapter names the credential variables the binary actually reads", () => {
  assert.deepEqual(
    ADAPTERS["claude-code.v1"].auth_env,
    ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]
  );
  // Not permissive by default. An adapter for a runtime nobody described cannot name a credential
  // without guessing which of the operator's secrets to hand over.
  assert.deepEqual(ADAPTERS["generic-command.v1"].auth_env, []);
});

test("--allow-env still refuses a credential, and now says which door to use", () => {
  const home = temporary();
  try {
    const refused = aos(home, [
      "agent", "add", "cc", "--command", "/bin/echo",
      "--adapter", "claude-code.v1", "--allow-env", "CLAUDE_CODE_OAUTH_TOKEN"
    ]);
    assert.notEqual(refused.status, 0);
    const said = refused.stdout + refused.stderr;
    assert.match(said, /AOS_CREDENTIAL_ENV_REFUSED/);
    // The old message sent the operator to a config directory that cannot hold this credential.
    assert.match(said, /--allow-runtime-auth/);
    assert.doesNotMatch(said, /point the runtime at a config directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--allow-env keeps pointing at a config directory when that is the real remedy", () => {
  const home = temporary();
  try {
    // Not one of claude-code's own credential names, so the honest advice is unchanged.
    const refused = aos(home, [
      "agent", "add", "cc", "--command", "/bin/echo",
      "--adapter", "claude-code.v1", "--allow-env", "ACME_PROD_DB_PASSWORD"
    ]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stdout + refused.stderr, /point the runtime at a config directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--allow-runtime-auth admits only what this adapter reads", () => {
  const home = temporary();
  try {
    const ok = aos(home, [
      "agent", "add", "cc", "--command", "/bin/echo",
      "--adapter", "claude-code.v1", "--allow-runtime-auth", "CLAUDE_CODE_OAUTH_TOKEN"
    ]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);

    // A real credential, but not this runtime's. The door is not a general credential door.
    const wrongRuntime = aos(home, [
      "agent", "add", "cx", "--command", "/bin/echo",
      "--adapter", "claude-code.v1", "--allow-runtime-auth", "OPENAI_API_KEY"
    ]);
    assert.notEqual(wrongRuntime.status, 0);
    assert.match(wrongRuntime.stdout + wrongRuntime.stderr, /AOS_UNKNOWN_RUNTIME_AUTH_ENV OPENAI_API_KEY/);

    // An adapter with no known credential variable refuses everything rather than defaulting open.
    const unknownRuntime = aos(home, [
      "agent", "add", "gg", "--command", "/bin/echo",
      "--adapter", "generic-command.v1", "--allow-runtime-auth", "CLAUDE_CODE_OAUTH_TOKEN"
    ]);
    assert.notEqual(unknownRuntime.status, 0);
    assert.match(unknownRuntime.stdout + unknownRuntime.stderr, /no known credential variable/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a declared runtime credential reaches the agent; an undeclared one still does not", () => {
  const source = {
    PATH: "/usr/bin",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-declared",
    ANTHROPIC_API_KEY: "sk-ant-undeclared",
    AWS_SECRET_ACCESS_KEY: "aws-undeclared"
  };
  const built = buildAgentEnv("BEST_EFFORT_CLI", source, {
    runtimeAuth: ["CLAUDE_CODE_OAUTH_TOKEN"],
    home: "/tmp/fake-home"
  });

  assert.equal(built.env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat-declared");
  // Declaring one name must not open the whole adapter list, and must not touch the shape rule.
  assert.equal(Object.hasOwn(built.env, "ANTHROPIC_API_KEY"), false);
  assert.equal(Object.hasOwn(built.env, "AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(built.env.HOME, "/tmp/fake-home");

  // Reported apart from ordinary carried names: "the agent could see a credential" is a different
  // statement about a run than "the agent could see PATH".
  assert.deepEqual(built.runtime_auth, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  const record = isolationRecord(built.level, {
    removed: built.removed, carried: built.carried, runtimeAuth: built.runtime_auth, home: "/tmp/fake-home"
  });
  assert.deepEqual(record.runtime_auth_env_names, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  // Values are never recorded, only names.
  assert.equal(JSON.stringify(record).includes("sk-ant-oat-declared"), false);
});

test("a name declared but absent from the environment is not reported as carried", () => {
  // Otherwise the result claims the agent was handed a credential it never received, and the next
  // reader takes a failed run for an authenticated one.
  const built = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin" }, {
    runtimeAuth: ["CLAUDE_CODE_OAUTH_TOKEN"],
    home: "/tmp/fake-home"
  });
  assert.deepEqual(built.runtime_auth, []);
});

test("handing the agent a credential changes the agent's digest", () => {
  const bare = temporary();
  const withAuth = temporary();
  try {
    const spec = { id: "cc", command: "/usr/bin/claude", args: ["-p"], adapter: "claude-code.v1" };
    const a = addAgent(bare, spec);
    const b = addAgent(withAuth, { ...spec, runtime_auth_env_names: ["CLAUDE_CODE_OAUTH_TOKEN"] });
    // Two runs that differ on whether a credential travelled are not the same environment, so they
    // must not compare as one. The digest is what a cycle checks before counting a run.
    assert.notEqual(a.config_digest, b.config_digest);
    assert.deepEqual(b.runtime_auth_env_names, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  } finally {
    for (const dir of [bare, withAuth]) rmSync(dir, { recursive: true, force: true });
  }
});

test("agent doctor answers the credential question before the quota is spent", () => {
  // The whole cost of #459 was that nothing asked this until six families had been paid for. On
  // v0.1.4 `agent doctor` returned PASS and exit 0 for an agent that could not log in, and said so
  // in its own footer: "this checks the command resolves, not that it can authenticate".
  const home = temporary();
  try {
    const add = (extra) =>
      aos(home, ["agent", "add", "cc", "--command", "/usr/bin/true", "--adapter", "claude-code.v1", ...extra]);
    const doctorWith = (token) =>
      spawnSync(process.execPath, [cli, "agent", "doctor"], {
        encoding: "utf8",
        env: { ...process.env, AOS_HOME: home, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token }
      });

    add([]);
    const undeclared = doctorWith("");
    assert.equal(undeclared.status, 3);
    assert.match(undeclared.stdout, /FAIL\tcc:auth\tno declared credential path/);
    assert.match(undeclared.stdout, /--allow-runtime-auth CLAUDE_CODE_OAUTH_TOKEN/);

    add(["--allow-runtime-auth", "CLAUDE_CODE_OAUTH_TOKEN"]);
    assert.equal(doctorWith("sk-ant-oat-present").status, 0);

    // Declared and absent is worse than undeclared: the operator believes it is handled.
    const missing = doctorWith("");
    assert.equal(missing.status, 3);
    assert.match(missing.stdout, /declared CLAUDE_CODE_OAUTH_TOKEN but not set in this environment/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unrecognised runtime is not failed for a credential nobody described", () => {
  const home = temporary();
  try {
    aos(home, ["agent", "add", "gg", "--command", "/usr/bin/true"]);
    const result = aos(home, ["agent", "doctor", "gg"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS\tgg:auth\t.*no known credential path, not checked/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
