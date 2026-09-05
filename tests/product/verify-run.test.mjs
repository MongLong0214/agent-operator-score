import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../../lib/core.mjs";
import { contractFileDigests, evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import { probeAgentCapabilities, detectedCapabilityRecord } from "../../lib/capability-probe.mjs";
import { capabilityDigestOf, delegationOracle, routeOracleDigest, routeOracleEvidenceId } from "../../lib/routing-oracle.mjs";
import { addAgent, initBare, makePlan, newestRunId, run } from "./helpers.mjs";

// A result is checkable when the number can be derived again from what the file itself holds. A
// hand-edited score, or one produced by a scorer that has since changed, stops matching.
const assessed = ({ adapter = null } = {}) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-verify-run-"));
  // `init` discovers whatever happens to be installed on this host. The A6 fixture is about the
  // default AOS-known posture for a shipped adapter, so construct that registration rather than
  // letting discovery decide which capability-source row this test exercises.
  if (adapter === null) run(cwd, ["init"]);
  else initBare(cwd);
  addAgent(cwd, "solo", undefined, adapter === null ? [] : ["--adapter", adapter]);
  const plan = makePlan(cwd, { default: "solo" });
  run(cwd, ["assess", "--plan", plan, "--seed", "5"], 3);
  const runId = newestRunId(cwd);
  const recordPath = join(cwd, ".aos", "runs", runId, "record.json");
  // #556. The confinement verdict this run was actually issued under. `verify` reads it from the
  // record rather than from the result, so a rebuild in a test has to hand `evaluate` the same
  // input the CLI did -- a result rebuilt under a different boundary is a different result, which
  // is the property the check exists to enforce.
  const boundary = JSON.parse(readFileSync(recordPath, "utf8")).isolation.official_issuance;
  return { cwd, runId, boundary, recordPath, resultPath: join(cwd, ".aos", "runs", runId, "result.json") };
};

const assessedWithProbe = (profile = "probe-cut-off") => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-verify-run-probe-"));
  initBare(cwd);
  addAgent(cwd, "solo");
  const plan = makePlan(cwd, { default: "solo" });
  // The cut-off fixture has three observed answers but an incomplete invocation. Rewriting its
  // stored completion bit would turn it into a detected capability record unless verification
  // derives the consumer-facing state from the probe evidence again.
  run(cwd, ["assess", "--plan", plan, "--seed", "5", "--probe-capabilities"], 3, { FAKE_AGENT_PROFILE: profile });
  const runId = newestRunId(cwd);
  const runDirectory = join(cwd, ".aos", "runs", runId);
  const recordPath = join(runDirectory, "record.json");
  const boundary = JSON.parse(readFileSync(recordPath, "utf8")).isolation.official_issuance;
  return { cwd, runId, boundary, recordPath, resultPath: join(runDirectory, "result.json") };
};

// The verifier reads the M09 evidence id and the delegation reference from the working record, so
// an honest probe fixture updates those two dependent projections too. This is deliberately not a
// forged capability record: the digest and route reference are recomputed from the older probe's
// own verifier identity.
const bindCapabilityToStoredRun = (record, result, capability) => {
  const agentId = capability.agent_id;
  record.routing_oracle.capabilities = record.routing_oracle.capabilities
    .map((entry) => (entry.agent_id === agentId ? capability : entry));
  record.routing_oracle.actual_route_events = record.routing_oracle.actual_route_events
    .map((entry) => (entry.agent_id === agentId
      ? { ...entry, capability_digest: capability.capability_digest }
      : entry));
  record.routing_oracle.route_oracle_digest = routeOracleDigest(record.routing_oracle);
  record.delegation_oracle = delegationOracle(record.routing_oracle);
  const m09 = result.observations.find((entry) => entry.metric_id === "M09");
  m09.evidence_ids = m09.evidence_ids
    .filter((id) => !id.startsWith("route-oracle:"))
    .concat(routeOracleEvidenceId(record.routing_oracle.route_oracle_digest));
};

