import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./helpers.mjs";

// What the operator gets wrong, and what a damaged home looks like. Both are their problem to fix,
// and both used to arrive as "AOS_INTERNAL_ERROR" at exit 70 -- which tells them this product
// broke when what happened is that they forgot an argument.
const damaged = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-refusals-"));
  run(cwd, ["init"]);
  const home = join(cwd, ".aos");
  mkdirSync(join(home, "runs", "run-corrupt"), { recursive: true });
  writeFileSync(join(home, "runs", "run-corrupt", "manifest.json"), "{broken");
  writeFileSync(join(home, "runs", "run-corrupt", "result.json"), "{also broken");
  writeFileSync(join(home, "cycle.json"), "{not json either");
  return cwd;
};

test("an async command's refusal is a refusal, not an internal error", () => {
  // Returning a promise from inside a try block does not put its rejection in that block's catch,
  // so every async command's refusal escaped the CLI's own classification.
  const cwd = damaged();
  try {
    const noPlan = run(cwd, ["assess"], 2);
    assert.match(noPlan.stderr, /AOS_OPERATOR_PLAN_REQUIRED/);
    assert.equal(noPlan.stderr.includes("AOS_INTERNAL_ERROR"), false);

    const missingPlan = run(cwd, ["assess", "--plan", join(cwd, "nope.json")], 2);
    assert.match(missingPlan.stderr, /AOS_UNREADABLE/);
    assert.equal(missingPlan.stderr.includes("AOS_INTERNAL_ERROR"), false);

    const badLedger = run(cwd, ["cycle"], 2);
    assert.match(badLedger.stderr, /AOS_MALFORMED_JSON/);
    assert.equal(badLedger.stderr.includes("AOS_INTERNAL_ERROR"), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a damaged file is named", () => {
  // "Expected property name or '}' at position 1" is true and useless: the operator has a home
  // full of run records and the one thing they need is which of them is damaged.
  const cwd = damaged();
  try {
    for (const args of [["report", "--run", "run-corrupt"], ["verify", "--run", "run-corrupt"], ["session", "status", "run-corrupt"]]) {
      const refused = run(cwd, args, 2);
      assert.match(refused.stderr, /AOS_MALFORMED_JSON/, args.join(" "));
      assert.match(refused.stderr, /run-corrupt/, args.join(" "));
    }
    assert.match(run(cwd, ["cycle"], 2).stderr, /cycle\.json/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("asking about an agent that is not configured is not a pass", () => {
  // It used to filter the unknown id away and then report that every agent in the empty list was
  // fine. A question about something that does not exist has no good answer, and PASS is the worst.
  const cwd = damaged();
  try {
    const refused = run(cwd, ["agent", "doctor", "nope"], 2);
    assert.match(refused.stderr, /AOS_AGENT_NOT_FOUND nope/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a directory is not a session file", () => {
  const cwd = damaged();
  try {
    const refused = run(cwd, ["review", "--session", cwd], 2);
    assert.match(refused.stdout, /is not a session file/);
    assert.equal(/EISDIR/.test(refused.stderr), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a port that is not a port is refused rather than replaced", () => {
  // NaN reads as 0 to listen(), so `--port lemon` quietly bound somewhere else. Asking for a port
  // and being given another one without being told is worse than being refused.
  const cwd = damaged();
  try {
    for (const port of ["not-a-number", "-1", "70000", "8080.5"]) {
      assert.match(run(cwd, ["dashboard", "--port", port], 2).stderr, /AOS_INVALID_PORT/, port);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a run that lists cleanly is still listed when a neighbour is damaged", () => {
  // The damaged record must not take down the command an operator reaches for because of it.
  const cwd = damaged();
  try {
    const listed = run(cwd, ["session", "list"]);
    assert.match(listed.stdout, /run-corrupt/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
