// The gate that stands between #572's audit and a deletion.
//
// #572 exists because a branch is sometimes the last copy of some work, so deleting one on a hunch
// is how a repository loses something. The audit is a committed document. This module is what
// refuses to let that document read as permission.
//
// The division that matters is between where a fact comes from and who decides on it. Everything a
// deletion turns on -- which refs exist, which pull requests are open, what protection and the
// rulesets say, what the install source is -- is mutable state on GitHub, and the audit's copy of it
// is a transcript written by the party proposing the deletion. So the destructive decision
// (`deletionAuthorizationFindings`) reads a live observation collected by
// `scripts/collect-branch-state.mjs` and refuses outright when there is none; the stored audit is
// only ever a *necessary* condition, never a sufficient one. Prerequisites are the same shape: #578
// and #588 clear in the canonical execution-plan snapshot or they have not cleared, and a sentence
// in the deletion log saying otherwise is a finding rather than an argument.
//
// Everything else fails closed. An unrecognized classification, a missing field, an empty reason, a
// state whose required record is absent, an unestablished fact with no argument attached: each makes
// a branch ineligible, never eligible. One finding anywhere empties the whole eligible set, because
// an audit with a broken invariant is not a document to delete branches from.
//
// This lives under `scripts/` beside the other governance verifiers rather than in `lib/`: it checks
// a governance report and is not part of the product the package ships.

import { readFileSync } from "node:fs";

import {
  INSTALL_SOURCE_FILES,
  OBSERVATION_SCHEMA,
  REQUIRED_DERIVATIONS,
  canonicalize,
  collect as collectLive,
  contentDigest,
  observationDigest,
  verifyObservation
} from "./collect-branch-state.mjs";

export { canonicalize };

/** The six states #572 classifies a branch into. Anything else is not a classification. */
export const CLASSIFICATIONS = new Set(["MERGED", "SUPERSEDED", "UNIQUE_WORK", "EVIDENCE_ONLY", "ACTIVE", "UNKNOWN_HOLD"]);

/** Recommendations carried forward from the first snapshot of this fixture, unchanged. */
export const RECOMMENDATIONS = new Set(["safe_to_delete_after_578", "needs_decision", "must_be_preserved"]);

/** Both, not either: #578 preserves the release evidence, #588 binds the confirmation to it. */
export const DELETION_BLOCKED_BY = Object.freeze([578, 588]);

/** How stale a live observation may be at the moment a deletion is recorded against it. */
export const OBSERVATION_MAX_AGE_SECONDS = 900;

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/u;

const isNonEmptyString = (value, min = 1) => typeof value === "string" && value.trim().length >= min;
const isList = (value) => Array.isArray(value) && value.length > 0;

// Epoch seconds from the shape the regex already accepted, computed rather than parsed: a lenient
// parser would quietly accept instants this gate's freshness window is not written for.
const instantSeconds = (value) => {
  const parts = INSTANT.exec(value ?? "");
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second);
  // Date.UTC rolls a day that does not exist forward into the next month rather than refusing it,
  // so the only way to reject 2026-02-30 is to ask what came back.
  const back = new Date(epoch);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return epoch / 1000;
};

/**
 * What each classification has to carry before anything else is asked about it.
 *
 * The states are not interchangeable labels over one predicate. A UNIQUE_WORK entry without a
 * preservation plan and an EVIDENCE_ONLY entry without a destination are the two states in which the
 * audit has recorded that something would be lost and then not said where it goes.
 */
