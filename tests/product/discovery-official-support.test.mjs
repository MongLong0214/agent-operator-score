// #574 crossed with #556 and #561. OFFICIAL is a conjunction, and this file takes each term away
// one at a time.
//
// The defect this is aimed at is not a wrong boolean, it is a second opinion. `support_matrix[]`
// and OFFICIAL are decided by the isolation gate in lib/confinement.mjs over the committed
// observations, and by the issuance policy in lib/model-identity.mjs over the executable #554
// verified. Discovery reads those verdicts. A copy of either rule here would be a second authority
// that goes stale the day the first one changes, so the tests below also assert that discovery's
// answer moves when the authority's answer moves -- not merely that it happens to agree today.

import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { discover } from "../../lib/discovery.mjs";
import { SUPPORTED_RELEASE_SET, laneOf, supportMatrixDecisions } from "../../lib/confinement.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-official-"));
const matrix = JSON.parse(readFileSync(new URL("../../fixtures/confinement/support-matrix.json", import.meta.url), "utf8"));

const installRuntime = (root, { package_name, binary }) => {
  const dir = join(root, "node_modules", ...package_name.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: package_name, version: "1.0.0" }));
  const file = join(dir, "bin", binary);
  writeFileSync(file, `#!/bin/sh\nexit 0\n`);
  chmodSync(file, 0o755);
  return { file, pathDir: join(dir, "bin") };
};

const backendStub = (result) => () => ({ id: result.backend, platform: "test", probe: () => result });
const seatbelt = backendStub({ available: true, backend: "macos-seatbelt", level_ceiling: "STRICT", reason: null, deprecated: true });

const agent = (id, command, adapter, extra = {}) => ({
  id, display_name: id, runtime_name: id, command, args: [], adapter,
  allowed_env_names: [], runtime_auth_env_names: [], transport_env_names: [],
  auto_runtime_auth: true, runtime_identity: null, model_id: null,
  config_digest: `sha256:${"0".repeat(64)}`, ...extra
});

/**
 * The one host on which everything is true at once: a real `@openai/codex` install this account
 * owns, the runtime's own configuration present, an exact model, and the seatbelt lane the release
 * proved.
 */
const officialHost = (root, { agents = null, backendFor = seatbelt, matrixOverride = matrix, resolveCredential = () => null } = {}) => {
  const { pathDir } = installRuntime(root, { package_name: "@openai/codex", binary: "codex" });
  const operatorHome = join(root, "operator-home");
  mkdirSync(join(operatorHome, ".codex"), { recursive: true });
  writeFileSync(join(operatorHome, ".codex", "auth.json"), JSON.stringify({ tokens: {} }), { mode: 0o600 });
  writeFileSync(join(operatorHome, ".codex", "config.toml"), 'model = "gpt-5-codex"\n', { mode: 0o600 });
  const home = join(root, "aos-home");
  mkdirSync(join(home, "runs"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "agents.json"), JSON.stringify({
    schema_id: "aos-config.v1",
    agents: agents ?? { codex: agent("codex", "codex", "codex-cli.v1", { model_id: "openai/gpt-4o-2024-08-06" }) },
    collaboration_surfaces: {}
  }));
  return {
    home, platform: "darwin", arch: "arm64",
    env: { PATH: [pathDir].join(delimiter), HOME: operatorHome },
    // Never the real resolver: `lib/runtime-auth.mjs` reads the login Keychain of whoever runs the
    // suite, and a test is not entitled to that. The ordering it is wrapped in is what these cases
    // are about, and that is exercised in tests/product/discovery.test.mjs.
    operatorHome, backendFor, matrix: matrixOverride, resolveCredential, probe: () => "codex-cli 1.2.3"
  };
};

test("the whole conjunction true is the host's one OFFICIAL_READY answer", () => {
  const root = scratch();
  const record = discover(officialHost(root));
  const codex = record.candidates.find((one) => one.id === "codex");

  assert.equal(codex.identity.status, "VERIFIED");
  assert.equal(codex.identity.adapter_runtime_match, true);
  assert.equal(codex.auth.status, "PRESENT");
  assert.equal(codex.model.status, "EXACT");
  assert.equal(codex.env.status, "READY");
  assert.equal(codex.isolation.level, "STRICT");
  assert.equal(codex.isolation.lane_official, true);
  assert.equal(codex.support_status, "OFFICIAL");
  assert.equal(record.status, "OFFICIAL_READY");
  assert.equal(record.reason_code, null);
  assert.equal(record.profile.isolation_level, "STRICT");
  assert.equal(record.profile.scoring_permitted, true);
  rmSync(root, { recursive: true, force: true });
});

test("BEST_EFFORT is never reported as OFFICIAL_READY, whatever else is true", () => {
  const root = scratch();
  const absent = backendStub({ available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: "AOS_ISOLATION_BACKEND_ABSENT" });
  const record = discover(officialHost(root, { backendFor: absent }));
  const codex = record.candidates.find((one) => one.id === "codex");

  assert.equal(codex.model.status, "EXACT");
  assert.equal(codex.auth.status, "PRESENT");
  assert.equal(codex.isolation.level, "BEST_EFFORT_CLI");
  assert.equal(codex.isolation.lane_official, false);
  assert.equal(codex.support_status, "DIAGNOSTIC_ONLY");
  assert.equal(record.status, "DIAGNOSTIC_ONLY");
  assert.equal(record.profile.isolation_level, "BEST_EFFORT_CLI");
  rmSync(root, { recursive: true, force: true });
});

