// #639. The durable evidence record for an actual, authenticated STRICT canary run, and the gate a
// release consumes it through.
//
// `confinement-real-lane.test.mjs` already runs the installed Codex runtime under Seatbelt and
// already tells a real run apart from a provider refusal and from a lane that could not be
// measured here at all. What was missing was a record of that fact durable enough for a release to
// cite -- so these tests are about the record and the gate, not about the sandbox. They build their
// confinement record from the same committed observation `official-issuance.test.mjs` uses, which
// makes them portable: no Seatbelt, no authenticated runtime, no darwin required to run them.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildStrictCanaryRecord,
  issuanceGate,
  PROVIDER_REFUSAL,
  releaseCanaryGate,
  STRICT_CANARY_GATE_REASONS,
  STRICT_CANARY_OUTCOMES,
  STRICT_CANARY_SCHEMA
} from "../../lib/confinement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixtureDir = join(root, "fixtures", "confinement");

// The same committed observation `official-issuance.test.mjs`'s `measured()` reads: a real darwin
// run of the codex-cli.v1 lane, captured once and kept so every test of the gate above it works
// from one piece of ground truth rather than a hand-built shape.
const observation = JSON.parse(readFileSync(join(fixtureDir, "observations", "strict-lane.darwin.seatbelt.canary.json"), "utf8"));
const captured = observation.captured;

const measuredConfinementRecord = (overrides = {}) => ({
  schema: "aos-confinement-record.v1",
  level: "STRICT",
  platform: "darwin",
  backend: "macos-seatbelt",
  adapter: "codex-cli.v1",
  filesystem_enforced: true,
  process_enforced: true,
  network_policy: captured.network_policy,
  network: { provider_transport: "allowed", task_external: "NOT_OBSERVED", enforcement: "kernel" },
  policy_digest: captured.policy_digest,
  rendered_profile_digest: captured.rendered_profile_digest,
  setup_verified: true,
  boundary_canary: {
    result: "PASS",
    failed: [],
    cells: captured.cells,
    out_of_band: captured.out_of_band,
    evidence_digest: captured.evidence_digest,
    program_digest: captured.program_digest,
    scan_polls: captured.scan_polls
  },
  descendants: {
    scan: "ancestry-poll+process-group-sweep+survivor-sweep",
    poll_interval_ms: 200,
    polls: 12,
    tracked: [4242],
    leaked: [],
    survivors: [],
    group_sweep: { pgid: 4242, members: [] },
    survivor_sweep: { scanned: true, scanners: ["environment-marker", "open-path", "process-group"], marker_used: true, paths: 3, group_enumerated: 1, survivors: [] }
  },
  cleanup_verified: true,
  scratch_not_removed: [],
  support_status: "SUPPORTED_WITH_CONSTRAINTS",
  platform_lane: "darwin/macos-seatbelt/codex-cli.v1",
  runtime_identity: { status: "VERIFIED", digest: `sha256:${"1".repeat(64)}`, matches_adapter: true, reason: null },
  ...overrides
});

// Sanity precondition every test below rests on: the confinement record these tests build the
// canary from is itself official under this module's own gate, so a rejection in the tests that
// follow is about the canary layer and not about a fixture that was never valid to begin with.
test("the fixture confinement record this file builds canaries from is itself official", () => {
  assert.deepEqual(issuanceGate(measuredConfinementRecord()).reasons, []);
  assert.equal(issuanceGate(measuredConfinementRecord()).official, true);
});

const observedRecord = (overrides = {}) => buildStrictCanaryRecord({
  outcome: "OBSERVED",
  platform: "darwin",
  backend: "macos-seatbelt",
  adapter: "codex-cli.v1",
  runtimeVersion: "0.47.0",
  runtimeVersionSource: "detected",
  confinementRecord: measuredConfinementRecord(),
  observedAt: "2026-09-06T00:00:00.000Z",
  ...overrides
});

test("an OBSERVED canary built from a real confinement record is accepted by the release gate", () => {
  const record = observedRecord();
  assert.equal(record.schema_id, STRICT_CANARY_SCHEMA);
  assert.equal(record.outcome, "OBSERVED");
  assert.equal(record.sandbox_profile_digest, captured.rendered_profile_digest);
  assert.deepEqual(record.escape_attempt_result, captured.out_of_band);
  const decision = releaseCanaryGate(record);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.accepted, true);
  assert.equal(decision.outcome, "OBSERVED");
});

test("a record carrying a forged sandbox_profile_digest is rejected", () => {
  const record = observedRecord();
  const forged = { ...record, sandbox_profile_digest: `sha256:${"0".repeat(64)}` };
  // The embedded confinement record still carries the real digest; only the headline field lies.
  assert.notEqual(forged.sandbox_profile_digest, forged.confinement_record.rendered_profile_digest);
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.PROFILE_DIGEST_MISMATCH), decision.reasons.join(","));
});

