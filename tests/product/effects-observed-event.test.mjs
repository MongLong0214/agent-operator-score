import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EFFECT_AXES, actualEffectObservation, effectsObservedPayload } from "../../lib/effect-events.mjs";
import { appendEvent, createRun, readEvents } from "../../lib/store.mjs";
import { addAgent, makePlan, observedCleanEffects, run } from "./helpers.mjs";

// What the run was observed to have done, as it reaches the store.
//
// Nothing tested this event at all, and it was losing a field on every run this tool has ever made:
// `coverage` was emitted as `axis=STATE`, one of the five axes is called `secret`, `lib/core.mjs`
// treats `secret=` as the start of a secret, and `projectPayload` dropped the whole key without
// saying so. The per-axis record of what nobody could see is the artefact #557's
// missing-observation policy exists to produce, and it reached the store on no run at all.

const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));

const observation = () => actualEffectObservation({
  ...observedCleanEffects(),
  scanned_artifacts: [{ id: "FAM-6.response", bytes: JSON.stringify({ diagnosis: "rate limited" }) }],
  canary: "AOS-CANARY-7c11"
});

const graderEvents = (home, runId) => readEvents(home, runId).filter((one) => one.producer_id === "grader");

test("the persisted safety observation names every axis, including the ones nobody observed", () => {
  const home = scratch("aos-557-store-");
  try {
    const { runId } = createRun(home, { mode: "IMPORTED", source: "test" });
    const payload = effectsObservedPayload(observation());
    assert.equal(payload.coverage.length, EFFECT_AXES.length);
    appendEvent(home, runId, "grader", { event_type: "safety.effects_observed", evidence_digest: payload.observation_digest, payload });

    const stored = graderEvents(home, runId).find((one) => one.event_type === "safety.effects_observed");
    assert.ok(stored, "the observation was not recorded at all");
    assert.ok(Array.isArray(stored.payload.coverage), "the coverage ledger did not survive the store");
    assert.deepEqual(
      stored.payload.coverage.map((row) => row.split(" ")[0]).sort(),
      [...EFFECT_AXES].sort(),
      "an axis is missing from the persisted ledger"
    );
    for (const row of stored.payload.coverage) assert.match(row, /^[a-z]+ (?:OBSERVED|NOT_OBSERVED)$/u);
    // And nothing was quietly removed on the way in.
    assert.equal(stored.payload.redacted_keys, undefined, `the store dropped ${String(stored.payload.redacted_keys)}`);
    assert.deepEqual(Object.keys(stored.payload).sort(), Object.keys(payload).sort());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a payload key the redaction filter removes is recorded, not dropped in silence", () => {
  // The half of the defect that is not about a name. A reader of a stored event could not tell a
  // filter that removed a field from a producer that never sent one -- which is the same shape as
  // the rule this repository states everywhere else, that absent evidence must not look like clean
  // evidence. It is a record and not a refusal: `checkpoint.raised` carries free-form agent output,
  // and an agent that prints `api_key=` would otherwise turn a redaction into a crashed run.
  const home = scratch("aos-557-redact-");
  try {
    const { runId } = createRun(home, { mode: "IMPORTED", source: "test" });
    appendEvent(home, runId, "grader", {
      event_type: "safety.event",
      payload: { family: "FAM-6", level: "S0", kind: "token: abcdefghijklmnop" }
    });
    const stored = graderEvents(home, runId).find((one) => one.event_type === "safety.event");
    assert.equal(stored.payload.kind, undefined, "a secret-shaped value was published");
    assert.deepEqual(stored.payload.redacted_keys, ["kind"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a real assess records the axis ledger it observed", () => {
  // End to end, because the defect lived between two files that were each correct on their own:
  // `lib/cli.mjs` passed `coverage` and `lib/store.mjs` allowlisted it.
  const cwd = scratch("aos-557-e2e-");
  try {
    const home = join(cwd, ".aos");
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    // An unattended run is INCOMPLETE by design and exits 3; what is asserted here is what it wrote
    // down about its own effects, which it writes whether or not it is scorable.
    run(cwd, ["assess", "--plan", plan, "--seed", "7"], 3, { FAKE_AGENT_PROFILE: "competent" });

    const runs = readdirSync(join(home, "runs"));
    assert.equal(runs.length, 1);
    const lines = readFileSync(join(home, "runs", runs[0], "events", "grader.ndjson"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const observed = lines.filter((one) => one.event_type === "safety.effects_observed");
    assert.equal(observed.length, 1, "the run recorded no observation of its own effects");
    const payload = observed[0].payload;
    assert.deepEqual(
      payload.coverage.map((row) => row.split(" ")[0]).sort(),
      [...EFFECT_AXES].sort(),
      "the persisted ledger lost an axis"
    );
    assert.equal(payload.redacted_keys, undefined);
    assert.match(payload.observation_digest, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
