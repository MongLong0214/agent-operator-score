import { join } from "node:path";

import { readJsonIfExists, sha256Text, writeJson } from "./core.mjs";
import { containsSecretMaterial, redactText } from "./redact.mjs";

// The sessions the owner did not tune against, and what the owner decided about each finding.
//
// Every rule in this product was written by looking at real sessions, which means every rule is at
// risk of having been written to fit them. The only answer is a set of sessions held back from that
// work, judged once, by hand -- and a number that says how often a high-severity finding was right.
//
// The ledger never holds a session. It holds a digest of one, the identity of a finding inside it,
// the owner's verdict, and a reason -- so it can live on the machine that has the sessions without
// becoming a second copy of them. Nothing here goes into git, and the shape is the reason it does
// not have to be trusted not to: there is no field a transcript could be written into.
//
// This is product acceptance, not science. It says the tool is worth the owner's attention on their
// own work. It does not generalise past that, and nothing here should be read as if it did.

export const LEDGER_VERSION = 1;

/** The owner's verdict on one finding. `unclear` is counted and reported, never quietly dropped. */
export const JUDGEMENTS = ["true-positive", "false-positive", "unclear"];

/** A session either taught the rules or tested them. It cannot do both and still be evidence. */
export const USES = ["tuning", "holdout"];

export const MVP_PRECISION = 0.9;

export const holdoutPath = (home) => join(home, "holdout.json");

/** A session is identified by a digest of itself, which is the whole point: the ledger holds no session. */
export const sessionDigestOf = (text) => sha256Text(text);

/**
 * A finding's identity inside a session.
 *
 * Derived from the rule and the position, both of which a re-run reproduces, and neither of which
 * carries any of the session's content. Keying on the finding's text would put the transcript in
 * the ledger through the back door, and keying on an index alone would silently re-point every
 * judgement the first time a rule fired one step earlier.
 */
export const findingIdOf = (sessionDigest, finding) =>
  sha256Text(`${sessionDigest}\n${finding.rule}\n${finding.where}`).slice(0, 16);

export const emptyLedger = () => ({ version: LEDGER_VERSION, sessions: [], judgements: [] });

export function loadLedger(home) {
  const stored = readJsonIfExists(holdoutPath(home));
  if (stored === null) return emptyLedger();
  if (stored.version !== LEDGER_VERSION) throw new Error(`AOS_HOLDOUT_VERSION ${stored.version}`);
  return stored;
}

export const saveLedger = (home, ledger) => writeJson(holdoutPath(home), ledger);

/**
 * Records that a session exists, which side of the line it is on, and what AOS said about its
 * evidence against what the owner found when they read it.
 *
 * The two statuses are separate fields because the gap between them is one of the three things this
 * ledger exists to count: a session whose transcript AOS could not fully read, reported as one it
 * could, is a clean bill of health that was never earned.
 */
export function recordSession(ledger, { digest, use, reported_status, actual_evidence, note = "" }) {
  if (typeof digest !== "string" || digest.length !== 64) throw new Error("AOS_HOLDOUT_BAD_DIGEST");
  if (!USES.includes(use)) throw new Error(`AOS_HOLDOUT_BAD_USE ${use}`);
  for (const [label, value] of [["reported_status", reported_status], ["actual_evidence", actual_evidence]]) {
    if (value !== "COMPLETE" && value !== "INCOMPLETE") throw new Error(`AOS_HOLDOUT_BAD_STATUS ${label}=${value}`);
  }
  // Only the named fields are ever copied. Spreading the caller's object is how a transcript ends up
  // in a file that promises not to hold one.
  const row = { digest, use, reported_status, actual_evidence, note: safeText(note) };
  const sessions = ledger.sessions.filter((entry) => entry.digest !== digest);
  return { ...ledger, sessions: [...sessions, row] };
}

/**
 * Records the owner's verdict on one finding.
 *
 * A second verdict on the same finding replaces the first and keeps the one it replaced. Precision
 * a judge can revise after seeing it is not a measurement, and the only defence that survives an
 * owner grading their own tool is that the revision is visible.
 */