test("forging the embedded record's digest instead of the headline field is caught the same way", () => {
  const record = observedRecord();
  const forged = { ...record, confinement_record: { ...record.confinement_record, rendered_profile_digest: `sha256:${"f".repeat(64)}` } };
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.PROFILE_DIGEST_MISMATCH), decision.reasons.join(","));
});

// #639 round-1 blocker: `escape_attempt_result` is the headline copy of
// `confinement_record.boundary_canary.out_of_band`, and nothing previously checked the copy still
// agreed with the original -- unlike `sandbox_profile_digest`, which is cross-checked against the
// embedded record's own `rendered_profile_digest` two tests up. These three mutations are the exact
// ones round 1 ran by hand against the real committed fixture: deleting the field, replacing it with
// `{}`, and replacing it with a record that says the sandboxed process escaped and left a survivor.
// All three left the embedded evidence untouched and all three were accepted before this fix.
test("deleting escape_attempt_result is rejected, not silently accepted", () => {
  const record = observedRecord();
  const forged = { ...record };
  delete forged.escape_attempt_result;
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.ESCAPE_ATTEMPT_RESULT_MISMATCH), decision.reasons.join(","));
});

test("an empty escape_attempt_result is rejected, not silently accepted", () => {
  const record = observedRecord();
  const forged = { ...record, escape_attempt_result: {} };
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.ESCAPE_ATTEMPT_RESULT_MISMATCH), decision.reasons.join(","));
});

test("a headline escape_attempt_result that contradicts its own embedded confinement evidence is rejected", () => {
  const record = observedRecord();
  // The embedded `confinement_record.boundary_canary.out_of_band` still says `escapee_confined:
  // true` with no survivors -- only the headline field is edited to say the descendant escaped.
  const forged = { ...record, escape_attempt_result: { descendant: { escapee_confined: false, survivors: [999] } } };
  assert.notDeepEqual(forged.escape_attempt_result, forged.confinement_record.boundary_canary.out_of_band);
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.ESCAPE_ATTEMPT_RESULT_MISMATCH), decision.reasons.join(","));
});

test("forging the embedded out_of_band instead of the headline field is caught the same way", () => {
  const record = observedRecord();
  const brokenOutOfBand = { ...record.confinement_record.boundary_canary.out_of_band, descendant: { ...record.confinement_record.boundary_canary.out_of_band.descendant, escapee_confined: false, survivors: [999] } };
  const forged = {
    ...record,
    confinement_record: { ...record.confinement_record, boundary_canary: { ...record.confinement_record.boundary_canary, out_of_band: brokenOutOfBand } }
  };
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  // Caught twice over: the headline no longer matches the (now-broken) embedded value, and the
  // embedded confinement record itself is no longer official because `authenticityProblems` refuses
  // an unconfined descendant.
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.ESCAPE_ATTEMPT_RESULT_MISMATCH), decision.reasons.join(","));
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.CONFINEMENT_NOT_OFFICIAL), decision.reasons.join(","));
});

// #639 round-1 blocker: `observed_at` was completely free-form -- an OBSERVED record dated
// 1970-01-01 passed this gate exactly like a real one. There is no second, independently-measured
// timestamp elsewhere in the record to cross-check it against the way the profile digest is
// cross-checked, so what this binds it to instead: a canonical ISO-8601 string (the exact shape
// `new Date().toISOString()` produces, which is the only way this module ever builds one), dated no
// earlier than the schema this record claims to be an instance of could possibly have shipped.
test("a record dated at the Unix epoch is rejected, not silently accepted", () => {
  const record = observedRecord({ observedAt: "1970-01-01T00:00:00.000Z" });
  const decision = releaseCanaryGate(record);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.OBSERVED_AT_INVALID), decision.reasons.join(","));
});

test("a non-canonical or unparseable observed_at is rejected", () => {
  for (const bad of ["not a date", "", "2026-09-06", 1757116800000, null, undefined]) {
    const record = { ...observedRecord(), observed_at: bad };
    const decision = releaseCanaryGate(record);
    assert.equal(decision.accepted, false, `observed_at=${JSON.stringify(bad)} was accepted`);
    assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.OBSERVED_AT_INVALID), decision.reasons.join(","));
  }
});

test("a canonical observed_at at or after the schema floor is accepted", () => {
  const record = observedRecord({ observedAt: "2026-09-06T00:00:00.000Z" });
  const decision = releaseCanaryGate(record);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.accepted, true);
});

