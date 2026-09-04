import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../../lib/core.mjs";
import { contractFileDigests, evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import { addAgent, makePlan, newestRunId, run } from "./helpers.mjs";

// A result is checkable when the number can be derived again from what the file itself holds. A
// hand-edited score, or one produced by a scorer that has since changed, stops matching.
const assessed = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-verify-run-"));
  run(cwd, ["init"]);
  addAgent(cwd, "solo");
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
