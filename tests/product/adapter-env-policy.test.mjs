import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV_POLICY_SCHEMA, HARD_FORBIDDEN_CLASSES, TRANSPORT_ENV, envPolicyFor, hardForbiddenClassOf, isTransportName } from "../../lib/env-policy.mjs";
import { buildAgentEnv, isolationRecord } from "../../lib/isolation.mjs";
import { ADAPTERS, buildProfile } from "../../lib/profile.mjs";
import { runProcess } from "../../lib/core.mjs";
import { addAgent, initBare, makePlan, newestResult, run } from "./helpers.mjs";

/**
 * The variables that change what a process is before it runs a line of its own.
 *
 * Every value here is inert. `DYLD_INSERT_LIBRARIES` is the exception that proves why the list
 * exists: before this policy, a nonexistent path in it reached the spawned agent and dyld
 * terminated the child trying to load it -- so a test that asserts the child ran at all is a test
 * that the variable did not arrive, independent of what the child reports about its own
 * environment.
 */
const INJECTION_ENV = {
  NODE_OPTIONS: null, // set per test, because it needs a real file to require
  LD_PRELOAD: "/tmp/aos-test-nonexistent-preload.so",
  LD_LIBRARY_PATH: "/tmp/aos-test-nonexistent-lib",
  DYLD_INSERT_LIBRARIES: "/tmp/aos-test-nonexistent-insert.dylib",
  DYLD_LIBRARY_PATH: "/tmp/aos-test-nonexistent-dyld",
  DYLD_FRAMEWORK_PATH: "/tmp/aos-test-nonexistent-framework",
  PYTHONPATH: "/tmp/aos-test-python",
  PYTHONSTARTUP: "/tmp/aos-test-python/startup.py",
  PERL5LIB: "/tmp/aos-test-perl",
  PERL5OPT: "-Mstrict",
  RUBYOPT: "-rrubygems",
  RUBYLIB: "/tmp/aos-test-ruby",
  BASH_ENV: "/tmp/aos-test-bashenv.sh",
  ENV: "/tmp/aos-test-env.sh",
  ZDOTDIR: "/tmp/aos-test-zdotdir",
  GIT_SSH_COMMAND: "sh -c 'echo pwned'",
  GIT_CONFIG_GLOBAL: "/tmp/aos-test-gitconfig",
  GIT_CONFIG_COUNT: "1",
  GIT_EXTERNAL_DIFF: "/tmp/aos-test-diff.sh",
  GIT_EXEC_PATH: "/tmp/aos-test-git-exec",
  JAVA_TOOL_OPTIONS: "-Dfoo=bar",
  CLASSPATH: "/tmp/aos-test-classes",
  NODE_PATH: "/tmp/aos-test-node-path",
  npm_config_registry: "http://127.0.0.1:9/registry",
  npm_config_userconfig: "/tmp/aos-test-npmrc",
  NPM_CONFIG_PREFIX: "/tmp/aos-test-npm-prefix",
  YARN_NPM_REGISTRY_SERVER: "http://127.0.0.1:9/",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  ALL_PROXY: "socks5://127.0.0.1:9",
  NO_PROXY: "example.invalid",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  all_proxy: "socks5://127.0.0.1:9",
  no_proxy: "example.invalid",
  NODE_EXTRA_CA_CERTS: "/tmp/aos-test-ca.pem",
  SSL_CERT_FILE: "/tmp/aos-test-ca.pem",
  REQUESTS_CA_BUNDLE: "/tmp/aos-test-ca.pem",
  ACME_DEPLOY_TOKEN: "ghp_notarealtokenusedonlyforthistest1",
  ACME_PROD_DB_PASSWORD: "hunter2-not-real",
  AWS_SECRET_ACCESS_KEY: "aws-not-real",
  EDITOR: "vim",
  PROJECT_ROOT: "/work"
};

