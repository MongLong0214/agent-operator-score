// #554. A credential AOS discovers on the operator's behalf must reach the exact executable that
// was verified when the agent was registered -- not whatever is answering to that name now.
//
// What was there before this file: `commandMayReceive` compared the *basename* of the configured
// command against the name the adapter declares. A script called `claude` anywhere on PATH passed
// it, and AOS read the macOS login Keychain and handed that script a real
// `CLAUDE_CODE_OAUTH_TOKEN`. Same name is not same program: the binary can be rewritten in place,
// the path can become a symlink to somewhere else, a wrapper can be dropped earlier on PATH, and
// the directory holding any of them can be writable by somebody who is not the operator.
//
// Every case below is built out of real files in a temporary directory, because the thing under
// test is the stat and realpath logic. A mock would agree with whatever the implementation
// believes.

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runProcess } from "../../lib/core.mjs";
import { ADAPTERS, buildProfile } from "../../lib/profile.mjs";
import {
  authorizeRuntimeAuth,
  resolveRuntimeAuthForAgent,
  runtimeIdentityRecord
} from "../../lib/runtime-auth.mjs";
import {
  IDENTITY_SCHEMA,
  REPLACEABLE_RIGHTS,
  TRUSTED_DIRECTORY_GIDS,
  aclFindingsFrom,
  describeExecutable,
  envProgramOf,
  identityDrift,
  resolveExecutable
} from "../../lib/runtime-identity.mjs";
import { addAgent, makePlan, newestRecord, newestResult, newestRunId, run } from "./helpers.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const CLAUDE = ADAPTERS["claude-code.v1"];
const GENERIC = ADAPTERS["generic-command.v1"];

// A token shape that would be unmistakable if it ever appeared in a record or a message.
const OPERATOR_TOKEN = "sk-ant-oat-554-must-never-be-recorded";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-identity-"));

