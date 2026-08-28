import assert from "node:assert/strict";
import test from "node:test";

import { ADAPTERS, adapterFor, buildProfile, probeCommand, profileDigestOf, profileLabel, sameCohort } from "../../lib/profile.mjs";

const agent = (over = {}) => ({
  id: "main",
  runtime_name: "codex",
  command: "/usr/bin/codex",
  args: [],
  adapter: "codex-cli.v1",
  config_digest: "sha256:abc",
  ...over
});

const build = (over = {}, probe = () => null) =>
  buildProfile({ agent: agent(), platform: "darwin", arch: "arm64", nodeVersion: "22.18.0", probe, ...over });

test("a version read from the runtime is detected, one typed by the operator is declared", () => {
  // The two carry different weight, and a surface that showed them the same way would let a guess
  // read as a measurement.
  const detected = build({}, () => "codex-cli 0.12.3");
  assert.equal(detected.runtime_version, "0.12.3");
  assert.equal(detected.runtime_version_source, "detected");

  const declared = build({ agent: agent({ runtime_version: "0.9.0" }) });
  assert.equal(declared.runtime_version, "0.9.0");
  assert.equal(declared.runtime_version_source, "declared");

  const neither = build();
  assert.equal(neither.runtime_version, null);
  assert.equal(neither.runtime_version_source, "unknown");
});

test("an undetectable model does not block a score", () => {
  // Refusing to run because a version string could not be parsed would make the product unusable
  // against exactly the runtimes it exists to be neutral about.
  const profile = build();
  assert.equal(profile.model_id, null);
  assert.equal(profile.model_source, "unknown");
  assert.equal(profile.scoring_permitted, true);
});

test("isolation NONE is recorded as not scorable", () => {
  assert.equal(build({ isolation: "NONE" }).scoring_permitted, false);
  assert.equal(build({ isolation: "STRICT" }).scoring_permitted, true);
});

test("an unknown isolation level is refused rather than defaulted", () => {
  assert.throws(() => build({ isolation: "SANDBOXED" }), /AOS_UNKNOWN_ISOLATION/);
});

test("the digest changes with anything that changes what the number means", () => {
  const base = build();
  const changes = [
    ["a different machine", { platform: "linux" }],
    ["a different cpu", { arch: "x64" }],
    ["a different node major", { nodeVersion: "24.1.0" }],
    ["a different isolation level", { isolation: "STRICT" }],
    ["a different suite major", { suiteMajor: 2 }],
    ["a different tool policy", { toolPolicy: "workspace-read" }],
    ["a carried credential name", { allowedEnvNames: ["ANTHROPIC_API_KEY"] }],
    ["a different agent configuration", { agent: agent({ config_digest: "sha256:def" }) }],
    ["a different runtime", { agent: agent({ runtime_name: "claude-code", adapter: "claude-code.v1" }) }]
  ];
  for (const [label, over] of changes) {
    assert.notEqual(build(over).profile_digest, base.profile_digest, label);
  }
});

test("the digest does not change with the name the operator gave it", () => {
  // Two identically configured environments must aggregate whether or not they were labelled the
  // same, or the cohort becomes a naming convention.
  assert.equal(build({ profileId: "work" }).profile_digest, build({ profileId: "home" }).profile_digest);
});

test("the digest is not part of its own input", () => {
  const profile = build();
  assert.equal(profileDigestOf(profile), profile.profile_digest);
  assert.equal(profileDigestOf({ ...profile, profile_digest: "sha256:tampered" }), profile.profile_digest);
});

test("a node patch release is not a new cohort", () => {
  // Pinning the patch would leave the operator unable to compare this week with last week for a
  // reason nobody could act on.
  assert.equal(build({ nodeVersion: "22.18.0" }).profile_digest, build({ nodeVersion: "22.21.4" }).profile_digest);
  assert.notEqual(build({ nodeVersion: "22.18.0" }).profile_digest, build({ nodeVersion: "24.0.0" }).profile_digest);
});