/** Runs a probe child through the real spawn path and returns what its own environment held. */
const spawnAndReadEnv = async (ambient, spec = {}, context = {}) => {
  const workspace = mkdtempSync(join(tmpdir(), "aos-envpolicy-"));
  const restore = new Map();
  for (const [name, value] of Object.entries(ambient)) {
    restore.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    const probe = join(workspace, "probe.mjs");
    writeFileSync(
      probe,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.AOS_WORKSPACE + "/seen.json", JSON.stringify({
  names: Object.keys(process.env).sort(),
  home: process.env.HOME ?? null
}));
`,
      "utf8"
    );
    const result = await runProcess(
      { command: process.execPath, args: [probe], ...spec },
      { workspace, family: "FAM-5", stage: "stage-1", prompt: "probe", session: "run-env-policy", timeoutMs: 30000, ...context }
    );
    const seenFile = join(workspace, "seen.json");
    return {
      result,
      workspace,
      seen: existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, "utf8")) : null,
      cleanup: () => rmSync(workspace, { recursive: true, force: true })
    };
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  } finally {
    for (const [name, value] of restore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test("no process-injection variable in the operator's shell reaches the spawned child", async () => {
  // The point of testing this through a spawn rather than through the builder: a builder that is
  // correct and a spawn path that adds names back is exactly the failure that would otherwise pass.
  // Measured before the allowlist, `DYLD_INSERT_LIBRARIES` from the parent shell reached the child
  // and dyld killed it before its first line -- so `exit_code === 0` below is itself an assertion
  // about that variable, made without trusting anything the child says.
  const ambient = { ...INJECTION_ENV };
  delete ambient.NODE_OPTIONS;
  const { result, seen, cleanup } = await spawnAndReadEnv(ambient);
  try {
    assert.equal(result.exit_code, 0, `${result.error ?? ""} ${result.stderr_excerpt ?? ""}`);
    assert.ok(seen, "the child never wrote its environment, so something ran before it did");
    for (const name of Object.keys(ambient)) {
      assert.equal(seen.names.includes(name), false, `${name} reached the child`);
    }
    // And the record says so by class, without naming a value.
    assert.ok(result.isolation.blocked_env_classes.length > 0, "the record did not report what was refused");
    assert.equal(JSON.stringify(result.isolation).includes("hunter2-not-real"), false);
  } finally {
    cleanup();
  }
});

test("NODE_OPTIONS cannot make the child run code before its own first line", async () => {
  // An inherited `--require ./evil.cjs` runs before the agent's first statement, which changes what
  // the assessed process is without changing the command that was recorded in the result.
  const scratch = mkdtempSync(join(tmpdir(), "aos-node-options-"));
  const marker = join(scratch, "preloaded.txt");
  const evil = join(scratch, "evil.cjs");
  writeFileSync(evil, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`, "utf8");
  try {
    const { result, seen, cleanup } = await spawnAndReadEnv({ NODE_OPTIONS: `--require ${evil}` });
    try {
      assert.equal(result.exit_code, 0, result.error ?? "");
      assert.equal(seen.names.includes("NODE_OPTIONS"), false, "NODE_OPTIONS reached the child");
      assert.equal(existsSync(marker), false, "the inherited --require executed inside the assessed process");
    } finally {
      cleanup();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a credential in the operator's shell never reaches the child, listed or not", async () => {
  // Two of these are in no list anywhere: they are caught because nothing that was not declared
  // travels, which is the property a denylist cannot have.
  const ambient = {
    ACME_UNLISTED_THING: "not-credential-shaped-and-still-undeclared",
    ACME_DEPLOY_TOKEN: "ghp_notarealtokenusedonlyforthistest2",
    GITHUB_TOKEN: "gh-not-real",
    SSH_AUTH_SOCK: "/tmp/aos-test-agent.sock",
    DATABASE_URL: "postgres://user:pw@host/db"
  };
  const { result, seen, cleanup } = await spawnAndReadEnv(ambient);
  try {
    assert.equal(result.exit_code, 0, result.error ?? "");
    for (const name of Object.keys(ambient)) assert.equal(seen.names.includes(name), false, name);
    assert.equal(JSON.stringify(result.isolation).includes("postgres://user:pw@host/db"), false);
  } finally {
    cleanup();
  }
});

test("the child gets the structural minimum and nothing more", async () => {
  // The counterfactual for the tests above: if the policy carried nothing the child could not run,
  // and if it carried the shell the negative tests would be meaningless. What arrives is the
  // structural set, the AOS run metadata, and the temporary HOME.
  const { result, seen, cleanup } = await spawnAndReadEnv({ EDITOR: "vim", PROJECT_ROOT: "/work" });
  try {
    assert.equal(result.exit_code, 0, result.error ?? "");
    assert.equal(seen.names.includes("PATH"), true, "the child was given no PATH and nothing could run");
    assert.notEqual(seen.home, process.env.HOME, "the child was given the operator's real HOME");
    const allowed = new Set([
      "PATH", "LANG", "TERM", "TZ", "HOME", "TMPDIR",
      "LC_ALL", "LC_COLLATE", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
      "AOS_SESSION_ID", "AOS_FAMILY", "AOS_WORKSPACE", "AOS_TASK_FILE",
      // Added by CoreFoundation inside the child after exec, not carried across: a child spawned
      // with an environment of exactly `{PATH}` still has it. Asserting it away would be asserting
      // about macOS rather than about this policy.
      "__CF_USER_TEXT_ENCODING"
    ]);
    const unexpected = seen.names.filter((name) => !allowed.has(name));
    assert.deepEqual(unexpected, [], "an undeclared name travelled");
  } finally {
    cleanup();
  }
});

test("an adapter's declared config directory travels and nothing else does", async () => {
  // BEST_EFFORT_CLI exists so an already-logged-in CLI can find its own configuration. That is one
  // declared name, not the operator's shell.
  //
  // Nothing is passed in `allowed_env_names` here, which is the whole assertion: the name travels
  // because `codex-cli.v1` declares `CODEX_HOME`, not because the operator repeated it on a flag.
  // This test used to supply it and so proved the operator's declaration worked while claiming to
  // prove the adapter's -- and the adapter's did not, so a hand-registered Codex could not see its
  // own login unless the operator knew to type the name twice.
  const { result, seen, cleanup } = await spawnAndReadEnv(
    { CODEX_HOME: "/tmp/aos-test-codex-home", CLAUDE_CONFIG_DIR: "/tmp/aos-test-claude", EDITOR: "vim" },
    { adapter: "codex-cli.v1" }
  );
  try {
    assert.equal(result.exit_code, 0, result.error ?? "");
    assert.equal(seen.names.includes("CODEX_HOME"), true, "the declared config directory did not travel");
    assert.equal(seen.names.includes("CLAUDE_CONFIG_DIR"), false, "an undeclared config directory travelled");
    assert.equal(seen.names.includes("EDITOR"), false);
    assert.deepEqual(result.isolation.explicit_env_names, ["CODEX_HOME"]);
    assert.equal(result.isolation.adapter_id, "codex-cli.v1");
  } finally {
    cleanup();
  }
});

test("proxy and certificate names travel only on a separate approval", async () => {
  const ambient = { HTTPS_PROXY: "http://127.0.0.1:9", NODE_EXTRA_CA_CERTS: "/tmp/aos-test-ca.pem" };
  const refused = await spawnAndReadEnv(ambient, { adapter: "codex-cli.v1" });
  try {
    assert.equal(refused.seen.names.includes("HTTPS_PROXY"), false, "a proxy travelled with no approval");
    assert.deepEqual(refused.result.isolation.transport_env_names, []);
  } finally {
    refused.cleanup();
  }

  const approved = await spawnAndReadEnv(ambient, { adapter: "codex-cli.v1", transport_env_names: ["HTTPS_PROXY"] });
  try {
    assert.equal(approved.seen.names.includes("HTTPS_PROXY"), true, "an approved proxy did not travel");
    // Approving one name does not approve the class.
    assert.equal(approved.seen.names.includes("NODE_EXTRA_CA_CERTS"), false);
    assert.deepEqual(approved.result.isolation.transport_env_names, ["HTTPS_PROXY"]);
  } finally {
    approved.cleanup();
  }
});

test("a generic command gets no transport env even when the operator asks for one", () => {
  // Otherwise the way to hand any binary a proxy is to register it as generic, and the approval
  // gate is a formality anybody can walk around.
  assert.throws(
    () => envPolicyFor(ADAPTERS["generic-command.v1"], { transport: ["HTTPS_PROXY"] }),
    /AOS_ENV_TRANSPORT_UNVERIFIED/
  );
  const policy = envPolicyFor(ADAPTERS["generic-command.v1"], {});
  assert.deepEqual(policy.transport_env, []);
  assert.deepEqual(policy.runtime_auth_env, []);
  assert.deepEqual(policy.config_env, []);
  assert.equal(policy.schema_id, ENV_POLICY_SCHEMA);
});

test("a hard-forbidden name cannot be declared into the allowlist by any route", () => {
  // The builder refuses as well as the CLI, because they are different failures: one is an operator
  // typing a flag, the other is a hand-edited config file arriving at a spawn.
  for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PYTHONPATH", "BASH_ENV", "GIT_SSH_COMMAND", "npm_config_registry"]) {
    assert.ok(hardForbiddenClassOf(name), `${name} is in no hard-forbidden class`);
    assert.throws(() => envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: [name] }), /AOS_ENV_HARD_FORBIDDEN/, name);
    assert.throws(() => envPolicyFor(ADAPTERS["codex-cli.v1"], { runtimeAuth: [name] }), /AOS_ENV_HARD_FORBIDDEN/, name);
    assert.throws(() => envPolicyFor(ADAPTERS["codex-cli.v1"], { transport: [name] }), /AOS_ENV_HARD_FORBIDDEN/, name);
  }
  // And a policy object that somehow held one still does not carry it.
  const smuggled = { ...envPolicyFor(ADAPTERS["codex-cli.v1"], {}), config_env: ["NODE_OPTIONS", "LD_PRELOAD"] };
  const built = buildAgentEnv("BEST_EFFORT_CLI", { NODE_OPTIONS: "--require /tmp/evil.cjs", LD_PRELOAD: "/tmp/evil.so", PATH: "/usr/bin" }, { policy: smuggled });
  assert.equal(Object.hasOwn(built.env, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(built.env, "LD_PRELOAD"), false);
  assert.deepEqual(built.blocked_classes, ["language_preload", "loader_preload"]);

  // Route three: an adapter's own declaration. `structural_env` is the one list that is merged
  // without passing through the flag checks, so it is the route a new adapter could open by
  // accident rather than by an operator typing anything.
  const rogue = { ...ADAPTERS["generic-command.v1"], id: "rogue.v1", env_policy: { structural_env: ["LD_PRELOAD", "BASH_ENV"], transport_env: [] } };
  const viaAdapter = buildAgentEnv("BEST_EFFORT_CLI", { LD_PRELOAD: "/tmp/evil.so", BASH_ENV: "/tmp/evil.sh", PATH: "/usr/bin" }, { adapter: rogue });
  assert.equal(Object.hasOwn(viaAdapter.env, "LD_PRELOAD"), false, "an adapter declared a loader hook into the structural set");
  assert.equal(Object.hasOwn(viaAdapter.env, "BASH_ENV"), false);
  assert.deepEqual(viaAdapter.blocked_classes, ["loader_preload", "shell_startup"]);

  // Route four: the merge that happens after the policy has decided. It carries the four AOS run
  // names, and it used to carry whatever else a caller put in it -- a door past the allowlist that
  // no test opened and nothing closed.
  assert.throws(
    () => buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin" }, { injected: { NODE_OPTIONS: "--require /tmp/evil.cjs" } }),
    /AOS_ENV_POLICY_MISMATCH NODE_OPTIONS/
  );
  assert.throws(
    () => buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin" }, { injected: { AOS_HOME: "/Users/someone/.aos" } }),
    /AOS_ENV_POLICY_MISMATCH AOS_HOME/,
    "the run-metadata door handed over the operator's own records"
  );
  const metadata = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin" }, { injected: { AOS_SESSION_ID: "run-1" } });
  assert.equal(metadata.env.AOS_SESSION_ID, "run-1", "the door closed on the names it exists for");
});