const CLASSIFICATION_CONTRACT = {
  MERGED: {
    recommendation: null,
    deletable: true,
    check: (entry, push) => {
      if (!(entry.merged_into_dev === true && entry.merged_into_main === true)) push("classified MERGED without being contained in both dev and main");
      if (entry.unique_commits_vs_dev !== 0 || entry.unique_commits_vs_main !== 0) push("classified MERGED while holding commits dev or main does not have");
      if (entry.unique_commits_vs_dev_and_main !== 0) push("classified MERGED while holding commits neither dev nor main has");
    }
  },
  SUPERSEDED: {
    recommendation: null,
    deletable: true,
    // The whole point of this state is that the commits were *not* merged verbatim. What replaces
    // containment is a named replacement plus an account of every commit that is not on dev or main.
    check: (entry, push) => {
      const record = entry.superseding;
      if (!record) return push("classified SUPERSEDED with nothing recorded that supersedes it");
      if (typeof record.pr !== "number" && typeof record.issue !== "number") push("classified SUPERSEDED without naming a superseding PR or issue");
      if (!SHA.test(record.sha ?? "")) push("classified SUPERSEDED without the SHA the replacement landed at");
      if (!isNonEmptyString(record.note, 21)) push("classified SUPERSEDED without saying how the replacement covers this branch's work");
      const outstanding = entry.unique_commits_vs_dev_and_main;
      if (typeof outstanding !== "number") return push("classified SUPERSEDED without recording how many commits reach neither dev nor main");
      if (outstanding > 0 && (record.supersedes_commits ?? []).length !== outstanding) {
        push(`classified SUPERSEDED with ${outstanding} commit(s) on no other line but ${(record.supersedes_commits ?? []).length} accounted for by the replacement`);
      }
      for (const sha of record.supersedes_commits ?? []) if (!SHA.test(sha)) push(`superseding record names "${sha}", which is not a commit id`);
    }
  },
  UNIQUE_WORK: {
    recommendation: "must_be_preserved",
    deletable: false,
    check: (entry, push) => {
      if (!isList(entry.preserve)) push("classified UNIQUE_WORK without naming what is unique to it");
      const plan = entry.preservation_plan;
      if (!plan) return push("classified UNIQUE_WORK with no plan for getting the work off the branch");
      if (typeof plan.canonical_issue !== "number") push("preservation plan names no canonical issue to carry the work");
      if (!isNonEmptyString(plan.replacement_branch_base)) push("preservation plan does not say what the replacement branch is cut from");
      if (!["cherry-pick", "reimplement"].includes(plan.method)) push(`preservation plan method "${plan.method}" is neither cherry-pick nor reimplement`);
      if (!isNonEmptyString(plan.new_pr_requirement, 11)) push("preservation plan does not require a new PR and CI for the replacement");
    }
  },
  EVIDENCE_ONLY: {
    recommendation: "must_be_preserved",
    deletable: false,
    check: (entry, push) => {
      if (!isList(entry.preserve)) push("classified EVIDENCE_ONLY without naming the evidence it holds");
      const destination = entry.evidence_destination;
      if (!destination) return push("classified EVIDENCE_ONLY with no destination for the evidence");
      if (!["issue", "comment", "doc", "fixture", "commit"].includes(destination.kind)) push(`evidence destination "${destination.kind}" is not an issue, comment, doc, fixture or commit`);
      if (!isNonEmptyString(destination.locator, 3)) push("evidence destination does not say where");
      if (destination.migrated !== false && destination.migrated !== true) push("evidence destination does not record whether the migration has happened");
      if (destination.migrated === true && !SHA.test(destination.migrated_at_sha ?? "")) push("evidence is recorded as migrated without the commit that migrated it");
    }
  },
  ACTIVE: {
    recommendation: "must_be_preserved",
    deletable: false,
    check: (entry, push) => {
      if (!entry.open_pr) push("classified ACTIVE with no open PR and no active owner recorded");
    }
  },
  UNKNOWN_HOLD: {
    recommendation: "needs_decision",
    deletable: false,
    check: (entry, push) => {
      if (!entry.unestablished.some((item) => item.bearing_on_deletion === "blocks_deletion")) {
        push("classified UNKNOWN_HOLD without naming anything that blocks the decision");
      }
    }
  }
};

/**
 * Every remote head other than the excluded refs must be audited exactly once, at the commit that
 * was observed.
 *
 * With a live observation this is measured against what GitHub actually has; without one it can only
 * be measured against the audit's own snapshot, which is why the destructive path always supplies
 * one. A head present live and absent from the audit is a branch nobody decided about -- silence is
 * not coverage.
 */
export const auditCoverageFindings = (audit, live = null) => {
  const findings = [];
  const excluded = new Set(audit.excluded_refs ?? []);
  const snapshot = audit.ls_remote_snapshot ?? [];
  const target = new Set(snapshot.map((entry) => entry.name).filter((name) => !excluded.has(name)));

  const seen = new Map();
  for (const entry of audit.branches ?? []) {
    if (seen.has(entry.name)) findings.push(`${entry.name} is audited more than once`);
    seen.set(entry.name, entry);
  }
  for (const name of target) if (!seen.has(name)) findings.push(`${name} is in the ls-remote snapshot but is not audited`);
  for (const name of seen.keys()) if (!target.has(name)) findings.push(`${name} is audited but is not in the ls-remote snapshot`);

  for (const entry of snapshot) if (!SHA.test(entry.sha ?? "")) findings.push(`${entry.name}: ls-remote snapshot SHA is not a full SHA`);
  for (const name of excluded) {
    if (!snapshot.some((entry) => entry.name === name)) findings.push(`${name} is declared excluded but does not appear in the snapshot, so nobody can tell it was excluded rather than missed`);
  }

  // A name is not a ref. The audit's judgement is about the commit it read, so the entry has to name
  // the same commit the snapshot saw.
  const observed = new Map(snapshot.map((entry) => [entry.name, entry.sha]));
  for (const [name, entry] of seen) {
    if (!observed.has(name)) continue;
    if (entry.head_sha !== observed.get(name)) findings.push(`${name} is audited at ${entry.head_sha} but the snapshot observed it at ${observed.get(name)}`);
  }

  if (live) {
    // A branch may legitimately appear after the snapshot -- this audit is submitted from one. What
    // it may not do is appear by being written into a list. The exception is earned by being the
    // head of an open pull request in the observation: that is in-flight work someone is watching,
    // and it is the only reading of "created after the snapshot" that a later orphan cannot claim.
    const openPrHeads = new Set((live.open_prs ?? []).filter((pr) => pr.state === "OPEN").map((pr) => pr.head_branch));
    const excused = new Set();
    for (const entry of audit.heads_created_after_this_snapshot ?? []) {
      if (openPrHeads.has(entry.name)) excused.add(entry.name);
      if (!openPrHeads.has(entry.name)) findings.push(`${entry.name} is claimed as created after the snapshot but no open pull request has it as a head, so nothing accounts for it`);
    }
    const known = new Set([...target, ...excluded, ...excused]);
    for (const head of live.heads ?? []) {
      if (!known.has(head.name)) findings.push(`${head.name} exists on the live repository but appears nowhere in this audit`);
    }
    // Two transports, deliberately. One of them read twice would prove nothing.
    const rest = new Map((live.rest_heads ?? []).map((head) => [head.name, head.sha]));
    for (const head of live.heads ?? []) {
      if (!rest.has(head.name)) findings.push(`${head.name} was returned by git but not by the REST branch list`);
      else if (rest.get(head.name) !== head.sha) findings.push(`${head.name} is ${head.sha} over git and ${rest.get(head.name)} over REST`);
    }
    for (const name of rest.keys()) {
      if (!(live.heads ?? []).some((head) => head.name === name)) findings.push(`${name} was returned by the REST branch list but not by git`);
    }
  }
  return findings;
};

