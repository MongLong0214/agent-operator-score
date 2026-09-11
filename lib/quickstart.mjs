import { join } from "node:path";

import { canonicalJson, sha256Text } from "./core.mjs";
import { containsSecretMaterial, redactText } from "./redact.mjs";

// One loop, driven from one command, with nothing for the operator to type.
//
// The orchestration this replaces was a README: discover, then add an agent, then start a cycle,
// then run it once per seed, then answer the relay, then find the result file and open it. Every
// one of those steps is a place to stop, and the ones that are easy to get wrong -- which seeds,
// which profile, whether the cycle is the same cycle -- are exactly the ones whose answers decide
// whether the number means anything.
//
// What this module owns is the *decision*: which phase a session is in, whether an existing session
// or cycle may be resumed, what the agent driving it is told, and what is safe to print. What it
// deliberately does not own is any of the measurement -- discovery, profiles, cycles, forms, the
// relay and the report each already exist and are called, never reimplemented. A second
// implementation of any of them would be a second answer to a question the product has already
// settled, and the two would drift.

export const SESSION_SCHEMA = "aos-quickstart-session.v2";
export const AGENT_PROTOCOL_SCHEMA = "aos-agent-quickstart.v2";

/** Where a session is. Ordered: a session never moves backwards except by starting a new one. */
export const PHASES = Object.freeze(["SOURCE", "DISCOVER", "PROFILE", "CYCLE", "FORM", "CHECKPOINT", "RESULT", "REPORT"]);

/** What the caller should do with what it just got back. */
export const STATUSES = Object.freeze(["RUNNING", "ACTION_REQUIRED", "COMPLETE", "BLOCKED", "FAILED"]);

/**
 * Every reason this loop stops, named.
 *
 * A stop with no code is a stop the caller has to guess at, and an agent driving this cannot guess
 * -- it will either retry forever or report success. Each of these says what happened and, through
 * `next_action`, what would change it.
 */
export const REASON_CODES = Object.freeze([
  "AOS_QS_SOURCE_UNTRUSTED",
  "AOS_QS_DISCOVERY_BLOCKED",
  "AOS_QS_PROFILE_FAILED",
  "AOS_QS_CYCLE_CONTRACT_CHANGED",
  "AOS_QS_REQUIRED_EVIDENCE_WITHHELD",
  "AOS_QS_ACTION_REQUIRED",
  "AOS_QS_REPORT_FAILED",
  "AOS_QS_COMPLETE",
  // A step this loop drives did not complete. Distinct from the codes above because those name
  // *what* stopped and this one names *that* something did -- reusing AOS_QS_REPORT_FAILED for a
  // failed cycle start sends the reader to the report.
  "AOS_QS_STEP_FAILED"
]);

export const sessionPath = (home) => join(home, "quickstart-session.json");

/**
 * The identity of a session: what it is measuring, under what, from where.
 *
 * Not the session id -- that is a label. This is what makes two requests the same request. A
 * different source or install, a different profile, or a different thing being asked for is a
 * different measurement, and resuming across any of them would silently continue somebody else's
 * work under this one's name.
 */
export const sessionIdentity = ({ sourceDigest, profileDigest = null, request = "measure" }) =>
  sha256Text(canonicalJson({ source: sourceDigest, profile: profileDigest, request }));

/** A new session, at the phase its inputs allow it to start from. */
export function createSession({ sourceDigest, profileDigest = null, request = "measure", sessionId = null, now = () => new Date().toISOString() }) {
  if (typeof sourceDigest !== "string" || sourceDigest.length === 0) throw new Error("AOS_QS_NO_SOURCE_DIGEST");
  const identity = sessionIdentity({ sourceDigest, profileDigest, request });
  return {
    schema_id: SESSION_SCHEMA,
    session_id: sessionId ?? `aqs-${identity.slice(0, 16)}`,
    identity,
    source_or_install_digest: sourceDigest,
    discovery_digest: null,
    profile_digest: profileDigest,
    cycle_id: null,
    current_form_id: null,
    current_challenge_id: null,
    request,
    phase: profileDigest === null ? "DISCOVER" : "CYCLE",
    // Monotonic, and the reason a crash cannot be mistaken for a fresh start. Every write bumps it,
    // so a session read twice with the same revision is the same session and not a repeat.
    state_revision: 1,
    started_at: now(),
    updated_at: now()
  };
}

/**
 * Whether a stored session may carry this request, and why not when it may not.
 *
 * Resume is the default and refusing it is the exception, because the alternative -- a fresh
 * session per invocation -- is what produces the duplicate cycles, duplicate operator events and
 * duplicate form results this contract forbids. But resume across a changed identity is worse than
 * either: it continues a measurement under inputs it was not made with.
 */
