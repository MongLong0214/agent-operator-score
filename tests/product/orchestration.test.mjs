import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MARKER_FILE,
  branchMarkerFor,
  handoffIntegrity,
  handoffOutcome,
  joinCoverage,
  plantBranchMarker
} from "../../lib/orchestration.mjs";
import { SEED_INPUTS, promptFor } from "../../lib/suite.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-orch-"));

test("a branch marker is unique per branch and stable per run", () => {
  // Derived rather than random, so a replayed run plants the same markers and its evidence can be
  // checked twice.
  const a = branchMarkerFor("run-1", "FAM-3", "a");
  const b = branchMarkerFor("run-1", "FAM-3", "b");
  assert.notEqual(a, b);
  assert.equal(a, branchMarkerFor("run-1", "FAM-3", "a"));
  assert.notEqual(a, branchMarkerFor("run-2", "FAM-3", "a"));
  assert.match(a, /^AOS-BRANCH-[0-9A-F]{16}$/);
});

test("coverage is read from the join's own output, not from the workspace", () => {
  // The first version walked the workspace, which still holds AOS's copy of every branch output
  // under candidates/ -- so the marker was always found and the check confirmed only that AOS could
  // read a file AOS had written. The chain has to run through two agents.
  const markers = { a: "AOS-BRANCH-AAAA", b: "AOS-BRANCH-BBBB" };
  assert.deepEqual(joinCoverage("", markers), { covered: [], missing: ["a", "b"], complete: false });
  assert.deepEqual(joinCoverage("carried AOS-BRANCH-AAAA", markers), {
    covered: ["a"],
    missing: ["b"],
    complete: false
  });
  const both = joinCoverage("AOS-BRANCH-AAAA and AOS-BRANCH-BBBB", markers);
  assert.equal(both.complete, true);
});

test("no branches is not complete coverage", () => {
  // An empty marker set would otherwise report a clean join for a run that never branched.
  assert.equal(joinCoverage("anything", {}).complete, false);
});

test("an announced handoff is not a consumed one", () => {
  // `handoff.consumed` used to be written immediately after `handoff.created`, before the receiving
  // agent had been invoked: every handoff was consumed by construction.
  assert.equal(handoffOutcome({ artifactDigests: ["d"], observable: true, evidenced: true }), "consumed");
  assert.equal(handoffOutcome({ artifactDigests: ["d"], observable: true, evidenced: false }), "unconsumed");
});

test("consumption in a shared workspace is unobservable, and says so", () => {
  // The handed artifact is simply present, and nothing distinguishes a receiver that read it from
  // one that ignored it. Reporting that as consumed is the defect this replaces.
  assert.equal(handoffOutcome({ artifactDigests: ["d"], observable: false, evidenced: false }), "unobservable");
  assert.equal(handoffOutcome({ artifactDigests: [], observable: true, evidenced: true }), "nothing-handed");
});

test("integrity counts an unobserved handoff as neither pass nor fail", () => {
  // A run in which the question was not asked is not a failed run.
  const unobserved = handoffIntegrity(["unobservable", "unobservable"]);
  assert.equal(unobserved.observed, false);
  assert.equal(unobserved.complete, true);

  const mixed = handoffIntegrity(["consumed", "unconsumed"]);
  assert.equal(mixed.observed, true);
  assert.equal(mixed.complete, false);

  const broken = handoffIntegrity(["nothing-handed"]);
  assert.equal(broken.complete, false, "a sender that produced nothing is a broken route");
});

test("the branch is told to carry its evidence, and the join to carry every branch's", () => {
  // The instruction has to reach both halves or the chain has a step nobody was asked to take.
  const root = scratch();
  try {
    plantBranchMarker(root, "AOS-BRANCH-TEST");
    const branchPrompt = promptFor("FAM-3", root, "parallel-1", [], "do the work");
    assert.match(branchPrompt, new RegExp(MARKER_FILE));
    assert.match(branchPrompt, /include that exact line/i);

    const joinPrompt = promptFor("FAM-3", root, "stage-2", ["a", "b"], "join the work");
    assert.match(joinPrompt, /every one of them/i);
    assert.match(joinPrompt, /cannot be told from the ones you did/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a workspace with no branch says nothing about markers", () => {
  const root = scratch();
  try {
    const prompt = promptFor("FAM-1", root, "stage-1", [], "do the work");
    assert.equal(prompt.includes(MARKER_FILE), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the planted marker carries its own instruction", () => {
  // An agent that opens the file has to be able to tell what it is for without the prompt.
  const root = scratch();
  try {
    plantBranchMarker(root, "AOS-BRANCH-XYZ");
    const text = readFileSync(join(root, MARKER_FILE), "utf8");
    assert.match(text, /^AOS-BRANCH-XYZ$/m);
    assert.match(text, /include this line/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the marker AOS planted is not the agent's output", () => {
  // Otherwise AOS's own writing is digested as the agent's work and copied on as an artifact, which
  // is the same self-evidence problem the coverage check had: the product finding a file it wrote
  // and counting it as somebody else's.
  assert.equal(SEED_INPUTS.includes(MARKER_FILE), true, "the branch marker was treated as output");
  for (const planted of ["task.md", "docs", "checkpoint.json", "incident.json", "candidates"]) {
    assert.equal(SEED_INPUTS.includes(planted), true, planted);
  }
  assert.equal(SEED_INPUTS.includes("plan.json"), false, "an agent artifact was excluded from output");
});