/**
 * A classification and a recommendation are two claims about the same branch, and they have to be
 * the same claim -- plus whatever that particular state is required to carry.
 */
export const classificationFindings = (audit) => {
  const findings = [];
  for (const entry of audit.branches ?? []) {
    const push = (message) => findings.push(`${entry.name}: ${message}`);
    if (!CLASSIFICATIONS.has(entry.classification)) {
      push(`unrecognized classification "${entry.classification}"`);
      continue;
    }
    if (!RECOMMENDATIONS.has(entry.recommendation)) {
      push(`unrecognized recommendation "${entry.recommendation}"`);
      continue;
    }
    if (!Array.isArray(entry.unestablished)) {
      push("does not record what it could not establish");
      continue;
    }

    const contract = CLASSIFICATION_CONTRACT[entry.classification];
    const deletable = entry.recommendation === "safe_to_delete_after_578";
    // One rule, not two. A state that may not be deleted fixes its recommendation, and that single
    // check is what refuses both "UNIQUE_WORK, safe to delete" and "UNIQUE_WORK, needs decision".
    if (contract.recommendation && entry.recommendation !== contract.recommendation) {
      push(`classified ${entry.classification} but recommended "${entry.recommendation}" rather than "${contract.recommendation}"`);
    }
    contract.check(entry, push);

    if (deletable && !isNonEmptyString(entry.reason, 21)) push("recommends deletion with no substantive reason");
    if (deletable && isList(entry.preserve)) push(`recommends deletion while naming ${entry.preserve.length} thing(s) that would be lost`);
    if (!Array.isArray(entry.preserve)) push("does not say what would be lost, so nobody can tell whether anything would be");
    if (!Array.isArray(entry.release_tags_containing)) push("does not record release-tag containment");
    if (typeof entry.unique_commits_vs_dev_and_main !== "number") push("does not record how many commits reach neither dev nor main, which is the count deletion actually turns on");
    if (!entry.references || typeof entry.references !== "object") push('records no reference scan, so "nothing refers to it" was never established');
    if (entry.open_pr && entry.classification !== "ACTIVE") push(`has open PR #${entry.open_pr.number} but is classified ${entry.classification}`);
  }
  return findings;
};

/**
 * Every graph fact a branch record asserts has to be one the collector actually ran.
 *
 * The failure this refuses is a record that says "0 commits unique against dev" beside a receipt
 * table that only ever listed the branch. A neighbouring query is not evidence for a derivation
 * nobody performed, so the numbers in the record are compared against the collector's own answers,
 * and each answer has to name a receipt the observation carries.
 */
export const derivationFindings = (audit, observation = audit?.live_observation) => {
  const findings = [];
  if (!observation) return ["the audit cites no observation, so nothing says where its branch facts came from"];
  const receiptSources = new Set((observation.receipts ?? []).map((receipt) => receipt.source));
  const derivations = observation.derivations ?? {};

  for (const entry of audit.branches ?? []) {
    const derived = derivations[entry.name];
    if (!derived) {
      findings.push(`${entry.name}: the observation derives nothing about it, so every fact recorded for it is unsourced`);
      continue;
    }
    for (const field of REQUIRED_DERIVATIONS) {
      const one = derived[field];
      if (!one) findings.push(`${entry.name}: no ${field} derivation`);
      if (one && !receiptSources.has(one.source)) findings.push(`${entry.name}: ${field} cites receipt "${one.source}", which the observation does not carry`);
    }
    const asserted = [
      ["merged_into_dev", entry.merged_into_dev, derived.ancestor_of_dev?.value],
      ["merged_into_main", entry.merged_into_main, derived.ancestor_of_main?.value],
      ["unique_commits_vs_dev", entry.unique_commits_vs_dev, derived.unique_vs_dev?.value],
      ["unique_commits_vs_main", entry.unique_commits_vs_main, derived.unique_vs_main?.value],
      ["unique_commits_vs_dev_and_main", entry.unique_commits_vs_dev_and_main, derived.unique_vs_dev_and_main?.value],
      ["behind_dev", entry.behind_dev, derived.behind_dev?.value],
      ["behind_main", entry.behind_main, derived.behind_main?.value],
      ["last_commit_date", entry.last_commit_date, derived.last_commit?.date]
    ];
    for (const [field, claimed, observed] of asserted) {
      if (claimed !== observed) findings.push(`${entry.name}: records ${field} as ${JSON.stringify(claimed)} but the collector derived ${JSON.stringify(observed)}`);
    }
    if (canonicalize(entry.release_tags_containing) !== canonicalize(derived.tags_containing?.value)) {
      findings.push(`${entry.name}: records release-tag containment the collector did not derive`);
    }
    if (canonicalize(entry.references?.tree_scan?.hits) !== canonicalize(derived.tree_scan?.value)) {
      findings.push(`${entry.name}: records a tree scan the collector did not run`);
    }
    // "No pull request ever used this branch as a head" is a claim about closed and merged pull
    // requests too, so it needs the all-state query rather than the open list.
    const openInHistory = (derived.pr_history?.value ?? []).filter((pr) => pr.state === "OPEN");
    if (entry.open_pr && !openInHistory.some((pr) => pr.number === entry.open_pr.number)) {
      findings.push(`${entry.name}: records open PR #${entry.open_pr.number}, which the collected PR history does not show`);
    }
    if (!entry.open_pr && openInHistory.length > 0) {
      findings.push(`${entry.name}: records no open PR, but the collected history shows #${openInHistory[0].number} open on it`);
    }
    // "No pull request ever used this branch as a head" is a claim about everything, so a history
    // read as a bounded slice does not support it: the pull request that was cut off looks exactly
    // like the one that never existed.
    if (derived.pr_history && derived.pr_history.complete !== true) {
      findings.push(`${entry.name}: the pull request history was read as a bounded slice, so no claim about its PR history rests on it`);
    }
    const sweep = (observation.reference_sweep ?? []).find((one) => one.branch === entry.name);
    if (!sweep) findings.push(`${entry.name}: no GitHub-wide reference sweep`);
    else if (sweep.complete !== true) findings.push(`${entry.name}: the reference sweep was truncated, so no reference claim rests on it`);
  }
  return findings;
};