export function judge(ledger, { session_digest, finding_id, rule, severity, judgement, reason = "" }) {
  const session = ledger.sessions.find((entry) => entry.digest === session_digest);
  if (!session) throw new Error("AOS_HOLDOUT_UNKNOWN_SESSION");
  // A judgement about a session the rules were written against says nothing about the rules.
  if (session.use !== "holdout") throw new Error("AOS_HOLDOUT_SESSION_IS_TUNING");
  if (!JUDGEMENTS.includes(judgement)) throw new Error(`AOS_HOLDOUT_BAD_JUDGEMENT ${judgement}`);
  if (typeof finding_id !== "string" || finding_id.length === 0) throw new Error("AOS_HOLDOUT_BAD_FINDING_ID");
  if (typeof rule !== "string" || rule.length === 0) throw new Error("AOS_HOLDOUT_BAD_RULE");

  const previous = ledger.judgements.find(
    (entry) => entry.session_digest === session_digest && entry.finding_id === finding_id
  );
  const row = {
    session_digest,
    finding_id,
    rule,
    severity,
    judgement,
    reason: safeText(reason),
    revisions: previous ? [...previous.revisions, { judgement: previous.judgement, reason: previous.reason }] : []
  };
  const rest = ledger.judgements.filter(
    (entry) => !(entry.session_digest === session_digest && entry.finding_id === finding_id)
  );
  return { ...ledger, judgements: [...rest, row] };
}

/**
 * Anything the owner typed, with credential material removed.
 *
 * The reason is the one free-text field in the ledger, so it is the one way a secret could get in.
 * Redaction runs first; the check after it is not redundant, because a redactor that stopped
 * matching would otherwise fail silently and this file is the last place that should be discovered.
 */
function safeText(value) {
  if (typeof value !== "string") return "";
  const { text } = redactText(value.slice(0, 500));
  // Not redundant with the redaction above: it asks whether anything credential-shaped survived it.
  // A redactor that stopped matching would otherwise fail silently, and this file is the last place
  // that should be discovered.
  if (containsSecretMaterial(text)) throw new Error("AOS_HOLDOUT_SECRET_IN_TEXT");
  return text;
}

/**
 * How often a finding at this severity was right.
 *
 * `unclear` is reported rather than folded into either side. A holdout where a third of the
 * findings could not be judged has a precision that is arithmetically fine and means nothing, and
 * the only way a reader can see that is if the number of them is printed next to it.
 */
export function precisionOf(ledger, { severity = "high" } = {}) {
  const judged = ledger.judgements.filter((entry) => entry.severity === severity);
  const truePositive = judged.filter((entry) => entry.judgement === "true-positive").length;
  const falsePositive = judged.filter((entry) => entry.judgement === "false-positive").length;
  const unclear = judged.filter((entry) => entry.judgement === "unclear").length;
  const decided = truePositive + falsePositive;
  return {
    severity,
    true_positive: truePositive,
    false_positive: falsePositive,
    unclear,
    decided,
    // Not 1, and not 0. Nothing was decided, so there is no rate, and inventing one here is how a
    // ledger with two entries reports a perfect score.
    precision: decided === 0 ? null : truePositive / decided
  };
}

/** Every string the ledger holds, for the check that none of them is a secret. */
const stringsOf = (value) =>
  typeof value === "string" ? [value]
    : Array.isArray(value) ? value.flatMap(stringsOf)
      : value && typeof value === "object" ? Object.values(value).flatMap(stringsOf)
        : [];

/**
 * The three things that have to be true before this is worth shipping.
 *
 * They are product acceptance and they are stated as such: a high-severity finding is usually
 * right, a session AOS could not read is never reported as clean, and no secret was written back
 * out. None of them is a claim about anybody else's sessions.
 */
export function acceptanceOf(ledger) {
  const holdout = ledger.sessions.filter((entry) => entry.use === "holdout");
  const precision = precisionOf(ledger, { severity: "high" });

  // Counted over the ledger's own contents rather than read from a field somebody set. A recorded
  // zero is a claim; this is a measurement of the file in front of us.
  const reprints = stringsOf(ledger).filter((text) => containsSecretMaterial(text)).length;
  const passedOffAsClean = holdout.filter(
    (entry) => entry.actual_evidence === "INCOMPLETE" && entry.reported_status === "COMPLETE"
  );

  const gates = [
    {
      gate: "high-severity precision",
      target: `>= ${MVP_PRECISION}`,
      value: precision.precision,
      // Undecided is not passed. A holdout that judged nothing has no precision to clear the bar with.
      pass: precision.precision !== null && precision.precision >= MVP_PRECISION,
      detail: `${precision.true_positive} right, ${precision.false_positive} wrong, ${precision.unclear} unclear`
    },
    {
      gate: "incomplete evidence reported as clean",
      target: "0",
      value: passedOffAsClean.length,
      pass: passedOffAsClean.length === 0,
      detail: passedOffAsClean.map((entry) => entry.digest.slice(0, 12)).join(", ") || "none"
    },
    {
      gate: "secret material reprinted",
      target: "0",
      value: reprints,
      pass: reprints === 0,
      detail: reprints === 0 ? "none" : "the ledger itself carries credential-shaped text"
    }
  ];

  return {
    holdout_sessions: holdout.length,
    tuning_sessions: ledger.sessions.length - holdout.length,
    judged: ledger.judgements.length,
    precision,
    gates,
    accepted: gates.every((entry) => entry.pass)
  };
}
