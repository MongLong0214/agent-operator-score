import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_PROTOCOL_SCHEMA,
  IDEMPOTENT_KINDS,
  PHASES,
  REASON_CODES,
  SESSION_SCHEMA,
  STATUSES,
  advance,
  agentReply,
  createSession,
  deliveryOutcome,
  idempotencyKey,
  loadSession,
  nextStep,
  openCommandFor,
  resumeDecision,
  safePath,
  safeSummary,
  saveSession,
  sessionIdentity,
  sessionPath,
  zeroSetupCounters
} from "../../lib/quickstart.mjs";

const source = `sha256:${"a".repeat(64)}`;
const other = `sha256:${"b".repeat(64)}`;

test("the same request resumes its session; a different one never does", () => {
  // Resume is the default because the alternative -- a fresh session per invocation -- is what
  // produces the duplicate cycles, duplicate operator events and duplicate form results this
  // contract forbids. Resume across a changed identity is worse than either: it continues a
  // measurement under inputs it was not made with.
  const session = createSession({ sourceDigest: source, profileDigest: "sha256:p", request: "measure" });
  assert.equal(resumeDecision(session, { sourceDigest: source, profileDigest: "sha256:p", request: "measure" }).resume, true);

  for (const [label, ask] of [
    ["source", { sourceDigest: other, profileDigest: "sha256:p", request: "measure" }],
    ["profile", { sourceDigest: source, profileDigest: "sha256:q", request: "measure" }],
    ["request", { sourceDigest: source, profileDigest: "sha256:p", request: "re-measure" }]
  ]) {
    const decision = resumeDecision(session, ask);
    assert.equal(decision.resume, false, label);
    assert.ok(decision.changed.includes(label), `${label}: the reason does not name which input moved`);
  }

  // Nothing stored, and a session from a schema this build does not know, are both "start fresh"
  // rather than "resume something whose shape is unknown".
  assert.equal(resumeDecision(null, { sourceDigest: source }).resume, false);
  assert.equal(resumeDecision({ schema_id: "aos-quickstart-session.v1" }, { sourceDigest: source }).resume, false);

  // A session that has not chosen a profile yet is this session before the profile phase, not a
  // mismatch with the profile it is about to pick.
  const early = createSession({ sourceDigest: source });
  assert.equal(early.profile_digest, null);
  assert.equal(resumeDecision(early, { sourceDigest: source, profileDigest: "sha256:p" }).resume, true);
});

test("a session moves forward only, and every write moves the revision exactly once", () => {
  // A phase that could move backwards is a loop that can re-administer a form it has already
  // committed a terminal for, and the exposure ledger would be the only thing left to notice.
  const session = createSession({ sourceDigest: source });
  const later = advance(session, { phase: "FORM" });
  assert.equal(later.state_revision, session.state_revision + 1);
  assert.equal(advance(later, { phase: "FORM" }).state_revision, later.state_revision + 1, "a same-phase write did not move the revision");
  assert.throws(() => advance(later, { phase: "DISCOVER" }), /AOS_QS_PHASE_REGRESSION/u);
  assert.throws(() => advance(later, { phase: "NOWHERE" }), /AOS_QS_UNKNOWN_PHASE/u);
});

test("every reply has the same shape, and a reply that stops says why", () => {
  // A loop whose shape changes with its outcome is a loop the caller parses twice and handles once.
  // A status that stops without a reason code is the shape an agent retries forever on.
  const session = createSession({ sourceDigest: source });
  const reply = agentReply({ session, status: "RUNNING", summary: "discovering" });
  assert.equal(reply.schema_id, AGENT_PROTOCOL_SCHEMA);
  for (const field of ["session_id", "status", "phase", "progress", "next_action", "artifacts", "reason_code", "safe_summary"]) {
    assert.ok(field in reply, `${field} is absent, so the caller cannot tell it from "nothing here"`);
  }
  for (const status of ["BLOCKED", "ACTION_REQUIRED", "COMPLETE"]) {
    assert.throws(() => agentReply({ session, status }), /AOS_QS_REASON_REQUIRED/u, status);
  }
  assert.throws(() => agentReply({ session, status: "NOPE" }), /AOS_QS_UNKNOWN_STATUS/u);
  assert.throws(() => agentReply({ session, status: "BLOCKED", reason: "AOS_QS_INVENTED" }), /AOS_QS_UNKNOWN_REASON/u);
  // RUNNING and FAILED carry a reason when there is one and do not require it: a loop still moving
  // has nothing to explain.
  assert.equal(agentReply({ session, status: "RUNNING" }).reason_code, null);
});

