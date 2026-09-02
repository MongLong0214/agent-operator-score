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
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  TRUSTED_DIRECTORY_GIDS,
  describeExecutable,
  identityDrift,
  resolveExecutable
} from "../../lib/runtime-identity.mjs";

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

test("a binary replaced between registration and spawn is refused", () => {
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
    const file = executable(directory, "claude", "exit 0");
    const registered = describeExecutable(file, { adapterId: "claude-code.v1" });
    executable(directory, "claude", `touch ${marker}`);

    const spec = agentAt(file, registered);
    const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = OPERATOR_TOKEN;
    try {
      await assert.rejects(
        runProcess(spec, {
          workspace: directory,
          family: "FAM-1",
          stage: "s",
          prompt: "hello",
          session: "sess",
          isolation: "BEST_EFFORT_CLI",
          timeoutMs: 5000
        }),
        /AOS_RUNTIME_IDENTITY_DRIFT/
      );
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previous;
    }
    assert.equal(resolveExecutable(marker), null, "the child was spawned after the identity was refused");
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