/** A real file with a real exec bit, because the check under test reads the filesystem. */
const executable = (directory, name, body) => {
  const file = join(directory, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};

const agentAt = (command, identity, extra = {}) => ({
  id: "cc",
  command,
  args: [],
  adapter: "claude-code.v1",
  auto_runtime_auth: true,
  runtime_auth_env_names: [],
  runtime_identity: identity,
  ...extra
});

/** Counts resolver calls, so "before" can be asserted rather than assumed. */
const spy = () => {
  const calls = [];
  const resolve = (...args) => {
    calls.push(args);
    return { name: "CLAUDE_CODE_OAUTH_TOKEN", value: OPERATOR_TOKEN, source: "keychain" };
  };
  return { calls, resolve };
};

const refusal = (agent, options = {}) => {
  const counter = spy();
  let thrown = null;
  try {
    resolveRuntimeAuthForAgent(agent, CLAUDE, { resolve: counter.resolve, ...options });
  } catch (error) {
    thrown = error;
  }
  return { thrown, calls: counter.calls.length };
};

test("an identity record names the exact file, never the name it was reached by", () => {
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const identity = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.equal(identity.schema_id, IDENTITY_SCHEMA);
    assert.equal(identity.command_input, file);
    assert.equal(identity.resolved_realpath.endsWith("/claude"), true);
    assert.match(identity.file_fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.match(identity.realpath_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(identity.owner_uid, process.getuid());
    assert.equal(identity.mode, "0755");
    assert.equal(identity.parent_security.world_writable, false);
    assert.equal(identity.parent_security.group_writable_untrusted, false);
    assert.equal(identity.adapter_id, "claude-code.v1");
    assert.equal(identity.identity_status, "VERIFIED");
    // Recorded when the platform can say something, null when it cannot -- and null is never read
    // as a pass, only as an absence of evidence.
    assert.equal(Object.hasOwn(identity.platform_identity, "macos_codesign_team"), true);
    assert.equal(Object.hasOwn(identity.platform_identity, "macos_requirement_digest"), true);
    if (process.platform !== "darwin") {
      assert.equal(identity.platform_identity.macos_codesign_team, null);
      assert.equal(identity.platform_identity.recorded, false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The name says registration, not spawn, on purpose. This replaces the binary before the
// authorization call, so what it proves is that a rewrite between `aos agent add` and the
// credential lookup is caught -- not that the microseconds between the check and `execve` are
// closed. Nothing in this file can prove that, and an earlier name here claimed it did.
test("a binary replaced after registration is refused before the credential is read", () => {
  // Same path, same name, same mode. Only the bytes changed, which is the whole attack.
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });
    executable(directory, "claude", `printf %s "$CLAUDE_CODE_OAUTH_TOKEN" > ${join(directory, "stolen")}`);

    const drifted = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.deepEqual(identityDrift(registered, drifted), ["file_fingerprint"]);

    const { thrown, calls } = refusal(agentAt(file, registered));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(calls, 0, "the credential store was read for a binary that had changed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a path that has become a symlink to somewhere else is refused", () => {
  const directory = scratch();
  try {
    const real = join(directory, "real");
    mkdirSync(real, { mode: 0o755 });
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });

    const elsewhere = executable(real, "impostor", "exit 0");
    unlinkSync(file);
    symlinkSync(elsewhere, file);

    const drifted = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.equal(drifted.resolved_realpath.endsWith("/impostor"), true);
    assert.ok(identityDrift(registered, drifted).includes("resolved_realpath"));
    assert.ok(identityDrift(registered, drifted).includes("realpath_digest"));

    const { thrown, calls } = refusal(agentAt(file, registered));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a wrapper script shadowing the real executable earlier on PATH is refused", () => {
  // Nothing about the agent's configuration changed. `claude` is still `claude`; a directory was
  // prepended to PATH, and the name now resolves somewhere else. Basename comparison sees no
  // difference at all.
  const directory = scratch();
  try {
    const real = join(directory, "real");
    const shadow = join(directory, "shadow");
    for (const dir of [real, shadow]) mkdirSync(dir, { mode: 0o755 });
    executable(real, "claude", "exit 0");
    executable(shadow, "claude", "exit 0");

    const honest = { PATH: real };
    const shadowed = { PATH: [shadow, real].join(delimiter) };
    const registered = describeExecutable("claude", { env: honest, adapterId: "claude-code.v1" });
    const now = describeExecutable("claude", { env: shadowed, adapterId: "claude-code.v1" });
    assert.equal(registered.resolved_realpath.startsWith(realpathSync(real)), true);
    assert.equal(now.resolved_realpath.startsWith(realpathSync(shadow)), true);

    const { thrown, calls } = refusal(agentAt("claude", registered), { env: shadowed });
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owner or mode drift since registration is refused", () => {
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });

    chmodSync(file, 0o775);
    const relaxed = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.equal(relaxed.mode, "0775");
    assert.ok(identityDrift(registered, relaxed).includes("mode"));
    assert.match(refusal(agentAt(file, registered)).thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(refusal(agentAt(file, registered)).calls, 0);

    // Changing the owner needs root, so the owner half is asserted against a record that says the
    // file belonged to somebody else. The comparison is the same one either way.
    chmodSync(file, 0o755);
    const otherOwner = { ...registered, owner_uid: registered.owner_uid + 1 };
    assert.deepEqual(identityDrift(otherOwner, describeExecutable(file, { adapterId: "claude-code.v1" })), ["owner_uid"]);
    const { thrown, calls } = refusal(agentAt(file, otherOwner));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a world-writable parent directory is refused however verified the file looks", () => {
  // `/tmp/claude` is the shape of this: the bytes can be correct at the moment they are read and
  // replaced by anyone before the process starts.
  const directory = scratch();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o755 });
    const file = executable(holder, "claude", "exit 0");
    chmodSync(holder, 0o777);

    const identity = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.equal(identity.parent_security.world_writable, true);
    assert.equal(identity.identity_status, "UNTRUSTED");

    const { thrown, calls } = refusal(agentAt(file, identity));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_UNTRUSTED/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a parent directory writable by an untrusted group is refused", () => {
  const directory = scratch();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o755 });
    const file = executable(holder, "claude", "exit 0");
    chmodSync(holder, 0o775);

    const identity = describeExecutable(file, { adapterId: "claude-code.v1" });
    // The group owning a scratch directory is the operator's own login group, which on a shared
    // machine holds every other account on it. Only root's group is trusted without asking.
    assert.equal(TRUSTED_DIRECTORY_GIDS.has(0), true);
    assert.equal(TRUSTED_DIRECTORY_GIDS.size, 1);
    assert.equal(identity.parent_security.group_writable_untrusted, true);
    assert.equal(identity.identity_status, "UNTRUSTED");

    const { thrown, calls } = refusal(agentAt(file, identity));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_UNTRUSTED/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the adapter that owns the credential resolver is not the adapter being spawned", () => {
  // The identity was recorded for one adapter and the run is asking a different adapter's resolver
  // to produce a credential for it. The keychain entry belongs to the adapter, not to the command.
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "codex-cli.v1" });
    const agent = agentAt(file, registered, { adapter: "codex-cli.v1" });

    const verdict = authorizeRuntimeAuth(agent, CLAUDE, {});
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "AOS_RUNTIME_AUTH_RESOLVER_MISMATCH");
    // Said out loud because it is easy to overstate what this check holds: `adapter_id` is in the
    // drift comparison as well, so removing the ownership check above changes which refusal the
    // operator is shown -- not whether the credential is refused.
    assert.ok(identityDrift(registered, describeExecutable(file, { adapterId: "claude-code.v1" })).includes("adapter_id"));

    const { thrown, calls } = refusal(agent);
    assert.match(thrown.message, /AOS_RUNTIME_AUTH_RESOLVER_MISMATCH/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a legacy agent with no identity record is refused, not promoted", () => {
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const agent = agentAt(file, null);
    const verdict = authorizeRuntimeAuth(agent, CLAUDE, {});
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "AOS_RUNTIME_IDENTITY_MISSING");
    assert.equal(verdict.identity_status, "MIGRATION_REQUIRED");
    // The remedy has to be in the message: an operator who cannot see the way out disables the
    // check instead of doing the migration.
    assert.match(verdict.detail, /aos agent add/);

    const { thrown, calls } = refusal(agent);
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_MISSING/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a command that resolves to nothing executable is refused before anything is read", () => {
  const directory = scratch();
  try {
    assert.equal(resolveExecutable(join(directory, "absent")), null);
    // A relative path is resolved against the child's working directory, not this one, so AOS
    // cannot claim to have verified the file that will actually run.
    assert.equal(resolveExecutable("./claude"), null);
    assert.equal(resolveExecutable(""), null);
    assert.equal(resolveExecutable("claude", { env: { PATH: directory } }), null);
    // A directory and a non-executable file are both "present" and neither is the runtime.
    writeFileSync(join(directory, "data"), "x", { mode: 0o644 });
    assert.equal(resolveExecutable(join(directory, "data")), null);

    const { thrown, calls } = refusal(agentAt(join(directory, "absent"), null));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_MISSING/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the identity check runs before the credential resolver, not after", () => {
  // The ordering is the guarantee. A check that runs after the resolver has already answered has
  // let AOS read the operator's Keychain on behalf of a program it had not identified -- the
  // refusal afterwards does not put the credential back.
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });
    executable(directory, "claude", "exit 1");

    const counter = spy();
    assert.throws(() => resolveRuntimeAuthForAgent(agentAt(file, registered), CLAUDE, { resolve: counter.resolve }));
    assert.equal(counter.calls.length, 0);

    // And the same call on an unchanged binary does reach it, so the zero above is the gate and
    // not a resolver that is never called at all.
    const stableDirectory = join(directory, "stable");
    mkdirSync(stableDirectory, { mode: 0o755 });
    const stable = executable(stableDirectory, "claude", "exit 0");
    const stableIdentity = describeExecutable(stable, { adapterId: "claude-code.v1" });
    const ok = resolveRuntimeAuthForAgent(agentAt(stable, stableIdentity), CLAUDE, { resolve: counter.resolve });
    assert.equal(counter.calls.length, 1);
    assert.equal(ok.verdict.ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an agent with no credential at stake is not gated at all", () => {
  // The counterfactual. This gate exists to protect a credential; it is not a general policy about
  // which programs may be run, and turning it into one would refuse every fixture-backed agent in
  // this repository's own suite.
  const directory = scratch();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o777 });
    const file = executable(holder, "anything", "exit 0");
    const agent = { id: "gg", command: file, args: [], adapter: "generic-command.v1" };
    const verdict = authorizeRuntimeAuth(agent, GENERIC, {});
    assert.equal(verdict.ok, true);
    assert.equal(verdict.auto, false);
    assert.equal(resolveRuntimeAuthForAgent(agent, GENERIC, {}).resolved, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an operator's own token does not reach a binary whose identity failed, and the child never starts", async () => {
  // The end of the chain. `--no-auto-auth` is off, the operator's shell already holds the token,
  // and the registered binary was swapped. Nothing may be resolved and nothing may be spawned:
  // a refusal that still starts the child has handed over the run it was refusing.
  const directory = scratch();
  try {
    const marker = join(directory, "the-child-ran");
    const stolen = join(directory, "stolen");
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });
    // The impostor writes down what it was given, so the two halves of this test's name are two
    // separate pieces of evidence rather than one.
    executable(directory, "claude", `touch ${marker}\nprintf %s "$CLAUDE_CODE_OAUTH_TOKEN" > ${stolen}`);

    const spec = agentAt(file, registered);
    let thrown = null;
    await withOperatorToken(OPERATOR_TOKEN, async () => {
      try {
        await runProcess(spec, {
          workspace: directory,
          family: "FAM-1",
          stage: "s",
          prompt: "hello",
          session: "sess",
          isolation: "BEST_EFFORT_CLI",
          timeoutMs: 5000
        });
      } catch (error) {
        thrown = error;
      }
    });
    // Asserted before the refusal, deliberately. Run the other way round, a change that lets the
    // child start is reported as "expected a rejection" -- the shape of the failure, not the fact
    // that a swapped binary was handed the operator's token and started.
    //
    // `existsSync`, not `resolveExecutable`. The child creates this marker with `touch`, so it is
    // not executable and `resolveExecutable` answers null whether the child ran or not -- an
    // assertion that could not fail is not an assertion.
    assert.equal(existsSync(marker), false, "the child was spawned after the identity was refused");
    assert.equal(existsSync(stolen), false, "the operator's own token reached a binary whose identity failed");
    assert.match(thrown?.message ?? "", /AOS_RUNTIME_IDENTITY_DRIFT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("no credential value is ever written into an identity record", () => {
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const identity = describeExecutable(file, {
      adapterId: "claude-code.v1",
      env: { PATH: directory, CLAUDE_CODE_OAUTH_TOKEN: OPERATOR_TOKEN, ANTHROPIC_API_KEY: OPERATOR_TOKEN }
    });
    const serialized = JSON.stringify(identity);
    assert.equal(serialized.includes(OPERATOR_TOKEN), false);
    assert.equal(serialized.includes("sk-ant"), false);

    // The provenance a result carries makes the same promise. It says which variable was used and
    // where the value came from; there is no field for the value, so there is nowhere to put one.
    const provenance = runtimeIdentityRecord(
      { identity, identity_status: identity.identity_status },
      { name: "CLAUDE_CODE_OAUTH_TOKEN", value: OPERATOR_TOKEN, source: "keychain" }
    );
    assert.equal(provenance.credential_env_name, "CLAUDE_CODE_OAUTH_TOKEN");
    assert.equal(provenance.credential_source, "keychain");
    assert.equal(provenance.identity_digest, identity.identity_digest);
    assert.equal(JSON.stringify(provenance).includes(OPERATOR_TOKEN), false);

    // And the refusal message is an output too. #459's lesson was that the surfaces which explain a
    // failure are exactly the ones an operator pastes somewhere else.
    executable(directory, "claude", "exit 1");
    const { thrown } = refusal(agentAt(file, identity), {
      env: { PATH: directory, CLAUDE_CODE_OAUTH_TOKEN: OPERATOR_TOKEN }
    });
    assert.equal(thrown.message.includes(OPERATOR_TOKEN), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the profile digest moves when the runtime's executable identity moves", () => {
  // #561 reuses this identity rather than building a second one. A score is bound to the program
  // that produced it, so two runs whose binary differs are not one cohort.
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const first = describeExecutable(file, { adapterId: "claude-code.v1" });
    executable(directory, "claude", "exit 0 # rebuilt");
    const second = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.notEqual(first.identity_digest, second.identity_digest);

    const profileWith = (identity) => buildProfile({
      agent: { id: "cc", command: file, adapter: "claude-code.v1", runtime_identity: identity },
      probe: () => null
    });
    const a = profileWith(first);
    const b = profileWith(second);
    assert.equal(a.runtime_identity_digest, first.identity_digest);
    assert.notEqual(a.profile_digest, b.profile_digest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("aos agent add records the executable identity, and doctor names the migration", () => {
  const home = scratch();
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const aos = (args) => spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, AOS_HOME: home, HOME: home }
    });
    const added = aos(["agent", "add", "cc", "--command", file, "--adapter", "claude-code.v1", "--json"]);
    assert.equal(added.status, 0, added.stdout + added.stderr);
    const record = JSON.parse(added.stdout).runtime_identity;
    assert.equal(record.identity_status, "VERIFIED");
    assert.equal(record.adapter_id, "claude-code.v1");
    assert.match(record.file_fingerprint, /^sha256:/);

    // Replace the binary and the same doctor that passes above must say what to do about it.
    executable(directory, "claude", "exit 1");
    const drifted = aos(["agent", "doctor", "cc"]);
    assert.equal(drifted.status, 3);
    assert.match(drifted.stdout, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.match(drifted.stdout, /aos agent add/);
  } finally {
    for (const dir of [home, directory]) rmSync(dir, { recursive: true, force: true });
  }
});

// Round two. Everything below answers a finding from the independent adversarial review of #554,
// and each one is built the same way as the tests above it: real files in a temporary directory,
// because a mock would agree with whatever the implementation believes.

test("a symlink hop through a writable directory is refused, not only the two ends of the chain", () => {
  // /safe/claude -> /bridge/hop -> /trusted/real-claude. Both ends belong to the operator and both
  // pass. `/bridge` is the middle, and whoever can write it repoints `hop` at their own file with
  // every recorded field about `/safe` and `/trusted` unchanged. An earlier round walked the first
  // link and the final target and never looked between them.
  const directory = scratch();
  try {
    const safe = join(directory, "safe");
    const bridge = join(directory, "bridge");
    const trusted = join(directory, "trusted");
    for (const dir of [safe, bridge, trusted]) mkdirSync(dir, { mode: 0o755 });
    const real = executable(trusted, "real-claude", "exit 0");
    const hop = join(bridge, "hop");
    symlinkSync(real, hop);
    const command = join(safe, "claude");
    symlinkSync(hop, command);
    chmodSync(bridge, 0o777);

    const identity = describeExecutable(command, { adapterId: "claude-code.v1" });
    assert.equal(identity.resolved_realpath, realpathSync(real));
    assert.equal(identity.parent_security.world_writable, true);
    assert.ok(
      identity.untrusted_reasons.includes(`world_writable ${bridge}`),
      `the hop's own directory was never audited: ${identity.untrusted_reasons.join(", ")}`
    );
    assert.equal(identity.identity_status, "UNTRUSTED");

    const { thrown, calls } = refusal(agentAt(command, identity));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_UNTRUSTED/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the interpreter a shebang selects is part of the identity", () => {
  // A script does not run itself. `#!/usr/bin/env <name>` makes the kernel run `env`, and `env`
  // searches PATH for the name -- so the byte-identical, correctly-owned script hands the
  // operator's credential to whatever that search finds. Nothing about the script changes.
  const directory = scratch();
  try {
    const first = join(directory, "first");
    const second = join(directory, "second");
    for (const dir of [first, second]) mkdirSync(dir, { mode: 0o755 });
    executable(first, "aos-test-interpreter", "exit 0");
    executable(second, "aos-test-interpreter", "exit 1");
    const script = join(directory, "claude");
    writeFileSync(script, "#!/usr/bin/env aos-test-interpreter\nexit 0\n");
    chmodSync(script, 0o755);

    const registered = describeExecutable(script, { env: { PATH: first }, adapterId: "claude-code.v1" });
    assert.equal(registered.identity_status, "VERIFIED", registered.untrusted_reasons.join(", "));
    assert.deepEqual(registered.interpreter_chain.map((entry) => entry.command), ["/usr/bin/env", "aos-test-interpreter"]);

    const now = describeExecutable(script, { env: { PATH: second }, adapterId: "claude-code.v1" });
    // The file is byte for byte what it was. Only the program it hands itself to has changed.
    assert.equal(now.file_fingerprint, registered.file_fingerprint);
    assert.equal(now.resolved_realpath, registered.resolved_realpath);
    assert.deepEqual(identityDrift(registered, now), ["interpreter_digest"]);

    const { thrown, calls } = refusal(agentAt(script, registered), { env: { PATH: second } });
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an interpreter reached through a world-writable directory makes the script untrusted", () => {
  const directory = scratch();
  try {
    const wide = join(directory, "wide");
    // chmod after mkdir: mkdir is filtered through the umask and 0777 arrives as 0755.
    mkdirSync(wide, { mode: 0o755 });
    chmodSync(wide, 0o777);
    executable(wide, "aos-test-interpreter", "exit 0");
    const script = join(directory, "claude");
    writeFileSync(script, "#!/usr/bin/env aos-test-interpreter\nexit 0\n");
    chmodSync(script, 0o755);

    const identity = describeExecutable(script, { env: { PATH: wide }, adapterId: "claude-code.v1" });
    assert.equal(identity.identity_status, "UNTRUSTED");
    assert.ok(
      identity.untrusted_reasons.some((reason) => reason === `interpreter world_writable ${wide}`),
      `the interpreter's directory was never audited: ${identity.untrusted_reasons.join(", ")}`
    );

    const { thrown, calls } = refusal(agentAt(script, identity), { env: { PATH: wide } });
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_UNTRUSTED/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a shebang naming an interpreter that cannot be resolved is not read as having none", () => {
  const directory = scratch();
  try {
    const script = join(directory, "claude");
    writeFileSync(script, "#!/usr/bin/env aos-test-interpreter-that-is-not-installed\nexit 0\n");
    chmodSync(script, 0o755);
    const identity = describeExecutable(script, { env: { PATH: directory }, adapterId: "claude-code.v1" });
    assert.equal(identity.identity_status, "UNTRUSTED");
    assert.ok(identity.untrusted_reasons.includes("interpreter_unresolved aos-test-interpreter-that-is-not-installed"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a macOS ACL that lets somebody else replace the file is refused", { skip: process.platform !== "darwin" }, () => {
  // Mode 0755, owned by the operator, and still one `mv` from being somebody else's file. Node has
  // no interface to an ACL, so the mode walk reads this directory as clean.
  const directory = scratch();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o755 });
    const file = executable(holder, "claude", "exit 0");
    const clean = describeExecutable(file, { adapterId: "claude-code.v1" });
    assert.equal(clean.identity_status, "VERIFIED", clean.untrusted_reasons.join(", "));
    assert.equal(clean.parent_security.acl_writable, false);

    const applied = spawnSync("/bin/chmod", ["+a", "group:everyone allow add_file,delete_child", holder], { encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);

    const identity = describeExecutable(file, { adapterId: "claude-code.v1" });
    // Nothing the mode bits can see has changed.
    assert.equal(identity.mode, clean.mode);
    assert.equal(identity.owner_uid, clean.owner_uid);
    assert.equal(identity.parent_security.world_writable, false);
    assert.equal(identity.parent_security.group_writable_untrusted, false);
    assert.equal(identity.parent_security.acl_writable, true);
    assert.equal(identity.identity_status, "UNTRUSTED");

    const { thrown, calls } = refusal(agentAt(file, identity));
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_UNTRUSTED/);
    assert.equal(calls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an execute bit that does not apply to this process is not an executable", { skip: process.getuid() === 0 }, () => {
  // 0011 has execute bits set and the owner is not one of them. POSIX resolves permission by the
  // first class that matches, so this process -- the owner -- may not execute it, and `execvp`
  // carries on down PATH. Reading `mode & 0111` would have described a file the child never runs.
  const directory = scratch();
  try {
    const shadowed = join(directory, "shadowed");
    const real = join(directory, "real");
    for (const dir of [shadowed, real]) mkdirSync(dir, { mode: 0o755 });
    const decoy = join(shadowed, "claude");
    writeFileSync(decoy, "#!/bin/sh\nexit 0\n");
    chmodSync(decoy, 0o011);
    const genuine = executable(real, "claude", "exit 0");

    assert.equal(resolveExecutable(decoy), null);
    const found = resolveExecutable("claude", { env: { PATH: [shadowed, real].join(delimiter) } });
    assert.equal(found.realpath, realpathSync(genuine));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a PATH entry that is not absolute is not searched", () => {
  // A relative entry is resolved against a working directory, and the child's is the workspace --
  // not this process's. Anything AOS verified through one would be a statement about another file.
  const directory = scratch();
  const previous = process.cwd();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o755 });
    executable(holder, "claude", "exit 0");
    process.chdir(holder);
    assert.equal(resolveExecutable("claude", { env: { PATH: "." } }), null);
    assert.equal(resolveExecutable("claude", { env: { PATH: "" } }), null);
    // The same directory named absolutely does resolve, so the nulls above are the rule and not a
    // file that was never there.
    assert.notEqual(resolveExecutable("claude", { env: { PATH: holder } }), null);
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an explicitly approved wrapper is still compared against the identity it was approved as", () => {
  // `--allow-runtime-auth` is the operator saying this program may carry this variable. It is not
  // them saying nobody need look at it again: the wrapper still has an identity and it is still
  // compared, which is the difference between an approval and an exemption.
  const directory = scratch();
  try {
    const holder = join(directory, "bin");
    mkdirSync(holder, { mode: 0o755 });
    const file = executable(holder, "claude", "exit 0");
    chmodSync(holder, 0o777);
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });
    // A directory the automatic path refuses outright.
    assert.equal(registered.identity_status, "UNTRUSTED");

    const approved = agentAt(file, registered, {
      auto_runtime_auth: false,
      runtime_auth_env_names: ["CLAUDE_CODE_OAUTH_TOKEN"]
    });
    const verdict = authorizeRuntimeAuth(approved, CLAUDE, {});
    assert.equal(verdict.ok, true, verdict.detail);
    assert.equal(verdict.auto, false);
    assert.equal(verdict.identity_status, "UNTRUSTED");

    // And the same wrapper rewritten is refused, approval or not.
    executable(holder, "claude", "exit 1");
    const { thrown } = refusal(approved);
    assert.match(thrown.message, /AOS_RUNTIME_IDENTITY_DRIFT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an explicitly approved credential on an agent with no recorded identity says to migrate", () => {
  const directory = scratch();
  try {
    const file = executable(directory, "claude", "exit 0");
    const legacy = agentAt(file, null, {
      auto_runtime_auth: false,
      runtime_auth_env_names: ["CLAUDE_CODE_OAUTH_TOKEN"]
    });
    const verdict = authorizeRuntimeAuth(legacy, CLAUDE, {});
    // Not refused: the operator approved this one by name, and AOS is not reaching into a store on
    // its own behalf. Recorded as unmigrated, because a run that says VERIFIED here would be saying
    // something nobody checked.
    assert.equal(verdict.ok, true);
    assert.equal(verdict.auto, false);
    assert.equal(verdict.identity_status, "MIGRATION_REQUIRED");
    assert.match(verdict.detail, /explicit approval/);
    // A status nobody is told how to leave is a status the operator lives in. The name of this test
    // says the message tells them what to do, so the message has to.
    assert.match(verdict.detail, /aos agent add cc --command/);
    assert.match(verdict.detail, /keeps working either way/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A child that reports the file it was actually executed as, and quotes its own credential. */
const reporter = (directory, name) => {
  const file = join(directory, name);
  writeFileSync(
    file,
    "#!/bin/sh\n" +
    'echo "argv0=$0"\n' +
    `printf 'AOS_EVENT\\t{"event_type":"completion.claimed","payload":{"claim":"%s"}}\\n' "$CLAUDE_CODE_OAUTH_TOKEN"\n`
  );
  chmodSync(file, 0o755);
  return file;
};

const withOperatorToken = async (value, body) => {
  const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = value;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous;
  }
};

const runOnce = (spec, directory) => runProcess(spec, {
  workspace: directory,
  family: "FAM-1",
  stage: "s",
  prompt: "hello",
  session: "sess",
  isolation: "BEST_EFFORT_CLI",
  timeoutMs: 10000
});

test("the file whose identity was verified is the file that is spawned", async () => {
  // The command is a name; the identity is a file. Spawning the name resolves it a second time, at
  // a later moment, by the kernel -- so the record describes one file and another one runs. The
  // child reports the path it was executed as, and it is the verified one.
  const directory = scratch();
  try {
    const vendor = reporter(directory, "vendor-runtime");
    const command = join(directory, "claude");
    symlinkSync(vendor, command);
    const identity = describeExecutable(command, { adapterId: "claude-code.v1" });
    assert.equal(identity.identity_status, "VERIFIED", identity.untrusted_reasons.join(", "));

    const result = await withOperatorToken("aos554-opaque-runtime-credential", () =>
      runOnce(agentAt(command, identity), directory));
    assert.equal(result.exit_code, 0, result.stderr_excerpt);
    assert.ok(
      result.stdout_excerpt.includes(`argv0=${realpathSync(vendor)}`),
      `the child was reached through the name rather than the verified file: ${result.stdout_excerpt}`
    );
    // And the run says which program the credential was bound to.
    assert.equal(result.runtime_identity.identity_digest, identity.identity_digest);
    assert.equal(result.runtime_identity.credential_env_name, "CLAUDE_CODE_OAUTH_TOKEN");
    assert.equal(result.runtime_identity.credential_source, "environment");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a credential the child quotes back does not survive into anything the run keeps", async () => {
  // The claim that no credential value is ever stored covered the identity record and stopped
  // there. The child is handed the credential on purpose, it may print whatever it likes, and the
  // raw `AOS_EVENT` objects were kept verbatim in `semantic_events` and written to result.json --
  // past the projection the event store applies. This value matches none of the redactor's shape
  // patterns, so what removes it is knowing exactly what was handed over.
  const directory = scratch();
  const secret = "aos554-opaque-runtime-credential";
  try {
    const command = reporter(directory, "claude");
    const identity = describeExecutable(command, { adapterId: "claude-code.v1" });
    assert.equal(identity.identity_status, "VERIFIED", identity.untrusted_reasons.join(", "));

    const result = await withOperatorToken(secret, () => runOnce(agentAt(command, identity), directory));
    assert.equal(result.exit_code, 0, result.stderr_excerpt);
    // The child really did print it, so the absence below is redaction and not an empty stream.
    assert.equal(result.semantic_events.length, 1);
    assert.equal(result.semantic_events[0].event_type, "completion.claimed");
    assert.equal(result.semantic_events[0].payload.claim.includes(secret), false);
    assert.equal(JSON.stringify(result).includes(secret), false, "the credential reached the stored result");
    assert.equal(result.stdout_excerpt.includes(secret), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stored assessment carries the executable identity each invocation was bound to", () => {
  // `runProcess` produces the provenance and the assessment is where anybody reads it. The mapping
  // that builds `family_results` dropped the field on the floor, so the promise of the issue --
  // evidence of which program the run went to -- existed only in memory.
  const cwd = scratch();
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    run(cwd, ["assess", "--plan", plan, "--json"], 3);
    const record = newestRecord(cwd);
    const invocation = record.family_results["FAM-1"].invocations[0];
    assert.equal(Object.hasOwn(invocation, "runtime_identity"), true, "the stored assessment dropped the identity provenance");
    const provenance = invocation.runtime_identity;
    for (const field of ["identity_status", "identity_digest", "credential_env_name", "credential_source", "explicit_env_names"]) {
      assert.equal(Object.hasOwn(provenance, field), true, `runtime_identity is missing ${field}`);
    }
    // A fixture agent has no credential at stake, and the record says so rather than saying nothing.
    assert.equal(provenance.credential_env_name, null);
    assert.equal(provenance.credential_source, null);
    // And the file it is stored in is the one an operator reads: the run's own record, beside the
    // result, which is where everything about how the run went now lives.
    const stored = JSON.parse(readFileSync(join(cwd, ".aos", "runs", newestRunId(cwd), "record.json"), "utf8"));
    assert.equal(Object.hasOwn(stored.family_results["FAM-1"].invocations[0], "runtime_identity"), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// Round three. Each test below answers a finding from the second adversarial review: a claim that
// was not true, a parse that was wrong, or a guard whose evidence did not match its name.

test("an env shebang that hides its program behind options is read, not guessed", () => {
  // `env -u FOO node` unsets FOO and runs node. The first version of this scan skipped every
  // leading dash and took the next word, which is `FOO` -- the name of a variable, verified as if
  // it were the interpreter. A patch that claims to describe the shebang dispatch has to read it.
  assert.equal(envProgramOf(["node"]), "node");
  assert.equal(envProgramOf(["-u", "FOO", "node"]), "node");
  assert.equal(envProgramOf(["-uFOO", "node"]), "node");
  assert.equal(envProgramOf(["-iu", "FOO", "node"]), "node");
  assert.equal(envProgramOf(["--unset=FOO", "node"]), "node");
  assert.equal(envProgramOf(["--unset", "FOO", "node"]), "node");
  assert.equal(envProgramOf(["-C", "/tmp", "node"]), "node");
  assert.equal(envProgramOf(["-i", "PATH=/bin", "node", "--flag"]), "node");
  // `-S` exists because Linux hands `env` the whole rest of the shebang line as one argument, so
  // the options can be nested one level down and the program with them.
  assert.equal(envProgramOf(["-S", "node --flag"]), "node");
  assert.equal(envProgramOf(["-S", "-u", "FOO", "node"]), "node");
  assert.equal(envProgramOf(["--split-string=-u FOO node"]), "node");
  assert.equal(envProgramOf(["--", "-oddly-named"]), "-oddly-named");
  // And what it cannot read, it does not name. A guess here verifies some other file and passes.
  assert.equal(envProgramOf([]), null);
  assert.equal(envProgramOf(["-Z", "node"]), null);
  assert.equal(envProgramOf(["--frobnicate", "node"]), null);
  assert.equal(envProgramOf(["-u"]), null);
});

test("an env shebang with options still names the interpreter it will run", () => {
  const directory = scratch();
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin, { mode: 0o755 });
    executable(bin, "aos-test-interpreter", "exit 0");
    const script = join(directory, "claude");
    writeFileSync(script, "#!/usr/bin/env -u AOS_TEST_UNSET aos-test-interpreter\nexit 0\n");
    chmodSync(script, 0o755);

    const identity = describeExecutable(script, { env: { PATH: bin }, adapterId: "claude-code.v1" });
    assert.deepEqual(identity.interpreter_chain.map((entry) => entry.command), ["/usr/bin/env", "aos-test-interpreter"]);
    assert.equal(identity.identity_status, "VERIFIED", identity.untrusted_reasons.join(", "));

    // The consequence, not only the name. Put that interpreter somewhere anyone can write and the
    // script has to become untrusted for that reason. A scan that took `AOS_TEST_UNSET` -- the
    // variable being unset -- would report an unresolved interpreter here and never look at the
    // directory the program it will actually run is sitting in.
    const wide = join(directory, "wide");
    mkdirSync(wide, { mode: 0o755 });
    chmodSync(wide, 0o777);
    executable(wide, "aos-test-interpreter", "exit 0");
    const exposed = describeExecutable(script, { env: { PATH: [wide, bin].join(delimiter) }, adapterId: "claude-code.v1" });
    assert.equal(exposed.identity_status, "UNTRUSTED");
    assert.ok(
      exposed.untrusted_reasons.some((reason) => reason === `interpreter world_writable ${wide}`),
      `the interpreter env would run was never audited: ${exposed.untrusted_reasons.join(", ")}`
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an env shebang this cannot parse is an interpreter it cannot vouch for", () => {
  const directory = scratch();
  try {
    const script = join(directory, "claude");
    writeFileSync(script, "#!/usr/bin/env -Z aos-test-interpreter\nexit 0\n");
    chmodSync(script, 0o755);
    const identity = describeExecutable(script, { env: { PATH: directory }, adapterId: "claude-code.v1" });
    assert.equal(identity.identity_status, "UNTRUSTED");
    assert.ok(identity.untrusted_reasons.some((reason) => reason.startsWith("interpreter_unresolved arguments to env")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// One captured `ls -lde` listing, in the shape the tool actually prints it. `/bin` and `/usr/bin`
// are here on purpose: one operand is a suffix of the other, and the shorter one used to steal the
// longer one's entries.
const ACL_LISTING = [
  "drwxr-xr-x+ 39 isaac  staff  1248 Sep  2 07:39 /usr/bin",
  " 0: group:everyone deny delete",
  " 1: user:mallory allow add_file,delete_child",
  " 2: user:isaac inherited allow read,write",
  " 3: group:staff allow read,list",
  "drwxr-xr-x  2 root   wheel    64 Sep  2 07:39 /bin",
  "drwxr-xr-x  7 isaac  staff   224 Aug 19 04:28 /opt/quiet"
].join("\n");

test("an ACL listing is read for the rights that let somebody replace a file", () => {
  const findings = aclFindingsFrom(ACL_LISTING, ["/usr/bin", "/bin", "/opt/quiet"]);
  const busy = findings.get("/usr/bin");
  assert.equal(busy.unreadable, false);
  // The deny entry is not a grant, and `read,list` cannot put a different file anywhere. What is
  // left is the two that can, with `inherited` dropped from the principal it decorates.
  assert.equal(busy.detail, "user:mallory allow add_file,delete_child; user:isaac allow read,write");
  assert.equal(REPLACEABLE_RIGHTS.has("add_file"), true);
  assert.equal(REPLACEABLE_RIGHTS.has("read"), false);
  // The suffix pair: `/bin` was mentioned, carries nothing, and did not collect `/usr/bin`'s rows.
  assert.deepEqual(findings.get("/bin"), { unreadable: false, detail: null });
  assert.deepEqual(findings.get("/opt/quiet"), { unreadable: false, detail: null });
});

test("a path the ACL listing never mentions is not read as clean", () => {
  // The failure half, and the one that decides what happens when the tool is missing, times out, or
  // is refused. Reading silence as "no ACL here" makes the check pass hardest exactly when it has
  // stopped working.
  const findings = aclFindingsFrom(ACL_LISTING, ["/usr/bin", "/never/mentioned"]);
  assert.equal(findings.get("/never/mentioned").unreadable, true);
  assert.equal(findings.get("/usr/bin").unreadable, false);
  // And a call that did not happen at all says so for every path it was asked about.
  const nothing = aclFindingsFrom("", ["/usr/bin", "/bin"], { answered: false });
  assert.deepEqual([...nothing.values()].map((entry) => entry.unreadable), [true, true]);
});

test("the identity is read from the descriptor, not by reopening the name", () => {
  // The single-descriptor claim, made deterministic. The seam replaces the pathname atomically
  // while the handle is held and puts it back before the same-inode check, so what is measured is
  // where each field came from -- not whether a race happened to be won.
  const directory = scratch();
  try {
    const command = join(directory, "claude");
    const keep = join(directory, "keep");
    const impostor = join(directory, "impostor");
    writeFileSync(command, "#!/bin/sh\nexit 0\n");
    chmodSync(command, 0o755);
    // A different inode, different bytes, different mode and a different shebang.
    writeFileSync(impostor, "#!/usr/bin/env aos-test-interpreter-not-installed\nexit 1\n");
    chmodSync(impostor, 0o700);
    const expected = `sha256:${createHash("sha256").update(readFileSync(command)).digest("hex")}`;

    const identity = describeExecutable(command, {
      adapterId: "claude-code.v1",
      probe: (stage) => {
        if (stage === "opened") {
          renameSync(command, keep);
          renameSync(impostor, command);
        }
        if (stage === "read") {
          renameSync(command, impostor);
          renameSync(keep, command);
        }
      }
    });

    assert.notEqual(identity, null, "the description was abandoned rather than answered");
    assert.equal(identity.file_fingerprint, expected, "the bytes came from reopening the name");
    assert.equal(identity.mode, "0755", "the metadata came from re-stating the name");
    assert.equal(identity.owner_uid, process.getuid());
    assert.deepEqual(identity.interpreter_chain.map((entry) => entry.command), ["/bin/sh"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a native runtime keeps the argv0 the operator configured", async () => {
  // What `argv0` does, and what it does not. For a native executable the child sees the configured
  // command in `argv[0]` and the verified file in `execPath`, which is the whole intent. For a
  // `#!` script the kernel rebuilds the argument vector when it dispatches the interpreter and
  // `argv0` is discarded -- which is why the script test above finds the resolved path in `$0`.
  // The documentation promised the first for both, and for a script that was not true.
  const directory = scratch();
  try {
    const command = join(directory, "claude");
    symlinkSync(process.execPath, command);
    const identity = describeExecutable(command, { adapterId: "claude-code.v1" });
    assert.equal(identity.resolved_realpath, realpathSync(process.execPath));

    const spec = agentAt(command, identity, {
      auto_runtime_auth: false,
      runtime_auth_env_names: ["CLAUDE_CODE_OAUTH_TOKEN"],
      args: ["-e", "console.log('argv0=' + process.argv0); console.log('exe=' + process.execPath)"]
    });
    const result = await runOnce(spec, directory);
    assert.equal(result.exit_code, 0, result.stderr_excerpt);
    assert.ok(
      result.stdout_excerpt.includes(`argv0=${command}`),
      `argv0 was not the configured command: ${result.stdout_excerpt}`
    );
    assert.ok(
      result.stdout_excerpt.includes(`exe=${realpathSync(process.execPath)}`),
      `the executed file was not the verified one: ${result.stdout_excerpt}`
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
