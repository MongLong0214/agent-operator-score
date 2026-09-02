import { join } from "node:path";

import { readJsonIfExists, sha256Text, sha256Value, writeJson } from "./core.mjs";
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

/**
 * The name of the shape `laneA` returns, because it replaced one that had no name.
 *
 * `aos holdout --json` used to print the acceptance object -- `accepted`, `holdout_sessions`, a
 * nested `precision` object, three gates -- and it printed it unversioned, so the only way a reader
 * could tell the shape had changed was for their code to start reading `undefined`. It had to
 * change: that object carries a rate no floor was ever applied to. Naming it is what makes the next
 * change to it detectable, and `docs/HOLDOUT_OUTPUT.md` says field by field what the old readers
 * should read now.
 */
export const LANE_A_SCHEMA = "aos-holdout-lane-a.v1";

/**
 * The smallest holdout that is allowed to carry a rate.
 *
 * `precisionOf` already refuses to invent a number when nothing was decided. It did not refuse to
 * print one when almost nothing was, and that is the shape that ships: one true positive and no
 * false positives is a precision of 1.000, arithmetically fine, and a description of a single
 * finding. Two figures are needed because they fail in different ways -- a hundred judgements
 * across three sessions measures three sessions, and fifty sessions with two judgements measures
 * two findings.
 *
 * Below the floor the rate is withheld. Withheld means absent: not zero, not the number that would
 * have been printed, and not an interval around it. The counts stay, because withholding a rate is
 * not withholding the evidence it would have been computed from.
 *
 * None of these figures is derived from a power calculation and none of them should be read as one.
 * Twenty decisions at a measured 0.90 is consistent with a true rate anywhere from roughly 0.70 to
 * 0.97, so clearing this floor buys a number that may be published, not a number that is precise.
 * They are declared product-acceptance thresholds, and LIMITATIONS says so in the same words.
 */
export const MVP_HOLDOUT_SESSIONS = 50;
export const MVP_DECIDED_HIGH = 20;

/**
 * The decisions have to touch more than one session, and most of the findings have to be decidable.
 *
 * Fifty sessions was decorative while nothing required the decisions to reach past one of them:
 * forty-nine sessions could contribute nothing and twenty verdicts inside the fiftieth would clear
 * both figures. A precision quoted about a reviewer is a claim across sessions, so the spread of
 * the decisions is part of the floor rather than a number printed beside it.
 *
 * The second figure is the same argument applied to abstention. `unclear` was counted and shown and
 * that was all it did, so a ledger could decide twenty findings, abstain on a thousand, and report
 * a rate over the twenty that were easy to judge. This module already says a rate computed only
 * over the cases somebody could label describes the easy ones; below this ratio it has to act on it.
 */
