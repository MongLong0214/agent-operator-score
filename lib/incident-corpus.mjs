import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Value } from "./core.mjs";
import { loadSession } from "./session.mjs";
import { reviewSession } from "./review.mjs";

// Incidents that already happened, written down as sessions the reviewer has to still get right.
//
// Precision on its own is satisfied by a reviewer that reports almost nothing: a rule that fires
// twice a year and is right both times has a precision of 1.000 and misses everything. The other
// direction needs a denominator, and the only honest denominator available locally is a set of
// incidents somebody wrote down. So each item carries both labels -- the rules that must fire and
// the rules that must stay silent -- and the rate over them is called what it is: a known-incident
// fixture rate, not a recall over anybody's sessions.
//
// The item also carries the one fact that decides whether it may be counted at all. A rule that was
// changed in response to this exact session cannot be measured on it; that asks whether the rule
// fits the thing it was fitted to, and the answer is yes whatever the rule is worth. Those items
// stay in the corpus as regression tests and are taken out of the arithmetic.
//
// What that exclusion cannot do is check itself. `derived_rules` is a declaration, and the rules,
// the items, the labels and the declarations were written by one person in one change. Omitting a
// rule name from that array makes the item eligible and nothing here would notice: there is no
// independent history to test the claim against on the machine this runs on. So the corpus is a set
// of reconstructions written by the author of the rules, not an independently labelled corpus, and
// it is named that way in LIMITATIONS. It can show a rule has stopped doing what it was recorded
// doing. It cannot establish that a rule was measured on evidence it did not come from.

export const CORPUS_SCHEMA_ID = "aos-known-incident.v1";

/** The transcript shapes an item can be recorded in. `normalized` is a session already parsed. */
export const CORPUS_RUNTIMES = ["codex", "claude", "normalized"];

/**
 * The smallest corpus, per rule and per direction, that is allowed to carry a rate.
 *
 * Both directions, because one of them alone is the failure mode this lane exists to catch: ten
 * incidents and no near misses measures a reviewer that reports everything, and ten near misses and
 * no incidents measures one that reports nothing. High-severity rules carry the larger floor
 * because they are the ones a release claim is made about.
 */
export const LANE_B_FLOOR = { high: 10, other: 5 };

export const METRIC_NAME = "known-incident fixture precision and recall";

const floorFor = (severity) => (severity === "high" ? LANE_B_FLOOR.high : LANE_B_FLOOR.other);

/**
 * Which of two observed severities decides the rule's floor: the worse one.
 *
 * A rule does not have one severity. `session-ended-on-stale-evidence` is medium after one edit and
 * high after four, and the first version of this recorded whichever the corpus happened to produce
 * first -- so the same ten positives and ten negatives cleared a floor of five when the medium item
 * sorted first and were withheld under a floor of ten when the high one did. The floor moved with
 * the directory listing, which means a rate could be published by renaming a file.
 *
 * The maximum is the conservative direction as well as the deterministic one: it withholds a rate
 * the corpus might have been able to carry, rather than publishing one it could not.
 */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };
const worseOf = (left, right) => {
  if (left === undefined || left === null) return right;
  if (right === undefined || right === null) return left;
  return (SEVERITY_RANK[right] ?? 0) < (SEVERITY_RANK[left] ?? 0) ? right : left;
};

export const knownIncidentsDir = () =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "known-incidents");

/**
 * Everything an item has to say before it counts as a known incident.
 *
 * The provenance fields are required for the same reason the labels are: an item nobody can trace
 * back to something that happened is a session somebody wrote to make a number come out, and a
 * corpus of those measures the person who wrote them.
 */