test("a hard-forbidden name is refused in every spelling a consumer might fold it into", () => {
  // POSIX lookup is case-sensitive, so `NpM_cOnFiG_node_options` is a different variable from
  // `npm_config_node_options` and a case-sensitive rule matches neither spelling of the other. npm
  // is not case-sensitive: it lower-cases every key before looking for its own, so the mixed-case
  // name arrives at a lifecycle child as `NODE_OPTIONS`. Measured on this build before the fix, it
  // was recorded as carried with no blocked class.
  for (const name of ["NpM_cOnFiG_node_options", "npm_config_node_options", "Ld_Preload", "dyld_insert_libraries", "Bash_Env", "git_ssh_command"]) {
    assert.ok(hardForbiddenClassOf(name), `${name} is in no hard-forbidden class`);
    assert.throws(() => envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: [name] }), /AOS_ENV_HARD_FORBIDDEN/, name);
  }
  // Refusal is case-insensitive; carrying stays exact. A policy grants the name that was written
  // down, so declaring `CODEX_HOME` does not also hand over `codex_home`.
  const built = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin", codex_home: "/tmp/lower", CODEX_HOME: "/tmp/upper" }, {
    adapter: ADAPTERS["codex-cli.v1"]
  });
  assert.equal(built.env.CODEX_HOME, "/tmp/upper");
  assert.equal(Object.hasOwn(built.env, "codex_home"), false, "a different capitalisation was carried as though it were the declared name");
});

