import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRelianceAdministration, relayPaths } from "../../lib/relay-administration.mjs";
import { relianceOpportunities } from "../../lib/relay-producer.mjs";
import { relianceProfileForRun } from "../../lib/cli.mjs";
import { createRelianceTrace, deriveRelianceProfile } from "../../lib/reliance.mjs";
import { createRun, instrumentRunKey, operatorRunKey, relianceJournal } from "../../lib/store.mjs";
import { scenarioParams } from "../../lib/suite-seed.mjs";

const OPERATOR_SECRET = "operator-key";
const INSTRUMENT_SECRET = "instrument-key";
const ROUTE_ORACLE = { schema_id: "aos-reliance-route-oracle.v1", source: "operator-plan", routes: {} };

const memoryJournal = () => {
  const entries = [];
  let head = null;
  return {
    record: (entry, nextHead) => { if (entry !== null) entries.push(structuredClone(entry)); head = structuredClone(nextHead); },
    read: () => structuredClone(entries),
    readHead: () => structuredClone(head)
  };
};

const produceFor = (seed, expiresAt) => {
  const params = scenarioParams(seed);
  return relianceOpportunities({ seed: params.seed, params, expires_at: expiresAt, route_oracle: ROUTE_ORACLE });
};

const writeAnswer = (path, challenge, selected, extra = {}) => {
  writeFileSync(path, JSON.stringify({
    schema_id: "aos-agent-relay-response.v2",
    challenge_id: challenge.challenge_id,
    selected_option_ids: selected,
    operator_text: "I read the current record first.",
    reported_confidence: 0.6,
    named_evidence_ids: ["evidence-1"],
    ...extra,
    relay: {
      source: "agent-relay",
      agent_runtime_digest: `sha256:${"b".repeat(64)}`,
      conversation_turn_id: "turn-1",
      attestation: "relay-declared-user-response",
      autonomous: false,
      submitted_at: "2026-09-11T00:00:00Z"
    }
  }), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
};

/**
 * Answer whatever challenge the administration publishes, as a coding agent relaying for a person.
 *
 * The responder watches the published challenge file rather than being handed the challenge, which
 * is the only channel a separate process actually has: run capabilities are memory-only, so nothing
 * outside the assessing process can commit a response.
 */
const answeringHost = (paths, decide) => {
  const seen = new Set();
  const timer = setInterval(() => {
    let challenge;
    try {
      challenge = JSON.parse(readFileSync(paths.challenge_file, "utf8"));
    } catch {
      return;
    }
    if (seen.has(challenge.challenge_id)) return;
    seen.add(challenge.challenge_id);
    const answer = decide(challenge);
    if (answer === null) return;
    writeAnswer(join(paths.inbox, `${challenge.challenge_id}.json`), challenge, answer.selected, answer.extra ?? {});
  }, 15);
  return () => clearInterval(timer);
};

const administrationIn = (root, produced, { announce = () => {} } = {}) => {
  const journal = memoryJournal();
  const trace = createRelianceTrace({ run_id: "admin-run", operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal });
  const administration = createRelianceAdministration({
    run_id: "admin-run",
    run_root: root,
    produced,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    trace,
    announce,
    poll_ms: 10
  });
  return { administration, journal, trace };
};

const farFuture = () => new Date(Date.now() + 60_000).toISOString();

test("a published challenge is readable only by the run's owner and hides the advice until the initial answer commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-admin-"));
  try {
    const produced = produceFor("1", farFuture()).filter((one) => one.task_form_id === "FAM-2").slice(0, 1);
    const paths = relayPaths(root);
    const phases = [];
    const { administration } = administrationIn(root, produced);
    const stop = answeringHost(paths, (challenge) => {
      phases.push({ phase: challenge.phase, advice: challenge.advice });
      // The file on disk, not the object the protocol returned: this is what a coding agent reads.
      assert.equal((statSync(paths.challenge_file).mode & 0o077), 0, "the published challenge is readable beyond its owner");
      const correct = produced[0].grading.correct_option_ids[0];
      return challenge.phase === "INITIAL_JUDGMENT"
        ? { selected: [correct] }
        : { selected: [correct], extra: { inspected: true, final_action: "adopt" } };
    });
    await administration.administer("FAM-2");
    stop();
    assert.deepEqual(administration.summary().administered, [produced[0].reliance_opportunity_id]);
    assert.deepEqual(administration.summary().abandoned, []);
    assert.deepEqual(phases.map((entry) => entry.phase), ["INITIAL_JUDGMENT", "POST_ADVICE_DECISION"]);
    assert.equal(phases[0].advice, undefined, "the advice was published before the initial judgment committed");
    assert.notEqual(phases[1].advice, undefined, "the post-advice challenge withheld the advice it exists to reveal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unanswered question is abandoned rather than completed, and says which it was", async () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-admin-"));
  try {
    // Already expired: absence of an answer must never become an answer, and the wait must end.
    const produced = produceFor("1", new Date(Date.now() - 1_000).toISOString()).filter((one) => one.task_form_id === "FAM-6");
    const { administration, journal } = administrationIn(root, produced);
    await administration.administer("FAM-6");
    const summary = administration.summary();
    assert.deepEqual(summary.administered, [], "an unanswered question was recorded as administered");
    assert.equal(summary.abandoned.length, produced.length);
    assert.equal(journal.read().length, 0, "an unanswered question wrote reliance evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a response the relay refuses leaves no operator evidence and does not stop the run", async () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-admin-"));
  try {
    const produced = produceFor("1", farFuture()).filter((one) => one.task_form_id === "FAM-5").slice(0, 1);
    const paths = relayPaths(root);
    const { administration, journal } = administrationIn(root, produced);
    const stop = answeringHost(paths, (challenge) => ({
      selected: [produced[0].grading.correct_option_ids[0]],
      // An agent answering on its own behalf. The protocol refuses it; the administration must
      // carry the refusal rather than crash the assessment around it.
      extra: { __autonomous: true, ...(challenge.phase === "INITIAL_JUDGMENT" ? {} : { inspected: true, final_action: "adopt" }) }
    }));
    // Rewrite the published answer with autonomous:true, which `requireResponse` refuses.
    const hostile = setInterval(() => {
      let challenge;
      try { challenge = JSON.parse(readFileSync(paths.challenge_file, "utf8")); } catch { return; }
      const path = join(paths.inbox, `${challenge.challenge_id}.json`);
      let body;
      try { body = JSON.parse(readFileSync(path, "utf8")); } catch { return; }
      if (body.relay.autonomous === true) return;
      body.relay.autonomous = true;
      delete body.__autonomous;
      writeFileSync(path, JSON.stringify(body), { encoding: "utf8", mode: 0o600 });
      chmodSync(path, 0o600);
    }, 5);
    await administration.administer("FAM-5");
    clearInterval(hostile);
    stop();
    const summary = administration.summary();
    assert.deepEqual(summary.administered, [], "an autonomous response was accepted as an operator turn");
    assert.equal(summary.abandoned.length, 1);
    assert.equal(journal.read().length, 0, "an autonomous response wrote reliance evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fully answered administration derives a profile whose form families are bound", async () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-admin-"));
  try {
    const produced = produceFor("1", farFuture());
    const paths = relayPaths(root);
    const { administration, journal } = administrationIn(root, produced);
    const byChallenge = new Map();
    let answered = 0;
    const stop = answeringHost(paths, (challenge) => {
      const one = produced.find((entry) => entry.operator_opportunity_id === challenge.opportunity_id);
      if (one === undefined) return null;
      if (challenge.phase === "INITIAL_JUDGMENT") {
        answered += 1;
        // A mixed operator: a run answered perfectly observes no incorrect judgment, so calibration
        // would have nothing to discriminate between and the shortfall would be the simulated
        // answers rather than the administration.
        const wrong = one.action.initial_options.map((option) => option.option_id).find((id) => !one.grading.correct_option_ids.includes(id));
        const selected = answered % 3 === 0 ? [wrong] : [one.grading.correct_option_ids[0]];
        byChallenge.set(challenge.opportunity_id, selected);
        return { selected };
      }
      const initial = byChallenge.get(challenge.opportunity_id) ?? [one.grading.correct_option_ids[0]];
      return {
        selected: answered % 2 === 0 ? [one.grading.advice_option_id] : initial,
        extra: { inspected: answered % 4 !== 0, final_action: answered % 2 === 0 ? "adopt" : "reject" }
      };
    });
    for (const family of ["FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"]) await administration.administer(family);
    stop();
    assert.deepEqual(administration.summary().abandoned, [], "an episode was abandoned in a fully answered administration");
    assert.equal(administration.summary().administered.length, produced.length);

    const profile = deriveRelianceProfile({
      run_id: "admin-run", operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal,
      taskFormFamilyOf: (formId) => formId
    });
    assert.deepEqual([...profile.operational_coverage.reasons], [], "an answered administration did not meet the operational floor");
    for (const [id, metric] of Object.entries(profile.profile.metrics)) {
      assert.notEqual(metric.reason, "TASK_FORM_FAMILY_UNBOUND", `${id} was withheld for an unbound task form`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the administration reads no terminal input and offers no prompt to type into", () => {
  const source = readFileSync(new URL("../../lib/relay-administration.mjs", import.meta.url), "utf8");
  // An answer typed into the process that is grading it has no separate observer, which is why the
  // channel is a file and why this must not quietly gain a fallback that asks on the terminal.
  assert.doesNotMatch(source, /\bprocess\.std(?:in|out)\b|node:readline|from\s+["']readline(?:\/promises)?["']/u,
    "the administration acquired a terminal channel");
});

test("the inbox a coding agent writes is not the store the protocol verifies from", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-admin-"));
  try {
    const paths = relayPaths(root);
    assert.notEqual(paths.inbox, paths.response_dir, "a hostile inbox write would land in the protocol's own evidence store");
    mkdirSync(paths.inbox, { recursive: true, mode: 0o700 });
    assert.equal((statSync(paths.inbox).mode & 0o077), 0, "the inbox is readable beyond its owner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assess binds the form families before deriving the profile, and produces nothing without --relay", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-relay-derive-"));
  try {
    const { runId, paths } = createRun(home, { run_id: "derive-run", mode: "TEST" });
    // The real store, the real keys, the real journal: the defect lives in how the production
    // derivation is called, so a fixture resolver here would reproduce the bug it hides. An earlier
    // version of this test matched `taskFormFamilyOf:` in lib/cli.mjs's source and was satisfied by
    // `taskFormFamilyOf: undefined` -- the mutation survived, which is what a check that reads a
    // name rather than a behaviour always does.
    const trace = createRelianceTrace({
      run_id: runId,
      operator_secret: operatorRunKey(home, runId),
      instrument_secret: instrumentRunKey(home, runId),
      journal: relianceJournal(home, runId)
    });
    const produced = produceFor("1", farFuture()).filter((one) => one.task_form_id === "FAM-2").slice(0, 1);
    const administration = createRelianceAdministration({
      run_id: runId,
      run_root: paths.root,
      produced,
      operator_secret: operatorRunKey(home, runId),
      instrument_secret: instrumentRunKey(home, runId),
      trace,
      poll_ms: 10
    });
    const stop = answeringHost(administration.paths, (challenge) => {
      const correct = produced[0].grading.correct_option_ids[0];
      return challenge.phase === "INITIAL_JUDGMENT"
        ? { selected: [correct] }
        : { selected: [correct], extra: { inspected: true, final_action: "adopt" } };
    });
    await administration.administer("FAM-2");
    stop();
    assert.deepEqual(administration.summary().abandoned, [], "the episode did not complete, so the derivation has nothing to bind");

    const profile = relianceProfileForRun(home, runId);
    assert.equal(profile.opportunities.length, 1, "the production derivation did not read the episode this run recorded");
    // Other floors are unmet with one episode and that is correct. This is the one reason that is
    // not about how much was answered: it says the form this run administered could not be named.
    assert.ok(!profile.operational_coverage.reasons.includes("TASK_FORM_FAMILY_UNBOUND"),
      `the production derivation left its task form unbound: ${profile.operational_coverage.reasons.join(", ")}`);
    assert.deepEqual(profile.operational_coverage.families_represented.unbound_task_form_ids, [],
      "the production derivation could not name the family of a form it administered");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the reliance administration runs only when the operator asked to be asked", () => {
  const source = readFileSync(new URL("../../lib/cli.mjs", import.meta.url), "utf8");
  // Inferring relay mode from --checkpoints plus a non-terminal stdin would make a piped CI run
  // start waiting for a person. This one is a source check because the alternative is executing a
  // whole assessment to observe that nothing happened.
  assert.match(source, /getOption\(options, "relay", false\) !== true \? null : createRelianceAdministration\(/u,
    "the reliance administration is not gated on an explicit --relay");
});