/**
 * A fact the audit could not establish has to be named and then argued about. It either blocks
 * deletion, or the entry says in writing why it does not -- an assertion a reviewer can disagree
 * with. What it may never be is absent.
 */
export const unestablishedFindings = (audit) => {
  const findings = [];
  for (const entry of audit.branches ?? []) {
    if (!Array.isArray(entry.unestablished)) {
      findings.push(`${entry.name}: unestablished is not a list`);
      continue;
    }
    for (const item of entry.unestablished) {
      if (!isNonEmptyString(item.fact, 10)) {
        findings.push(`${entry.name}: an unestablished item does not say what could not be established`);
        continue;
      }
      if (item.bearing_on_deletion === "blocks_deletion") {
        if (entry.recommendation === "safe_to_delete_after_578") findings.push(`${entry.name}: "${item.fact}" blocks deletion, yet the branch reads as deletable`);
        continue;
      }
      if (item.bearing_on_deletion !== "none") {
        findings.push(`${entry.name}: "${item.fact}" records bearing_on_deletion "${item.bearing_on_deletion}", which is neither "none" nor "blocks_deletion"`);
        continue;
      }
      if (!isNonEmptyString(item.why_it_does_not_bear, 21)) findings.push(`${entry.name}: "${item.fact}" is dismissed as not bearing on deletion without saying why`);
    }
  }
  return findings;
};

/**
 * What the audit alone can say about deletion: a necessary condition, never a sufficient one.
 *
 * Nothing is eligible by default, and any finding anywhere removes the whole set rather than only
 * the entry that produced it. Authorization to actually delete is `deletionAuthorizationFindings`,
 * which needs a live observation this function does not have.
 */
export const deletionEligibility = (audit) => {
  const branches = audit.branches ?? [];
  const blocking = [...auditCoverageFindings(audit), ...classificationFindings(audit), ...unestablishedFindings(audit)];
  if (blocking.length > 0) return { eligible: [], ineligible: [...branches], findings: blocking };

  const eligible = [];
  const ineligible = [];
  for (const entry of branches) {
    const contentIsElsewhere =
      entry.classification === "MERGED"
        ? entry.merged_into_dev === true && entry.merged_into_main === true && entry.unique_commits_vs_dev === 0 && entry.unique_commits_vs_main === 0
        : entry.classification === "SUPERSEDED" && Boolean(entry.superseding);
    const holds =
      // Belt and braces at the destructive boundary. No test can reach past it today, because every
      // state with `deletable: false` also fixes a recommendation that is not the deletable one, so
      // it is deliberately not claimed as a mutation guard -- it is here so that a future state
      // added to the table without a fixed recommendation still cannot become eligible by default.
      CLASSIFICATION_CONTRACT[entry.classification].deletable === true &&
      entry.recommendation === "safe_to_delete_after_578" &&
      contentIsElsewhere &&
      entry.open_pr === null &&
      entry.branch_protected === false &&
      entry.preserve.length === 0 &&
      !entry.unestablished.some((item) => item.bearing_on_deletion !== "none");
    (holds ? eligible : ineligible).push(entry);
  }
  return { eligible, ineligible, findings: [] };
};

/**
 * The Phase A baseline's own consistency: does it record every invariant family the issue names, at
 * the state the snapshot it was taken from observed?
 *
 * This is deliberately not the deletion comparison. A baseline collected in Phase A describes a
 * repository that keeps moving, so comparing a Phase B result against it would report ordinary
 * progress as damage. `boundaryInvariantFindings` compares the two observations that actually
 * bracket the deletion; this function only establishes that the historical record is complete
 * enough to be worth keeping, and that its own numbers agree with its own snapshot.
 */