test("a variable that starts an interpreter's own code is in a hard-forbidden class", () => {
  // These read as directory settings, which is why they were missing. `PYTHONUSERBASE` enables the
  // user site directory under it, and a `.pth` file there may hold an `import` line that runs at
  // interpreter start -- before the assessed script's first statement. `R_ENVIRON_USER` names a
  // file R reads at startup. Both were carried by an ordinary `--allow-env` on this build.
  for (const name of ["PYTHONUSERBASE", "R_ENVIRON_USER", "R_ENVIRON"]) {
    assert.equal(hardForbiddenClassOf(name), "language_preload", name);
    assert.throws(() => envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: [name] }), /AOS_ENV_HARD_FORBIDDEN/, name);
  }
});

test("a name that redirects or unverifies the run's traffic needs the transport approval", () => {
  // Each of these does what `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` do, spelled by a different
  // runtime, and each passed through an ordinary `--allow-env` while the two names beside it needed
  // a separate approval. That made the approval a spelling test rather than a boundary.
  for (const name of ["CARGO_HTTP_PROXY", "CARGO_HTTP_CAINFO", "CURL_HOME", "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
    assert.equal(isTransportName(name), true, `${name} is not classified as transport`);
    assert.throws(
      () => envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: [name] }),
      /AOS_ENV_EXPLICIT_APPROVAL_REQUIRED/,
      name
    );
    // And the approval still only reaches an adapter that declared the need.
    assert.throws(
      () => envPolicyFor(ADAPTERS["generic-command.v1"], { transport: [name] }),
      /AOS_ENV_TRANSPORT_UNVERIFIED/,
      name
    );
  }
});