test("a record whose embedded confinement record is not itself official cannot authorize the canary by existing alone", () => {
  const record = observedRecord();
  const brokenCanary = { ...record.confinement_record.boundary_canary, cells: { ...record.confinement_record.boundary_canary.cells, outside_read: { expected: "denied", observed: "allowed", errno: null } } };
  const forged = { ...record, confinement_record: { ...record.confinement_record, boundary_canary: brokenCanary } };
  const decision = releaseCanaryGate(forged);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.CONFINEMENT_NOT_OFFICIAL), decision.reasons.join(","));
});

test("a NOT_OBSERVED record is a legitimate artifact and is never release evidence", () => {
  const record = buildStrictCanaryRecord({
    outcome: "NOT_OBSERVED",
    reason: "NOT_OBSERVED: codex is not on PATH; the codex-cli.v1 lane was not re-measured",
    platform: "linux",
    backend: null,
    adapter: null
  });
  assert.equal(record.schema_id, STRICT_CANARY_SCHEMA);
  assert.equal(record.outcome, "NOT_OBSERVED");
  assert.equal(record.sandbox_profile_digest, null);
  const decision = releaseCanaryGate(record);
  assert.equal(decision.accepted, false);
  assert.deepEqual(decision.reasons, [STRICT_CANARY_GATE_REASONS.NOT_OBSERVED]);
  // Silence is not coverage: a run of ten NOT_OBSERVED records is still zero evidence, never
  // averaged or counted toward release readiness by this gate.
  assert.equal([record, record, record].every((one) => releaseCanaryGate(one).accepted), false);
});

test("a PROVIDER_REFUSED record is a distinct value from NOT_OBSERVED, not the same fact under a different name", () => {
  const refused = buildStrictCanaryRecord({
    outcome: "PROVIDER_REFUSED",
    reason: "NOT_OBSERVED: the provider refused to serve (usage limit); the codex-cli.v1 lane was not re-measured",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1"
  });
  const absent = buildStrictCanaryRecord({
    outcome: "NOT_OBSERVED",
    reason: "NOT_OBSERVED: codex is not on PATH; the codex-cli.v1 lane was not re-measured",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1"
  });
  assert.notEqual(refused.outcome, absent.outcome);
  assert.ok(STRICT_CANARY_OUTCOMES.includes(refused.outcome));
  assert.ok(STRICT_CANARY_OUTCOMES.includes(absent.outcome));
  // Neither is a pass and neither is a boundary failure: both are refused by the release gate, but
  // as the value they actually are.
  assert.equal(releaseCanaryGate(refused).accepted, false);
  assert.equal(releaseCanaryGate(refused).outcome, "PROVIDER_REFUSED");
  assert.equal(releaseCanaryGate(absent).outcome, "NOT_OBSERVED");
  // The regex this module ships is the one the real lane's own provider-refusal test still uses --
  // preserved rather than re-specified, so the two cannot silently drift into disagreeing about
  // what a refusal looks like.
  assert.equal(PROVIDER_REFUSAL.test("You have hit your usage limit. Try again later."), true);
  assert.equal(PROVIDER_REFUSAL.test("internal error: segmentation fault"), false);
});

test("runtime_version is what the runtime measured, and a canary that cannot show that is not accepted", () => {
  const declared = observedRecord({ runtimeVersionSource: "declared" });
  assert.equal(releaseCanaryGate(declared).accepted, false);
  assert.ok(releaseCanaryGate(declared).reasons.includes(STRICT_CANARY_GATE_REASONS.RUNTIME_VERSION_UNMEASURED));

  const unknown = observedRecord({ runtimeVersionSource: "unknown" });
  assert.equal(releaseCanaryGate(unknown).accepted, false);
  assert.ok(releaseCanaryGate(unknown).reasons.includes(STRICT_CANARY_GATE_REASONS.RUNTIME_VERSION_UNMEASURED));

  const detected = observedRecord();
  assert.equal(detected.runtime_version_source, "detected");
  assert.equal(detected.runtime_version, "0.47.0");
  assert.equal(releaseCanaryGate(detected).accepted, true);
});

test("an OBSERVED record cannot be built without a runtime version actually measured", () => {
  assert.throws(() => buildStrictCanaryRecord({
    outcome: "OBSERVED",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1",
    runtimeVersion: null,
    confinementRecord: measuredConfinementRecord()
  }), /AOS_STRICT_CANARY_RUNTIME_VERSION_UNMEASURED/u);
});

test("an OBSERVED record cannot be built without a confinement record to bind its digest to", () => {
  assert.throws(() => buildStrictCanaryRecord({
    outcome: "OBSERVED",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1",
    runtimeVersion: "0.47.0",
    confinementRecord: null
  }), /AOS_STRICT_CANARY_PROFILE_DIGEST_MISSING/u);
});