export function validateItem(item) {
  if (!item || item.schema_id !== CORPUS_SCHEMA_ID) throw new Error(`AOS_CORPUS_SCHEMA ${item?.schema_id}`);
  if (typeof item.fixture_id !== "string" || item.fixture_id.length === 0) throw new Error("AOS_CORPUS_BAD_ID");
  if (!CORPUS_RUNTIMES.includes(item.runtime)) throw new Error(`AOS_CORPUS_BAD_RUNTIME ${item.runtime}`);
  if (item.evidence_status !== "COMPLETE" && item.evidence_status !== "INCOMPLETE") {
    throw new Error(`AOS_CORPUS_BAD_STATUS ${item.evidence_status}`);
  }
  if (typeof item.incident !== "string" || item.incident.length === 0) throw new Error("AOS_CORPUS_NO_PROVENANCE");
  if (typeof item.source !== "string" || item.source.length === 0) throw new Error("AOS_CORPUS_NO_PROVENANCE");
  for (const field of ["expected_rules", "forbidden_rules", "undecided_rules", "derived_rules", "secret_values"]) {
    if (!Array.isArray(item[field])) throw new Error(`AOS_CORPUS_BAD_FIELD ${field}`);
  }
  // A rule cannot be the thing that must fire and the thing that must not, and it cannot be both
  // decided and undecided. A label set that contradicts itself scores whichever way it is read.
  const labels = [["expected_rules", "forbidden_rules"], ["expected_rules", "undecided_rules"], ["forbidden_rules", "undecided_rules"]];
  for (const [left, right] of labels) {
    const overlap = item[left].filter((rule) => item[right].includes(rule));
    if (overlap.length > 0) throw new Error(`AOS_CORPUS_LABEL_CONFLICT ${overlap.join(", ")}`);
  }
  const hasEvidence = item.runtime === "normalized" ? Boolean(item.session) : Array.isArray(item.events) && item.events.length > 0;
  if (!hasEvidence) throw new Error("AOS_CORPUS_NO_EVIDENCE");
  return item;
}

/** Every item on disk, in a stable order so the digest of the corpus does not depend on the reader. */
export function loadCorpus(dir = knownIncidentsDir()) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => validateItem(JSON.parse(readFileSync(join(dir, name), "utf8"))));
}

/**
 * The review this item produces, through the same path a real session takes.
 *
 * Recorded items go back out to a file and through `loadSession`, rather than being handed to
 * `reviewSession` already parsed. Half of the incidents in this corpus are parser incidents -- a
 * Codex tool call in a shape the parser had never seen, a patch envelope read as a command -- and a
 * corpus that skipped the parser could not have caught any of them.
 */