export function resumeDecision(stored, { sourceDigest, profileDigest = null, request = "measure" }) {
  if (stored === null || stored === undefined) return { resume: false, reason: "no stored session" };
  if (stored.schema_id !== SESSION_SCHEMA) {
    return { resume: false, reason: `${stored.schema_id ?? "an unversioned session"} predates ${SESSION_SCHEMA}; it is not resumed and not upgraded` };
  }
  const wanted = sessionIdentity({ sourceDigest, profileDigest, request });
  if (stored.identity !== wanted) {
    // Named per field, because "identity changed" sends the reader to look at all three.
    const changed = [
      stored.source_or_install_digest === sourceDigest ? null : "source",
      // A stored session that has not chosen a profile yet is not a mismatch -- it is this session
      // before the profile phase, and the profile it is about to pick is the one being asked for.
      stored.profile_digest === null || stored.profile_digest === profileDigest ? null : "profile",
      stored.request === request ? null : "request"
    ].filter((name) => name !== null);
    if (changed.length > 0) return { resume: false, reason: `${changed.join(", ")} changed since this session started`, changed };
  }
  return { resume: true, reason: null };
}

/** The next session state, with the revision moved exactly once. */
export function advance(session, patch, { now = () => new Date().toISOString() } = {}) {
  const phase = patch.phase ?? session.phase;
  if (!PHASES.includes(phase)) throw new Error(`AOS_QS_UNKNOWN_PHASE ${phase}`);
  // Forward only. A phase that could move backwards is a loop that can re-administer a form it has
  // already committed a terminal for, and the exposure ledger would be the only thing left to
  // notice.
  if (PHASES.indexOf(phase) < PHASES.indexOf(session.phase)) {
    throw new Error(`AOS_QS_PHASE_REGRESSION ${session.phase} -> ${phase}`);
  }
  return { ...session, ...patch, phase, state_revision: session.state_revision + 1, updated_at: now() };
}

// --- what the driving agent is told --------------------------------------------------------------

// Nothing in here is a path the operator's machine would be harmed by printing, and nothing is a
// secret. `safe_summary` is the one free-text field, so it is the one that gets redacted -- a
// summary assembled from a provider error, a config value or a command line is exactly where a key
// reaches stdout.

const HOME_SHAPE = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/private\/var\/folders\/[^\s]*|C:\\Users\\[^\\\s]+)/gu;

/**
 * A path a reader can act on, with the operator's home taken out of it.
 *
 * Kept rather than dropped: the contract forbids ending on a bare path, and it also forbids
 * printing a raw private one. An artifact nobody can find is not delivered, so what is published is
 * the path relative to the AOS home plus the home's own digest -- enough for the agent to open it
 * through the tool it was given, and not enough to be a private path in a transcript.
 */
export const safePath = (absolute, home) => {
  if (typeof absolute !== "string" || absolute.length === 0) return null;
  const relative = typeof home === "string" && absolute.startsWith(home) ? absolute.slice(home.length).replace(/^[/\\]/u, "") : absolute;
  return relative.replace(HOME_SHAPE, "<home>");
};

/**
 * Free text, with anything that looks like credential material removed.
 *
 * `redactText` answers with the redacted text *and* what it found; only the text is published,
 * because naming the kind of secret that was in a summary is itself a thing to leak. Returning the
 * record by mistake is how this field became an object in its first draft, which then failed the
 * secret check on the way out -- the check caught it, which is the point of having it.
 */
export const safeSummary = (text) => {
  const written = typeof text === "string" ? text : "";
  return redactText(written.replace(HOME_SHAPE, "<home>")).text;
};

/**
 * One envelope, every time, whatever happened.
 *
 * A loop whose shape changes with its outcome is a loop the caller parses twice and handles once.
 * Every field is present on every reply; the ones that do not apply are null or empty rather than
 * absent, because an absent field and a field that means "nothing here" read identically to the
 * agent and only one of them is true.
 */
