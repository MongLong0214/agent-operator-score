import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { sha256Text } from "./core.mjs";

// Whether a handoff was used, rather than whether one was announced.
//
// `handoff.consumed` used to be written by AOS immediately after `handoff.created`, before the
// receiving agent had been invoked. The pair was unconditional: every handoff was consumed, by
// construction, and the event proved nothing except that the orchestrator had reached that line.
//
// Consumption is only observable where the receiver's evidence can be distinguished from what it
// was handed. That is true for parallel branches, because each branch runs in its own directory and
// can be given something no other branch has. It is not true for a sequential stage in a shared
// workspace, where the handed artifact is simply present. So one is measured and the other is
// recorded as unobservable, which is the honest split -- asserting consumption in both cases is how
// the old design came to be worth nothing.

/**
 * A token unique to one branch of one run.
 *
 * Derived rather than random so a replayed run plants the same markers, and hidden inside the
 * branch so a join that never opened it cannot name it.
 */
export const branchMarkerFor = (runId, family, branchId) =>
  `AOS-BRANCH-${sha256Text(`${runId}:${family}:${branchId}`).slice(0, 16).toUpperCase()}`;

export const MARKER_FILE = "branch-evidence.txt";

/**
 * Plants a branch's marker where its agent can find it.
 *
 * The marker is the thing a join has to carry forward. A join that picked one branch and invented
 * the rest can produce a plausible summary; it cannot produce a token it never read.
 */
export function plantBranchMarker(branchRoot, marker) {
  writeFileSync(
    join(branchRoot, MARKER_FILE),
    `${marker}\nInclude this line in whatever you hand on, so the join can show it read this branch.\n`,
    "utf8"
  );
  return marker;
}

/**
 * Which branches the join can show it read, from the join's own output.
 *
 * The text handed in must be what the join produced, not the whole workspace. The first version
 * walked the workspace, which still holds AOS's copy of each branch's output under candidates/ --
 * so the marker was always found and the check confirmed that AOS could read a file AOS had
 * written. The chain has to run through two agents: the branch carries the marker into its output,
 * and the join carries it into the join's.
 */
export function joinCoverage(joinText, markers) {
  const text = typeof joinText === "string" ? joinText : "";
  const covered = [];
  const missing = [];
  for (const [branchId, marker] of Object.entries(markers)) {
    (text.includes(marker) ? covered : missing).push(branchId);
  }
  return {
    covered: covered.sort(),
    missing: missing.sort(),
    complete: missing.length === 0 && covered.length > 0
  };
}

/**
 * What a handoff can be said to be.
 *
 * `unobservable` is a real answer and the common one: in a shared workspace the handed artifact is
 * simply there, and nothing distinguishes a receiver that read it from one that ignored it.
 * Reporting that as "consumed" is the defect this replaces.
 */
export function handoffOutcome({ artifactDigests, observable, evidenced }) {
  if (!Array.isArray(artifactDigests) || artifactDigests.length === 0) return "nothing-handed";
  if (!observable) return "unobservable";
  return evidenced ? "consumed" : "unconsumed";
}

/**
 * Whether the orchestration evidence is complete enough to score a handoff metric.
 *
 * A run with no observable handoff is not a failed run; it is a run in which the question was not
 * asked. Only an observed handoff that was not consumed counts against the operator.
 */
export function handoffIntegrity(outcomes) {
  const counts = { consumed: 0, unconsumed: 0, unobservable: 0, "nothing-handed": 0 };
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return {
    ...counts,
    observed: counts.consumed + counts.unconsumed > 0,
    // Nothing handed is a broken route: the sender produced no evidence to pass on.
    complete: counts.unconsumed === 0 && counts["nothing-handed"] === 0
  };
}