test("a stored configuration cannot hand a credential to an adapter that does not read it", async () => {
  // The CLI refuses `--allow-runtime-auth GH_TOKEN` for the generic adapter. Nothing repeated that
  // where a spawn could see it, so a configuration file edited by hand -- the same file that names
  // the command -- had the operator's GitHub token copied into a child running an arbitrary binary
  // and recorded as runtime auth. Carrying a credential is AOS acting on the operator's store, so
  // the adapter that owns the credential has to be the one receiving it.
  assert.throws(
    () => envPolicyFor(ADAPTERS["generic-command.v1"], { runtimeAuth: ["GH_TOKEN"] }),
    /AOS_ENV_POLICY_MISMATCH GH_TOKEN for generic-command.v1/
  );
  assert.throws(
    () => envPolicyFor(ADAPTERS["codex-cli.v1"], { runtimeAuth: ["CLAUDE_CODE_OAUTH_TOKEN"] }),
    /AOS_ENV_POLICY_MISMATCH/,
    "one runtime's credential reached another runtime's adapter"
  );
  // The adapter that does read it is unaffected.
  assert.deepEqual(
    envPolicyFor(ADAPTERS["claude-code.v1"], { runtimeAuth: ["CLAUDE_CODE_OAUTH_TOKEN"] }).runtime_auth_env,
    ["CLAUDE_CODE_OAUTH_TOKEN"]
  );

  // Through the spawn, because the point is that the refusal is reachable from a stored agent and
  // not only from the flag parser. The run fails rather than the credential travelling.
  await assert.rejects(
    () => spawnAndReadEnv({ GH_TOKEN: "gh-not-real" }, { runtime_auth_env_names: ["GH_TOKEN"] }),
    /AOS_ENV_POLICY_MISMATCH/
  );
});

test("every hard-forbidden class the issue names is covered by a rule", () => {
  // The classes are the contract. A rename that emptied one of them would leave the tests above
  // still passing on the names they happen to list.
  for (const className of ["loader_preload", "shell_startup", "language_preload", "git_override", "package_manager"]) {
    assert.ok(HARD_FORBIDDEN_CLASSES[className], className);
  }
  assert.equal(hardForbiddenClassOf("LD_PRELOAD"), "loader_preload");
  assert.equal(hardForbiddenClassOf("DYLD_INSERT_LIBRARIES"), "loader_preload");
  assert.equal(hardForbiddenClassOf("BASH_ENV"), "shell_startup");
  assert.equal(hardForbiddenClassOf("PERL5LIB"), "language_preload");
  assert.equal(hardForbiddenClassOf("RUBYOPT"), "language_preload");
  assert.equal(hardForbiddenClassOf("GIT_CONFIG_GLOBAL"), "git_override");
  assert.equal(hardForbiddenClassOf("npm_config_registry"), "package_manager");
  // Ordinary names are not swept up: an over-broad rule would drop the config directory a runtime
  // needs and the failure would look like a login problem.
  for (const name of ["PATH", "LANG", "TERM", "TZ", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "LC_ALL"]) {
    assert.equal(hardForbiddenClassOf(name), null, name);
  }
});

test("the policy digest moves when the allowlist or an approval moves", () => {
  // The evidence bundle quotes this instead of the values. If it did not move, two runs under
  // different environments would be filed as the same measurement.
  const base = envPolicyFor(ADAPTERS["codex-cli.v1"], {});
  const withConfig = envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: ["ACME_TOOLCHAIN_DIR"] });
  const withAuth = envPolicyFor(ADAPTERS["codex-cli.v1"], { runtimeAuth: ["OPENAI_API_KEY"] });
  const withProxy = envPolicyFor(ADAPTERS["codex-cli.v1"], { transport: ["HTTPS_PROXY"] });
  const digests = [base, withConfig, withAuth, withProxy].map((policy) => policy.policy_digest);
  assert.equal(new Set(digests).size, 4, "two different policies share a digest");
  // Same declaration, same digest: comparability is the reason this exists.
  assert.equal(envPolicyFor(ADAPTERS["codex-cli.v1"], { allow: ["ACME_TOOLCHAIN_DIR"] }).policy_digest, withConfig.policy_digest);
  // A different adapter is a different policy even with the same names.
  assert.notEqual(envPolicyFor(ADAPTERS["claude-code.v1"], { allow: ["ACME_TOOLCHAIN_DIR"] }).policy_digest, withConfig.policy_digest);
  for (const policy of [base, withConfig, withAuth, withProxy]) assert.match(policy.policy_digest, /^sha256:[0-9a-f]{64}$/);
});

