// #574. The observation this release actually made, and the lane it makes on whatever machine runs
// the suite.
//
// Two halves, because they answer different questions and fail for different reasons. The fixture
// half reads a record taken on the machine named in it and holds it against the shipped support
// table: a committed observation that no longer agrees with the product is a claim about a release
// that no longer exists, and it must fail rather than sit there. The local half runs the real thing
// here, with no injected backend and no injected identity, and refuses to call a skip a pass when
// `AOS_DISCOVERY_LOCAL_REQUIRED=1` says the lane was the point.
//
// Neither half is a CI measurement of the committed record. `verify:agent-discovery-local` -- the
// script that turns the local half's skip into a failure -- is wired into no job in
// .github/workflows/ci.yml, and on a runner with no runtime installed the local half skips. So what
// CI proves here is agreement between the committed observation and the shipped support table; the
// observation itself is attested by the one operator machine named in the fixture's `recorded_on`,
// and the fixture's `note` says so in the file rather than only here.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { DISCOVERY_SCHEMA, REASON_CODES, TERMINAL_STATUSES, discover } from "../../lib/discovery.mjs";
import { supportMatrixDecisions } from "../../lib/confinement.mjs";
import { containsSecretMaterial } from "../../lib/redact.mjs";

const canaryFile = new URL("../../fixtures/discovery/local-canary.darwin.json", import.meta.url);
const canary = JSON.parse(readFileSync(canaryFile, "utf8"));
const matrix = JSON.parse(readFileSync(new URL("../../fixtures/confinement/support-matrix.json", import.meta.url), "utf8"));

const strings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((one) => strings(one, out));
  else if (value && typeof value === "object") Object.values(value).forEach((one) => strings(one, out));
  return out;
};

test("the committed local canary is a record this module's own schema names", () => {
  assert.equal(canary.schema, "aos-discovery-canary.v1");
  assert.ok(canary.lanes.length >= 2, "the canary records the zero-config lane and the official one");
  for (const lane of canary.lanes) {
    assert.equal(lane.record.schema_id, DISCOVERY_SCHEMA);
    assert.ok(TERMINAL_STATUSES.includes(lane.record.status));
  }
});

test("the committed local canary carries no absolute path and no credential material", () => {
  for (const value of strings(canary.lanes)) {
    assert.ok(!value.startsWith("/"), `an absolute path reached the committed observation: ${value}`);
    assert.ok(!value.includes(homedir()), "the operator's home reached the committed observation");
    // Asked of this product's own redactor rather than of a pattern invented here, so the two
    // cannot disagree about what a credential looks like.
    assert.ok(!containsSecretMaterial(value), `credential material reached the committed observation: ${value}`);
  }
});

test("the committed canary's support matrix still agrees with the shipped release table", () => {
  const gated = supportMatrixDecisions(matrix);
  for (const lane of canary.lanes) {
    for (const row of lane.record.support_matrix) {
      const authority = gated.find((one) =>
        one.platform === row.platform && one.backend === row.backend && one.adapter === row.adapter && one.level === row.level);
      assert.ok(authority, `the canary cites a lane the release table no longer has: ${row.platform}/${row.backend}/${row.adapter}/${row.level}`);
      assert.equal(row.official, authority.decision.official, `${row.platform}/${row.backend}/${row.adapter}/${row.level}`);
      assert.equal(row.support_status, authority.support_status);
    }
  }
});

test("the zero-config lane reached DIAGNOSTIC_ONLY on a host with an unknown model, not a default", () => {
  const lane = canary.lanes.find((one) => one.lane === "zero-config");
  assert.equal(lane.record.status, "DIAGNOSTIC_ONLY");
  assert.equal(lane.record.reason_code, REASON_CODES.MODEL_WITHHELD);
  assert.deepEqual(lane.record.zero_input, {
    terminal_commands: 0, config_edits: 0, manual_registration: 0, setup_questions: 0
  });
  const selected = lane.record.candidates.find((one) => one.id === lane.record.selected_runtime);
  assert.equal(selected.identity.status, "VERIFIED");
  assert.equal(selected.identity.adapter_runtime_match, true);
  assert.equal(selected.isolation.lane_official, true, "the host reached the release's one proven lane");
});

