import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAgentEnv, isSensitiveName, isolationRecord, SCORING_ISOLATION } from "../../lib/isolation.mjs";
import { envPolicyFor } from "../../lib/env-policy.mjs";
import { runProcess } from "../../lib/core.mjs";
import { run } from "./helpers.mjs";

const SOURCE = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/someone",
  LANG: "en_US.UTF-8",
  AWS_SECRET_ACCESS_KEY: "aws",
  AWS_REGION: "eu-west-1",
  GITHUB_TOKEN: "gh",
  GH_TOKEN: "gh",
  OPENAI_API_KEY: "oa",
  ANTHROPIC_API_KEY: "an",
  DATABASE_URL: "postgres://user:pw@host/db",
  SSH_AUTH_SOCK: "/tmp/agent.sock",
  NPM_TOKEN: "npm",
  NODE_OPTIONS: "--require /tmp/evil.mjs",
  ACME_PROD_DB_PASSWORD: "nobody listed this one",
  MY_SERVICE_TOKEN: "nor this",
  EDITOR: "vim",
  PROJECT_ROOT: "/work"
};

const names = (env) => Object.keys(env).sort();

test("every credential-shaped name is removed at both scoring levels", () => {
  // A named list alone is not the defence: the two invented names below are in no list, and the
  // operator's machine is full of names nobody thought of.
  for (const level of ["STRICT", "BEST_EFFORT_CLI"]) {
    const { env, removed } = buildAgentEnv(level, SOURCE);
    for (const secret of [
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "DATABASE_URL",
      "SSH_AUTH_SOCK",
      "NPM_TOKEN",
      "ACME_PROD_DB_PASSWORD",
      "MY_SERVICE_TOKEN"
    ]) {
      assert.equal(Object.hasOwn(env, secret), false, `${secret} survived ${level}`);
      assert.equal(removed.includes(secret), true, `${secret} was dropped without being reported in ${level}`);
    }
  }
});

test("NODE_OPTIONS never travels", () => {
  // An inherited --require runs before the agent's own first line, which is a way to change what
  // the assessed process is without changing the command that was recorded.
  for (const level of ["STRICT", "BEST_EFFORT_CLI"]) {
    assert.equal(Object.hasOwn(buildAgentEnv(level, SOURCE).env, "NODE_OPTIONS"), false, level);
  }
});

test("both scoring levels are deny-by-default", () => {
  // BEST_EFFORT_CLI used to keep the rest of the operator's environment so an already-logged-in CLI
  // would work, and that is what this test used to assert. It is no longer true and should not be:
  // "keep everything except the dangerous names" is a denylist, and the names that matter are the
  // ones nobody has listed yet. What a logged-in CLI needs is one declared config directory, which
  // is the next test, not the operator's shell.
  for (const level of ["STRICT", "BEST_EFFORT_CLI"]) {
    const built = buildAgentEnv(level, SOURCE);
    assert.equal(Object.hasOwn(built.env, "EDITOR"), false, `${level} kept an unrelated variable`);
    assert.equal(Object.hasOwn(built.env, "PROJECT_ROOT"), false, level);
    assert.equal(names(built.env).includes("PATH"), true, `${level} dropped PATH and nothing could run`);
    assert.equal(built.removed.includes("EDITOR"), true, `${level}: a dropped name should be reported`);
  }
});

test("an explicitly allowed name travels and is reported by name", () => {
  // An adapter may genuinely need one. It is carried on purpose, and the result says so rather
  // than leaving the reader to assume the environment was empty.
  //
  // The name used to be `ANTHROPIC_API_KEY`, which made this test the counter-example to the one
  // above it: `every credential-shaped name is removed at both scoring levels` was false whenever
  // somebody declared one. `aos agent add` had refused that declaration since before #555 and the
  // builder had not, so the product's claim and its code disagreed and this test encoded the
  // disagreement. A config directory is what the claim was always about.
  const { env, carried, explicit, removed } = buildAgentEnv("STRICT", { ...SOURCE, CODEX_HOME: "/tmp/codex" }, { allow: ["CODEX_HOME"] });
  assert.equal(env.CODEX_HOME, "/tmp/codex");
  // `carried` is now every name the child actually has, so that a record cannot describe an
  // environment the agent did not run in; `explicit` is the narrower question this test asks --
  // which of them the operator named rather than which the structure of a process requires.
  assert.deepEqual(explicit, ["CODEX_HOME"]);
  assert.equal(carried.includes("CODEX_HOME"), true);
  assert.equal(removed.includes("CODEX_HOME"), false);
  assert.equal(Object.hasOwn(env, "OPENAI_API_KEY"), false, "allowing one name allowed another");
});