test("the policy digest moves when a forbidden rule's contents move, not only its class names", () => {
  // The digest used to hash `Object.keys(HARD_FORBIDDEN_CLASSES)`, which is a constant of this
  // build and therefore says nothing about the policy. Adding a name to a class flips an existing
  // policy from carrying that name to refusing it -- a different allowlist, the same digest, and an
  // evidence bundle that files the two runs as one measurement. This is the mutation the digest has
  // to react to, so it is the mutation this test performs.
  const rule = HARD_FORBIDDEN_CLASSES.language_preload;
  const before = envPolicyFor(ADAPTERS["codex-cli.v1"], {});
  const carriedBefore = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin", ACME_PRELOAD_PATH: "/tmp/x" }, {
    policy: { ...before, config_env: ["ACME_PRELOAD_PATH"] }
  });
  assert.equal(Object.hasOwn(carriedBefore.env, "ACME_PRELOAD_PATH"), true, "the fixture name was not carried to begin with");

  rule.names.push("ACME_PRELOAD_PATH");
  try {
    const after = envPolicyFor(ADAPTERS["codex-cli.v1"], {});
    // The decision changed, so the digest has to have changed with it.
    const carriedAfter = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin", ACME_PRELOAD_PATH: "/tmp/x" }, {
      policy: { ...after, config_env: ["ACME_PRELOAD_PATH"] }
    });
    assert.equal(Object.hasOwn(carriedAfter.env, "ACME_PRELOAD_PATH"), false, "the rule edit did not change what travels");
    assert.deepEqual(carriedAfter.blocked_classes, ["language_preload"]);
    assert.notEqual(after.policy_digest, before.policy_digest, "a rule that changed what travels left the digest where it was");
  } finally {
    rule.names.splice(rule.names.indexOf("ACME_PRELOAD_PATH"), 1);
  }
  // Restored, and the digest comes back with it -- otherwise this test would have proved only that
  // the digest is unstable.
  assert.equal(envPolicyFor(ADAPTERS["codex-cli.v1"], {}).policy_digest, before.policy_digest);
});

test("the profile digest cannot cover automatic credential resolution, and the run says so", () => {
  // The profile digest is computed before anything is spawned, from what the agent declares. It
  // cannot know whether AOS will find a credential on this machine, and finding one adds a name to
  // the policy the child is actually built with. So the two digests are different objects and the
  // result has to carry both: the profile's, beside the score, and the applied one, per invocation.
  const agent = { id: "cc", command: "/usr/bin/claude", args: [], adapter: "claude-code.v1", config_digest: "sha256:abc" };
  const profile = buildProfile({ agent, probe: () => null });
  const declaredPolicy = envPolicyFor(ADAPTERS["claude-code.v1"], { runtimeAuth: [] });
  assert.equal(profile.env_policy_digest, declaredPolicy.policy_digest);

  // What execution builds when the resolver finds a credential: the same declaration plus the name
  // it resolved. Different policy, different digest, and the profile digest did not move.
  const appliedPolicy = envPolicyFor(ADAPTERS["claude-code.v1"], { runtimeAuth: ["CLAUDE_CODE_OAUTH_TOKEN"] });
  assert.notEqual(appliedPolicy.policy_digest, profile.env_policy_digest, "an extra credential name left the applied digest where it was");
  const applied = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin" }, {
    policy: appliedPolicy,
    inject: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-not-real" },
    home: "/tmp/agent-home"
  });
  const record = isolationRecord(applied.level, { ...applied, runtimeAuth: applied.runtime_auth, homeSource: applied.home_source });
  assert.equal(record.env_policy_digest, appliedPolicy.policy_digest, "the record quoted a policy the child did not run under");
  assert.notEqual(record.env_policy_digest, profile.env_policy_digest);

  // And the one thing the profile digest *can* say about it: whether AOS was permitted to reach at
  // all. Two runs that differ on that are not the same cohort, and nothing else in the profile
  // would have separated them.
  const off = buildProfile({ agent: { ...agent, auto_runtime_auth: false }, probe: () => null });
  assert.notEqual(off.profile_digest, profile.profile_digest);
});

test("the isolation record quotes the policy by digest and never by value", () => {
  const built = buildAgentEnv("BEST_EFFORT_CLI", { PATH: "/usr/bin", CODEX_HOME: "/tmp/codex", GH_TOKEN: "gh-not-real" }, {
    adapter: ADAPTERS["codex-cli.v1"],
    home: "/tmp/agent-home"
  });
  const serialized = JSON.stringify(built.policy);
  assert.equal(serialized.includes("/tmp/codex"), false, "a value reached the policy");
  assert.equal(serialized.includes("gh-not-real"), false);
  assert.equal(built.policy.adapter_id, "codex-cli.v1");
  assert.equal(built.policy.policy_version, 1);

  // The record itself, which this test is named after and did not previously build. Everything the
  // policy knows has to survive into it by name and by digest, because the record is what a reader
  // gets and the policy object is not.
  const record = isolationRecord(built.level, { ...built, runtimeAuth: built.runtime_auth, blockedClasses: built.blocked_classes, homeSource: built.home_source, home: "/tmp/agent-home" });
  assert.equal(record.env_policy_digest, built.policy.policy_digest);
  assert.equal(record.env_policy_schema, ENV_POLICY_SCHEMA);
  assert.equal(record.env_policy_version, 1);
  assert.equal(record.adapter_id, "codex-cli.v1");
  assert.deepEqual(record.explicit_env_names, ["CODEX_HOME"]);
  assert.equal(record.removed_env_names.includes("GH_TOKEN"), true, "a refused name was dropped without being reported");
  assert.equal(record.home_source, "aos_temporary");
  const serializedRecord = JSON.stringify(record);
  assert.equal(serializedRecord.includes("gh-not-real"), false, "a credential value reached the record");
  assert.equal(serializedRecord.includes("/tmp/codex"), false, "a config path reached the record");
  assert.equal(serializedRecord.includes("/tmp/agent-home"), false, "the temporary HOME path reached the record");
});

