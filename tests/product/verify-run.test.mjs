import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  return { cwd, runId, resultPath: join(cwd, ".aos", "runs", runId, "result.json") };
};

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

    // And the cruder forgery -- the claim raised in one place only -- is refused before any
    // comparison, because a result whose surfaces disagree with its own top line is unreadable.
    writeFileSync(resultPath, JSON.stringify({ ...result, claim_stage: "GENERALIZABILITY_SUPPORTED" }, null, 2));
    const inconsistent = run(cwd, ["verify", "--run", runId], 5);
    assert.match(inconsistent.stdout + inconsistent.stderr, /AOS_CLAIM_STAGE|FAIL\trecompute/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