test("a non-OBSERVED outcome needs a stated reason", () => {
  assert.throws(() => buildStrictCanaryRecord({ outcome: "NOT_OBSERVED", reason: null }), /AOS_STRICT_CANARY_REASON_REQUIRED/u);
  assert.throws(() => buildStrictCanaryRecord({ outcome: "PROVIDER_REFUSED", reason: "" }), /AOS_STRICT_CANARY_REASON_REQUIRED/u);
});

test("an unknown outcome is refused rather than silently accepted", () => {
  assert.throws(() => buildStrictCanaryRecord({ outcome: "PASSED", reason: "whatever" }), /AOS_STRICT_CANARY_OUTCOME_INVALID/u);
});

test("a record for a lane this release has not proven cannot be release evidence however internally consistent it is", () => {
  // generic-command.v1 on darwin/macos-seatbelt is NOT_OBSERVED in SUPPORT_LANES: the boundary is
  // measured by the same canary, but no real runtime authenticated under it, so a release cannot
  // issue on it whatever a single record claims about itself.
  const record = observedRecord({ adapter: "generic-command.v1", confinementRecord: measuredConfinementRecord({ adapter: "generic-command.v1", platform_lane: "darwin/macos-seatbelt/generic-command.v1" }) });
  const decision = releaseCanaryGate(record);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.includes(STRICT_CANARY_GATE_REASONS.LANE_NOT_PROVEN), decision.reasons.join(","));
});

test("a record with a tampered or missing schema id is refused as invalid rather than read", () => {
  const record = observedRecord();
  assert.equal(releaseCanaryGate({ ...record, schema_id: "aos-strict-canary.v2" }).accepted, false);
  assert.deepEqual(releaseCanaryGate({ ...record, schema_id: "aos-strict-canary.v2" }).reasons, [STRICT_CANARY_GATE_REASONS.RECORD_INVALID]);
  assert.deepEqual(releaseCanaryGate(null).reasons, [STRICT_CANARY_GATE_REASONS.RECORD_INVALID]);
  assert.deepEqual(releaseCanaryGate({}).reasons, [STRICT_CANARY_GATE_REASONS.RECORD_INVALID]);
});

// The script a release actually runs: `verify:release-canary`. Exercised as a subprocess so the
// test is honest about what ships -- an import of the module under test would prove the function
// works and say nothing about whether the CLI wiring around it does the same thing.
const scriptPath = join(root, "scripts", "verify-release-canary.mjs");

test("the release-canary script fails closed when no evidence file exists", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "aos-639-canary-")), "absent.json");
  try {
    const result = spawnSync(process.execPath, [scriptPath, missing], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_RELEASE_CANARY_ABSENT/u);
  } finally {
    rmSync(dirname(missing), { recursive: true, force: true });
  }
});

test("the release-canary script exits zero only for an accepted OBSERVED record", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-639-canary-"));
  try {
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(observedRecord()));
    const okResult = spawnSync(process.execPath, [scriptPath, good], { encoding: "utf8" });
    assert.equal(okResult.status, 0, okResult.stderr);

    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify(buildStrictCanaryRecord({ outcome: "NOT_OBSERVED", reason: "NOT_OBSERVED: no backend on this host" })));
    const badResult = spawnSync(process.execPath, [scriptPath, bad], { encoding: "utf8" });
    assert.notEqual(badResult.status, 0);
    assert.match(badResult.stderr, /AOS_RELEASE_CANARY_NOT_ACCEPTED/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #639 round-1 blocker: this gate withheld nothing, because nothing called it. `grep -rn
// "verify:release-canary" .github/ docs/ governance/` found only `package.json` and this file's own
// comments -- a gate that is supposed to withhold release issuance was never run by any release
// procedure. Mirrors `"the live audit is a job in CI, not only a command in the documentation"` in
// `tests/product/execution-plan.test.mjs`, which is the analogue this issue named.
test("the release-canary gate is a job in CI, not only a command in the documentation", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /release-canary:/);
  assert.match(ci, /npm run verify:release-canary/);
});

// A remaining nit, fixed rather than only recorded: nothing in `npm test` read the actual committed
// record. Only `verify-release-canary.mjs` did, and that script is not part of the suite -- so a
// committed canary that stopped being accepted (a headline field edited out of step with its
// embedded evidence, an embedded record that regressed out of `issuanceGate`, a runtime_version
// that lost its `detected` source) would sit undetected until someone ran the script by hand or the
// `release-canary` CI job happened to run on a push to `main`.
test("the committed strict canary fixture is itself accepted by the release gate", () => {
  const committed = JSON.parse(readFileSync(join(fixtureDir, "strict-canary.json"), "utf8"));
  const decision = releaseCanaryGate(committed);
  assert.deepEqual(decision.reasons, [], `fixtures/confinement/strict-canary.json is not accepted: ${decision.reasons.join(",")}`);
  assert.equal(decision.accepted, true);
});