test("the HOME regime is recorded as a kind, and a path cannot be written into that field", () => {
  // `home_source` is what a later reader uses to tell an authenticated run from an unauthenticated
  // one. It was an arbitrary string that the record emitted verbatim, so a caller could put
  // `/Users/alice/private/home` into a field whose own comment promises the path is never written
  // down. Nothing in this repository passed one, which is exactly why it needed a rule rather than
  // a habit.
  for (const kind of ["aos_temporary", "operator", "adapter"]) {
    assert.equal(buildAgentEnv("STRICT", { PATH: "/usr/bin" }, { home: "/tmp/h", homeSource: kind }).home_source, kind);
    assert.equal(isolationRecord("STRICT", { home: "/tmp/h", homeSource: kind }).home_source, kind);
  }
  assert.throws(
    () => buildAgentEnv("STRICT", { PATH: "/usr/bin" }, { home: "/tmp/h", homeSource: "/Users/alice/private/home" }),
    /AOS_UNKNOWN_HOME_SOURCE/
  );
  assert.throws(
    () => isolationRecord("STRICT", { home: "/tmp/h", homeSource: "/Users/alice/private/home" }),
    /AOS_UNKNOWN_HOME_SOURCE/
  );
});

test("the CLI refuses a hard-forbidden name and points a proxy at its own approval", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-env-policy-cli-"));
  try {
    run(cwd, ["init"]);
    for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PYTHONPATH", "PERL5LIB", "RUBYOPT", "BASH_ENV", "GIT_SSH_COMMAND", "GIT_CONFIG_GLOBAL", "npm_config_registry"]) {
      const refused = run(cwd, ["agent", "add", "x", "--command", process.execPath, "--allow-env", name], 2);
      assert.match(refused.stderr, /AOS_ENV_HARD_FORBIDDEN/, name);
    }
    for (const name of TRANSPORT_ENV.slice(0, 6)) {
      const refused = run(cwd, ["agent", "add", "x", "--command", process.execPath, "--allow-env", name], 2);
      assert.match(refused.stderr, /AOS_ENV_EXPLICIT_APPROVAL_REQUIRED/, name);
    }
    // A generic command cannot be handed one on the transport flag either.
    const generic = run(cwd, ["agent", "add", "x", "--command", process.execPath, "--allow-transport-env", "HTTPS_PROXY"], 2);
    assert.match(generic.stderr, /AOS_ENV_TRANSPORT_UNVERIFIED/);

    // A declared runtime may have one, and it lands in its own field so the digest moves.
    run(cwd, ["agent", "add", "proxied", "--command", process.execPath, "--adapter", "codex-cli.v1", "--allow-transport-env", "HTTPS_PROXY"]);
    run(cwd, ["agent", "add", "plain", "--command", process.execPath, "--adapter", "codex-cli.v1"]);
    const listed = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout);
    const proxied = listed.find((agent) => agent.id === "proxied");
    const plain = listed.find((agent) => agent.id === "plain");
    assert.deepEqual(proxied.transport_env_names, ["HTTPS_PROXY"]);
    assert.deepEqual(plain.transport_env_names, []);
    assert.notEqual(proxied.config_digest, plain.config_digest, "an approved proxy did not change what the agent is");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor says which names a run will carry and which dangerous ones it will drop, without values", () => {
  // Answerable before a quota is spent: no provider call, no spawn, and no value in the output.
  const cwd = mkdtempSync(join(tmpdir(), "aos-env-doctor-"));
  process.env.ACME_DOCTOR_TOKEN = "ghp_notarealtokenusedonlyforthistest3";
  process.env.PYTHONPATH = "/tmp/aos-test-python";
  try {
    run(cwd, ["init"]);
    run(cwd, ["agent", "add", "envcheck", "--command", process.execPath, "--adapter", "codex-cli.v1", "--allow-env", "CODEX_HOME"]);
    // One agent by name: `agent doctor` with no id also reports on whatever runtimes `init` found
    // on this machine, and its exit code would then depend on the machine rather than on the test.
    const rows = JSON.parse(run(cwd, ["agent", "doctor", "envcheck", "--json"]).stdout);
    const row = rows.find((entry) => entry.id === "envcheck");
    assert.equal(row.env.ok, true);
    assert.match(row.env.detail, /carries .*PATH/);
    assert.match(row.env.detail, /blocked .*language_preload/);
    assert.match(row.env.detail, /sha256:[0-9a-f]{64}/);
    assert.equal(row.env.detail.includes("ghp_notarealtokenusedonlyforthistest3"), false, "a value reached doctor output");
    assert.equal(row.env.detail.includes("/tmp/aos-test-python"), false);
  } finally {
    delete process.env.ACME_DOCTOR_TOKEN;
    delete process.env.PYTHONPATH;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the record says which HOME regime a run was under, by kind and never by path", async () => {
  // A replaced HOME is load-bearing for isolation and it has a measured cost: on darwin 26.3 the
  // login keychain is unreachable under a temporary HOME (`security` exits 44) and
  // `codex login status` reads `Not logged in`, where the operator's own HOME gives
  // `Logged in using ChatGPT`. Two runs that differ only in that will look identical in a result
  // unless the record says so, and "it failed to authenticate" is not the same evidence as "it ran
  // under a temporary HOME". The kind is recorded; the directory is not, because it names a place
  // on the operator's machine and this record is meant to be quotable.
  const { result, seen, cleanup } = await spawnAndReadEnv({ EDITOR: "vim" });
  try {
    assert.equal(result.isolation.home_source, "aos_temporary");
    assert.equal(result.isolation.temporary_home, true);
    assert.notEqual(seen.home, process.env.HOME);
    assert.equal(JSON.stringify(result.isolation).includes(seen.home), false, "the temporary path reached the record");
  } finally {
    cleanup();
  }

  // No HOME at all is its own case, not a missing value: the version probe runs that way, and a
  // record that called it "operator" would be wrong in the direction that matters.
  const bare = buildAgentEnv("STRICT", { PATH: "/usr/bin", HOME: "/Users/someone" });
  assert.equal(bare.home_source, "absent");
  assert.equal(Object.hasOwn(bare.env, "HOME"), false, "the operator's HOME was inherited");
  assert.equal(isolationRecord("STRICT", { ...bare, homeSource: bare.home_source }).home_source, "absent");

  // And a caller that hands over the operator's own HOME has to say so, so the two are never
  // indistinguishable in a record.
  const operator = buildAgentEnv("STRICT", { PATH: "/usr/bin" }, { home: "/Users/someone", homeSource: "operator" });
  assert.equal(operator.home_source, "operator");
  assert.equal(isolationRecord("STRICT", { home: "/Users/someone", homeSource: operator.home_source }).home_source, "operator");
});