export const cleanupInvariantFindings = (audit, deletionLog) => {
  const findings = [];
  const baseline = audit.invariant_baseline;
  if (!baseline) return ["the audit records no pre-deletion invariant baseline"];

  const head = (name) => (audit.ls_remote_snapshot ?? []).find((entry) => entry.name === name)?.sha;
  if (!SHA.test(baseline.main_sha ?? "")) findings.push("baseline main SHA is not a full SHA");
  if (!SHA.test(baseline.dev_sha ?? "")) findings.push("baseline dev SHA is not a full SHA");
  if (baseline.main_sha !== head("main")) findings.push("baseline main SHA disagrees with the main entry in the ls-remote snapshot");
  if (baseline.dev_sha !== head("dev")) findings.push("baseline dev SHA disagrees with the dev entry in the ls-remote snapshot");

  if (!isList(baseline.tags)) findings.push("no baseline tag list to compare against after deletion");
  else {
    // Both halves of a tag's identity. `ref_sha` is what refs/tags/<name> points at -- for an
    // annotated tag that is the tag object, carrying the annotation and any signature. `commit_sha`
    // is what it peels to. Recording only the peeled commit would let a tag be replaced by a
    // different tag object over the same commit, which nothing would notice.
    for (const tag of baseline.tags) {
      if (!SHA.test(tag.ref_sha ?? "")) findings.push(`tag ${tag.name}: no baseline ref object id`);
      if (!SHA.test(tag.commit_sha ?? "")) findings.push(`tag ${tag.name}: no baseline commit id`);
    }
  }

  for (const ref of ["main", "dev"]) {
    const protection = baseline.protection?.[ref];
    if (!protection) findings.push(`no baseline protection recorded for ${ref}`);
    else {
      if (protection.allow_deletions?.enabled !== false) findings.push(`baseline does not record ${ref} as undeletable`);
      if (protection.allow_force_pushes?.enabled !== false) findings.push(`baseline does not record ${ref} as unforce-pushable`);
    }
  }
  if (!Array.isArray(baseline.rulesets)) findings.push("no baseline ruleset list");
  if (!isList(baseline.install_source?.files)) findings.push("the baseline does not record the stable plugin/install source, so nothing can say it is unchanged");
  else {
    for (const path of INSTALL_SOURCE_FILES) {
      const recorded = baseline.install_source.files.find((file) => file.path === path);
      if (!recorded) findings.push(`the install source baseline does not cover ${path}`);
      else if (!DIGEST.test(recorded.digest ?? "")) findings.push(`${path}: install-source baseline records no digest`);
    }
  }
  if (!Array.isArray(baseline.open_pr_heads)) findings.push("no baseline list of open PR heads");

  const recordedOpenHeads = new Set((baseline.open_pr_heads ?? []).map((entry) => entry.branch));
  for (const entry of audit.branches ?? []) {
    if (entry.open_pr && !recordedOpenHeads.has(entry.name)) findings.push(`${entry.name} is the head of open PR #${entry.open_pr.number} but is not in the baseline list of open PR heads`);
  }

  return findings;
};

/**
 * The invariants #572 lists, compared across the deletion itself.
 *
 * The comparison pair is two independently collected observations -- one taken immediately before
 * the deletion and one immediately after -- and not the Phase A baseline. That baseline is a
 * snapshot of a repository that goes on moving: comparing a Phase B post-state against it reports
 * every legitimate advance of `dev` as "dev moved across the deletion", which is both a false alarm
 * and, worse, an invariant nobody can satisfy honestly. The baseline stays in the audit as
 * historical context; the boundary pair is what decides.
 *
 * It also decides the other direction. The set of heads that disappeared between the two
 * observations has to be exactly the set the log says it deleted -- so a deletion that took one
 * extra ref with it is a finding, and a log that claims a deletion which did not happen is too.
 */
export const boundaryInvariantFindings = (deletionLog, pre, post) => {
  const findings = [];
  if (!pre) findings.push("no pre-deletion observation was collected, so nothing records the state the deletion started from");
  if (!post) findings.push("no post-deletion observation was collected, so the log's account of the state afterwards is its own");
  if (!pre || !post) return findings;

  findings.push(...verifyObservation(pre).map((finding) => `pre-deletion observation: ${finding}`));
  findings.push(...verifyObservation(post).map((finding) => `post-deletion observation: ${finding}`));

  const head = (observation, name) => (observation.heads ?? []).find((one) => one.name === name)?.sha;
  for (const ref of ["main", "dev"]) {
    if (head(pre, ref) !== head(post, ref)) findings.push(`${ref} moved across the deletion: ${head(pre, ref)} -> ${head(post, ref)}`);
  }

  const before = new Map((pre.tags ?? []).map((tag) => [tag.name, tag]));
  for (const tag of post.tags ?? []) {
    const was = before.get(tag.name);
    if (!was) {
      findings.push(`tag ${tag.name} appeared across the deletion`);
      continue;
    }
    if (was.ref_sha !== tag.ref_sha) findings.push(`tag ${tag.name} was replaced across the deletion: its ref pointed at ${was.ref_sha} and now points at ${tag.ref_sha}`);
    if (was.commit_sha !== tag.commit_sha) findings.push(`tag ${tag.name} moved across the deletion`);
  }
  for (const name of before.keys()) {
    if (!(post.tags ?? []).some((tag) => tag.name === name)) findings.push(`tag ${name} disappeared across the deletion`);
  }

  for (const ref of ["main", "dev"]) {
    if (contentDigest(pre.protection?.[ref] ?? null) !== contentDigest(post.protection?.[ref] ?? null)) findings.push(`${ref} protection changed across the deletion`);
  }
  if (contentDigest(pre.rulesets ?? []) !== contentDigest(post.rulesets ?? [])) findings.push("the repository's ruleset configuration changed across the deletion");
  if (contentDigest(pre.install_source) !== contentDigest(post.install_source)) findings.push("the stable plugin/install source changed across the deletion");
  if (contentDigest(pre.settings) !== contentDigest(post.settings)) findings.push("the repository settings changed across the deletion");

  const stillOpen = new Map((post.open_prs ?? []).map((pr) => [pr.number, pr]));
  for (const pr of pre.open_prs ?? []) {
    const after = stillOpen.get(pr.number);
    if (!after) findings.push(`open PR #${pr.number} (${pr.head_branch}) is gone after the deletion`);
    if (after && after.head_sha !== pr.head_sha) findings.push(`the head of open PR #${pr.number} (${pr.head_branch}) moved across the deletion`);
  }
  const postHeads = new Set((post.heads ?? []).map((one) => one.name));
  for (const pr of post.open_prs ?? []) {
    if (!postHeads.has(pr.head_branch)) findings.push(`open PR #${pr.number} has no head branch after the deletion: ${pr.head_branch} is gone`);
  }

  // Exactly what the log says was deleted, and nothing else.
  const vanished = new Set((pre.heads ?? []).map((one) => one.name).filter((name) => !postHeads.has(name)));
  const claimed = new Set((deletionLog?.deleted ?? []).map((one) => one.name));
  for (const name of vanished) if (!claimed.has(name)) findings.push(`${name} disappeared across the deletion but the log does not say it was deleted`);
  for (const name of claimed) if (!vanished.has(name)) findings.push(`the log says ${name} was deleted but it is still on the repository afterwards`);
  return findings;
};