test("a reply never carries a credential or a raw private path", () => {
  // `safe_summary` is the one free-text field, so it is the one a provider error, a config value or
  // a command line could reach stdout through.
  const session = createSession({ sourceDigest: source });
  const reply = agentReply({
    session,
    status: "RUNNING",
    summary: "spawned from /Users/isaac/projects/aos with AWS_SECRET_ACCESS_KEY=abcd1234abcd1234abcd",
    artifacts: [{ kind: "html", path: "/Users/isaac/.aos/runs/r-1/report.html" }],
    home: "/Users/isaac/.aos"
  });
  assert.equal(/isaac/u.test(reply.safe_summary), false, "the operator's home reached the summary");
  assert.equal(/abcd1234abcd1234abcd/u.test(reply.safe_summary), false, "a credential reached the summary");
  assert.equal(reply.progress.summary_redacted, true, "the caller is not told redaction ran");
  // The kind of secret is not published: naming it is itself a thing to leak.
  assert.equal(/AWS_SECRET/u.test(JSON.stringify(reply.progress)), false);

  // An artifact keeps a path the agent can act on, with the home taken out. The contract forbids
  // both a raw private path and ending on a path nobody can find, so it is neither.
  assert.equal(reply.artifacts[0].path, "runs/r-1/report.html");
  assert.equal(safePath("/home/someone/x/report.html", null), "<home>/x/report.html");
  assert.equal(safePath(null, "/h"), null);
  assert.equal(safeSummary(undefined), "");
});

test("every stop in the loop is reachable and names its reason", () => {
  // A stop with no code is a stop the caller has to guess at, and an agent driving this cannot
  // guess -- it will either retry forever or report success.
  const at = (phase) => ({ ...createSession({ sourceDigest: source }), phase });
  const rows = [
    [at("SOURCE"), { sourceTrusted: false }, "BLOCKED", "AOS_QS_SOURCE_UNTRUSTED"],
    [at("DISCOVER"), { discoveryBlocked: true }, "BLOCKED", "AOS_QS_DISCOVERY_BLOCKED"],
    [at("PROFILE"), {}, "BLOCKED", "AOS_QS_PROFILE_FAILED"],
    [at("FORM"), { contractChanged: true }, "BLOCKED", "AOS_QS_CYCLE_CONTRACT_CHANGED"],
    [at("FORM"), { requiredEvidenceMissing: "C1-C6 5/6" }, "BLOCKED", "AOS_QS_REQUIRED_EVIDENCE_WITHHELD"],
    [at("FORM"), { pendingChallengeId: "ch-1" }, "ACTION_REQUIRED", "AOS_QS_ACTION_REQUIRED"],
    [at("REPORT"), {}, "FAILED", "AOS_QS_REPORT_FAILED"],
    [at("REPORT"), { artifacts: [{ kind: "html" }] }, "COMPLETE", "AOS_QS_COMPLETE"]
  ];
  const seen = new Set();
  for (const [session, facts, status, reason] of rows) {
    const step = nextStep(session, facts);
    assert.equal(step.status, status, reason);
    assert.equal(step.reason, reason);
    seen.add(reason);
  }
  // Every declared code is produced by the loop. A code nothing can produce is a code nobody will
  // ever read, and it would sit in the vocabulary looking like coverage.
  assert.deepEqual([...seen].sort(), [...REASON_CODES].sort());
});

test("the loop never answers the operator's question for them", () => {
  // An agent's own answer recorded as an operator's is the one thing the relay exists to prevent,
  // and afterwards it is indistinguishable from the real thing.
  const step = nextStep({ ...createSession({ sourceDigest: source }), phase: "FORM" }, { pendingChallengeId: "ch-7" });
  assert.equal(step.action, "await-operator");
  assert.equal(step.challenge_id, "ch-7");
  assert.match(step.next_action, /do not answer it on their behalf/u);
  // And a pending challenge outranks a pending form: the loop does not run ahead of the answer.
  const both = nextStep({ ...createSession({ sourceDigest: source }), phase: "FORM" }, { pendingChallengeId: "ch-7", pendingFormId: "FAM-3" });
  assert.equal(both.action, "await-operator");
});

test("contract drift preserves the cycle instead of continuing it", () => {
  // The runs in it were measured under a contract that no longer holds. Continuing would aggregate
  // two contracts; deleting would lose the evidence. The third answer is the only honest one.
  for (const phase of ["CYCLE", "FORM", "RESULT"]) {
    const step = nextStep({ ...createSession({ sourceDigest: source }), phase }, { contractChanged: true });
    assert.equal(step.reason, "AOS_QS_CYCLE_CONTRACT_CHANGED", phase);
    assert.equal(step.action, "new-cycle", phase);
  }
});