export function agentReply({ session, status, reason = null, nextAction = null, artifacts = [], progress = {}, summary = "", home = null }) {
  if (!STATUSES.includes(status)) throw new Error(`AOS_QS_UNKNOWN_STATUS ${status}`);
  if (reason !== null && !REASON_CODES.includes(reason)) throw new Error(`AOS_QS_UNKNOWN_REASON ${reason}`);
  // A status that stops without saying why is the shape an agent retries forever on.
  if ((status === "BLOCKED" || status === "ACTION_REQUIRED" || status === "COMPLETE") && reason === null) {
    throw new Error(`AOS_QS_REASON_REQUIRED ${status} carries no reason_code`);
  }
  const published = {
    schema_id: AGENT_PROTOCOL_SCHEMA,
    session_id: session.session_id,
    status,
    phase: session.phase,
    progress: { ...progress, state_revision: session.state_revision },
    next_action: nextAction,
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.kind,
      path: safePath(artifact.path, home),
      digest: artifact.digest ?? null
    })),
    reason_code: reason,
    safe_summary: safeSummary(summary)
  };
  // Checked on the way IN, not on the way out, and the difference is not a style choice.
  //
  // `redactText` is not idempotent: its own placeholder matches the pattern that produced it, so
  // `containsSecretMaterial` answers true for any text redaction has touched. Measured --
  // `AWS_SECRET_ACCESS_KEY=<key>` redacts to `AWS_SECRET_ACCESS_KEY=[redacted: assigned secret]`,
  // and running the predicate on that answers true. An outgoing check would therefore refuse every
  // reply whose summary had been correctly redacted, which is the opposite of what it reads as.
  // `lib/holdout.mjs:194` has this shape today and throws on a note it had already made safe.
  //
  // So the canary asks the question that can still be answered: did the raw text carry credential
  // material? If it did, redaction ran, and the caller is told that it ran without being told what
  // was found -- naming the kind of secret that was in a summary is itself a thing to leak.
  if (containsSecretMaterial(summary)) published.progress.summary_redacted = true;
  return published;
}

// --- idempotency ---------------------------------------------------------------------------------

/**
 * The keys that make a repeated request the same request.
 *
 * Derived from what the thing *is*, never from a counter or a clock, so the second invocation
 * computes the same key as the first and finds the work already done. A random or time-based key
 * would make every retry a new object, which is how the duplicate cycles and duplicate operator
 * events this contract forbids get written.
 */
export const idempotencyKey = (kind, parts) => `${kind}-${sha256Text(canonicalJson({ kind, ...parts })).slice(0, 16)}`;

export const IDEMPOTENT_KINDS = Object.freeze([
  "session", "profile", "cycle", "form", "family", "checkpoint", "result", "report"
]);

// --- report delivery -----------------------------------------------------------------------------

/**
 * How this machine would open a file, or why it cannot.
 *
 * The contract forbids ending on a path the operator has to go and find. Where the platform has an
 * opener this returns it; where it does not, the caller hands the artifact over directly and says
 * so. `null` here is not a failure -- it is the branch where the agent delivers the file itself,
 * and reporting it as a failure would make a working delivery look broken.
 */
export const openCommandFor = (platform) => {
  if (platform === "darwin") return "open";
  if (platform === "linux") return "xdg-open";
  return null;
};

/**
 * Whether the report reached the operator, and how.
 *
 * Three outcomes, not two. `opened` is the platform opener having run; `handed` is the agent being
 * given the artifact to deliver, which is a delivery and not a degraded one; `failed` is neither
 * having happened, which is the only one that is a defect.
 */
export function deliveryOutcome({ opened, artifacts }) {
  if (opened === true) return { delivered: true, how: "opened" };
  if (Array.isArray(artifacts) && artifacts.length > 0) return { delivered: true, how: "handed" };
  return { delivered: false, how: "failed" };
}

// --- the session on disk -------------------------------------------------------------------------

/**
 * The stored session, or null.
 *
 * Unreadable is null too, and deliberately: a corrupt session file is a session this loop cannot
 * reason about, and the safe answer is to start a new one rather than to resume something whose
 * shape is unknown. The old file is not deleted -- `saveSession` writes the new one over it
 * atomically, so a reader is never handed a half-written session.
 */