/**
 * Whether Phase B may start at all, read from the canonical snapshot rather than from anything the
 * deletion record says about itself.
 *
 * Split out because two callers need the same answer: the log check, and the runner, which has to
 * know before it deletes anything rather than after.
 */
export const prerequisiteFindings = (completion) => {
  if (!completion) return ["no canonical issue-state snapshot was available to check the prerequisites against"];
  const findings = [];
  const byNumber = new Map((completion.issues ?? []).map((issue) => [issue.number, issue]));
  for (const issue of DELETION_BLOCKED_BY) {
    const canonical = byNumber.get(issue);
    if (!canonical) {
      findings.push(`the canonical issue-state snapshot has no record of #${issue}, so nothing says it cleared`);
      continue;
    }
    if (canonical.state !== "closed") findings.push(`#${issue} is ${canonical.state} in the canonical issue-state snapshot, so Phase B is still blocked`);
    if (!canonical.close_evidence) findings.push(`#${issue} has no close evidence in the canonical issue-state snapshot`);
  }
  return findings;
};

/** The canonical record of which issues are finished. Read, never restated. */
export const loadCompletionSnapshot = (url = new URL("../fixtures/execution-plan/github-state.json", import.meta.url)) =>
  JSON.parse(readFileSync(url, "utf8"));

/**
 * The deletion log's own shape, and the prerequisite it may not clear for itself.
 *
 * While Phase B is blocked the log says so and lists nothing. Once it claims completion, #578 and
 * #588 have to be closed in the canonical execution-plan snapshot -- the log's own account of them
 * is cross-checked against that authority rather than believed. A completed log with an empty
 * deletion list is legitimate: "delete only what a fresh audit finds eligible" is satisfied by a
 * fresh audit that finds nothing, which this repository's auto-delete setting makes ordinary.
 */
export const deletionLogFindings = (log, { completion = null } = {}) => {
  const findings = [];
  if (!log) return ["there is no deletion log"];
  if (log.schema !== "aos-branch-deletion-log.v1") findings.push(`unrecognized deletion log schema "${log.schema}"`);
  if (!Array.isArray(log.deleted)) return [...findings, "the deletion log has no list of deletions"];

  if (log.status === "NOT_YET") {
    if (log.deleted.length > 0) findings.push("the deletion log says NOT_YET but lists deletions");
    if (log.pre_observation || log.post_observation) findings.push("the deletion log says NOT_YET but cites deletion-boundary observations");
    const blockers = new Set(log.blocked_by ?? []);
    for (const issue of DELETION_BLOCKED_BY) if (!blockers.has(issue)) findings.push(`the deletion log is NOT_YET but does not record #${issue} as blocking it`);
    if (!isNonEmptyString(log.note, 21)) findings.push("the deletion log is NOT_YET but does not say why nothing was deleted");
    return findings;
  }

  if (log.status !== "COMPLETED") return [...findings, `unrecognized deletion log status "${log.status}"`];

  // Not "did you write down a post-state" -- that was the log vouching for itself. The log names the
  // digests of two observations collected outside it, and the gate is handed those observations.
  for (const field of ["pre_observation", "post_observation"]) {
    if (!DIGEST.test(log[field]?.digest ?? "")) findings.push(`the deletion log says COMPLETED without citing a ${field.replace("_", "-")} digest`);
  }
  if (!INSTANT.test(log.completed_at ?? "")) findings.push("the deletion log says COMPLETED without a well-formed instant saying when");
  for (const entry of log.deleted) if (!SHA.test(entry.sha ?? "")) findings.push(`${entry.name}: deleted without recording the SHA it pointed at`);
  if (log.deleted.length === 0 && log.no_op_reason === undefined) findings.push("the deletion log says COMPLETED and deleted nothing without saying why nothing was eligible");
  if (log.deleted.length === 0 && log.no_op_reason !== undefined && !isNonEmptyString(log.no_op_reason, 21)) {
    findings.push("the deletion log says nothing was eligible without a substantive reason");
  }

  // The prerequisite is not the log's to clear. Free text saying #578 passed was accepted before,
  // which made "only after #578" a sentence rather than a condition.
  if (!completion) return [...findings, "the deletion log claims completion but no canonical issue-state snapshot was supplied to check its prerequisites against"];
  findings.push(...prerequisiteFindings(completion));
  const byNumber = new Map((completion.issues ?? []).map((issue) => [issue.number, issue]));
  const claimed = new Map((log.blockers_cleared ?? []).map((entry) => [entry.issue, entry]));
  for (const issue of DELETION_BLOCKED_BY) {
    const canonical = byNumber.get(issue);
    if (!canonical) continue;
    const claim = claimed.get(issue);
    if (!claim) findings.push(`the deletion log does not record #${issue} among the blockers it cleared`);
    else if (claim.canonical_state && claim.canonical_state !== canonical.state) {
      findings.push(`the deletion log says #${issue} was ${claim.canonical_state} while the canonical snapshot says ${canonical.state}`);
    }
  }
  return findings;
};