test("a report handed to the agent is delivered, and only nothing at all is a failure", () => {
  // The contract forbids ending on a path the operator has to go and find. Where the platform has
  // an opener it is used; where it does not, the agent delivers the artifact itself -- that is a
  // delivery, and reporting it as failed would make a working one look broken.
  assert.equal(openCommandFor("darwin"), "open");
  assert.equal(openCommandFor("linux"), "xdg-open");
  assert.equal(openCommandFor("win32"), null, "an unknown platform claimed an opener it does not have");
  assert.deepEqual(deliveryOutcome({ opened: true, artifacts: [] }), { delivered: true, how: "opened" });
  assert.deepEqual(deliveryOutcome({ opened: false, artifacts: [{ kind: "html" }] }), { delivered: true, how: "handed" });
  assert.deepEqual(deliveryOutcome({ opened: false, artifacts: [] }), { delivered: false, how: "failed" });
});

test("an idempotency key is derived from what the thing is, never from a clock or a counter", () => {
  // A random or time-based key makes every retry a new object, which is how the duplicate cycles
  // and duplicate operator events this contract forbids get written.
  const a = idempotencyKey("cycle", { profile: "sha256:p", seeds: ["1", "2"] });
  const b = idempotencyKey("cycle", { seeds: ["1", "2"], profile: "sha256:p" });
  assert.equal(a, b, "key order changed the key, so a retry would not find its own work");
  assert.notEqual(a, idempotencyKey("cycle", { profile: "sha256:p", seeds: ["1", "3"] }));
  assert.notEqual(a, idempotencyKey("form", { profile: "sha256:p", seeds: ["1", "2"] }), "two kinds shared one key");
  assert.equal(IDEMPOTENT_KINDS.length, 8);
  for (const kind of IDEMPOTENT_KINDS) assert.match(idempotencyKey(kind, {}), new RegExp(`^${kind}-[0-9a-f]{16}$`, "u"));
});

test("a session survives a crash at every phase, and an unreadable one starts fresh", () => {
  // The recovery case. A stored session is re-read rather than remembered, so a crash between any
  // two phases resumes at the phase that was committed rather than at the one that was attempted.
  const files = new Map();
  const io = { read: (path) => { if (!files.has(path)) throw new Error("ENOENT"); return files.get(path); }, write: (path, text) => files.set(path, text) };
  const home = "/h";
  let session = createSession({ sourceDigest: source });
  for (const phase of PHASES.slice(PHASES.indexOf("DISCOVER"))) {
    session = advance(session, { phase });
    saveSession(home, session, io);
    const recovered = loadSession(home, io);
    assert.equal(recovered.phase, phase, `${phase} did not survive the write`);
    assert.equal(recovered.state_revision, session.state_revision);
    assert.equal(resumeDecision(recovered, { sourceDigest: source }).resume, true, `${phase} could not be resumed`);
  }
  // Corrupt, and absent, are both "start fresh" rather than "resume something unknown".
  files.set(sessionPath(home), "{not json");
  assert.equal(loadSession(home, io), null);
  files.delete(sessionPath(home));
  assert.equal(loadSession(home, io), null);
});

test("the zero-setup counters are counted, never declared", () => {
  // A field somebody set to zero says the same thing as a measurement and means nothing.
  const replies = [
    { status: "RUNNING" },
    { status: "ACTION_REQUIRED" },
    { status: "ACTION_REQUIRED" },
    { status: "COMPLETE" }
  ];
  const counters = zeroSetupCounters(replies);
  for (const field of ["terminal_commands", "config_edits", "manual_agent_profile_env", "manual_cycle_form_resume_report", "result_path_lookups"]) {
    assert.equal(counters[field], 0, field);
  }
  // The permitted action is counted separately rather than folded into the zeros: a measurement
  // response is the one thing only the operator can supply.
  assert.equal(counters.operator_measurement_responses, 2);
});

test("the vocabularies are closed, and the session schema is versioned", () => {
  assert.equal(SESSION_SCHEMA, "aos-quickstart-session.v2");
  assert.equal(AGENT_PROTOCOL_SCHEMA, "aos-agent-quickstart.v2");
  assert.deepEqual([...PHASES], ["SOURCE", "DISCOVER", "PROFILE", "CYCLE", "FORM", "CHECKPOINT", "RESULT", "REPORT"]);
  assert.deepEqual([...STATUSES], ["RUNNING", "ACTION_REQUIRED", "COMPLETE", "BLOCKED", "FAILED"]);
  assert.equal(new Set(REASON_CODES).size, REASON_CODES.length);
  assert.equal(sessionIdentity({ sourceDigest: source }), sessionIdentity({ sourceDigest: source, profileDigest: null, request: "measure" }));
});