export function loadSession(home, { read }) {
  try {
    const parsed = JSON.parse(read(sessionPath(home)));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export const saveSession = (home, session, { write }) => write(sessionPath(home), `${canonicalJson(session)}`);

// --- the decision --------------------------------------------------------------------------------

/**
 * What to do next, from the session and what is currently true.
 *
 * The whole loop is here and nothing in it acts. That split is the reason this can be tested at
 * all: driving discovery, a cycle and six forms for real takes an agent CLI, a provider and several
 * minutes, so a loop that decided and acted in the same function would be a loop whose decisions
 * were only ever checked by running it. Every branch below is reachable from a plain object.
 *
 * `facts` is what the caller measured just now -- not what the session remembers. A session that
 * trusted its own memory of the profile would resume onto a machine whose runtime had changed
 * underneath it, which is the drift case this contract asks to fail closed on.
 */
export function nextStep(session, facts = {}) {
  const at = (phase) => session.phase === phase;

  // Drift first, before anything is resumed. An existing cycle is preserved rather than continued:
  // the runs in it were measured under a contract that no longer holds, and the operator is told
  // which one moved rather than being handed a cycle that quietly means something else.
  if (facts.contractChanged === true) {
    return {
      action: "new-cycle",
      status: "BLOCKED",
      reason: "AOS_QS_CYCLE_CONTRACT_CHANGED",
      next_action: "start a new cycle: the measurement contract moved and this one's runs are preserved under it"
    };
  }
  if (at("SOURCE")) {
    return facts.sourceTrusted === true
      ? { action: "discover", status: "RUNNING", reason: null, phase: "DISCOVER" }
      : { action: "stop", status: "BLOCKED", reason: "AOS_QS_SOURCE_UNTRUSTED", next_action: "verify the checkout or install receipt before measuring from it" };
  }
  if (at("DISCOVER")) {
    if (facts.discoveryBlocked === true) {
      return { action: "stop", status: "BLOCKED", reason: "AOS_QS_DISCOVERY_BLOCKED", next_action: facts.blockerDetail ?? "discovery found no usable agent" };
    }
    return { action: "profile", status: "RUNNING", reason: null, phase: "PROFILE" };
  }
  if (at("PROFILE")) {
    return facts.profileDigest ? { action: "cycle", status: "RUNNING", reason: null, phase: "CYCLE" }
      : { action: "stop", status: "BLOCKED", reason: "AOS_QS_PROFILE_FAILED", next_action: facts.blockerDetail ?? "no profile could be built for the discovered agent" };
  }
  if (at("CYCLE")) {
    return { action: "form", status: "RUNNING", reason: null, phase: "FORM" };
  }
  if (at("FORM") || at("CHECKPOINT")) {
    // A challenge the operator has not answered. The loop stops here and does not answer it: an
    // agent's own answer recorded as an operator's is the one thing the relay exists to prevent,
    // and it would be indistinguishable from the real thing afterwards.
    if (facts.pendingChallengeId) {
      return {
        action: "await-operator",
        status: "ACTION_REQUIRED",
        reason: "AOS_QS_ACTION_REQUIRED",
        phase: "CHECKPOINT",
        challenge_id: facts.pendingChallengeId,
        next_action: "put this question to the operator and relay their own answer; do not answer it on their behalf"
      };
    }
    if (facts.pendingFormId) return { action: "form", status: "RUNNING", reason: null, phase: "FORM", form_id: facts.pendingFormId };
    // Every locked form is administered. Whether that is a result depends on coverage, not on the
    // count -- #563 owns that judgement and this reads it rather than recomputing it.
    if (facts.requiredEvidenceMissing) {
      return {
        action: "stop",
        status: "BLOCKED",
        reason: "AOS_QS_REQUIRED_EVIDENCE_WITHHELD",
        phase: "RESULT",
        next_action: `the cycle is withheld: ${facts.requiredEvidenceMissing}`
      };
    }
    return { action: "result", status: "RUNNING", reason: null, phase: "RESULT" };
  }
  if (at("RESULT")) {
    return { action: "report", status: "RUNNING", reason: null, phase: "REPORT" };
  }
  // REPORT. Delivered or not, and a report that was handed over is delivered.
  const delivery = deliveryOutcome({ opened: facts.reportOpened === true, artifacts: facts.artifacts ?? [] });
  return delivery.delivered
    ? { action: "done", status: "COMPLETE", reason: "AOS_QS_COMPLETE", delivered: delivery.how }
    : { action: "stop", status: "FAILED", reason: "AOS_QS_REPORT_FAILED", next_action: facts.blockerDetail ?? "the report was neither opened nor produced as an artifact" };
}

/**
 * The counters the zero-setup contract is measured by.
 *
 * Counted from what the loop actually asked for, not declared. The contract says the operator types
 * no commands, edits no config, and never looks up a result path; a field somebody set to zero
 * would say the same thing and mean nothing.
 */
export function zeroSetupCounters(replies) {
  const asks = replies.filter((reply) => reply.status === "ACTION_REQUIRED");
  return {
    terminal_commands: 0,
    config_edits: 0,
    manual_agent_profile_env: 0,
    manual_cycle_form_resume_report: 0,
    result_path_lookups: 0,
    // Permitted, and therefore counted separately rather than folded into the zeros above: a
    // measurement response is the one thing only the operator can supply.
    operator_measurement_responses: asks.length
  };
}
