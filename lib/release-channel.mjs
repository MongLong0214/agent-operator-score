import { canonicalJson, sha256Text } from "./core.mjs";

// Whether a release may be promoted, decided from evidence rather than from a sense that things
// look ready.
//
// The failure this exists to prevent is `near-green`: every gate but one, a plausible story about
// why that one does not count, and a stable channel that now points at work nobody finished. The
// issue that asked for this says it in one line -- "near-green은 promotion 조건이 아니다" -- and
// the only way to keep that line is to make the decision a function of a matrix somebody else
// filled in, so that the gap has to be visible before it can be waved past.
//
// Nothing here talks to GitHub. The live reads belong to the script that calls this, for the same
// reason the quickstart loop separates its decisions from its doing: a promotion decision that
// could only be checked by promoting is a decision nobody checks.

export const RELEASE_CHANNEL_SCHEMA = "aos-release-channel.v1";

/** The gates, and the issues each is satisfied by. Named here so a missing one cannot be silent. */
export const RELEASE_GATES = Object.freeze({
  X: Object.freeze([588]),
  S: Object.freeze([553, 554, 555, 556, 557]),
  C: Object.freeze([582, 559, 560, 558, 583]),
  G: Object.freeze([561, 564, 584, 585, 568, 586, 562, 563]),
  "E/Q/U": Object.freeze([566, 567, 565, 574, 575, 576])
});

/**
 * Which gates pass, and which issues each is still waiting on.
 *
 * `status` comes from the execution plan, which is the one place an issue's state is recorded
 * against evidence rather than against a label somebody set. An issue this function cannot find is
 * not passing -- an absent entry and a done one read identically to a reader who only counts
 * failures, and only one of them is true.
 */
export function gateMatrix(planStatuses) {
  const rows = Object.entries(RELEASE_GATES).map(([gate, issues]) => {
    const waiting = issues.filter((issue) => planStatuses?.[issue] !== "done");
    return { gate, issues: [...issues], waiting, pass: waiting.length === 0 };
  });
  return {
    rows,
    pass: rows.every((row) => row.pass),
    waiting: rows.flatMap((row) => row.waiting).sort((a, b) => a - b)
  };
}

/**
 * Whether the repository is actually shaped the way a stable channel needs, from live reads.
 *
 * Every check names what it read. "Protected" is not a property this asks GitHub for by feature
 * name -- the issue is explicit that a specific feature's name must not be guessed at -- so the
 * caller passes what the API returned and this decides from the enforcement that was actually
 * observed: required checks, no force push, no deletion.
 */
export function channelState({ defaultBranch, protection = {}, tag = null, backMerged = null, versions = {}, devOnlyMarkers = [] }) {
  const problems = [];
  const enforced = (branch) => {
    const found = protection[branch] ?? null;
    if (found === null) return `${branch} has no protection evidence; an unprotected branch is not a channel`;
    const missing = [
      found.required_checks === true ? null : "required checks",
      found.allow_force_push === false ? null : "no force push",
      found.allow_deletion === false ? null : "no deletion"
    ].filter((name) => name !== null);
    return missing.length === 0 ? null : `${branch} does not enforce ${missing.join(", ")}`;
  };

  if (defaultBranch !== "main") problems.push(`the default branch is ${defaultBranch ?? "unset"}, so a clone follows integration rather than the stable channel`);
  for (const branch of ["main", "dev"]) {
    const problem = enforced(branch);
    if (problem !== null) problems.push(problem);
  }
  if (tag !== null) {
    if (tag.reachable_from_main !== true) problems.push(`${tag.name} is not reachable from main, so the tag names a commit the stable channel does not have`);
    if (tag.commit !== tag.release_target) problems.push(`${tag.name} points at ${tag.commit} and its release targets ${tag.release_target}`);
    if (tag.tree !== tag.main_tree) problems.push(`the released tree does not match main's tree at ${tag.commit}`);
    // Every surface that states a version states the same one. A plugin manifest that lags the tag
    // is how a stable install ends up describing a release it is not.
    for (const [surface, value] of Object.entries(versions)) {
      if (value !== tag.version) problems.push(`${surface} says ${value ?? "nothing"} and the tag says ${tag.version}`);
    }
  }
  if (devOnlyMarkers.length > 0) problems.push(`the stable tree carries dev-only marker(s): ${devOnlyMarkers.join(", ")}`);
  // Back-merge last, because it is the only one that is about what happens *after* a release: dev
  // must contain main, or the next integration work starts from a tree the release is not in.
  if (backMerged === false) problems.push("dev does not contain main; the release was not back-merged");
  return { ok: problems.length === 0, problems };
}

/**
 * The promotion decision: the gates and the channel, together, with nothing inferred from either.
 *
 * Returns a verdict rather than throwing, because the caller prints it. A promotion that is refused
 * has to say every reason at once -- fixing one and rediscovering the next is how a release takes a
 * day instead of an hour, and how somebody starts looking for the flag that skips the check.
 */
export function promotionVerdict({ planStatuses, channel }) {
  const gates = gateMatrix(planStatuses);
  const state = channelState(channel);
  const reasons = [
    ...gates.waiting.map((issue) => `gate evidence: #${issue} is not done`),
    ...state.problems
  ];
  return {
    schema_id: RELEASE_CHANNEL_SCHEMA,
    gates: gates.rows,
    channel: state,
    // `near-green` is not a verdict. Either every gate passed and the channel is shaped for a
    // stable release, or the promotion is refused and says why.
    promote: gates.pass && state.ok,
    reasons,
    digest: `sha256:${sha256Text(canonicalJson({ gates: gates.rows, problems: state.problems }))}`
  };
}
