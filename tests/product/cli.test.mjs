import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateOperatorPlan } from "../../lib/operator-plan.mjs";
import test from "node:test";
import { addAgent, cli, initBare, makePlan, newestRecord, newestResult, newestRunId, run } from "./helpers.mjs";

const temporary = (name) => mkdtempSync(join(tmpdir(), name));

test("self verification and package version", () => {
  const cwd = temporary("aos-verify-");
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.equal(run(cwd, ["--version"]).stdout.trim(), manifest.version);
    const verified = JSON.parse(run(cwd, ["verify", "--json"]).stdout);
    assert.equal(verified.ok, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("official assessment requires a non-vacuous operator plan", () => {
  const cwd = temporary("aos-plan-required-");
  try {
    initBare(cwd);
    addAgent(cwd, "solo");

    // Naming no plan is no longer a refusal: the shipped plan is written and used, because
    // requiring a hand-authored file before anything ran was a lot of typing for a document the
    // README says is not a scoring input. What must still hold is that the plan a run used is
    // never vacuous, and that the record can tell a shipped plan from an authored one.
    run(cwd, ["assess", "--template", "plan.json"]);
    const shipped = JSON.parse(readFileSync(join(cwd, "plan.json"), "utf8"));
    assert.deepEqual(validateOperatorPlan(shipped, ["solo"]), [], "the shipped plan cannot be run");

    // Emptied by hand, and still refused. This is the property the check is named for.
    writeFileSync(join(cwd, "blank.json"), JSON.stringify({
      ...shipped,
      goal: "", constraints: [], non_goals: [],
      clarification_policy: { facts: "", human_decisions: "" },
      acceptance: [{ criterion: "", evidence: "" }]
    }));
    const blank = spawnSync(process.execPath, [cli, "assess", "--plan", "blank.json"], { cwd, encoding: "utf8" });
    assert.notEqual(blank.status, 0);
    assert.match(blank.stderr, /AOS_INVALID_OPERATOR_PLAN/);

    // A plan that is not there at all is still an error when the operator named one.
    const absent = spawnSync(process.execPath, [cli, "assess", "--plan", "nope.json"], { cwd, encoding: "utf8" });
    assert.notEqual(absent.status, 0);

    const overwrite = spawnSync(process.execPath, [cli, "assess", "--template", "plan.json"], { cwd, encoding: "utf8" });
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.stderr, /AOS_TEMPLATE_EXISTS/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("one agent can complete a controlled assessment", () => {
  const cwd = temporary("aos-single-");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    // Exit 3, not 0: an unattended run is INCOMPLETE by design. Monitoring is scored from a real
    // operator turn that changed something, and there was nobody here to make one -- so this run is
    // a diagnostic result rather than an operator score. That is the product statement, not a
    // regression.
    run(cwd, ["assess", "--plan", plan, "--json"], 3);
    const result = newestResult(cwd);
    const record = newestRecord(cwd);
    assert.equal(result.schema_id, "aos-result.v2");
    assert.equal(Object.hasOwn(result, "score"), false);
    // The three profiles, and what each of them rests on. The composite is withheld because the
    // process index is: the contract's operator-process cells are not populated in this build, and
    // an unattended run answers none of the monitoring metrics either.
    assert.equal(result.operator_process_profile.index, null);
    assert.equal(result.aos_composite.value, null);
    assert.deepEqual(result.aos_composite.withheld_for.includes("operator_process"), true);
    assert.equal(result.claim_stage, "RUN_DIAGNOSTIC");
    assert.equal(result.observations.length, 20);
    // Everything it could observe, it observed well: no more than the monitoring metrics missing.
    assert.equal(result.observations.filter((entry) => entry.value === 1).length >= 14, true);
    assert.deepEqual(record.agent_portfolio.used, ["solo"]);
    assert.ok(result.run.operator_plan_digest);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("six vendor-neutral aliases share one operator score without agent-count bonus", () => {
  const cwd = temporary("aos-six-");
  try {
    run(cwd, ["init"]);
    const ids = ["codex", "claude", "gemini", "grok", "hermes", "buzz"];
    for (const id of ids) addAgent(cwd, id);
    const routes = Object.fromEntries(ids.map((id, index) => [`FAM-${index + 1}`, id]));
    const plan = makePlan(cwd, routes);
    run(cwd, ["assess", "--plan", plan, "--json"], 3);
    const result = newestResult(cwd);
    // Six agents, one score. The count is not an input, and the only way to keep that true is for
    // nothing in the result to carry it.
    const record = newestRecord(cwd);
    assert.deepEqual(record.agent_portfolio.used, [...ids].sort());
    assert.equal(record.agent_portfolio.invocations, 6);
    assert.deepEqual(result.run.agents_used, [...ids].sort());
    assert.equal(JSON.stringify(result.observations).includes("agent_count"), false);
    assert.equal(result.observations.filter((entry) => entry.value === 1).length >= 14, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("parallel workers use isolated workspaces and evidence-bound handoffs", () => {
  const cwd = temporary("aos-parallel-");
  try {
    run(cwd, ["init"]);
    for (const id of ["a", "b", "joiner"]) addAgent(cwd, id);
    const routes = { "FAM-1": "a", "FAM-2": "a", "FAM-3": "a|b>joiner", "FAM-4": "b", "FAM-5": "joiner", "FAM-6": "a" };
    const plan = makePlan(cwd, routes);
    run(cwd, ["assess", "--plan", plan, "--json"], 3);
    const record = newestRecord(cwd);
    assert.equal(record.family_results["FAM-3"].invocations.length, 3);
    assert.equal(record.family_results["FAM-3"].handoff_complete, true);
    // Observed, not merely unobjectionable. Without this, planting no marker at all would leave
    // every handoff "unobservable" and the run would still report a complete handoff.
    const integrity = record.family_results["FAM-3"].handoff_integrity;
    assert.equal(integrity.observed, true, "consumption was never observed");
    assert.equal(integrity.consumed, 2, "both branches should have been shown as read");
    assert.equal(integrity.unconsumed, 0);
    assert.deepEqual(record.family_results["FAM-3"].join.covered, ["a", "b"]);
    const runId = newestRunId(cwd);
    const graph = JSON.parse(run(cwd, ["session", "graph", runId, "--json"]).stdout);
    const created = graph.filter((edge) => edge.type === "handoff.created");
    assert.equal(created.length, 2);
    assert.ok(created.every((edge) => edge.artifact_digests.length > 0));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("duplicated role instructions are refused for a multi-agent route", () => {
  const cwd = temporary("aos-roles-");
  try {
    run(cwd, ["init"]);
    for (const id of ["a", "b", "joiner"]) addAgent(cwd, id);
    const planPath = makePlan(cwd, { "FAM-1": "a", "FAM-2": "a", "FAM-3": "a|b>joiner", "FAM-4": "b", "FAM-5": "joiner", "FAM-6": "a" });
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const duplicate = "Perform the same generic role and return the same generic result to the operator.";
    plan.families["FAM-3"].agent_instructions = { a: duplicate, b: duplicate, joiner: duplicate };
    writeFileSync(planPath, JSON.stringify(plan));
    const result = spawnSync(process.execPath, [cli, "assess", "--plan", planPath], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /distinct responsibilities/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("agent config refuses secret-like arguments", () => {
  const cwd = temporary("aos-secret-");
  try {
    run(cwd, ["init"]);
    const result = spawnSync(process.execPath, [cli, "agent", "add", "bad", "--command", "tool", "--arg", "API_KEY=secret"], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_SECRET_IN_AGENT_CONFIG/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("collaboration surfaces and imported or bridged evidence remain diagnostic", () => {
  const cwd = temporary("aos-surface-");
  try {
    run(cwd, ["init"]);
    run(cwd, ["surface", "add", "buzz", "--kind", "buzz", "--transport", "ndjson"]);
    const surfaces = JSON.parse(run(cwd, ["surface", "list", "--json"]).stdout);
    assert.equal(surfaces[0].id, "buzz");
    const source = join(cwd, "events.ndjson");
    writeFileSync(source, `${JSON.stringify({ event_type: "completion.claimed", payload: { claim: "blocked" } })}\n`);
    const imported = JSON.parse(run(cwd, ["import", "--producer", "buzz", "--file", source, "--json"]).stdout);
    assert.equal(imported.status, "DIAGNOSTIC_ONLY");
    const bridged = JSON.parse(run(cwd, ["bridge", "--run", imported.run_id, "--producer", "buzz", "--file", source, "--json"]).stdout);
    assert.equal(bridged.status, "DIAGNOSTIC_ONLY");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an explicit session is reviewed without discovering any", () => {
  // Searching the default roots first meant that on a machine with no ~/.claude or ~/.codex the
  // command exited with "no sessions found" while holding the path it had been asked about.
  const cwd = temporary("aos-review-session-");
  try {
    const session = join(cwd, "explicit.jsonl");
    writeFileSync(
      session,
      `${JSON.stringify({ type: "assistant", cwd: "/repo", message: { content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "/repo/a.ts" } }] } })}\n` +
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "all tests pass" }] } })}\n`,
      "utf8"
    );
    // HOME points at an empty directory, so nothing is discoverable.
    const reviewed = spawnSync(process.execPath, [cli, "review", "--session", session, "--json"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: cwd }
    });
    const result = JSON.parse(reviewed.stdout);
    assert.equal(result.findings.some((finding) => finding.rule === "completion-claimed-without-verification"), true);
    assert.equal(reviewed.status, 1, "a session with findings must not exit 0");

    const missing = spawnSync(process.execPath, [cli, "review", "--session", join(cwd, "nope.jsonl")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: cwd }
    });
    assert.equal(missing.status, 2, "a path that does not exist is bad input, not an empty review");
    assert.match(missing.stdout, /no session file at/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("asking for more sessions than the old cap returns more than the old cap", () => {
  // `--since 100` silently returned at most forty. The requested count and what could be found are
  // different numbers, and the output says both.
  const cwd = temporary("aos-review-limit-");
  try {
    const projects = join(cwd, ".claude", "projects", "sample");
    mkdirSync(projects, { recursive: true });
    // With a tool call in each, because `--since n` now means n sessions that have something to
    // review: a transcript with no tool activity no longer takes a slot (#501).
    const row = JSON.stringify({
      type: "assistant", cwd: "/repo",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] }
    });
    for (let index = 0; index < 45; index += 1) {
      writeFileSync(join(projects, `s-${index}.jsonl`), `${row}\n`, "utf8");
    }
    const env = { ...process.env, HOME: cwd };
    const asked = JSON.parse(
      spawnSync(process.execPath, [cli, "review", "--since", "45", "--json"], { cwd, encoding: "utf8", env }).stdout
    );
    assert.equal(asked.requested_sessions, 45);
    assert.equal(asked.reviewed_sessions, 45, "the request was capped");

    // And when there genuinely are not that many, both numbers are reported rather than one.
    const beyond = JSON.parse(
      spawnSync(process.execPath, [cli, "review", "--since", "60", "--json"], { cwd, encoding: "utf8", env }).stdout
    );
    assert.equal(beyond.requested_sessions, 60);
    assert.equal(beyond.reviewed_sessions, 45);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("a seed names the scenario, and a run records the one it used", () => {
  // A scenario nobody can name again is a result nobody can check. Given explicitly the run is
  // reproducible; left out, one is drawn and written down rather than left implicit.
  const cwd = temporary("aos-seed-");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    makePlan(cwd, { default: "solo" });

    run(cwd, ["assess", "--plan", "operator-plan.json", "--seed", "2a"], 3);
    const first = newestResult(cwd);
    assert.equal(first.run.seed, "000000000000002a");
    assert.equal(newestRecord(cwd).suite_manifest.seed, "000000000000002a");
    assert.deepEqual(first.run.seeded_families, ["FAM-2", "FAM-4", "FAM-6"]);

    // The run manifest and the result must name the same suite. Two sites write it, and a run that
    // recorded one suite while its result claimed another would be unreadable after the fact.
    const manifest = JSON.parse(
      readFileSync(join(cwd, ".aos", "runs", newestRunId(cwd), "manifest.json"), "utf8")
    );
    // Same digest, one spelling: the run manifest writes it bare and the published result writes
    // every digest with the prefix that says what the hex is a digest under.
    assert.equal(`sha256:${manifest.suite_digest}`, first.run.suite_digest);
    assert.equal(manifest.seed, first.run.seed);

    run(cwd, ["assess", "--plan", "operator-plan.json", "--seed", "2a"], 3);
    const repeated = newestResult(cwd);
    assert.equal(repeated.run.suite_digest, first.run.suite_digest, "the same seed produced a different suite");

    run(cwd, ["assess", "--plan", "operator-plan.json", "--seed", "2b"], 3);
    const different = newestResult(cwd);
    assert.notEqual(different.run.suite_digest, first.run.suite_digest, "a different seed produced the same suite");

    // Without --seed one is drawn, and it is a real seed rather than a placeholder.
    run(cwd, ["assess", "--plan", "operator-plan.json"], 3);
    assert.match(newestResult(cwd).run.seed, /^[0-9a-f]{16}$/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an unusable seed is refused rather than quietly replaced", () => {
  const cwd = temporary("aos-seed-bad-");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    makePlan(cwd, { default: "solo" });
    const refused = spawnSync(process.execPath, [cli, "assess", "--plan", "operator-plan.json", "--seed", "not-hex"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(refused.status, 0);
    // Named at the boundary the operator typed at. The generator refuses it too, but its message
    // says only "AOS_INVALID_SEED nope", which does not tell anyone what shape was wanted.
    assert.match(refused.stderr, /AOS_INVALID_SEED --seed not-hex/);
    assert.match(refused.stderr, /expected up to 16 hex digits/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("a join that never opened its branches is reported as unconsumed", () => {
  // The evidence chain has to be able to fail. If it cannot, "consumed" carries no information --
  // which is exactly what the old unconditional handoff.consumed event was worth.
  const cwd = temporary("aos-unconsumed-");
  try {
    run(cwd, ["init"]);
    for (const id of ["a", "b", "joiner"]) addAgent(cwd, id);
    const plan = makePlan(cwd, { "FAM-3": "a|b>joiner", default: "a" });
    // Non-zero exit is expected: an unconsumed handoff zeroes M11 and the run stops issuing.
    spawnSync(process.execPath, [cli, "assess", "--plan", plan], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_SKIP_EVIDENCE: "1" }
    });
    const result = newestResult(cwd);
    const fam3 = newestRecord(cwd).family_results["FAM-3"];
    assert.equal(fam3.handoff_integrity.unconsumed, 2, "a join that read nothing was accepted");
    assert.equal(fam3.handoff_complete, false);
    assert.deepEqual(fam3.join.covered, []);
    // Two of four, not zero: the handoff was made and the branches were distinguishable. What
    // failed is that the join did not read them, and those are the two subchecks that say so.
    const m10 = result.observations.find((entry) => entry.metric_id === "M10");
    assert.equal(m10.value, 0.5, "the metric did not follow the evidence");
    assert.equal(m10.subchecks.find((entry) => entry.id === "receiver-consumed-evidence").pass, false);
    assert.equal(m10.subchecks.find((entry) => entry.id === "join-covers-required-branches").pass, false);
    assert.equal(m10.subchecks.find((entry) => entry.id === "artifact-digest-handed-off").pass, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