const writeStoredRun = (recordPath, resultPath, record, result) => {
  writeFileSync(recordPath, `${canonicalJson(record)}\n`);
  writeFileSync(resultPath, `${canonicalJson(result)}\n`);
};

const assertAccepted = (cwd, runId) => {
  const verified = run(cwd, ["verify", "--run", runId]);
  assert.match(verified.stdout, /PASS\tprobe-record/u, verified.stdout);
  assert.doesNotMatch(verified.stdout, /FAIL/u, verified.stdout);
  return verified;
};

const rebuildStoredResult = (result, boundary) => {
  const contract = shippedEcdContract();
  const { contract_digest: _contract, profile_digest: _profile, ...facets } = result.facet_identity;
  return buildResult({
    evaluation: evaluate(result.observations, { facets, profile_digest: result.profile_digest, forms_completed: result.run.forms_completed, boundary }, contract),
    contract,
    observations: result.observations,
    run: result.run,
    caps: result.system_outcome_profile.caps,
    model_identity: result.model_identity,
    uncertainty: result.uncertainty,
    generalizability_status: result.generalizability_status
  });
};

// This record is intentionally a sibling rather than a replacement for the current probe. The
// verifier can name its v2 claims but cannot recompute them; the current `solo` record remains a
// separate claim that this build must still check.
const supersededProbeSibling = (current) => ({
  schema_id: "aos-capability-probe.v2",
  verifier_id: "aos-capability-probe.v2",
  probe_id: `${current.probe_id}-v2`,
  agent_id: "legacy",
  status: current.status,
  reason: current.reason,
  started_at: current.started_at,
  observations: current.observations,
  exhibited: current.exhibited,
  invocation: current.invocation === null ? null : {
    completed: current.invocation.completed,
    exit_code: current.invocation.exit_code,
    signal: current.invocation.signal,
    timed_out: current.invocation.timed_out,
    interrupted: current.invocation.interrupted,
    survivor: current.invocation.survivor,
    leaked_descendants: current.invocation.leaked_descendants,
    stdout_digest: current.invocation.stdout_digest
  }
});