/**
 * The prohibition that cannot be walked back, on the stored side.
 *
 * A deletion may only name a branch this audit covered, found eligible, and judged at that exact
 * commit. This is still only the stored half -- `deletionAuthorizationFindings` is what asks GitHub.
 */
export const openPrHeadDeletionFindings = (audit, deletionLog) => {
  const findings = [];
  const byName = new Map((audit.branches ?? []).map((entry) => [entry.name, entry]));
  const { eligible } = deletionEligibility(audit);
  const eligibleNames = new Set(eligible.map((entry) => entry.name));

  for (const deleted of deletionLog?.deleted ?? []) {
    const entry = byName.get(deleted.name);
    if (!entry) {
      findings.push(`${deleted.name} was deleted but this audit never covered it`);
      continue;
    }
    if (entry.open_pr) findings.push(`${deleted.name} was deleted while PR #${entry.open_pr.number} was open on it`);
    if (!eligibleNames.has(deleted.name)) findings.push(`${deleted.name} was deleted without being deletion-eligible in this audit`);
    if (deleted.sha !== entry.head_sha) findings.push(`${deleted.name} was deleted at ${deleted.sha}, but this audit judged it at ${entry.head_sha}`);
  }

  for (const entry of audit.branches ?? []) {
    if (entry.open_pr && eligibleNames.has(entry.name)) findings.push(`${entry.name} is the head of open PR #${entry.open_pr.number} and is nevertheless deletion-eligible`);
  }
  return findings;
};

/**
 * The destructive gate. Everything above is necessary; this is what authorizes.
 *
 * It takes the two observations that bracket the deletion. `pre` is collected immediately before and
 * decides every fact the deletion turns on -- the ref still exists at the commit being deleted, no
 * pull request is open on it *now* -- because a stored snapshot cannot see a pull request opened
 * five minutes after it was written. `post` is collected immediately after and is what makes the
 * invariants checkable at all; without it, "nothing else changed" is the deleting party's own word.
 *
 * Both are refused when absent. Both must be bound by digest to the record citing them, and the
 * record's instant must fall between them.
 */
export const deletionAuthorizationFindings = ({ audit, log, pre = null, post = null, completion = null, maxAgeSeconds = OBSERVATION_MAX_AGE_SECONDS } = {}) => {
  const findings = [
    ...auditCoverageFindings(audit, pre),
    ...derivationFindings(audit),
    ...deletionLogFindings(log, { completion }),
    ...cleanupInvariantFindings(audit, log),
    ...openPrHeadDeletionFindings(audit, log)
  ];

  if (!pre) return [...findings, "no pre-deletion observation was supplied, so no deletion can be authorized from stored facts alone"];
  findings.push(...verifyObservation(pre).map((finding) => `pre-deletion observation: ${finding}`));
  if (observationDigest(pre) !== log?.pre_observation?.digest) {
    findings.push("the deletion record does not cite the digest of the pre-deletion observation it was checked against");
  }

  const collected = instantSeconds(pre.collected_at);
  const completed = instantSeconds(log?.completed_at);
  if (collected === null) findings.push("the pre-deletion observation records no well-formed collection instant");

  if (log?.status === "COMPLETED") {
    if (completed === null) findings.push("the deletion log claims completion without a well-formed instant saying when");
    else if (collected !== null) {
      if (collected > completed) findings.push("the pre-deletion observation was collected after the deletion it is supposed to authorize");
      if (collected <= completed && completed - collected > maxAgeSeconds) findings.push(`the pre-deletion observation was ${Math.round(completed - collected)}s old when the deletion ran, past the ${maxAgeSeconds}s this gate allows`);
    }

    if (!post) findings.push("the deletion log claims completion but no post-deletion observation was supplied, so the invariants cannot be checked");
    else {
      if (observationDigest(post) !== log?.post_observation?.digest) {
        findings.push("the deletion record does not cite the digest of the post-deletion observation");
      }
      const recollected = instantSeconds(post.collected_at);
      if (recollected === null) findings.push("the post-deletion observation records no well-formed collection instant");
      if (recollected !== null && completed !== null) {
        if (recollected < completed) findings.push("the post-deletion observation was collected before the deletion it is supposed to witness");
        if (recollected >= completed && recollected - completed > maxAgeSeconds) findings.push(`the post-deletion observation was taken ${Math.round(recollected - completed)}s after the deletion, past the ${maxAgeSeconds}s this gate allows`);
      }
      findings.push(...boundaryInvariantFindings(log, pre, post));
    }
  }

  const liveHeads = new Map((pre.heads ?? []).map((head) => [head.name, head.sha]));
  const openPrByBranch = new Map((pre.open_prs ?? []).filter((pr) => pr.state === "OPEN").map((pr) => [pr.head_branch, pr]));
  for (const deleted of log?.deleted ?? []) {
    if (!liveHeads.has(deleted.name)) findings.push(`${deleted.name} was deleted but the pre-deletion observation does not show it on the repository`);
    if (liveHeads.has(deleted.name) && liveHeads.get(deleted.name) !== deleted.sha) findings.push(`${deleted.name} was deleted at ${deleted.sha} but live it points at ${liveHeads.get(deleted.name)}`);
    const pr = openPrByBranch.get(deleted.name);
    if (pr) findings.push(`${deleted.name} was deleted while PR #${pr.number} was open on it live, whatever the stored audit says`);
  }

  // A pull request opened on an eligible branch after the audit was written makes it ineligible now.
  for (const entry of deletionEligibility(audit).eligible) {
    const pr = openPrByBranch.get(entry.name);
    if (pr) findings.push(`${entry.name} reads as eligible in the audit but PR #${pr.number} is open on it live`);
  }
  return findings;
};

