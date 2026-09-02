import { existsSync } from "node:fs";

import { laneA } from "./holdout.mjs";
import { METRIC_NAME, knownIncidentsDir, laneB, loadCorpus } from "./incident-corpus.mjs";

// The two lanes, and the only claim they add up to.
//
// They measure different things and are kept apart on purpose. Lane A is the reviewer's precision
// on the owner's own held-back sessions: real work, judged by hand, and the only one of the two that
// says anything about sessions. Lane B is a fixture rate over incidents this repository already
// wrote down: it has a recall, which lane A cannot have, and it is a rate over fixtures somebody
// chose rather than over anybody's work.
//
// Neither of them is a statement about an operator. They are diagnostics about a review rule, and
// the release claim they gate is a claim about `aos review`, not about a person who used it.

/**
 * Lane B is not always available, and saying so is better than a number computed over nothing.
 *
 * The corpus is a directory of fixtures. An installation that does not carry it gets an honest
 * absence rather than an empty corpus reported as a clean one -- an empty corpus has no regressions
 * and no violations, which is exactly what a passing one looks like from the outside.
 */
export function corpusIfPresent(dir = knownIncidentsDir()) {
  return existsSync(dir) ? loadCorpus(dir) : null;
}

const absentLaneB = () => ({
  status: "UNDECIDED",
  metric_name: METRIC_NAME,
  items: 0,
  rule_metrics: {},
  regressions: [],
  violations: [],
  undecided_items: [],
  excluded_for_leakage: 0,
  withheld_rules: [],
  corpus_absent: true,
  corpus_digest: null
});

/**
 * What may be claimed, given both lanes.
 *
 * `PRODUCTION_QUALITY` needs both to pass. Everything else is `EXPERIMENTAL`, including the case
 * this product is actually in: lane A undecided for want of judged findings, lane B undecided for
 * want of incidents that did not also write the rule being measured. An undecided lane is not a
 * quiet pass, and the stage is where that has to show, because the stage is what a reader carries
 * away.
 */
export function laneReport({ ledger, corpus = corpusIfPresent() }) {
  const lane_a = laneA(ledger);
  const lane_b = corpus === null ? absentLaneB() : laneB(corpus);
  const both = lane_a.status === "PASS" && lane_b.status === "PASS";
  return {
    lane_a,
    lane_b,
    claim: both ? "PRODUCTION_QUALITY" : "EXPERIMENTAL",
    // Named separately from the claim because they can differ: a lane A that fails has a precision
    // and it is a bad one, which is a different thing from having none.
    precision_claim: lane_a.precision === null ? "WITHHELD" : "REPORTED",
    review_stage: both ? "PRODUCTION_QUALITY" : "EXPERIMENTAL"
  };
}
