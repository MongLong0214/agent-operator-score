// Reading a stale-branch audit as a gate rather than as a note.
//
// #572 exists because a branch is the last copy of some work often enough that deleting one on a
// hunch is how a repository loses something. So the audit is a committed record, and this module is
// what refuses to let that record read as permission. The rule it enforces is narrow and mechanical:
// a branch may be deletion-eligible only when the audit itself demonstrates that nothing on it is
// unique to it -- contained in both `dev` and `main`, zero commits either lacks -- with no pull
// request open on it, no branch protection, and nothing the audit admits it could not establish that
// bears on the decision.
//
// Every other outcome fails closed. A classification this module does not recognize, a missing
// field, an empty reason, an unestablished fact with no argument attached: each of those makes a
// branch ineligible, never eligible. That direction matters more than the individual checks -- an
// audit that cannot answer a question has not answered it "yes".
//
// The deletion log is checked separately and against the audit, because the two failures are
// different. An audit that marks the wrong branch deletable is a bad judgement; a log that names a
// branch the audit never covered is a deletion nobody reviewed at all.

/** The six states #572 classifies a branch into. Anything else is not a classification. */
export const CLASSIFICATIONS = new Set(["MERGED", "SUPERSEDED", "UNIQUE_WORK", "EVIDENCE_ONLY", "ACTIVE", "UNKNOWN_HOLD"]);

/** The only classifications whose content is provably elsewhere, so deletion can lose nothing. */
const DELETABLE_CLASSIFICATIONS = new Set(["MERGED", "SUPERSEDED"]);

/** Recommendations carried forward from the first snapshot of this fixture, unchanged. */
export const RECOMMENDATIONS = new Set(["safe_to_delete_after_578", "needs_decision", "must_be_preserved"]);

/** The issues that gate Phase B. Both, not either: #578 preserves evidence, #588 confirms it. */
export const DELETION_BLOCKED_BY = [578, 588];

const SHA = /^[0-9a-f]{40}$/u;

const isNonEmptyString = (value, min = 1) => typeof value === "string" && value.trim().length >= min;

/**
 * Every remote head other than the excluded refs must be audited exactly once. Silence is not
 * coverage: a branch nobody wrote down is a branch nobody decided about.
 */
export const auditCoverageFindings = (audit) => {
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

  // A name is not a ref. The audit's judgement is about the commit it read, so the entry has to
  // name the same commit the snapshot saw -- otherwise the audited facts and the branch that would
  // actually be deleted are two different things, and a branch that advanced past the snapshot
  // inherits a verdict nobody formed about it.
  const observed = new Map(snapshot.map((entry) => [entry.name, entry.sha]));
  for (const [name, entry] of seen) {
    if (!observed.has(name)) continue;
    if (entry.head_sha !== observed.get(name)) {
      findings.push(`${name} is audited at ${entry.head_sha} but the snapshot observed it at ${observed.get(name)}`);
    }
  }

  for (const entry of snapshot) {
    if (!SHA.test(entry.sha ?? "")) findings.push(`${entry.name}: ls-remote snapshot SHA is not a full SHA`);
  }
  for (const name of excluded) {
    if (!snapshot.some((entry) => entry.name === name)) findings.push(`${name} is declared excluded but does not appear in the snapshot, so nobody can tell it was excluded rather than missed`);
  }
  return findings;
};

/**
 * A classification and a recommendation are two claims about the same branch, and they have to be
 * the same claim. Only MERGED and SUPERSEDED may read as deletable, and even then only when the
 * containment numbers back it up.
 */
export const classificationFindings = (audit) => {
  const findings = [];
  for (const entry of audit.branches ?? []) {
    if (!CLASSIFICATIONS.has(entry.classification)) {
      findings.push(`${entry.name}: unrecognized classification "${entry.classification}"`);
      continue;
    }
    if (!RECOMMENDATIONS.has(entry.recommendation)) {
      findings.push(`${entry.name}: unrecognized recommendation "${entry.recommendation}"`);
      continue;
    }
    const deletable = entry.recommendation === "safe_to_delete_after_578";
    if (deletable && !DELETABLE_CLASSIFICATIONS.has(entry.classification)) {
      findings.push(`${entry.name}: classified ${entry.classification} but recommended for deletion`);
    }
    if (entry.classification === "ACTIVE" && entry.recommendation !== "must_be_preserved") {
      findings.push(`${entry.name}: classified ACTIVE but recommended "${entry.recommendation}"`);
    }
    if (entry.classification === "UNKNOWN_HOLD" && entry.recommendation !== "needs_decision") {
      findings.push(`${entry.name}: classified UNKNOWN_HOLD but recommended "${entry.recommendation}"`);
    }
    if (DELETABLE_CLASSIFICATIONS.has(entry.classification) && !(entry.merged_into_dev === true && entry.merged_into_main === true)) {
      findings.push(`${entry.name}: classified ${entry.classification} without being contained in both dev and main`);
    }
    if (entry.classification === "SUPERSEDED" && !entry.superseding) {
      findings.push(`${entry.name}: classified SUPERSEDED with nothing recorded that supersedes it`);
    }
    if (deletable && !isNonEmptyString(entry.reason, 21)) {
      findings.push(`${entry.name}: recommends deletion with no substantive reason`);
    }
    // The `preserve` list is the audit's own answer to "what would be lost". A non-empty answer and
    // a deletion recommendation cannot both be right, and #572 exists because deleting over an
    // unmigrated answer is the loss it is written to prevent.
    if (deletable && Array.isArray(entry.preserve) && entry.preserve.length > 0) {
      findings.push(`${entry.name}: recommends deletion while naming ${entry.preserve.length} thing(s) that would be lost`);
    }
    if (!Array.isArray(entry.preserve)) {
      findings.push(`${entry.name}: does not say what would be lost, so nobody can tell whether anything would be`);
    }
    if (!Array.isArray(entry.release_tags_containing)) {
      findings.push(`${entry.name}: does not record release-tag containment`);
    }
    if (!entry.references || typeof entry.references !== "object") {
      findings.push(`${entry.name}: records no reference scan, so "nothing refers to it" was never established`);
    }
  }
  return findings;
};

