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

import { sha256Bytes } from "../lib/digest.mjs";
import { observationDigest, INSTALL_SOURCE_FILES, OBSERVATION_SCHEMA } from "./collect-branch-state.mjs";

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

/** Key-ordered JSON, so two structurally equal objects compare equal whatever order they were built in. */
export const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const contentDigest = (value) => sha256Bytes(Buffer.from(canonicalize(value), "utf8"));

// Epoch seconds from the shape the regex already accepted, computed rather than parsed: a lenient
// parser would quietly accept instants this gate's freshness window is not written for.
const instantSeconds = (value) => {
  const parts = INSTANT.exec(value ?? "");
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = value.split(/[-T:Z]/u).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
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
    const known = new Set([...target, ...excluded, ...(audit.heads_created_after_this_snapshot ?? []).map((entry) => entry.name)]);
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
 * The invariants #572 lists across a deletion.
 *
 * Compared as canonicalized content, not as a projection or a count: three booleans out of a twelve
 * field protection object cannot report that a fourth changed, and two rulesets of equal length are
 * not the same two rulesets.
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

  const after = deletionLog?.post_delete_state;
  if (after) {
    if (after.main_sha !== baseline.main_sha) findings.push("main moved across the deletion");
    if (after.dev_sha !== baseline.dev_sha) findings.push("dev moved across the deletion");

    const before = new Map((baseline.tags ?? []).map((tag) => [tag.name, tag]));
    for (const tag of after.tags ?? []) {
      const was = before.get(tag.name);
      if (!was) {
        findings.push(`tag ${tag.name} appeared across the deletion`);
        continue;
      }
      if (was.ref_sha !== tag.ref_sha) findings.push(`tag ${tag.name} was replaced across the deletion: its ref pointed at ${was.ref_sha} and now points at ${tag.ref_sha}`);
      if (was.commit_sha !== tag.commit_sha) findings.push(`tag ${tag.name} moved across the deletion`);
    }
    for (const name of before.keys()) {
      if (!(after.tags ?? []).some((tag) => tag.name === name)) findings.push(`tag ${name} disappeared across the deletion`);
    }

    if (!after.protection) findings.push("the post-delete state does not report branch protection, so nothing can say it is unchanged");
    else {
      for (const ref of ["main", "dev"]) {
        const was = contentDigest(baseline.protection?.[ref] ?? null);
        const now = contentDigest(after.protection?.[ref] ?? null);
        if (was !== now) findings.push(`${ref} protection changed across the deletion`);
      }
    }
    if (!Array.isArray(after.rulesets)) findings.push("the post-delete state does not report rulesets");
    else if (contentDigest(after.rulesets) !== contentDigest(baseline.rulesets ?? [])) findings.push("the repository's ruleset configuration changed across the deletion");

    if (!after.install_source) findings.push("the post-delete state does not report the stable plugin/install source");
    else if (contentDigest(after.install_source) !== contentDigest(baseline.install_source)) findings.push("the stable plugin/install source changed across the deletion");

    if (!Array.isArray(after.open_pr_heads)) findings.push("the post-delete state does not report the open PR heads, which is the one thing a deletion must not touch");
    else {
      const still = new Map(after.open_pr_heads.map((entry) => [entry.branch, entry.sha]));
      for (const entry of baseline.open_pr_heads ?? []) {
        if (!still.has(entry.branch)) findings.push(`the head of open PR #${entry.pr} (${entry.branch}) is gone after the deletion`);
        else if (still.get(entry.branch) !== entry.sha) findings.push(`the head of open PR #${entry.pr} (${entry.branch}) moved across the deletion`);
      }
    }
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
    if (log.post_delete_state !== null && log.post_delete_state !== undefined) findings.push("the deletion log says NOT_YET but carries a post-delete state");
    const blockers = new Set(log.blocked_by ?? []);
    for (const issue of DELETION_BLOCKED_BY) if (!blockers.has(issue)) findings.push(`the deletion log is NOT_YET but does not record #${issue} as blocking it`);
    if (!isNonEmptyString(log.note, 21)) findings.push("the deletion log is NOT_YET but does not say why nothing was deleted");
    return findings;
  }

  if (log.status !== "COMPLETED") return [...findings, `unrecognized deletion log status "${log.status}"`];

  if (!log.post_delete_state) findings.push("the deletion log says COMPLETED without reading the post-delete state back");
  for (const entry of log.deleted) if (!SHA.test(entry.sha ?? "")) findings.push(`${entry.name}: deleted without recording the SHA it pointed at`);
  if (log.deleted.length === 0 && log.no_op_reason === undefined) findings.push("the deletion log says COMPLETED and deleted nothing without saying why nothing was eligible");
  if (log.deleted.length === 0 && log.no_op_reason !== undefined && !isNonEmptyString(log.no_op_reason, 21)) {
    findings.push("the deletion log says nothing was eligible without a substantive reason");
  }

  // The prerequisite is not the log's to clear. Free text saying #578 passed was accepted before,
  // which made "only after #578" a sentence rather than a condition.
  if (!completion) return [...findings, "the deletion log claims completion but no canonical issue-state snapshot was supplied to check its prerequisites against"];
  const byNumber = new Map((completion.issues ?? []).map((issue) => [issue.number, issue]));
  const claimed = new Map((log.blockers_cleared ?? []).map((entry) => [entry.issue, entry]));
  for (const issue of DELETION_BLOCKED_BY) {
    const canonical = byNumber.get(issue);
    if (!canonical) {
      findings.push(`the canonical issue-state snapshot has no record of #${issue}, so nothing says it cleared`);
      continue;
    }
    if (canonical.state !== "closed") findings.push(`#${issue} is ${canonical.state} in the canonical issue-state snapshot, so Phase B is still blocked`);
    if (!canonical.close_evidence) findings.push(`#${issue} has no close evidence in the canonical issue-state snapshot`);
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
 * It refuses without a live observation, and every fact it decides on comes from that observation
 * rather than from the audit: the ref still exists at the commit being deleted, no pull request is
 * open on it *now*, and the observation is recent enough and bound by digest to the record citing
 * it. A pull request opened five minutes after the audit was written is invisible to a stored
 * snapshot and visible here, which is the entire reason the parameter exists.
 */
export const deletionAuthorizationFindings = ({ audit, log, live = null, completion = null, maxAgeSeconds = OBSERVATION_MAX_AGE_SECONDS } = {}) => {
  const findings = [
    ...auditCoverageFindings(audit, live),
    ...deletionLogFindings(log, { completion }),
    ...cleanupInvariantFindings(audit, log),
    ...openPrHeadDeletionFindings(audit, log)
  ];

  if (!live) return [...findings, "no live observation was supplied, so no deletion can be authorized from stored facts alone"];
  if (live.schema !== OBSERVATION_SCHEMA) findings.push(`the supplied observation is "${live.schema}", not ${OBSERVATION_SCHEMA}`);
  if (!isList(live.receipts)) findings.push("the live observation carries no command receipts, so nothing says where its facts came from");
  if (observationDigest(live) !== log?.live_observation?.digest) {
    findings.push("the deletion record does not cite the digest of the observation it was checked against");
  }

  const collected = instantSeconds(live.collected_at);
  const completed = instantSeconds(log?.completed_at);
  if (collected === null) findings.push("the live observation records no collection instant");
  if (log?.status === "COMPLETED") {
    if (completed === null) findings.push("the deletion log claims completion without recording when");
    else if (collected !== null) {
      if (collected > completed) findings.push("the live observation was collected after the deletion it is supposed to authorize");
      if (collected <= completed && completed - collected > maxAgeSeconds) findings.push(`the live observation was ${Math.round(completed - collected)}s old when the deletion ran, past the ${maxAgeSeconds}s this gate allows`);
    }
  }

  const liveHeads = new Map((live.heads ?? []).map((head) => [head.name, head.sha]));
  const openPrByBranch = new Map((live.open_prs ?? []).filter((pr) => pr.state === "OPEN").map((pr) => [pr.head_branch, pr]));
  for (const deleted of log?.deleted ?? []) {
    if (!liveHeads.has(deleted.name)) findings.push(`${deleted.name} was deleted but the live observation does not show it on the repository`);
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