test("the official lane recorded a host entitled to issue, on the machine the fixture names", () => {
  const lane = canary.lanes.find((one) => one.lane === "official-pairing");
  assert.equal(lane.record.status, "OFFICIAL_READY");
  assert.equal(lane.record.reason_code, null);
  const selected = lane.record.candidates.find((one) => one.id === lane.record.selected_runtime);
  assert.equal(selected.support_status, "OFFICIAL");
  assert.equal(selected.model.status, "EXACT");
  assert.equal(selected.isolation.level, "STRICT");
  assert.equal(lane.record.profile.isolation_level, "STRICT");
  assert.match(lane.record.profile.profile_digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(lane.record.zero_input, {
    terminal_commands: 0, config_edits: 0, manual_registration: 0, setup_questions: 0
  });
});

// ------------------------------------------------------------------------------------------- //
// The lane on this machine, now.

/**
 * Whether the real local lane may be skipped.
 *
 * `verify:agent-discovery-local` exists to ask one question -- does discovery reach a runtime on
 * this machine -- and a suite whose only test skips and then exits 0 answers "yes". The variable is
 * set by that script and not by `npm test`, so an ordinary run on a machine with no runtime
 * installed still passes while the verification script refuses.
 */
const required = process.env.AOS_DISCOVERY_LOCAL_REQUIRED === "1";

test("discovery on this machine reads it without injection and reports a terminal status", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-discovery-local-"));
  const record = discover({ home: join(root, "aos-home") });

  assert.equal(record.schema_id, DISCOVERY_SCHEMA);
  assert.ok(TERMINAL_STATUSES.includes(record.status));
  for (const value of strings(record)) {
    assert.ok(!value.startsWith("/"), `an absolute path reached the record: ${value}`);
    assert.ok(!value.includes(homedir()), "the operator's home reached the record");
    // This machine has a real credential in its keychain and a real one in its environment. A
    // record produced here is the strongest place there is to ask whether either can escape.
    assert.ok(!containsSecretMaterial(value), `credential material reached the record: ${value}`);
  }

  if (record.candidates.length === 0) {
    rmSync(root, { recursive: true, force: true });
    if (required) assert.fail("AOS_DISCOVERY_LOCAL_NOT_RUN no runtime is installed here; a skipped lane is NOT_OBSERVED and is not a pass");
    t.skip("no agent runtime is installed on this machine");
    return;
  }
  // A candidate exists, so every stage ran and the record says what each of them found.
  for (const candidate of record.candidates) {
    assert.ok(["VERIFIED", "UNTRUSTED", "ABSENT"].includes(candidate.identity.status));
    assert.ok(["OFFICIAL", "DIAGNOSTIC_ONLY", "BLOCKED"].includes(candidate.support_status));
  }
  rmSync(root, { recursive: true, force: true });
});

test("a second discovery on this machine adds no duplicate profile", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-discovery-local-"));
  const home = join(root, "aos-home");
  const first = discover({ home });
  if (first.selected_runtime === null) {
    rmSync(root, { recursive: true, force: true });
    if (required) assert.fail("AOS_DISCOVERY_LOCAL_NOT_RUN nothing selectable on this machine; a skipped lane is NOT_OBSERVED and is not a pass");
    t.skip("no selectable runtime on this machine");
    return;
  }
  const ledgerAfterFirst = readFileSync(join(home, "discovery-profiles.json"), "utf8");
  const second = discover({ home });
  assert.equal(second.profile.profile_digest, first.profile.profile_digest);
  assert.equal(readFileSync(join(home, "discovery-profiles.json"), "utf8"), ledgerAfterFirst);
  assert.equal(second.profile_reuse.reused, true);
  rmSync(root, { recursive: true, force: true });
});