export const MVP_DECIDED_SESSIONS = 10;

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
  // A change of side is kept, the way a revised judgement is. This overwrote the row wholesale, so
  // a session that had taught the rules could become holdout with no trace -- in a file whose
  // stated defence is that revisions are visible.
  const existing = ledger.sessions.find((entry) => entry.digest === digest);
  const flipped = Boolean(existing) && existing.use !== use;
  const carried = flipped
    ? { previous_use: existing.use, previous_note: existing.note ?? "" }
    : existing?.previous_use
      ? { previous_use: existing.previous_use, previous_note: existing.previous_note ?? "" }
      : {};
  const row = { digest, use, reported_status, actual_evidence, note: safeText(note), ...carried };
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
  // Joined back to the session's *current* use, not only to the severity. `judge` refuses a verdict
  // on a tuning session at write time, but nothing re-checked it afterwards: judging a finding
  // while the session was holdout and then re-recording that session as tuning left the verdict in
  // the precision count. The report then read "2 used for tuning" and "3 right, 0 wrong" at once.
  //
  // This module says a session either taught the rules or tested them and cannot do both and still
  // be evidence. That has to hold when the label changes, not only when it is first set.
  const holdout = new Set(ledger.sessions.filter((entry) => entry.use === "holdout").map((entry) => entry.digest));
  const judged = ledger.judgements.filter((entry) => entry.severity === severity && holdout.has(entry.session_digest));
  const truePositive = judged.filter((entry) => entry.judgement === "true-positive").length;
  const falsePositive = judged.filter((entry) => entry.judgement === "false-positive").length;
  const unclear = judged.filter((entry) => entry.judgement === "unclear").length;
  const decided = truePositive + falsePositive;
  // How far the decisions reach, not how many there are. Twenty verdicts inside one session are
  // twenty facts about that session, and a rate over them is quoted as a fact about the reviewer.
  const decidedSessions = new Set(
    judged.filter((entry) => entry.judgement !== "unclear").map((entry) => entry.session_digest)
  ).size;
  return {
    severity,
    true_positive: truePositive,
    false_positive: falsePositive,
    unclear,
    decided,
    decided_sessions: decidedSessions,
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
 *
 * Not an output path, and that is a rule rather than an accident. The precision gate here is
 * unfloored -- it will happily say `pass` over ten judgements, which is what the owner's own
 * accept-or-not decision has always been allowed to do -- so a report generated from this object
 * prints a rate the floor above would have withheld, and the status printed beside it does not
 * take the number back. `laneA` is what the command prints, and the only caller of this is `laneA`.
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

/**
 * Which part of the floor was not met, in the words of the figure that was short.
 *
 * "Below the holdout floor" was true and said nothing a reader could act on: four different states
 * produced the same sentence, and the one that matters most -- decisions that never left one
 * session -- looks identical to a holdout that is simply young.
 */
const withheldReason = (floor) => {
  const missing = [
    floor.sessions_met ? null : `fewer than ${floor.sessions_required} holdout sessions`,
    floor.decided_met ? null : `fewer than ${floor.decided_required} decided high-severity findings`,
    floor.decided_sessions_met ? null : `decisions from fewer than ${floor.decided_sessions_required} sessions`,
    floor.abstention_met ? null : "more findings undecided than decided"
  ].filter((entry) => entry !== null);
  return `below the holdout floor: ${missing.join("; ")}`;
};

/**
 * Lane A: the local holdout, with the floor applied and the status kept separate from the rate.
 *
 * Three outcomes, and the third one is the point. PASS and FAIL are claims about the reviewer;
 * UNDECIDED is a claim about the sample, and collapsing it into either of the others is how a
 * ledger with one judgement reports a verdict on a product. `acceptanceOf` answers a different,
 * older question -- whether the owner accepts this on their own machine -- and it is folded into
 * this one rather than reported beside it: two result objects for one ledger meant the floored
 * answer and the unfloored one were both reachable, and the command printed the unfloored one.
 *
 * Order matters. A violation is a count, not a rate, so it decides before the floor does: one
 * session whose transcript AOS could not read, reported as one it could, is a clean bill of health
 * that was never earned, and no amount of further sampling earns it. Waiting for a bigger sample
 * before saying so would be the same as not saying it.
 */
export function laneA(ledger) {
  const acceptance = acceptanceOf(ledger);
  const precision = acceptance.precision;
  const floor = {
    sessions_required: MVP_HOLDOUT_SESSIONS,
    decided_required: MVP_DECIDED_HIGH,
    decided_sessions_required: MVP_DECIDED_SESSIONS,
    sessions_met: acceptance.holdout_sessions >= MVP_HOLDOUT_SESSIONS,
    decided_met: precision.decided >= MVP_DECIDED_HIGH,
    // Magnitude is not spread. Fifty sessions and twenty decisions are both satisfied by one
    // session that carried every verdict, and the rate that comes out of that is about one session.
    decided_sessions_met: precision.decided_sessions >= MVP_DECIDED_SESSIONS,
    // A rate over the findings that could be judged, when most of them could not, describes the
    // ones that were easy. Counting the abstentions said so; this is what acts on it.
    abstention_met: precision.unclear <= precision.decided
  };
  const met = floor.sessions_met && floor.decided_met && floor.decided_sessions_met && floor.abstention_met;

  // The two gates that are counts rather than rates. The precision gate is not among them: below
  // the floor there is no precision to have failed, and reading its `pass: false` as a failure is
  // exactly the mislabelling this lane exists to remove.
  //
  // Both are carried, passing or not, so that everything the command prints comes from this object.
  // The unfloored acceptance object was printable too, and it was the one that got printed.
  const gates = acceptance.gates
    .filter((gate) => gate.gate !== "high-severity precision")
    .map((gate) => ({ gate: gate.gate, target: gate.target, value: gate.value, pass: gate.pass, detail: gate.detail }));
  const violations = gates
    .filter((gate) => !gate.pass)
    .map((gate) => ({ gate: gate.gate, target: gate.target, value: gate.value, detail: gate.detail }));

  // A session that changed side after being judged is reported next to the number, not only kept in
  // the file. A record nobody reads is the shape this ledger exists to refuse.
  const moved = (ledger.sessions ?? []).filter((entry) => entry.previous_use && entry.previous_use !== entry.use);

  const status = violations.length > 0 ? "FAIL" : !met ? "UNDECIDED" : precision.precision >= MVP_PRECISION ? "PASS" : "FAIL";

  return {
    schema_id: LANE_A_SCHEMA,
    status,
    sessions: acceptance.holdout_sessions,
    tuning_sessions: acceptance.tuning_sessions,
    decided_high: precision.decided,
    tp: precision.true_positive,
    fp: precision.false_positive,
    // Neither side, and still printed. A holdout where a third of the findings could not be judged
    // has a precision that is arithmetically fine and means nothing, and the only way a reader sees
    // that is if the count sits beside it.
    unclear: precision.unclear,
    // How far the decisions reach and how many findings nobody could decide. Both are part of the
    // floor above, and both are reported whether or not they cleared it.
    decided_sessions: precision.decided_sessions,
    precision: met ? precision.precision : null,
    precision_withheld: !met,
    withheld_reason: met ? null : withheldReason(floor),
    floor,
    judged: acceptance.judged,
    gates,
    violations,
    moved_sessions: moved.length,
    // Binds the figure to the data it came from, so a number quoted later can be checked against
    // the ledger that produced it rather than against the ledger as it is now.
    dataset_digest: `sha256:${sha256Value({ sessions: ledger.sessions ?? [], judgements: ledger.judgements ?? [] })}`
  };
}