/**
 * A fact the audit could not establish has to be named and then argued about. It either blocks
 * deletion, or the entry says in writing why it does not bear on deletion -- an assertion a
 * reviewer can disagree with. What it may never be is absent.
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
        if (entry.recommendation === "safe_to_delete_after_578") {
          findings.push(`${entry.name}: "${item.fact}" blocks deletion, yet the branch reads as deletable`);
        }
        continue;
      }
      if (item.bearing_on_deletion !== "none") {
        findings.push(`${entry.name}: "${item.fact}" records bearing_on_deletion "${item.bearing_on_deletion}", which is neither "none" nor "blocks_deletion"`);
        continue;
      }
      if (!isNonEmptyString(item.why_it_does_not_bear, 21)) {
        findings.push(`${entry.name}: "${item.fact}" is dismissed as not bearing on deletion without saying why`);
      }
    }
  }
  return findings;
};

/**
 * Partition the audited branches into what may be deleted in Phase B and what may not. Nothing is
 * eligible by default: an entry earns eligibility by satisfying every condition, and any finding
 * anywhere in the audit removes the whole set from consideration rather than only the entry that
 * produced it -- an audit with a broken invariant is not a document to delete branches from.
 */
export const deletionEligibility = (audit) => {
  const branches = audit.branches ?? [];
  const blocking = [...auditCoverageFindings(audit), ...classificationFindings(audit), ...unestablishedFindings(audit)];
  if (blocking.length > 0) return { eligible: [], ineligible: [...branches], findings: blocking };

  const eligible = [];
  const ineligible = [];
  for (const entry of branches) {
    const holds =
      DELETABLE_CLASSIFICATIONS.has(entry.classification) &&
      entry.recommendation === "safe_to_delete_after_578" &&
      entry.merged_into_dev === true &&
      entry.merged_into_main === true &&
      entry.unique_commits_vs_dev === 0 &&
      entry.unique_commits_vs_main === 0 &&
      entry.open_pr === null &&
      entry.branch_protected === false &&
      entry.preserve.length === 0 &&
      !entry.unestablished.some((item) => item.bearing_on_deletion !== "none");
    (holds ? eligible : ineligible).push(entry);
  }
  return { eligible, ineligible, findings: [] };
};