test("the model term alone withheld takes OFFICIAL away and nothing else", () => {
  const root = scratch();
  const record = discover(officialHost(root, {
    agents: { codex: agent("codex", "codex", "codex-cli.v1", { model_id: null }) }
  }));
  const codex = record.candidates.find((one) => one.id === "codex");

  assert.equal(codex.isolation.lane_official, true);
  assert.equal(codex.identity.status, "VERIFIED");
  assert.equal(codex.model.status, "WITHHELD");
  assert.equal(codex.support_status, "DIAGNOSTIC_ONLY");
  assert.equal(record.status, "DIAGNOSTIC_ONLY");
  assert.equal(record.reason_code, "AOS_DISCOVERY_MODEL_WITHHELD");
  rmSync(root, { recursive: true, force: true });
});

test("the credential term alone missing takes OFFICIAL away and asks the runtime, not the operator", () => {
  const root = scratch();
  const options = officialHost(root);
  rmSync(join(options.operatorHome, ".codex"), { recursive: true, force: true });
  const record = discover(options);
  const codex = record.candidates.find((one) => one.id === "codex");

  assert.equal(codex.model.status, "EXACT");
  assert.equal(codex.isolation.lane_official, true);
  assert.equal(codex.auth.status, "ACTION_REQUIRED");
  // And the environment term with it: `CODEX_HOME` is required, the operator has not set it, and
  // there is no configuration directory left for the boundary to stage and point it at.
  assert.equal(codex.env.status, "ACTION_REQUIRED");
  assert.deepEqual(codex.env.missing_required, ["CODEX_HOME"]);
  assert.equal(codex.support_status, "DIAGNOSTIC_ONLY");
  assert.equal(record.status, "ACTION_REQUIRED");
  rmSync(root, { recursive: true, force: true });
});

test("a lane the release table does not prove is not official, even with the backend present", () => {
  const root = scratch();
  // Claude Code on the same backend: the boundary is the same, and the release has no observation
  // of a real runtime authenticating under it.
  const claude = installRuntime(root, { package_name: "@anthropic-ai/claude-code", binary: "claude" });
  const options = officialHost(root, {
    agents: { claude: agent("claude", claude.file, "claude-code.v1", { model_id: "anthropic/claude-sonnet-4-5-20250929" }) }
  });
  const record = discover(options);
  const candidate = record.candidates.find((one) => one.id === "claude");

  assert.equal(candidate.model.status, "EXACT");
  assert.equal(candidate.isolation.support_status, "NOT_OBSERVED");
  assert.equal(candidate.isolation.lane_official, false);
  // Its adapter declares a configuration directory and no file inside it: on macOS the login is in
  // the Keychain, so a `~/.claude` that exists is not a login and must not read as one.
  assert.equal(candidate.auth.status, "ACTION_REQUIRED");
  assert.equal(candidate.support_status !== "OFFICIAL", true);
  assert.equal(laneOf({ platform: "darwin", backend: "macos-seatbelt", adapter: "claude-code.v1", level: "STRICT" }).support_status, "NOT_OBSERVED");
  rmSync(root, { recursive: true, force: true });
});

test("discovery's support matrix is the isolation gate's decision, not the fixture's own label", () => {
  const root = scratch();
  // The fixture keeps a `official: true` label beside the evidence. The gate's answer is what the
  // release issues on, and a label edited to disagree with the evidence does not move it.
  const relabelled = JSON.parse(JSON.stringify(matrix));
  for (const lane of relabelled.lanes) lane.official = true;
  const record = discover(officialHost(root, { matrixOverride: relabelled }));

  const gated = supportMatrixDecisions(relabelled);
  for (const row of record.support_matrix) {
    const authority = gated.find((one) =>
      one.platform === row.platform && one.backend === row.backend && one.adapter === row.adapter && one.level === row.level);
    assert.equal(row.official, authority.decision.official, `${row.platform}/${row.backend}/${row.adapter}/${row.level}`);
  }
  assert.equal(record.support_matrix.filter((row) => row.official).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test("a lane whose committed evidence no longer verifies loses official, and discovery loses it with it", () => {
  const root = scratch();
  const broken = JSON.parse(JSON.stringify(matrix));
  const proven = broken.lanes.find((lane) => SUPPORTED_RELEASE_SET.has(lane.support_status));
  // One byte of the cited canary's declared digest. The gate reads the observation and refuses.
  proven.evidence.canary.digest = `sha256:${"0".repeat(64)}`;
  const record = discover(officialHost(root, { matrixOverride: broken }));

  const codex = record.candidates.find((one) => one.id === "codex");
  assert.equal(codex.isolation.lane_official, false);
  assert.notEqual(record.status, "OFFICIAL_READY");
  assert.ok(codex.isolation.reasons.includes("AOS_ISOLATION_EVIDENCE_DIGEST_MISMATCH"));
  rmSync(root, { recursive: true, force: true });
});

test("an untrusted executable withholds the profile-bound claim through the issuance policy, not through a rule of its own", () => {
  const root = scratch();
  const options = officialHost(root);
  // A world-writable directory earlier on PATH holding the same name. #554 records UNTRUSTED.
  const open = join(root, "open-bin");
  mkdirSync(open, { recursive: true });
  chmodSync(open, 0o777);
  writeFileSync(join(open, "codex"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(open, "codex"), 0o755);
  const record = discover({ ...options, env: { ...options.env, PATH: [open, options.env.PATH].join(delimiter) } });

  const codex = record.candidates.find((one) => one.id === "codex");
  assert.equal(codex.identity.status, "UNTRUSTED");
  assert.equal(codex.model.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(codex.model.withheld_reason, "RUNTIME_IDENTITY_UNVERIFIED");
  assert.equal(codex.support_status, "BLOCKED");
  rmSync(root, { recursive: true, force: true });
});