test("a credential-shaped name cannot become an ordinary allowed name, by flag or by file", () => {
  // The other half of the claim above, and the route that actually worked. `aos agent add` refused
  // `--allow-env GH_TOKEN` and nothing repeated the refusal where a spawn could see it, so a
  // configuration file edited by hand carried the operator's token into the child and the record
  // filed it as an ordinary declared name.
  assert.throws(
    () => buildAgentEnv("STRICT", SOURCE, { allow: ["ANTHROPIC_API_KEY"] }),
    /AOS_ENV_POLICY_MISMATCH ANTHROPIC_API_KEY is credential-shaped/
  );
  // And a policy object that never passed that check still does not carry one: the construction
  // refusal is not the last line, because a policy does not have to arrive from the constructor.
  const forged = { ...envPolicyFor(null, {}), config_env: ["GH_TOKEN", "ACME_DEPLOY_TOKEN"] };
  const built = buildAgentEnv("STRICT", { ...SOURCE, ACME_DEPLOY_TOKEN: "ghp-not-real" }, { policy: forged });
  assert.equal(Object.hasOwn(built.env, "GH_TOKEN"), false, "a hand-forged policy carried a credential");
  assert.equal(Object.hasOwn(built.env, "ACME_DEPLOY_TOKEN"), false);
  assert.equal(built.removed.includes("GH_TOKEN"), true, "it was refused without being reported");
  // The record cannot go on quoting the digest of the object before it was tampered with.
  assert.notEqual(built.policy.policy_digest, envPolicyFor(null, {}).policy_digest);
});

test("HOME is replaced, never inherited", () => {
  // ~/.aws/credentials and ~/.ssh are one path expansion away from an inherited HOME.
  const { env } = buildAgentEnv("BEST_EFFORT_CLI", SOURCE, { home: "/tmp/agent-home" });
  assert.equal(env.HOME, "/tmp/agent-home");
  assert.equal(env.TMPDIR, "/tmp/agent-home");
});

test("no secret value is ever recorded, only names", () => {
  // Built from the real process.env, not from the fixture. A record that looked up the removed
  // names against the live environment would leak on this machine while a fixture-only test kept
  // reporting nulls and passing.
  const marker = "ghp_valuethatmustneverbewrittendown00";
  process.env.ACME_RECORD_TOKEN = marker;
  try {
    const built = buildAgentEnv("BEST_EFFORT_CLI", process.env);
    const record = isolationRecord("BEST_EFFORT_CLI", built);
    const serialized = JSON.stringify(record);
    assert.equal(record.removed_env_names.includes("ACME_RECORD_TOKEN"), true, "the name should be reported");
    assert.equal(serialized.includes(marker), false, "a removed variable's value reached the record");
    for (const value of Object.values(process.env)) {
      if (typeof value === "string" && value.length >= 12) {
        assert.equal(serialized.includes(value), false, "an environment value reached the record");
      }
    }
  } finally {
    delete process.env.ACME_RECORD_TOKEN;
  }
});

test("NONE cannot carry an issued score", () => {
  // The score is still computable. Printing it without this flag is how a number produced with no
  // boundary gets compared against one produced under a boundary.
  assert.equal(SCORING_ISOLATION.has("NONE"), false);
  assert.equal(isolationRecord("NONE", {}).scoring_permitted, false);
  assert.equal(isolationRecord("STRICT", {}).scoring_permitted, true);
  assert.equal(isolationRecord("BEST_EFFORT_CLI", {}).scoring_permitted, true);
});

test("an unknown isolation level is refused rather than defaulted", () => {
  assert.throws(() => buildAgentEnv("SANDBOXED", SOURCE), /AOS_UNKNOWN_ISOLATION/);
});

test("isSensitiveName catches shape, prefix and exact name", () => {
  for (const name of ["AWS_REGION", "GOOGLE_APPLICATION_CREDENTIALS", "SOME_API_KEY", "X_SECRET_Y", "SSH_AUTH_SOCK"]) {
    assert.equal(isSensitiveName(name), true, name);
  }
  for (const name of ["PATH", "EDITOR", "PROJECT_ROOT", "MONKEY", "TOKENIZER_PATH"]) {
    assert.equal(isSensitiveName(name), false, name);
  }
});