test("same digest is the whole test for comparability", () => {
  assert.equal(sameCohort(build(), build()), true);
  assert.equal(sameCohort(build(), build({ isolation: "STRICT" })), false);
  assert.equal(sameCohort(build(), null), false);
});

test("a runtime nobody wrote an adapter for is accepted", () => {
  // Vendor neutrality has to hold for the runtime that does not exist yet, or the product decides
  // which agents an operator is allowed to be measured with.
  const unknown = adapterFor({ runtime_name: "something-new-in-2027", adapter: undefined });
  assert.equal(unknown.id, "generic-command.v1");
  assert.equal(unknown.provider_network, "unknown", "a network claim was invented for an unknown runtime");

  const profile = build({ agent: agent({ runtime_name: "something-new-in-2027", adapter: undefined }) });
  assert.equal(profile.adapter_id, "generic-command.v1");
  assert.equal(profile.runtime_name, "something-new-in-2027");
});

test("an adapter is chosen by name first and by runtime second", () => {
  assert.equal(adapterFor({ adapter: "claude-code.v1" }).id, "claude-code.v1");
  assert.equal(adapterFor({ runtime_name: "codex" }).id, "codex-cli.v1");
  assert.equal(adapterFor({}).id, "generic-command.v1");
});

test("every declared adapter can answer the questions a profile asks", () => {
  for (const adapter of Object.values(ADAPTERS)) {
    assert.equal(Array.isArray(adapter.version_args), true, adapter.id);
    assert.equal(typeof adapter.version_of, "function", adapter.id);
    assert.equal(typeof adapter.model_of, "function", adapter.id);
    assert.equal(adapter.supported_isolation.length > 0, true, adapter.id);
    // A parser that throws on unexpected output would take the run down at the probe.
    assert.doesNotThrow(() => adapter.version_of(""));
    assert.doesNotThrow(() => adapter.model_of("garbage output \u0000"));
  }
});

test("the label carries the boundary next to the number", () => {
  const label = profileLabel(build({}, () => "codex-cli 0.12.3"));
  assert.match(label, /codex/);
  assert.match(label, /0\.12\.3/);
  assert.match(label, /darwin arm64/);
  assert.match(label, /BEST_EFFORT_CLI/);
  // And says so when a fact is missing, rather than leaving a gap that reads as "none".
  assert.match(profileLabel(build()), /model unknown/);
});

test("the version probe does not hand the operator's credentials to the runtime", () => {
  // It runs before anybody has decided the run is safe to start, so it gets the same treatment the
  // run itself gets. Spawned for real, because the point is what the child can read.
  process.env.ACME_PROBE_TOKEN = "ghp_probemustneverseethisvalue000000";
  try {
    const dump = probeCommand(process.execPath, [
      "-e",
      'process.stdout.write(JSON.stringify({ token: process.env.ACME_PROBE_TOKEN ?? "absent", names: Object.keys(process.env).length }))'
    ]);
    const seen = JSON.parse(dump);
    assert.equal(seen.token, "absent", "the probe inherited the operator's environment");
  } finally {
    delete process.env.ACME_PROBE_TOKEN;
  }
});

test("a probe that fails or is absent yields unknown rather than an error", () => {
  // A runtime that is not installed, or one that answers `--version` with a non-zero exit, must
  // still produce a profile: the alternative is that doctor cannot describe a broken setup.
  assert.equal(probeCommand("", ["--version"]), null);
  assert.equal(probeCommand("/nonexistent/binary-aos-test", ["--version"]), null);
  assert.equal(probeCommand(process.execPath, ["-e", "process.exit(3)"]), null);

  let called = 0;
  const profile = buildProfile({
    agent: agent(),
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "22.18.0",
    probe: (command, args) => {
      called += 1;
      return probeCommand(command, args);
    }
  });
  assert.equal(called, 1);
  assert.equal(profile.runtime_version_source, "unknown");
});