/**
 * The entry point Phase B calls, and the reason it takes neither an observation nor a collector.
 *
 * The previous version accepted `collect` and `post`, which meant the trusted-collection boundary
 * could be stepped around from outside: an injected collector supplied the pre-observation and a
 * parameter supplied the post-observation, and a deletion authorized itself with two records the
 * deleting party had composed. Recollecting one side and accepting the other closes nothing, because
 * the invariants are a comparison and a comparison is only as trustworthy as its worse operand.
 *
 * So this function has no parameter through which state reaches a decision. It loads the canonical
 * prerequisite snapshot, collects the observation before the deletion, decides what may be deleted,
 * calls `perform` with exactly that list, collects the observation after, and emits the record. The
 * caller supplies the action, never the evidence, and never the account of what the action did.
 *
 * `perform` is called only if nothing is outstanding. If it throws, the post-observation is still
 * collected and the boundary still checked, because a deletion that failed halfway has still changed
 * the repository and the question of what it changed is the same question.
 */
const runner = (collect, loadCompletion = loadCompletionSnapshot) => ({ audit, perform, repository, cwd } = {}) => {
  const completion = loadCompletion();
  const target = { repository: repository ?? audit?.repository, cwd };

  const blocked = prerequisiteFindings(completion);
  if (blocked.length > 0) return { authorized: false, deleted: [], findings: blocked, log: null };

  let pre;
  try {
    pre = collect(target);
  } catch (error) {
    return { authorized: false, deleted: [], findings: [`the pre-deletion observation could not be collected, so nothing is authorized: ${error.message}`], log: null };
  }
  pre.digest = observationDigest(pre);

  const before = [
    ...verifyObservation(pre).map((finding) => `pre-deletion observation: ${finding}`),
    ...auditCoverageFindings(audit, pre),
    ...derivationFindings(audit),
    ...classificationFindings(audit),
    ...unestablishedFindings(audit)
  ];
  if (before.length > 0) return { authorized: false, deleted: [], findings: before, log: null };

  // What may go: eligible in the audit, and still true of the repository as it is right now.
  const liveHeads = new Map((pre.heads ?? []).map((head) => [head.name, head.sha]));
  const openPrByBranch = new Map((pre.open_prs ?? []).filter((pr) => pr.state === "OPEN").map((pr) => [pr.head_branch, pr]));
  const deleted = deletionEligibility(audit).eligible
    .filter((entry) => liveHeads.get(entry.name) === entry.head_sha && !openPrByBranch.has(entry.name))
    .map((entry) => ({ name: entry.name, sha: entry.head_sha }));

  let performError = null;
  try {
    if (perform) perform(deleted);
  } catch (error) {
    performError = error;
  }
  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");

  let post;
  try {
    post = collect(target);
  } catch (error) {
    return {
      authorized: false,
      deleted,
      findings: [`the deletion ran but the post-deletion observation could not be collected, so its effect is unrecorded: ${error.message}`],
      log: null
    };
  }
  post.digest = observationDigest(post);

  const log = {
    schema: "aos-branch-deletion-log.v1",
    status: "COMPLETED",
    completed_at: completedAt,
    blocked_by: [...DELETION_BLOCKED_BY],
    blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed" })),
    deleted,
    ...(deleted.length === 0
      ? { no_op_reason: "a fresh audit found no ref eligible for deletion at the commit it judged, with no pull request open on it" }
      : {}),
    pre_observation: { digest: pre.digest, collected_at: pre.collected_at },
    post_observation: { digest: post.digest, collected_at: post.collected_at },
    note: "Emitted by scripts/branch-audit.mjs runDeletion; both observations were collected by the gate, not supplied to it."
  };

  const findings = [
    ...(performError ? [`the deletion did not complete: ${performError.message}`] : []),
    ...deletionAuthorizationFindings({ audit, log, pre, post, completion })
  ];
  return { authorized: findings.length === 0, deleted, findings, log };
};

/**
 * The gate. No `collect`, no `pre`, no `post`, no `completion`, no `maxAgeSeconds` -- passing any of
 * them has no effect, which is the property the tests assert rather than describe.
 */
export const runDeletion = runner(collectLive);

/**
 * The seam, and the only thing that can substitute the two sources the gate reads: the collector and
 * the canonical prerequisite snapshot.
 *
 * It exists because the orchestration above -- check, collect, decide, act, recollect, compare --
 * has to be exercised offline, and there is no honest way to do that against a live repository from
 * a test suite. Both substitutions are made once, when a runner is built, and neither is reachable
 * from a call to one. A caller who builds their own runner is not stepping around the gate; they are
 * declining to use it, which is a different thing and visible in the code that does it. What the
 * gate itself exposes is nothing.
 */
export const makeDeletionRunner = runner;