/**
 * The invariants #572 lists across a deletion, checked from the side that can be checked now: the
 * baseline has to exist, agree with the snapshot it was taken from, and -- once a deletion has
 * actually happened -- the state read back afterwards has to equal it.
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
  if (!Array.isArray(baseline.tags) || baseline.tags.length === 0) findings.push("no baseline tag list to compare against after deletion");
  else {
    // Both halves of a tag's identity. `ref_sha` is what refs/tags/<name> points at -- for an
    // annotated tag that is the tag object, carrying the annotation and any signature. `commit_sha`
    // is what it peels to. Recording only the peeled commit would let a tag be replaced by a
    // different tag object over the same commit, which is a tag move that nothing would notice.
    for (const tag of baseline.tags) {
      if (!SHA.test(tag.ref_sha ?? "")) findings.push(`tag ${tag.name}: no baseline ref object id`);
      if (!SHA.test(tag.commit_sha ?? "")) findings.push(`tag ${tag.name}: no baseline commit id`);
    }
  }
  if (baseline.protection?.main?.allow_deletions !== false) findings.push("baseline does not record main as undeletable");
  if (baseline.protection?.dev?.allow_deletions !== false) findings.push("baseline does not record dev as undeletable");

  const recordedOpenHeads = new Set((baseline.open_pr_heads ?? []).map((entry) => entry.branch));
  for (const entry of audit.branches ?? []) {
    if (entry.open_pr && !recordedOpenHeads.has(entry.name)) {
      findings.push(`${entry.name} is the head of open PR #${entry.open_pr.number} but is not in the baseline list of open PR heads`);
    }
  }

  const after = deletionLog?.post_delete_state;
  if (after) {
    if (after.main_sha !== baseline.main_sha) findings.push("main moved across the deletion");
    if (after.dev_sha !== baseline.dev_sha) findings.push("dev moved across the deletion");

    const before = new Map(baseline.tags.map((tag) => [tag.name, tag]));
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

    // The issue names protection and the open PR heads among the invariants, so the state read back
    // has to carry them. Absent is a finding, not a pass: a post-delete state that simply omits
    // protection cannot report that protection is unchanged.
    if (!after.protection) findings.push("the post-delete state does not report branch protection, so nothing can say it is unchanged");
    else {
      for (const ref of ["main", "dev"]) {
        for (const setting of ["allow_deletions", "allow_force_pushes", "enforce_admins"]) {
          const was = baseline.protection?.[ref]?.[setting];
          const now = after.protection?.[ref]?.[setting];
          if (was !== now) findings.push(`${ref} protection changed across the deletion: ${setting} was ${was} and is now ${now}`);
        }
      }
    }
    if (!Array.isArray(after.rulesets)) findings.push("the post-delete state does not report rulesets");
    else if (after.rulesets.length !== (baseline.rulesets ?? []).length) findings.push("the repository's ruleset configuration changed across the deletion");

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

/**
 * The deletion log's own shape. While Phase B is blocked it must say so, name both blocking issues,
 * and list nothing; once it claims completion it has to carry the state read back afterwards, so
 * that "COMPLETED" cannot be a word somebody typed.
 */
export const deletionLogFindings = (log) => {
  const findings = [];
  if (!log) return ["there is no deletion log"];
  if (log.schema !== "aos-branch-deletion-log.v1") findings.push(`unrecognized deletion log schema "${log.schema}"`);
  if (!Array.isArray(log.deleted)) return [...findings, "the deletion log has no list of deletions"];

  if (log.status === "NOT_YET") {
    if (log.deleted.length > 0) findings.push("the deletion log says NOT_YET but lists deletions");
    if (log.post_delete_state !== null) findings.push("the deletion log says NOT_YET but carries a post-delete state");
    const blockers = new Set(log.blocked_by ?? []);
    for (const issue of DELETION_BLOCKED_BY) {
      if (!blockers.has(issue)) findings.push(`the deletion log is NOT_YET but does not record #${issue} as blocking it`);
    }
    if (!isNonEmptyString(log.note, 21)) findings.push("the deletion log is NOT_YET but does not say why nothing was deleted");
  } else if (log.status === "COMPLETED") {
    if (log.deleted.length === 0) findings.push("the deletion log says COMPLETED but deleted nothing");
    if (!log.post_delete_state) findings.push("the deletion log says COMPLETED without reading the post-delete state back");
    for (const entry of log.deleted) {
      if (!SHA.test(entry.sha ?? "")) findings.push(`${entry.name}: deleted without recording the SHA it pointed at`);
    }
    // "Only after #578" has to be a checked precondition rather than a sentence in a document. A
    // COMPLETED log names each blocking issue and what cleared it; without that, flipping the
    // status is all it takes to delete before the evidence was preserved.
    const cleared = new Map((log.blockers_cleared ?? []).map((entry) => [entry.issue, entry]));
    for (const issue of DELETION_BLOCKED_BY) {
      const entry = cleared.get(issue);
      if (!entry) findings.push(`the deletion log says COMPLETED without recording that #${issue} cleared`);
      else if (!isNonEmptyString(entry.evidence, 11)) findings.push(`the deletion log says #${issue} cleared but cites nothing for it`);
    }
  } else {
    findings.push(`unrecognized deletion log status "${log.status}"`);
  }
  return findings;
};

/**
 * The prohibition that cannot be walked back. A deletion may only name a branch this audit covered
 * and found eligible; naming an open PR head, or a branch outside the audit entirely, is refused
 * whatever the log says about itself.
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
    // The verdict was formed about a commit. Deleting the same name at a different commit deletes
    // something the audit never looked at -- which is how a branch that picked up unique work, or a
    // pull request, after the snapshot gets removed on an old branch's authority.
    if (deleted.sha !== entry.head_sha) {
      findings.push(`${deleted.name} was deleted at ${deleted.sha}, but this audit judged it at ${entry.head_sha}`);
    }
  }

  for (const entry of audit.branches ?? []) {
    if (entry.open_pr && eligibleNames.has(entry.name)) {
      findings.push(`${entry.name} is the head of open PR #${entry.open_pr.number} and is nevertheless deletion-eligible`);
    }
  }
  return findings;
};