test("a spawned agent really cannot read the operator's credentials", async () => {
  // The unit tests above check the builder. This one checks the thing that actually runs: a child
  // process spawned by runProcess, with a real secret in this process's environment.
  process.env.ACME_LEAK_TOKEN = "ghp_notarealtokenusedonlyforthistest0";
  const workspace = mkdtempSync(join(tmpdir(), "aos-iso-run-"));
  try {
    const probe = join(workspace, "probe.mjs");
    writeFileSync(
      probe,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.AOS_WORKSPACE + "/seen.json", JSON.stringify({
  token: process.env.ACME_LEAK_TOKEN ?? "absent",
  home: process.env.HOME ?? "absent",
  names: Object.keys(process.env).sort()
}));
`,
      "utf8"
    );
    const result = await runProcess(
      { command: process.execPath, args: [probe] },
      { workspace, family: "FAM-5", stage: "stage-1", prompt: "probe", session: "run-test", timeoutMs: 15000 }
    );
    assert.equal(result.exit_code, 0, result.error ?? "the probe did not run");
    const seen = JSON.parse(readFileSync(join(workspace, "seen.json"), "utf8"));
    assert.equal(seen.token, "absent", "the agent process read the operator's token");
    assert.notEqual(seen.home, process.env.HOME, "the agent process was given the real HOME");
    assert.equal(result.isolation.level, "BEST_EFFORT_CLI");
    assert.equal(result.isolation.removed_env_names.includes("ACME_LEAK_TOKEN"), true);
  } finally {
    delete process.env.ACME_LEAK_TOKEN;
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a credential-shaped name cannot be added to an agent's allow list", () => {
  // The allow list is checked before the credential filter, so permitting one there would hand the
  // agent the key itself. A runtime that needs to find its own configuration asks for a directory.
  const cwd = mkdtempSync(join(tmpdir(), "aos-allow-env-"));
  try {
    run(cwd, ["init"]);
    for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "GH_TOKEN", "DB_PASSWORD"]) {
      const refused = run(cwd, ["agent", "add", "x", "--command", process.execPath, "--allow-env", name], 2);
      assert.match(refused.stderr, /AOS_CREDENTIAL_ENV_REFUSED/, name);
    }
    // A configuration directory is not a credential and is carried by name.
    run(cwd, ["agent", "add", "real", "--command", process.execPath, "--allow-env", "CODEX_HOME", "--allow-env", "CLAUDE_CONFIG_DIR"]);
    const listed = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout);
    const added = listed.find((agent) => agent.id === "real");
    assert.deepEqual(added.allowed_env_names, ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]);

    // What an agent is allowed to carry is part of what it is: a run that carried one more variable
    // is not the same environment as one that did not.
    run(cwd, ["agent", "add", "plain", "--command", process.execPath]);
    const plain = listed.concat(JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout)).find((agent) => agent.id === "plain");
    assert.notEqual(added.config_digest, plain.config_digest);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an adapter has to be one this build knows", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-adapter-"));
  try {
    run(cwd, ["init"]);
    const refused = run(cwd, ["agent", "add", "x", "--command", process.execPath, "--adapter", "not-a-runtime"], 2);
    assert.match(refused.stderr, /AOS_UNKNOWN_ADAPTER/);
    run(cwd, ["agent", "add", "codex", "--command", process.execPath, "--adapter", "codex-cli.v1"]);
    const listed = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout);
    assert.equal(listed.find((agent) => agent.id === "codex").adapter, "codex-cli.v1");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an agent is never told where the operator's runs are", () => {
  // Replacing HOME keeps the operator's dotfiles out of reach, and then AOS_HOME handed the agent
  // the one directory that matters more than any of them: the run records, the results, the
  // holdout ledger and the cycle. An assessed agent runs with the operator's own write
  // permissions, so a path is all it needs -- and a crafted result.json is read back by the
  // dashboard in the operator's browser.
  const source = { PATH: "/usr/bin", HOME: "/Users/someone", AOS_HOME: "/Users/someone/.aos", AOS_DATA_DIR: "/elsewhere", LANG: "en_US.UTF-8" };
  for (const level of ["STRICT", "BEST_EFFORT_CLI", "NONE"]) {
    // Naming them explicitly is refused outright now, which is a stronger answer than carrying the
    // declaration and dropping the value: the operator cannot give away something that is not
    // theirs to give, and `AOS_` is withheld before the allowlist is consulted at all.
    assert.throws(() => buildAgentEnv(level, source, { allow: ["AOS_HOME"] }), /AOS_ENV_POLICY_MISMATCH/, level);
    const built = buildAgentEnv(level, source, {
      // And a policy that never went through that refusal still does not carry them. Declared in
      // `structural_env` rather than `config_env`: the config branch is also covered by the
      // credential-shape rule, and every `AOS_` name is credential-shaped by prefix, so a policy
      // that only used it would keep passing with the unconditional withholding removed. This is
      // the one arrangement where the withholding is the only thing left.
      policy: {
        ...envPolicyFor(null, {}),
        structural_env: [...envPolicyFor(null, {}).structural_env, "AOS_HOME", "AOS_DATA_DIR"]
      },
      home: "/tmp/agent-home",
      injected: { AOS_SESSION_ID: "s", AOS_FAMILY: "FAM-1", AOS_WORKSPACE: "/w", AOS_TASK_FILE: "/t" }
    });
    assert.equal(built.env.AOS_HOME, undefined, level);
    assert.equal(built.env.AOS_DATA_DIR, undefined, level);
    assert.equal(built.removed.includes("AOS_HOME"), true, `${level}: the name should be reported`);

    // The four AOS gives an agent on purpose are injected after the filter and are unaffected.
    assert.equal(built.env.AOS_WORKSPACE, "/w", level);
    assert.equal(built.env.AOS_TASK_FILE, "/t", level);
    assert.equal(built.env.AOS_FAMILY, "FAM-1", level);
    assert.equal(built.env.AOS_SESSION_ID, "s", level);

    // The config route is closed by a second rule, so it is asserted separately rather than folded
    // into the one above, where it would have masked what that one is testing.
    const declared = buildAgentEnv(level, source, {
      policy: { ...envPolicyFor(null, {}), config_env: ["AOS_HOME", "AOS_DATA_DIR"] },
      home: "/tmp/agent-home"
    });
    assert.equal(declared.env.AOS_HOME, undefined, level);
    assert.equal(declared.env.AOS_DATA_DIR, undefined, level);
  }
});