test("a forged routing record is rejected before it can certify M09", () => {
  const { cwd, runId, recordPath } = assessed();
  try {
    const original = readFileSync(recordPath, "utf8");
    const forgeries = [
      ["capability source", (record) => { record.routing_oracle.capabilities[0].source = "detected"; }],
      ["observable basis", (record) => { record.routing_oracle.observables.find((entry) => entry.observable_id === "capability-matches-task").basis = ["measured"]; }],
      ["observable pass", (record) => { record.routing_oracle.observables.find((entry) => entry.observable_id === "capability-matches-task").pass = true; }],
      ["minimum route", (record) => { record.routing_oracle.minimum.status = "SOLVED"; }]
    ];
    for (const [name, forge] of forgeries) {
      const record = JSON.parse(original);
      forge(record);
      writeFileSync(recordPath, `${canonicalJson(record)}\n`);
      const verified = run(cwd, ["verify", "--run", runId], 5);
      assert.match(verified.stdout, /FAIL\trouting-record/, `${name}: ${verified.stdout}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("forged probe and delegation records are rejected before they authorize consumer state", () => {
  const { cwd, runId, recordPath } = assessedWithProbe();
  try {
    const original = readFileSync(recordPath, "utf8");
    const forgeries = [
      ["probe completion", "probe-record", (record) => { record.capability_probes[0].invocation.completed = true; }],
      ["delegation state", "delegation-record", (record) => { record.delegation_oracle.expected_value_class = "MINIMAL"; }]
    ];
    for (const [name, check, forge] of forgeries) {
      const record = JSON.parse(original);
      forge(record);
      writeFileSync(recordPath, `${canonicalJson(record)}\n`);
      const verified = run(cwd, ["verify", "--run", runId], 5);
      assert.equal(verified.stdout.includes(`FAIL\t${check}`), true, `${name}: ${verified.stdout}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A5: a superseded v2 probe stays readable but leaves the run unresolved", () => {
  const { cwd, runId, boundary, recordPath, resultPath } = assessedWithProbe();
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const current = record.capability_probes[0];
    // This is the persisted v2 shape from the round-1 cut-off module: its completed invocation
    // and workspace observations are intact, while later retry/blocker conclusions and fields do
    // not yet exist. The v2 capability record was bound to the v2 verifier identity, not this
    // build's.
    const older = {
      schema_id: "aos-capability-probe.v2",
      verifier_id: "aos-capability-probe.v2",
      probe_id: current.probe_id,
      agent_id: current.agent_id,
      status: current.status,
      reason: current.reason,
      started_at: current.started_at,
      observations: current.observations,
      exhibited: current.exhibited,
      invocation: current.invocation === null ? null : {
        completed: current.invocation.completed,
        exit_code: current.invocation.exit_code,
        signal: current.invocation.signal,
        timed_out: current.invocation.timed_out,
        interrupted: current.invocation.interrupted,
        survivor: current.invocation.survivor,
        leaked_descendants: current.invocation.leaked_descendants,
        stdout_digest: current.invocation.stdout_digest
      }
    };
    record.capability_probes[0] = older;
    const historicalCapability = record.routing_oracle.capabilities[0];
    historicalCapability.evidence_ids = historicalCapability.evidence_ids
      .map((id) => (id.startsWith("verifier:") ? "verifier:aos-capability-probe.v2" : id));
    historicalCapability.capability_digest = capabilityDigestOf(historicalCapability);
    bindCapabilityToStoredRun(record, result, historicalCapability);
    writeStoredRun(recordPath, resultPath, record, rebuildStoredResult(result, boundary));

    const unresolved = run(cwd, ["verify", "--run", runId], 4);
    assert.notEqual(unresolved.status, 0, unresolved.stdout);
    assert.notEqual(unresolved.status, 5, unresolved.stdout);
    assert.doesNotMatch(unresolved.stdout, /FAIL/u, unresolved.stdout);
    assert.match(unresolved.stdout, /NOT-CHECKED\tprobe-record\tcapability probe for solo uses aos-capability-probe\.v2 predates this build's.*UNVERIFIABLE-by-this-build/u, unresolved.stdout);
    for (const check of ["routing-record", "delegation-record", "recompute"]) {
      assert.match(unresolved.stdout, new RegExp(`NOT-CHECKED\\t${check}\\t.*UNVERIFIABLE-by-this-build`, "u"), unresolved.stdout);
    }
    assert.equal(/capability probe outcome .* does not follow|routing capability record .* does not follow/u.test(unresolved.stdout), false, unresolved.stdout);
    const unresolvedJson = run(cwd, ["verify", "--run", runId, "--json"], 4);
    assert.equal(unresolvedJson.status, unresolved.status, unresolvedJson.stdout);
    const unresolvedReport = JSON.parse(unresolvedJson.stdout);
    assert.equal(unresolvedReport.state, "unresolved", unresolvedJson.stdout);
    assert.equal(unresolvedReport.ok, false, unresolvedJson.stdout);
    const notCheckedRows = unresolvedReport.checks
      .filter((row) => ["routing-record", "probe-record", "delegation-record", "recompute"].includes(row.check));
    assert.equal(notCheckedRows.length, 4, unresolvedJson.stdout);
    for (const row of notCheckedRows) assert.equal(row.resolution, "not-checked", unresolvedJson.stdout);

    // A v2 probe's current-looking status and completion fields are claims from an instrument this
    // build cannot re-run. The verifier therefore returns the same answer after they are edited:
    // neither value is a source of completion or scoring authority here.
    const tampered = JSON.parse(readFileSync(recordPath, "utf8"));
    tampered.capability_probes[0].status = "ANSWERED";
    tampered.capability_probes[0].invocation.completed = true;
    writeStoredRun(recordPath, resultPath, tampered, result);
    const afterTamper = run(cwd, ["verify", "--run", runId], 4);
    assert.equal(afterTamper.status, unresolved.status, afterTamper.stdout);
    assert.deepEqual(
      afterTamper.stdout.split("\n").filter((line) => line.startsWith("NOT-CHECKED\t")),
      unresolved.stdout.split("\n").filter((line) => line.startsWith("NOT-CHECKED\t")),
      afterTamper.stdout
    );

    // A contradicted claim is stronger evidence than a superseded probe's absence of evidence.
    // This record still carries the same not-checked claims, but its confinement summary now
    // disagrees with the independently recomputed one, so the aggregate has to report a
    // contradiction rather than merely unresolved.
    const contradictory = JSON.parse(readFileSync(recordPath, "utf8"));
    contradictory.isolation.official_issuance.official = !contradictory.isolation.official_issuance.official;
    writeStoredRun(recordPath, resultPath, contradictory, result);
    const contradictedJson = run(cwd, ["verify", "--run", runId, "--json"], 5);
    const contradictedReport = JSON.parse(contradictedJson.stdout);
    assert.equal(contradictedReport.state, "contradicted", contradictedJson.stdout);
    assert.equal(contradictedReport.ok, false, contradictedJson.stdout);
    assert.equal(contradictedReport.checks.find((row) => row.check === "confinement-record").resolution, "contradicted", contradictedJson.stdout);
    assert.equal(contradictedReport.checks.find((row) => row.check === "probe-record").resolution, "not-checked", contradictedJson.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a superseded sibling leaves an honest current probe unresolved", () => {
  const { cwd, runId, recordPath } = assessedWithProbe();
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.capability_probes.unshift(supersededProbeSibling(record.capability_probes[0]));
    writeFileSync(recordPath, `${canonicalJson(record)}\n`);

    const unresolved = run(cwd, ["verify", "--run", runId, "--json"], 4);
    const report = JSON.parse(unresolved.stdout);
    assert.equal(report.state, "unresolved", unresolved.stdout);
    assert.equal(report.checks.find((row) => row.check === "probe-record").resolution, "not-checked", unresolved.stdout);
    assert.equal(report.checks.find((row) => row.check === "routing-record").resolution, "verified", unresolved.stdout);
    assert.equal(report.checks.find((row) => row.check === "delegation-record").resolution, "verified", unresolved.stdout);
    assert.equal(report.checks.find((row) => row.check === "recompute").resolution, "verified", unresolved.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a superseded sibling cannot hide a forged current probe", () => {
  const { cwd, runId, recordPath } = assessedWithProbe();
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.capability_probes.unshift(supersededProbeSibling(record.capability_probes[0]));
    record.capability_probes.find((probe) => probe.agent_id === "solo").invocation.completed = true;
    writeFileSync(recordPath, `${canonicalJson(record)}\n`);

    const contradicted = run(cwd, ["verify", "--run", runId, "--json"], 5);
    const report = JSON.parse(contradicted.stdout);
    assert.equal(report.state, "contradicted", contradicted.stdout);
    const probe = report.checks.find((row) => row.check === "probe-record");
    assert.equal(probe.resolution, "contradicted", contradicted.stdout);
    assert.match(probe.detail, /capability probe outcome for solo does not follow/u, contradicted.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A4: an honest AOS spawn refusal persists only its safe class and verifies", async () => {
  const { cwd, runId, boundary, recordPath, resultPath } = assessedWithProbe();
  try {
    const { probe, record: capability } = await probeAgentCapabilities(
      { id: "solo" },
      {
        now: () => "2026-09-05T00:00:00.000Z",
        run: async () => { throw new Error("provider stderr body /private/aos-probe/transcript"); }
      }
    );
    // The refusal is AOS's pre-spawn observation. Its persisted form must classify that fact
    // without retaining the throw's text, an absolute path, or a provider transcript.
    assert.equal(probe.invocation.aos_refusal_class, "SPAWN_REFUSED");
    assert.equal(probe.blocker_class, "SPAWN_REFUSED");
    assert.equal(probe.retryable, false);
    assert.doesNotMatch(canonicalJson(probe), /provider stderr body|\/private\/aos-probe|transcript/u);

    const stored = JSON.parse(readFileSync(recordPath, "utf8"));
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    stored.capability_probes[0] = probe;
    bindCapabilityToStoredRun(stored, result, capability);
    writeStoredRun(recordPath, resultPath, stored, rebuildStoredResult(result, boundary));

    assertAccepted(cwd, runId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A1: a current completed probe with scored capabilities is accepted", () => {
  const { cwd, runId, recordPath } = assessedWithProbe("competent");
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.capability_probes[0].status, "ANSWERED");
    assert.equal(record.routing_oracle.capabilities[0].source, "detected");
    assertAccepted(cwd, runId);
    const acceptedJson = run(cwd, ["verify", "--run", runId, "--json"]);
    const acceptedReport = JSON.parse(acceptedJson.stdout);
    assert.equal(acceptedReport.state, "verified", acceptedJson.stdout);
    assert.equal(acceptedReport.ok, true, acceptedJson.stdout);
    assert.equal(acceptedReport.checks.every((row) => row.resolution === "verified"), true, acceptedJson.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A2: a current clean silent probe is accepted with its withheld disposition", () => {
  const { cwd, runId, recordPath } = assessedWithProbe("probe-silent");
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const probe = record.capability_probes[0];
    assert.deepEqual(
      { completed: probe.invocation.completed, observed: probe.observed_challenge_count, retryable: probe.retryable, blocker: probe.blocker_class },
      { completed: true, observed: 0, retryable: false, blocker: "NO_ENGAGEMENT" }
    );
    assertAccepted(cwd, runId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A3: a current cut-off probe is accepted with its retryable withheld disposition", () => {
  const { cwd, runId, recordPath } = assessedWithProbe();
  try {
    const probe = JSON.parse(readFileSync(recordPath, "utf8")).capability_probes[0];
    assert.deepEqual(
      { completed: probe.invocation.completed, observed: probe.observed_challenge_count, retryable: probe.retryable, blocker: probe.blocker_class },
      { completed: false, observed: 3, retryable: true, blocker: "NON_ZERO_EXIT" }
    );
    assertAccepted(cwd, runId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("A6: an unprobed aos-known record is accepted with its withheld capability question", () => {
  const { cwd, runId, recordPath } = assessed({ adapter: "codex-cli.v1" });
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.capability_probes, null);
    assert.equal(record.routing_oracle.capabilities[0].source, "aos-known");
    assertAccepted(cwd, runId);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a result names the contract files it was built from, and verify checks them against this build's", () => {
  // The digest a result cited was over the contract's canonical form, which is stable against key
  // order -- and blind to the file: appending one space to a contract file moved the file's byte
  // digest and left the cited digest exactly where it was. A result that names the contract that
  // scored it has to name it in a way that can notice the contract changing.
  const { cwd, runId, resultPath } = assessed();
  try {
    const stored = JSON.parse(readFileSync(resultPath, "utf8"));
    const bytes = contractFileDigests();
    assert.deepEqual(stored.contract.artifact_bytes, bytes, "the result did not name this build's contract files");
    assert.notEqual(stored.contract.artifact_bytes.combined, stored.contract.digests.combined, "the two digests answer the same question");
    const clean = run(cwd, ["verify", "--run", runId]);
    assert.match(clean.stdout, /PASS\tcontract-bytes/);

    // The bytes the result names are not the bytes this build holds: that is what a contract file
    // edited under a stored result looks like from here, and it is reported rather than passed over.
    const edited = JSON.parse(readFileSync(resultPath, "utf8"));
    edited.contract.artifact_bytes = { ...bytes, combined: `sha256:${"c".repeat(64)}` };
    writeFileSync(resultPath, JSON.stringify(edited, null, 2));
    const caught = run(cwd, ["verify", "--run", runId], 5);
    assert.match(caught.stdout, /FAIL\tcontract-bytes/);
    assert.match(caught.stdout, /not the bytes that produced it/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("a stored result is recomputed from its own record", () => {
  const { cwd, runId } = assessed();
  try {
    const verified = run(cwd, ["verify", "--run", runId]);
    assert.match(verified.stdout, /PASS\trecompute/);
    assert.equal(/FAIL/.test(verified.stdout), false, verified.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a result carrying reliance evidence is recomputed from its own record too", () => {
  // Every run this product makes today withholds the reliance surface, so a check built only on
  // those verifies a result whose reliance is the default -- and a default round trips whether or
  // not it was carried through. #583 issues the ten metrics as an input like the caps are, and a
  // rebuild that dropped that input compared its withheld default against a stored PARTIAL profile
  // and reported that the result did not follow from its own observations.
  const { cwd, runId, boundary, resultPath } = assessed();
  try {
    const stored = JSON.parse(readFileSync(resultPath, "utf8"));
    const contract = shippedEcdContract();
    const { contract_digest: _contract, profile_digest: _profile, ...facets } = stored.facet_identity;
    const withReliance = buildResult({
      evaluation: evaluate(stored.observations, { facets, profile_digest: stored.profile_digest, forms_completed: stored.run.forms_completed, boundary }, contract),
      contract,
      observations: stored.observations,
      run: stored.run,
      caps: stored.system_outcome_profile.caps,
      uncertainty: stored.uncertainty,
      generalizability_status: stored.generalizability_status,
      // The state #583 produces once it has four opportunities to compute a rate over.
      reliance: { status: "PARTIAL", metrics: { cair: { status: "ISSUED", value: 0.75, numerator: 3, denominator: 4 } } }
    });
    assert.equal(withReliance.reliance_calibration_profile.status, "PARTIAL");
    assert.equal(withReliance.reliance_calibration_profile.metrics.cair.value, 0.75);
    writeFileSync(resultPath, `${canonicalJson(withReliance)}\n`);

    const verified = run(cwd, ["verify", "--run", runId]);
    assert.match(verified.stdout, /PASS\trecompute/);
    assert.equal(/FAIL/.test(verified.stdout), false, verified.stdout);

    // What the check does and does not say about this surface, stated rather than assumed. The ten
    // metrics are an input #583 supplies, not something derived from the observations, so a
    // different value is a different input and rebuilding honours it -- exactly as a different cap
    // would be. What the rebuild does enforce are the seam's own rules: a rate issued over fewer
    // opportunities than the floor is refused, so an edit that breaks them is caught here.
    const belowFloor = JSON.parse(readFileSync(resultPath, "utf8"));
    belowFloor.reliance_calibration_profile.metrics.cair.denominator = 2;
    writeFileSync(resultPath, JSON.stringify(belowFloor, null, 2));
    const caught = run(cwd, ["verify", "--run", runId], 5);
    assert.match(caught.stdout, /FAIL\trecompute/);
    assert.match(caught.stdout, /AOS_RELIANCE_FLOOR/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a number that does not follow from the observations is caught", () => {
  // The point of recomputing: an edited index no longer matches the observations beside it.
  const { cwd, runId, resultPath } = assessed();
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.system_outcome_profile.index = 99;
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    const verified = run(cwd, ["verify", "--run", runId], 5);
    assert.match(verified.stdout, /FAIL\trecompute/);
    assert.match(verified.stdout, /do(?:es)? not follow from the stored observations/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a result that did not record what it was evaluated under says so", () => {
  // Deriving the inputs from the conclusions would let any file verify itself.
  const { cwd, runId, resultPath } = assessed();
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    delete result.run.forms_completed;
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    const verified = run(cwd, ["verify", "--run", runId], 5);
    assert.match(verified.stdout, /FAIL\trecompute/);
    assert.match(verified.stdout, /cannot be recomputed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a result from another contract or schema is not comparable, which is not the same as wrong", () => {
  const { cwd, runId, resultPath } = assessed();
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.contract.digests.combined = `sha256:${"0".repeat(64)}`;
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    const verified = run(cwd, ["verify", "--run", runId], 5);
    assert.match(verified.stdout, /FAIL\tcontract-digest/);
    assert.match(verified.stdout, /not comparable/);
    assert.equal(verified.stdout.includes("does not follow"), false, "a different contract is not a wrong number");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verify without --run is still the self-check", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-verify-self-"));
  try {
    run(cwd, ["init"]);
    const verified = run(cwd, ["verify"]);
    assert.match(verified.stdout, /PASS\tsix-family-suite/);
    assert.equal(/recompute/.test(verified.stdout), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a run id that is not one is refused, and a missing result is said so", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-verify-missing-"));
  try {
    run(cwd, ["init"]);
    assert.match(run(cwd, ["verify", "--run", "../../etc/passwd"], 2).stderr, /AOS_INVALID_RUN_ID/);
    assert.match(run(cwd, ["verify", "--run", "run-does-not-exist"], 2).stderr, /no result for/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a stored result of an instrument this build does not recognise is refused, not verified", () => {
  const { cwd, runId, resultPath } = assessed();
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    writeFileSync(resultPath, JSON.stringify({ ...result, schema_id: "attacker-result.v99" }, null, 2));
    const verified = run(cwd, ["verify", "--run", runId], 5);
    assert.match(verified.stderr, /AOS_UNKNOWN_RESULT_SCHEMA/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a claim the stored result is not entitled to make is caught by the verifier, not only by the reader", () => {
  // The claim is what a reader concludes, so it is compared like the numbers: editing it alone
  // used to leave verify's comparison saying the result still followed from its own record.
  const { cwd, runId, resultPath } = assessed();
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    // Forged so the reader cannot object: the claim, every surface's copy of it, the ceiling the
    // result states, and the generalizability the top stage rests on, all moved together. Nothing
    // inside the file contradicts anything else, so the only thing left that can catch it is the
    // comparison against what the observations actually produce.
    const elevated = {
      ...result,
      claim_stage: "GENERALIZABILITY_SUPPORTED",
      generalizability_status: "ESTABLISHED",
      contract: { ...result.contract, maximum_claim_stage: "GENERALIZABILITY_SUPPORTED" }
    };
    for (const key of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]) {
      elevated[key] = { ...elevated[key], claim_stage: "GENERALIZABILITY_SUPPORTED", generalizability_status: "ESTABLISHED" };
    }
    writeFileSync(resultPath, JSON.stringify(elevated, null, 2));
    const verified = run(cwd, ["verify", "--run", runId], 5);
    assert.match(verified.stdout, /FAIL\trecompute/);

    // The quietest forgery of the three: leave the claim where it is and raise only the ceiling the
    // result states it was issued under. Nothing in the file contradicts anything -- the claim is
    // within its stated ceiling -- and the reader has no way to know the ceiling is not the
    // contract's. Only rebuilding from the observations and comparing the claim can say so.
    writeFileSync(resultPath, JSON.stringify({
      ...result,
      contract: { ...result.contract, maximum_claim_stage: "GENERALIZABILITY_SUPPORTED" }
    }, null, 2));
    const raisedCeiling = run(cwd, ["verify", "--run", runId], 5);
    assert.match(raisedCeiling.stdout, /FAIL\trecompute/);
    assert.match(raisedCeiling.stdout, /do(?:es)? not follow from the stored observations/);

    // The same shape one level down: a row, its weight and the declaration that named it, edited
    // together. A reader holding this contract catches it; a reader that does not cannot, and this
    // is the check that covers that case for every contract, because it rebuilds from the run.
    const trimmed = JSON.parse(JSON.stringify(result));
    trimmed.contract.declared.process_constructs = result.contract.declared.process_constructs.slice(1);
    delete trimmed.operator_process_profile.constructs[result.contract.declared.process_constructs[0]];
    delete trimmed.operator_process_profile.weights[result.contract.declared.process_constructs[0]];
    writeFileSync(resultPath, JSON.stringify(trimmed, null, 2));
    const trimmedRun = run(cwd, ["verify", "--run", runId], 5);
    assert.match(trimmedRun.stdout + trimmedRun.stderr, /FAIL\trecompute|AOS_RESULT_INCOMPLETE/);

    // And the cruder forgery -- the claim raised in one place only -- is refused before any
    // comparison, because a result whose surfaces disagree with its own top line is unreadable.
    writeFileSync(resultPath, JSON.stringify({ ...result, claim_stage: "GENERALIZABILITY_SUPPORTED" }, null, 2));
    const inconsistent = run(cwd, ["verify", "--run", runId], 5);
    assert.match(inconsistent.stdout + inconsistent.stderr, /AOS_CLAIM_STAGE|FAIL\trecompute/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