export function reviewOf(item) {
  if (item.runtime === "normalized") return reviewSession(item.session);
  const dir = mkdtempSync(join(tmpdir(), "aos-corpus-"));
  try {
    const path = join(dir, `${item.fixture_id}.jsonl`);
    writeFileSync(path, `${item.events.map((row) => JSON.stringify(row)).join("\n")}\n`);
    return reviewSession(loadSession(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Findings and observations both. An info-severity rule is still a rule this corpus can label. */
export const firedRulesOf = (review) =>
  [...review.findings, ...(review.observations ?? [])].map((finding) => finding.rule);

/**
 * What this item says about this rule, once.
 *
 * Refuses rather than returns for a derived item. Returning a neutral value would let a caller that
 * forgot the exclusion quietly average the rule against its own training material, and the whole
 * separation this lane rests on would be a field nobody read.
 */
export function outcomeFor(item, rule, fired) {
  if (item.derived_rules.includes(rule)) throw new Error(`AOS_CORPUS_LEAKAGE ${item.fixture_id} ${rule}`);
  // Neither a positive nor a negative. An item that cannot say whether this rule should have fired
  // is counted and named, and it stays out of both denominators -- a reviewer graded only on the
  // cases somebody could label has a rate that describes the easy ones.
  if (item.undecided_rules.includes(rule)) return "UNDECIDED";
  const it = fired.includes(rule);
  if (item.expected_rules.includes(rule)) return it ? "TP" : "FN";
  if (item.forbidden_rules.includes(rule)) return it ? "FP" : "TN";
  // Silence is not coverage. An item that never said anything about this rule has not tested it.
  return null;
}

/** What an item is, for the digest: its labels and its evidence, never a live session object. */
const identityOf = (item) => ({
  fixture_id: item.fixture_id,
  runtime: item.runtime,
  evidence_status: item.evidence_status,
  expected_rules: [...item.expected_rules].sort(),
  forbidden_rules: [...item.forbidden_rules].sort(),
  undecided_rules: [...item.undecided_rules].sort(),
  derived_rules: [...item.derived_rules].sort(),
  evidence_digest: sha256Value(item.runtime === "normalized" ? (item.session.steps ?? []) : item.events)
});

const emptyMetric = (rule) => ({
  rule,
  severity: null,
  tp: 0,
  fp: 0,
  fn: 0,
  tn: 0,
  undecided: 0,
  decided_items: 0,
  eligible_items: 0,
  excluded_for_leakage: 0,
  runtimes: {},
  positives: 0,
  negatives: 0,
  precision: null,
  recall: null,
  withheld: true,
  withheld_reason: "no eligible item labelled this rule"
});

/**
 * The same evidence twice is one incident, however many files it is written into.
 *
 * Nothing stopped a corpus from holding ten copies of one session under ten fixture ids. Ten copies
 * of one positive and ten of one negative cleared a floor of ten in each direction and published a
 * precision of 1.000 and a recall of 1.000 over two distinct shapes -- and the floor is the whole
 * defence this lane has, so a floor that counts copies is not a floor.
 *
 * Refused rather than deduplicated. Silently collapsing them would leave a corpus that reports
 * twenty items and measures two, and the count is what a reader uses to judge the rate.
 *
 * This catches copies, not near-copies: an item with one character changed is a different digest
 * and counts again. That is a limit of the check and it is written down in LIMITATIONS rather than
 * implied to be covered.
 */
function refuseDuplicateEvidence(items) {
  const seen = new Map();
  for (const item of items) {
    const digest = identityOf(item).evidence_digest;
    const first = seen.get(digest);
    if (first !== undefined) throw new Error(`AOS_CORPUS_DUPLICATE_EVIDENCE ${first} ${item.fixture_id}`);
    seen.set(digest, item.fixture_id);
  }
}

/**
 * Lane B: the corpus, as a per-rule confusion matrix and a status that does not overstate it.
 *
 * Three things are computed and they answer different questions. Regressions run over every item,
 * derived or not, because a known incident that is no longer handled the way it was recorded is a
 * defect whoever the evidence belonged to. Violations run over every item too, because
 * incomplete-evidence-reported-as-clean and a reprinted credential are counts, not rates, and a
 * small corpus does not make them wait. The rates run over eligible items only, and are withheld
 * unless the corpus and the denominator both clear the floor.
 */
export function laneB(items) {
  refuseDuplicateEvidence(items);
  const rules = new Set();
  for (const item of items) {
    for (const rule of [...item.expected_rules, ...item.forbidden_rules, ...item.undecided_rules]) rules.add(rule);
  }

  const reviews = new Map(items.map((item) => [item.fixture_id, reviewOf(item)]));
  const severities = new Map();
  for (const review of reviews.values()) {
    for (const finding of [...review.findings, ...(review.observations ?? [])]) {
      severities.set(finding.rule, worseOf(severities.get(finding.rule), finding.severity));
    }
  }

  const regressions = [];
  const violations = [];
  const undecidedItems = [];
  const metrics = Object.fromEntries([...rules].sort().map((rule) => [rule, emptyMetric(rule)]));

  for (const item of items) {
    const review = reviews.get(item.fixture_id);
    const fired = firedRulesOf(review);

    // A session AOS could not fully read, reported as one it could. The gate is the gap between the
    // two, not either one on its own: saying so is the correct outcome, and only claiming otherwise
    // is the failure.
    if (item.evidence_status === "INCOMPLETE" && review.status === "COMPLETE") {
      violations.push({
        kind: "incomplete-evidence-reported-as-clean",
        fixture_id: item.fixture_id,
        detail: "the item records incomplete evidence and the review reported it complete"
      });
    }
    const printed = JSON.stringify(review);
    for (const secret of item.secret_values) {
      if (printed.includes(secret)) {
        violations.push({
          kind: "secret-material-reprinted",
          fixture_id: item.fixture_id,
          detail: "a value this item declares as credential material survived into the review"
        });
      }
    }

    if (item.undecided_rules.length > 0) undecidedItems.push(item.fixture_id);

    for (const rule of rules) {
      const metric = metrics[rule];
      // The regression check does not care where the evidence came from. It is not a rate.
      if (item.expected_rules.includes(rule) && !fired.includes(rule)) {
        regressions.push({ fixture_id: item.fixture_id, rule, expected: "fires", observed: "silent" });
      }
      if (item.forbidden_rules.includes(rule) && fired.includes(rule)) {
        regressions.push({ fixture_id: item.fixture_id, rule, expected: "silent", observed: "fires" });
      }

      if (item.derived_rules.includes(rule)) {
        if (item.expected_rules.includes(rule) || item.forbidden_rules.includes(rule) || item.undecided_rules.includes(rule)) {
          metric.excluded_for_leakage += 1;
        }
        continue;
      }
      const outcome = outcomeFor(item, rule, fired);
      if (outcome === null) continue;
      metric.eligible_items += 1;
      metric.runtimes[item.runtime] = (metric.runtimes[item.runtime] ?? 0) + 1;
      if (outcome === "UNDECIDED") metric.undecided += 1;
      else metric[outcome.toLowerCase()] += 1;
    }
  }

  for (const metric of Object.values(metrics)) {
    // Unknown severity is treated as high. The larger floor is the conservative direction: it
    // withholds a rate the corpus might have been able to carry, which is the error that costs a
    // claim rather than the one that makes a false one.
    metric.severity = severities.get(metric.rule) ?? null;
    const floor = floorFor(metric.severity ?? "high");
    metric.positives = metric.tp + metric.fn;
    metric.negatives = metric.fp + metric.tn;
    metric.floor = floor;

    const corpusMet = metric.positives >= floor && metric.negatives >= floor;
    const precisionDenominator = metric.tp + metric.fp;
    const recallDenominator = metric.positives;
    metric.precision_denominator = precisionDenominator;
    metric.recall_denominator = recallDenominator;

    metric.precision = corpusMet && precisionDenominator >= floor ? metric.tp / precisionDenominator : null;
    metric.recall = corpusMet && recallDenominator >= floor ? metric.tp / recallDenominator : null;
    metric.withheld = metric.precision === null || metric.recall === null;
    // Zero eligible evidence and too little eligible evidence are different states and the report
    // used to say the same sentence for both. "Below the floor of ten" reads as a corpus that is
    // nearly there; the true state of every rule in the corpus that ships is that after the leakage
    // exclusion there is nothing left to count at all, and that is a different thing to know.
    metric.decided_items = metric.tp + metric.fp + metric.fn + metric.tn;
    metric.withheld_reason = metric.decided_items === 0
      ? metric.excluded_for_leakage > 0
        ? `no eligible decided evidence: all ${metric.excluded_for_leakage} decided label(s) for this rule are on items the rule was derived from`
        : "no eligible decided evidence: no item labelled this rule as expected or forbidden"
      : !corpusMet
        ? `below the corpus floor of ${floor} eligible items in each direction`
        : metric.precision === null
          ? `the precision denominator is below the minimum of ${floor}`
          : metric.recall === null
            ? `the recall denominator is below the minimum of ${floor}`
            : null;
  }

  const withheld = Object.values(metrics).filter((metric) => metric.withheld);
  const status = violations.length > 0 || regressions.length > 0 ? "FAIL"
    // Not PASS. A corpus that cannot carry a rate has not shown the reviewer is right; it has shown
    // that nothing it saw was wrong, and the difference is the whole reason this lane exists.
    : withheld.length > 0 || Object.keys(metrics).length === 0 ? "UNDECIDED"
      : "PASS";

  return {
    status,
    metric_name: METRIC_NAME,
    items: items.length,
    rule_metrics: metrics,
    regressions,
    violations,
    undecided_items: undecidedItems,
    excluded_for_leakage: Object.values(metrics).reduce((total, metric) => total + metric.excluded_for_leakage, 0),
    withheld_rules: withheld.map((metric) => metric.rule),
    // The number that says which of the two withheld states this corpus is in. Zero is the honest
    // answer for the corpus that ships and it is reported as zero rather than as a small number.
    eligible_decided_pairs: Object.values(metrics).reduce((total, metric) => total + metric.decided_items, 0),
    // The corpus a number came from, so the number can be checked against the items that produced
    // it rather than against whatever the directory holds later.
    corpus_digest: `sha256:${sha256Value(items.map(identityOf))}`
  };
}