test("a scored result carries the boundary it was produced under, by name and never by value", () => {
  // `runProcess` built an accurate isolation record and `family_results` kept six process fields
  // from each invocation, so none of it reached the file anybody reads. A result that cannot say
  // which policy produced it cannot be compared with another, which is the whole claim the digest
  // beside the score is making.
  const cwd = mkdtempSync(join(tmpdir(), "aos-env-result-"));
  process.env.ACME_RESULT_TOKEN = "ghp_notarealtokenusedonlyforthistest4";
  process.env.PYTHONPATH = "/tmp/aos-test-python";
  try {
    initBare(cwd);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    // Exit 3: an unattended run is INCOMPLETE by design, which is not what this test is about.
    run(cwd, ["assess", "--plan", plan, "--json"], 3);
    const result = newestResult(cwd);
    const record = result.isolation.by_agent.solo;
    assert.ok(record, "the result did not say what environment the agent ran under");
    assert.equal(result.isolation.level, "BEST_EFFORT_CLI");
    assert.equal(record.adapter_id, "generic-command.v1");
    assert.match(record.env_policy_digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(record.home_source, "aos_temporary");
    assert.equal(record.blocked_env_classes.includes("language_preload"), true, "a refused class was not reported");
    assert.equal(record.removed_env_names.includes("ACME_RESULT_TOKEN"), true);
    assert.equal(record.allowed_env_names.includes("PATH"), true);
    // The applied policy, per invocation, so drift inside one run is visible without repeating the
    // whole record twenty times.
    for (const family of Object.values(result.family_results)) {
      for (const invocation of family.invocations) {
        assert.equal(invocation.env_policy_digest, record.env_policy_digest, "an invocation ran under a policy the result does not describe");
      }
    }
    // And no value of any kind reached the file.
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("ghp_notarealtokenusedonlyforthistest4"), false, "a credential value reached the result");
    assert.equal(serialized.includes("/tmp/aos-test-python"), false, "an environment value reached the result");
  } finally {
    delete process.env.ACME_RESULT_TOKEN;
    delete process.env.PYTHONPATH;
    rmSync(cwd, { recursive: true, force: true });
  }
});
