import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CLASSIFICATIONS,
  RECOMMENDATIONS,
  auditCoverageFindings,
  classificationFindings,
  deletionEligibility,
  derivationFindings,
  unestablishedFindings
} from "../../scripts/branch-audit.mjs";
import { REQUIRED_DERIVATIONS, citedSources, observationDigest, verifyObservation } from "../../scripts/collect-branch-state.mjs";

// #572 phase one is a read-only audit: no branch may be deleted, renamed or force-pushed until #578
// and #588 have preserved the evidence. An audit is only worth having if it is checkable rather than
// prose, so this file is the check -- it reads the committed snapshot the way a reviewer would and
// fails if the snapshot is incomplete, self-contradictory, or lets something it has no basis to
// delete read as deletable.
//
// Following the pattern in lib/github-state.mjs (see its header comment), the suite runs offline
// against a committed snapshot rather than a live `git ls-remote` / `gh pr list`. A live check here
// would go red every time another agent in this batch pushes or merges, which is the exact "live
// path with looser rules" failure that file exists to avoid. What the snapshot cannot do is stay
// true, and it cannot authorize a deletion on its own either -- that is
// `deletionAuthorizationFindings`, exercised in no-open-pr-head-deletion.test.mjs against a live
// observation this file deliberately does not have.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const auditPath = join(root, "fixtures", "stale-branches", "audit.json");
const docPath = join(root, "docs", "STALE_BRANCH_AUDIT.md");

const loadAudit = () => JSON.parse(readFileSync(auditPath, "utf8"));
const withBranch = (audit, name, patch) => ({
  ...audit,
  branches: audit.branches.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry))
});
const merged = (audit) => audit.branches.find((entry) => entry.classification === "MERGED");
/** The commits the collector derived as reaching neither dev nor main, for one audited branch. */
const outstandingIds = (audit, name) => audit.live_observation.derivations[name].unique_commit_ids_vs_dev_and_main.value;

test("the audit file exists and parses", () => {
  assert.equal(existsSync(auditPath), true, `${auditPath} is missing`);
  assert.doesNotThrow(() => loadAudit());
});

test("the audit doc exists and is not a stub", () => {
  assert.equal(existsSync(docPath), true, `${docPath} is missing`);
  assert.ok(readFileSync(docPath, "utf8").length > 200, "docs/STALE_BRANCH_AUDIT.md reads as a stub");
});

test("the audit declares the read-only phase, a method, and an ls-remote snapshot that excludes main and dev by name", () => {
  const audit = loadAudit();
  assert.equal(audit.schema, "aos-stale-branch-audit.v5");
  assert.equal(audit.phase, "read-only-audit");
  assert.ok(audit.method.length > 20, "no method recorded");
  assert.ok(Array.isArray(audit.ls_remote_snapshot) && audit.ls_remote_snapshot.length > 0);
  assert.deepEqual(audit.excluded_refs, ["main", "dev"]);
});

// The external facts have to come from somewhere a reader can re-run. A method sentence is a claim
// about collection; the receipts are the collection.
test("the observation holds its own shape, over two transports, with a receipt behind every derivation", () => {
  const audit = loadAudit();
  const observation = audit.live_observation;
  assert.equal(observation.schema, "aos-branch-live-observation.v3");
  assert.deepEqual(verifyObservation(observation), [], "the committed observation does not hold its own shape");
  assert.equal(observation.digest, observationDigest(observation), "the observation's digest does not name its own content");
  assert.equal(observation.collected_at, audit.generated_at, "the observation was not collected when the audit says it was generated");
  assert.ok(observation.receipts.some((r) => r.source === "git-ls-remote"), "no git transport receipt");
  assert.ok(observation.receipts.some((r) => r.source === "rest-branches"), "no REST branch-list receipt");
  for (const sweep of observation.reference_sweep) {
    assert.equal(sweep.complete, true, `${sweep.branch}: the reference sweep was truncated, so it establishes nothing`);
  }
});

// The failure this replaces: a record asserting merge-base, rev-list, tag-contains, grep and
// PR-history results beside a receipt table that only ever listed the branch. A receipt for a
// neighbouring query is not evidence for a derivation nobody ran.
test("every graph fact a branch record asserts was derived by a command the observation receipts", () => {
  const audit = loadAudit();
  assert.deepEqual(derivationFindings(audit), []);
  for (const entry of audit.branches) {
    const derived = audit.live_observation.derivations[entry.name];
    for (const field of REQUIRED_DERIVATIONS) {
      assert.ok(derived[field], `${entry.name}: no ${field} derivation`);
      // A derivation decided by one command per candidate cites the list of them, so the citation is
      // normalised before it is looked up rather than assumed to be a single name.
      const cited = citedSources(derived[field]);
      assert.ok(cited.length > 0, `${entry.name}: ${field} cites no receipt at all`);
      for (const source of cited) {
        assert.ok(audit.live_observation.receipts.some((r) => r.source === source), `${entry.name}: ${field} cites a receipt that is not there`);
      }
    }
  }
});

test("a branch record whose number disagrees with its derivation is refused, field by field", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  for (const [field, wrong] of [
    ["merged_into_dev", false],
    ["merged_into_main", false],
    ["unique_commits_vs_dev", 7],
    ["unique_commits_vs_main", 7],
    ["unique_commits_vs_dev_and_main", 7],
    ["behind_dev", 0],
    ["behind_main", 0],
    ["last_commit_date", "2020-01-01T00:00:00+00:00"],
    ["release_tags_containing", []]
  ]) {
    const findings = derivationFindings(withBranch(audit, entry.name, { [field]: wrong }));
    assert.notDeepEqual(findings, [], `a record whose ${field} disagrees with the collector passed`);
  }
});

// `gh pr list --limit 200` documents that flag as a maximum. An omitted 201st historical pull
// request is indistinguishable from a branch that never had one, which is precisely the claim the
// record makes -- "no pull request has ever used this branch as a head". A history read as a bounded
// slice supports no claim about what is not in it.
test("a pull request history read as a bounded slice supports no claim about it", () => {
  const audit = loadAudit();
  for (const derived of Object.values(audit.live_observation.derivations)) {
    assert.equal(derived.pr_history.complete, true, "the committed observation read a PR history as a bounded slice");
  }
  const capped = structuredClone(audit.live_observation);
  const branch = audit.branches[0].name;
  capped.derivations[branch].pr_history.complete = false;
  const findings = derivationFindings({ ...audit, live_observation: capped });
  assert.ok(findings.some((f) => f.includes("bounded slice")), `a capped PR history passed the derivation check: ${findings.join(" | ")}`);
  assert.notDeepEqual(verifyObservation(capped), [], "a capped PR history passed observation verification");
  // A history with the flag missing entirely is the older shape, and is refused the same way.
  const legacy = structuredClone(audit.live_observation);
  delete legacy.derivations[branch].pr_history.complete;
  assert.notDeepEqual(verifyObservation(legacy), [], "a PR history with no completeness signal passed");
});

test("a branch record whose reference or PR claims were never collected is refused", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const active = audit.branches.find((one) => one.open_pr);
  assert.notDeepEqual(derivationFindings(withBranch(audit, entry.name, { references: { ...entry.references, tree_scan: { ...entry.references.tree_scan, hits: ["lib/somewhere.mjs:1"] } } })), [], "an invented tree scan passed");
  assert.notDeepEqual(derivationFindings(withBranch(audit, entry.name, { open_pr: { number: 999, url: "x", state: "OPEN", base: "dev", head_sha: entry.head_sha } })), [], "an open PR the collected history does not show passed");
  assert.notDeepEqual(derivationFindings(withBranch(audit, active.name, { open_pr: null })), [], "dropping an open PR the collected history shows passed");
  const truncated = { ...audit, live_observation: { ...audit.live_observation, reference_sweep: audit.live_observation.reference_sweep.map((s) => ({ ...s, complete: false })) } };
  assert.notDeepEqual(derivationFindings(truncated), [], "a truncated reference sweep still supported the reference claims");
  const unsourced = { ...audit, live_observation: { ...audit.live_observation, derivations: {} } };
  assert.notDeepEqual(derivationFindings(unsourced), [], "a record with no derivations at all passed");
  // The derivations are all present here; what is missing is the receipts they cite. A citation to a
  // command that left no trace is indistinguishable from one that never ran.
  const receiptless = { ...audit, live_observation: { ...audit.live_observation, receipts: audit.live_observation.receipts.slice(0, 2) } };
  const findings = derivationFindings(receiptless);
  assert.ok(findings.some((f) => f.includes("which the observation does not carry")), `derivations citing absent receipts passed: ${findings.slice(0, 3).join(" | ")}`);
  // And one derivation missing while the rest are present, which is the shape a record gets when a
  // fact was asserted that the collector was never asked to produce.
  for (const field of REQUIRED_DERIVATIONS) {
    const derivations = structuredClone(audit.live_observation.derivations);
    delete derivations[entry.name][field];
    const missing = derivationFindings({ ...audit, live_observation: { ...audit.live_observation, derivations } });
    assert.ok(missing.some((f) => f.includes(`no ${field} derivation`)), `a record asserting ${field} with no derivation behind it passed`);
  }
});

// The digest that binds a record to an observation has to change when any part of the observation
// does. The previous implementation passed an array replacer to JSON.stringify, which is a key
// allowlist applied at every level -- so every nested object serialised as `{}` and the digest was
// the same for every observation with the same top-level keys.
test("the observation digest changes when any nested value changes, in every family", () => {
  const audit = loadAudit();
  const base = audit.live_observation;
  const before = observationDigest(base);
  const mutations = {
    heads: (o) => { o.heads[0].sha = "0".repeat(40); },
    rest_heads: (o) => { o.rest_heads[0].sha = "0".repeat(40); },
    open_prs: (o) => { o.open_prs[0].head_branch = "task/attacker"; },
    tags: (o) => { o.tags[0].ref_sha = "0".repeat(40); },
    protection: (o) => { o.protection.main.allow_deletions = { enabled: true }; },
    settings: (o) => { o.settings.delete_branch_on_merge = false; },
    install_source: (o) => { o.install_source.files[0].digest = `sha256:${"0".repeat(64)}`; },
    receipts: (o) => { o.receipts[0].command = "rm -rf /"; },
    derivations: (o) => { o.derivations[Object.keys(o.derivations)[0]].unique_vs_dev.value = 99; },
    reference_sweep: (o) => { o.reference_sweep[0].total_count = 999; }
  };
  for (const [family, mutate] of Object.entries(mutations)) {
    const forged = structuredClone(base);
    mutate(forged);
    assert.notEqual(observationDigest(forged), before, `changing ${family} left the observation digest unchanged`);
  }
});

test("the observation digest ignores key order but not content", () => {
  const audit = loadAudit();
  const base = audit.live_observation;
  const reordered = Object.fromEntries(Object.keys(base).reverse().map((key) => [key, base[key]]));
  assert.equal(observationDigest(reordered), observationDigest(base), "reordering the top-level keys changed the identity");
});

test("the audit is explicit that it is a point-in-time snapshot, and states the dev SHA it was taken at", () => {
  const audit = loadAudit();
  assert.ok(audit.snapshot_warning.length > 40, "snapshot_warning is too short to warn anyone");
  assert.match(audit.snapshot_warning, /Phase B/, "snapshot_warning must name Phase B as the re-collection point");
  assert.match(audit.snapshot_warning, /not a deletion list|do not act/iu, "snapshot_warning must say this file is not to be acted on directly");
  assert.match(audit.invariant_baseline.dev_sha, /^[0-9a-f]{40}$/u, "the baseline dev SHA is not a full SHA");
  const devEntry = audit.ls_remote_snapshot.find((entry) => entry.name === "dev");
  assert.equal(devEntry.sha, audit.invariant_baseline.dev_sha, "the baseline dev SHA disagrees with the dev entry in ls_remote_snapshot");
  assert.ok(audit.revision_history.length > 0, "revision_history is empty");
  for (const rev of audit.revision_history) assert.ok(rev.note.length > 10, "a revision_history entry has no substantive note");
});

test("heads recorded by an earlier snapshot but absent from this one are accounted for by name, with the PR that consumed them", () => {
  const audit = loadAudit();
  const absent = audit.previously_recorded_heads_now_absent;
  assert.ok(Array.isArray(absent) && absent.length > 0, "no earlier heads are accounted for");
  for (const entry of absent) {
    assert.match(entry.prior_sha, /^[0-9a-f]{40}$/u, `${entry.name}: prior_sha is not a full SHA`);
    assert.equal(entry.fate.state, "MERGED", `${entry.name}: a head that vanished without a merged PR is unexplained, not accounted for`);
    assert.equal(typeof entry.fate.pr, "number", `${entry.name}: no PR number for the merge that consumed it`);
    assert.match(entry.fate.merge_commit, /^[0-9a-f]{40}$/u, `${entry.name}: no merge commit SHA`);
  }
});

test("every branch in the snapshot other than main and dev is audited exactly once", () => {
  const audit = loadAudit();
  assert.deepEqual(auditCoverageFindings(audit), []);
  const names = audit.ls_remote_snapshot.map((entry) => entry.name);
  assert.ok(names.includes("main"), "the snapshot must include main to prove it was excluded, not forgotten");
  assert.ok(names.includes("dev"), "the snapshot must include dev to prove it was excluded, not forgotten");
});

// Coverage against the audit's own snapshot is circular. With an observation it is coverage against
// the repository, and a head nobody audited becomes visible.
test("a live head that appears nowhere in the audit is refused, and the two transports must agree", () => {
  const audit = loadAudit();
  const heads = [...audit.ls_remote_snapshot, { name: "task/issue-000-unaudited", sha: "a".repeat(40) }];
  const live = { schema: "aos-branch-live-observation.v3", heads, rest_heads: heads, open_prs: [] };
  const findings = auditCoverageFindings(audit, live);
  assert.ok(findings.some((f) => f.includes("task/issue-000-unaudited") && f.includes("appears nowhere in this audit")), `an unaudited live head passed coverage: ${findings.join(" | ")}`);
  assert.ok(findings.some((f) => f.includes("no open pull request")), "the audit's own after-snapshot branch was excused without a PR in this observation");

  // The audit's own branch is claimed under the after-snapshot exception, so a clean observation has
  // to show its pull request open -- that is what earns the exception.
  const self = audit.heads_created_after_this_snapshot[0];
  const consistent = {
    schema: "aos-branch-live-observation.v3",
    heads: audit.ls_remote_snapshot,
    rest_heads: audit.ls_remote_snapshot,
    open_prs: [{ number: self.open_pr, head_branch: self.name, head_sha: "1".repeat(40), base: "dev", state: "OPEN" }]
  };
  assert.deepEqual(auditCoverageFindings(audit, consistent), [], "an observation matching the snapshot reported findings");

  const divergent = { ...consistent, rest_heads: audit.ls_remote_snapshot.map((h, i) => (i === 0 ? { ...h, sha: "b".repeat(40) } : h)) };
  assert.ok(auditCoverageFindings(audit, divergent).some((f) => f.includes("over git and")), "the two transports disagreeing was not reported");
});

test("every branch entry carries the fields the issue lists, a recognized classification and a recognized recommendation", () => {
  const audit = loadAudit();
  assert.ok(audit.branches.length > 0);
  for (const entry of audit.branches) {
    for (const field of [
      "name", "head_sha", "author_name", "author_email", "last_commit_date", "age_days", "classification",
      "merged_into_dev", "merged_into_main", "unique_commits_vs_dev", "unique_commits_vs_main",
      "unique_commits_vs_dev_and_main", "release_tags_containing", "open_pr", "superseding", "preserve", "references", "branch_protected",
      "unestablished", "recommendation", "reason"
    ]) {
      assert.ok(field in entry, `${entry.name ?? "<unnamed>"} is missing "${field}"`);
    }
    assert.match(entry.head_sha, /^[0-9a-f]{40}$/u, `${entry.name}: head_sha is not a full SHA`);
    assert.ok(entry.age_days >= 0, `${entry.name}: negative age`);
    assert.ok(CLASSIFICATIONS.has(entry.classification), `${entry.name}: unrecognized classification "${entry.classification}"`);
    assert.ok(RECOMMENDATIONS.has(entry.recommendation), `${entry.name}: unrecognized recommendation "${entry.recommendation}"`);
    assert.ok(Array.isArray(entry.release_tags_containing) && Array.isArray(entry.preserve) && Array.isArray(entry.unestablished));
  }
});

test("a classification and its recommendation agree, and each state carries what that state requires", () => {
  assert.deepEqual(classificationFindings(loadAudit()), []);
});

test("an unestablished fact is named and either blocks deletion or says in writing why it does not bear on deletion", () => {
  const audit = loadAudit();
  assert.deepEqual(unestablishedFindings(audit), []);
  assert.ok(audit.branches.flatMap((entry) => entry.unestablished).length > 0, "no branch names anything it could not establish -- an audit that established everything about every branch would be the first one");
});

test("a branch is deletion-eligible only when its content is demonstrably elsewhere, no PR is open on it, and it is not protected", () => {
  const audit = loadAudit();
  const { eligible, ineligible, findings } = deletionEligibility(audit);
  assert.deepEqual(findings, [], `the audit carries findings, so eligibility is empty for an unrelated reason: ${findings.join(" | ")}`);
  assert.ok(eligible.length > 0, "no branch is deletion-eligible, so the assertions below would check nothing");
  for (const entry of eligible) {
    assert.equal(entry.open_pr, null, `${entry.name}: eligible while a PR is open on it`);
    assert.equal(entry.branch_protected, false, `${entry.name}: eligible while protected`);
    assert.deepEqual(entry.preserve, [], `${entry.name}: eligible while naming work to preserve`);
    assert.ok(entry.reason.trim().length > 20, `${entry.name}: recommends deletion with no substantive reason`);
  }
  assert.equal(eligible.length + ineligible.length, audit.branches.length, "eligibility did not partition the audited branches");
});

test("a branch carrying commits that reach neither dev nor main is never recommended for deletion", () => {
  const audit = loadAudit();
  let exercised = false;
  for (const entry of audit.branches) {
    if (entry.unique_commits_vs_dev_and_main > 0) {
      exercised = true;
      assert.notEqual(entry.recommendation, "safe_to_delete_after_578", `${entry.name}: carries ${entry.unique_commits_vs_dev_and_main} commit(s) that reach neither dev nor main`);
      assert.ok(entry.preserve.length > 0, `${entry.name}: unmerged work with nothing recorded to preserve`);
    }
  }
  assert.ok(exercised, "no audited branch carries commits outside dev and main -- this test would otherwise pass without checking anything");
});

test("every audited entry names the commit the ls-remote snapshot observed", () => {
  const audit = loadAudit();
  const observed = new Map(audit.ls_remote_snapshot.map((entry) => [entry.name, entry.sha]));
  for (const entry of audit.branches) assert.equal(entry.head_sha, observed.get(entry.name), `${entry.name}: audited at ${entry.head_sha}, observed at ${observed.get(entry.name)}`);
});

// The exception is not the name being on a list, and it is not "any name with a pull request on it"
// either -- that version read the branch name and the live PR-head name and nothing else, so an
// arbitrary orphan could take the exception carrying whatever metadata it liked. It is now bound to
// the one branch the audit says it was submitted from, and every claim that entry makes is checked.
test("the after-snapshot exception is bound to the submission branch and validates its claims", () => {
  const audit = loadAudit();
  const self = audit.heads_created_after_this_snapshot[0];
  assert.equal(self.name, audit.submission_branch, "the audit does not name the branch its exception is for");
  const heads = [...audit.ls_remote_snapshot, { name: self.name, sha: "1".repeat(40) }];
  const observe = (prs) => ({ schema: "aos-branch-live-observation.v3", heads, rest_heads: heads, open_prs: prs });
  const itsPr = [{ number: self.open_pr, head_branch: self.name, head_sha: "1".repeat(40), base: "dev", state: "OPEN" }];

  assert.deepEqual(auditCoverageFindings(audit, observe(itsPr)), [], "the submission branch was not excused while its PR was open");

  const refusals = [
    ["no open PR", audit, observe([]), "no open pull request"],
    ["a different branch claiming it", { ...audit, submission_branch: "task/somebody-else" }, observe(itsPr), "submitted from task/somebody-else"],
    ["no submission branch named at all", { ...audit, submission_branch: null }, observe(itsPr), "does not say which branch it was submitted from"],
    ["a classification other than ACTIVE", { ...audit, heads_created_after_this_snapshot: [{ ...self, classification: "MERGED" }] }, observe(itsPr), "is classified MERGED"],
    ["a PR number that is not the open one", { ...audit, heads_created_after_this_snapshot: [{ ...self, open_pr: 4242 }] }, observe(itsPr), "claims pull request #4242"],
    ["a head SHA it cannot have", { ...audit, heads_created_after_this_snapshot: [{ ...self, sha: "2".repeat(40) }] }, observe(itsPr), "records a head SHA"],
    ["no explanation", { ...audit, heads_created_after_this_snapshot: [{ ...self, note: "later" }] }, observe(itsPr), "without saying why"]
  ];
  for (const [what, forged, live, expected] of refusals) {
    const findings = auditCoverageFindings(forged, live);
    assert.ok(findings.some((f) => f.includes(expected)), `${what}: expected a refusal mentioning "${expected}", got ${findings.join(" | ") || "[]"}`);
  }

  // The reviewer's reproduction: an arbitrary orphan, with a pull request open on it and metadata of
  // its own choosing, present live.
  const orphan = "task/later-orphan";
  const orphanHeads = [...heads, { name: orphan, sha: "3".repeat(40) }];
  const forged = { ...audit, heads_created_after_this_snapshot: [...audit.heads_created_after_this_snapshot, { name: orphan, sha: null, classification: "MERGED", open_pr: 77, note: "x".repeat(60) }] };
  const orphanLive = {
    schema: "aos-branch-live-observation.v3",
    heads: orphanHeads,
    rest_heads: orphanHeads,
    open_prs: [...itsPr, { number: 77, head_branch: orphan, head_sha: "3".repeat(40), base: "dev", state: "OPEN" }]
  };
  const findings = auditCoverageFindings(forged, orphanLive);
  assert.ok(findings.some((f) => f.includes(orphan)), `an arbitrary after-snapshot orphan with a PR was silently considered covered: ${findings.join(" | ") || "[]"}`);
});

test("the branch this audit is submitted from is named, even though its SHA cannot be recorded here", () => {
  const audit = loadAudit();
  const later = audit.heads_created_after_this_snapshot;
  assert.ok(Array.isArray(later) && later.length > 0, "the audit does not account for the branch it is submitted from");
  for (const entry of later) {
    assert.ok(entry.name.length > 0, "an entry in heads_created_after_this_snapshot has no branch name");
    assert.equal(entry.sha, null, `${entry.name}: a head created after the snapshot cannot carry a SHA the snapshot observed`);
    assert.equal(entry.classification, "ACTIVE", `${entry.name}: a branch created after the snapshot is in flight, not stale`);
    assert.ok(entry.note.length > 40, `${entry.name}: no explanation of why it is recorded outside the snapshot`);
    assert.equal(entry.name, audit.submission_branch, `${entry.name}: the exception is not bound to the branch the audit was submitted from`);
    assert.equal(typeof entry.open_pr, "number", `${entry.name}: records no pull request to be checked against`);
  }
  assert.ok(later.every((entry) => !audit.ls_remote_snapshot.some((head) => head.name === entry.name)), "a head recorded as created after the snapshot is also in the snapshot");
});

// #572's Phase B output is the deletion log, and the canonical plan reserves it for the blocked
// final-deletion phase. Phase A records the contract that artifact must satisfy; it does not ship it.
test("Phase A records the Phase B contract and does not emit the Phase B artifact", () => {
  const audit = loadAudit();
  assert.equal(existsSync(join(root, "fixtures", "stale-branches", "deletion-log.json")), false, "Phase A shipped the blocked phase's deletion log");
  const contract = audit.phase_b_contract;
  assert.equal(contract.deletion_log_status, "NOT_YET");
  assert.deepEqual([...contract.blocked_by].sort((a, b) => a - b), [578, 588]);
  assert.match(contract.prerequisite_authority, /github-state\.json/u, "the contract does not name the canonical authority that decides whether the blockers cleared");
  assert.match(contract.required_shape.pre_observation, /digest/u, "the contract does not require the pre-deletion observation digest");
  assert.match(contract.required_shape.post_observation, /digest/u, "the contract does not require the post-deletion observation digest");
  assert.match(contract.entry_point, /liveEligibility/u, "the contract does not name the report Phase B starts from");
  assert.match(contract.entry_point, /ships no executor/u, "the contract does not say Phase A ships no executor");
  assert.match(contract.verifiers, /boundaryInvariantFindings/u, "the contract does not name the verifiers Phase B has to satisfy");
  for (const family of ["protection", "install source", "open pull request head"]) {
    assert.ok(contract.invariant_comparison.includes(family), `the invariant comparison does not name ${family}`);
  }
  assert.match(contract.invariant_comparison, /between the two fresh observations/u, "the contract still compares against a stored baseline");
  for (const entry of contract.eligible_at_this_snapshot) assert.match(entry.sha_at_audit, /^[0-9a-f]{40}$/u);
});

test("no entry recommends deletion without a substantive reason", () => {
  const audit = loadAudit();
  let exercised = false;
  for (const entry of audit.branches) {
    if (entry.recommendation !== "safe_to_delete_after_578") continue;
    exercised = true;
    assert.ok(entry.reason.trim().length > 20, `${entry.name}: recommends deletion with no substantive reason`);
  }
  assert.ok(exercised, "no entry recommends deletion -- this test would otherwise pass without checking anything");
  assert.deepEqual(classificationFindings(audit), []);
  const entry = merged(audit);
  assert.notDeepEqual(classificationFindings(withBranch(audit, entry.name, { reason: "stale" })), [], "a deletion recommendation with no substantive reason passed the classification check");
});

// --- the document is rendered from the fixture ------------------------------------------------

/** Parse the summary table's rows structurally, so a deleted row is a missing row. */
const summaryRows = (doc) => {
  const lines = doc.split("\n");
  const header = lines.findIndex((line) => line.startsWith("| branch | head SHA | classification |"));
  assert.notEqual(header, -1, "the document has no branch summary table");
  const rows = new Map();
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.set(cells[0].replace(/`/gu, ""), cells);
  }
  return rows;
};

test("the document's summary table has exactly one row per audited branch, carrying its SHA and recommendation", () => {
  const audit = loadAudit();
  const rows = summaryRows(readFileSync(docPath, "utf8"));
  assert.equal(rows.size, audit.branches.length, `the summary table has ${rows.size} rows for ${audit.branches.length} audited branches`);
  for (const entry of audit.branches) {
    const row = rows.get(entry.name);
    assert.ok(row, `docs/STALE_BRANCH_AUDIT.md has no summary row for ${entry.name}`);
    assert.ok(row.includes(`\`${entry.head_sha}\``), `${entry.name}: the summary row does not carry the recorded SHA`);
    assert.ok(row.some((cell) => cell.includes(entry.classification)), `${entry.name}: the summary row does not carry the classification`);
    assert.ok(row.some((cell) => cell.includes(entry.recommendation)), `${entry.name}: the summary row does not carry the recommendation`);
  }
});

test("deleting one summary row fails the correspondence check", () => {
  const audit = loadAudit();
  const doc = readFileSync(docPath, "utf8");
  const victim = audit.branches[0];
  const withoutRow = doc.split("\n").filter((line) => !(line.startsWith(`| \`${victim.name}\``))).join("\n");
  const rows = summaryRows(withoutRow);
  assert.equal(rows.has(victim.name), false, "the row was not actually removed by the counterfactual");
  assert.notEqual(rows.size, audit.branches.length, "a document missing a summary row still had one row per branch");
});

test("the document states the baseline main and dev SHAs", () => {
  const audit = loadAudit();
  const doc = readFileSync(docPath, "utf8");
  assert.ok(doc.includes(audit.invariant_baseline.main_sha), "the document does not state the baseline main SHA");
  assert.ok(doc.includes(audit.invariant_baseline.dev_sha), "the document does not state the baseline dev SHA");
});

// --- counterfactuals ---------------------------------------------------------------------------
//
// The fixture is a clean audit, so every rule below would pass vacuously against it. Each forges the
// exact shape the rule exists to refuse and asserts the refusal.

test("a branch with an open PR that is nevertheless marked deletable is refused", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const forged = withBranch(audit, active.name, { recommendation: "safe_to_delete_after_578" });
  assert.notDeepEqual(classificationFindings(forged), [], "an ACTIVE branch marked deletable passed the classification check");
  assert.deepEqual(deletionEligibility(forged).eligible, [], "an audit with a finding still produced deletion-eligible branches");
});

test("a branch classified UNIQUE_WORK is never deletion-eligible, however it is recommended", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const plan = { canonical_issue: 572, replacement_branch_base: "origin/dev", method: "cherry-pick", new_pr_requirement: "a new PR with CI green before this branch is deleted" };
  // Both spellings of the mistake: a state that may not be deleted, marked deletable, and the same
  // state marked with a third recommendation that is not the one it is required to carry. One rule
  // has to refuse both, or the classification decides nothing.
  for (const recommendation of ["safe_to_delete_after_578", "needs_decision"]) {
    const forged = withBranch(audit, entry.name, { classification: "UNIQUE_WORK", recommendation, preserve: ["a parser that exists on no other ref"], preservation_plan: plan });
    assert.notDeepEqual(classificationFindings(forged), [], `UNIQUE_WORK recommended "${recommendation}" passed the classification check`);
    assert.ok(!deletionEligibility(forged).eligible.some((e) => e.name === entry.name), "a UNIQUE_WORK branch was deletion-eligible");
  }
  const correct = withBranch(audit, entry.name, { classification: "UNIQUE_WORK", recommendation: "must_be_preserved", preserve: ["a parser that exists on no other ref"], preservation_plan: plan });
  assert.deepEqual(classificationFindings(correct), [], "a correctly recorded UNIQUE_WORK branch was refused");
  assert.ok(!deletionEligibility(correct).eligible.some((e) => e.name === entry.name), "a correctly recorded UNIQUE_WORK branch was deletion-eligible");
});

// UNIQUE_WORK is the state in which the audit has said work exists nowhere else. The issue names the
// plan that has to accompany it; without these checks the label was the whole record.
test("UNIQUE_WORK requires the preservation plan the issue specifies, component by component", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const complete = {
    classification: "UNIQUE_WORK",
    recommendation: "must_be_preserved",
    preserve: ["three commits implementing the parser that exist on no other ref"],
    preservation_plan: { canonical_issue: 572, replacement_branch_base: "origin/dev", method: "cherry-pick", new_pr_requirement: "a new PR with CI green before this branch is deleted" }
  };
  assert.deepEqual(classificationFindings(withBranch(audit, entry.name, complete)), [], "a complete UNIQUE_WORK record was refused");
  for (const [field, broken] of [
    ["preserve", { preserve: [] }],
    ["preservation_plan", { preservation_plan: undefined }],
    ["canonical_issue", { preservation_plan: { ...complete.preservation_plan, canonical_issue: undefined } }],
    ["replacement_branch_base", { preservation_plan: { ...complete.preservation_plan, replacement_branch_base: "" } }],
    ["method", { preservation_plan: { ...complete.preservation_plan, method: "wing-it" } }],
    ["new_pr_requirement", { preservation_plan: { ...complete.preservation_plan, new_pr_requirement: "" } }]
  ]) {
    const forged = withBranch(audit, entry.name, { ...complete, ...broken });
    assert.notDeepEqual(classificationFindings(forged), [], `UNIQUE_WORK with no ${field} passed the classification check`);
  }
});

test("EVIDENCE_ONLY requires a concrete destination for the evidence before anything is cleared", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const complete = {
    classification: "EVIDENCE_ONLY",
    recommendation: "must_be_preserved",
    preserve: ["the captured terminal-0 run this branch was holding"],
    evidence_destination: { kind: "fixture", locator: "fixtures/known-incidents/", migrated: false }
  };
  assert.deepEqual(classificationFindings(withBranch(audit, entry.name, complete)), [], "a complete EVIDENCE_ONLY record was refused");
  for (const [field, broken] of [
    ["preserve", { preserve: [] }],
    ["evidence_destination", { evidence_destination: undefined }],
    ["kind", { evidence_destination: { ...complete.evidence_destination, kind: "somewhere" } }],
    ["locator", { evidence_destination: { ...complete.evidence_destination, locator: "" } }],
    ["migrated", { evidence_destination: { kind: "fixture", locator: "fixtures/known-incidents/" } }],
    ["migrated_at_sha", { evidence_destination: { ...complete.evidence_destination, migrated: true } }]
  ]) {
    const forged = withBranch(audit, entry.name, { ...complete, ...broken });
    assert.notDeepEqual(classificationFindings(forged), [], `EVIDENCE_ONLY with no ${field} passed the classification check`);
  }
  assert.ok(!deletionEligibility(withBranch(audit, entry.name, complete)).eligible.some((e) => e.name === entry.name), "an EVIDENCE_ONLY branch was deletion-eligible");
});

// --- a citation is not evidence unless the cited command answered the recorded answer -------------
//
// `tags_containing` is decided by one `git merge-base --is-ancestor` per tag, and it cited a single
// receipt -- whichever tag sorted first -- whose recorded exit status was 1, "not contained", beside
// a value listing seven tags the branch is contained in. Neither checker could see it: one asked
// only whether the named receipt existed, the other compared the record against the same record.

test("every list-valued derivation cites a receipt per candidate, and each cited command answered what it is cited for", () => {
  const audit = loadAudit();
  const observation = audit.live_observation;
  const receipts = new Map(observation.receipts.map((receipt) => [receipt.source, receipt]));
  let checked = 0;
  for (const [branch, derivation] of Object.entries(observation.derivations)) {
    const cited = derivation.tags_containing.source;
    assert.ok(Array.isArray(cited), `${branch}: tag containment cites one receipt for a question decided by one command per tag`);
    assert.equal(cited.length, observation.tags.length, `${branch}: ${cited.length} ancestry test(s) cited for ${observation.tags.length} tag(s)`);
    const listed = new Set(derivation.tags_containing.value);
    for (const source of cited) {
      const receipt = receipts.get(source);
      assert.ok(receipt, `${branch}: cites ${source}, which the observation does not carry`);
      const tag = source.slice("tag-contains-".length, source.length - branch.length - 1);
      checked += 1;
      assert.equal(receipt.exit_code === 0, listed.has(tag), `${branch}: containment ${listed.has(tag) ? "lists" : "omits"} ${tag} while the receipt it cites for it exited ${receipt.exit_code}`);
    }
    // The booleans too, since the same comparison is available to them.
    for (const field of ["ancestor_of_dev", "ancestor_of_main"]) {
      const receipt = receipts.get(derivation[field].source);
      assert.ok(receipt, `${branch}: ${field} cites a receipt the observation does not carry`);
      checked += 1;
      assert.equal(receipt.exit_code === 0, derivation[field].value, `${branch}: ${field} records ${derivation[field].value} while the command it cites exited ${receipt.exit_code}`);
    }
  }
  assert.ok(checked > 20, `only ${checked} citation(s) were checked, so this test is not covering the observation`);
});

test("a derivation whose cited command answered the other way is refused", () => {
  const audit = loadAudit();
  const branch = Object.keys(audit.live_observation.derivations).find((name) => audit.live_observation.derivations[name].tags_containing.value.length > 0);
  assert.ok(branch, "no branch is contained in a release tag, so this test would check nothing");
  const forge = (mutate) => {
    const observation = structuredClone(audit.live_observation);
    mutate(observation.derivations[branch], observation);
    observation.digest = observationDigest(observation);
    return observation;
  };
  // A tag listed as containing the branch whose ancestry test said no.
  const invented = forge((derivation) => derivation.tags_containing.value.push("v9.9.9-not-tested"));
  assert.ok(verifyObservation(invented).some((f) => f.includes("without citing the ancestry test")), "a tag listed with no ancestry test behind it passed");
  // A tag dropped from the value whose ancestry test said yes.
  const dropped = forge((derivation) => { derivation.tags_containing.value = derivation.tags_containing.value.slice(1); });
  assert.ok(verifyObservation(dropped).some((f) => f.includes("omits")), "a tag whose ancestry test said contained was dropped from the value and passed");
  // The shape the defect had: one receipt, for a neighbouring question, cited for the whole answer.
  const neighbouring = forge((derivation, observation) => { derivation.tags_containing.source = `tag-contains-${observation.tags[0].name}-${branch}`; });
  assert.notDeepEqual(verifyObservation(neighbouring), [], "a list-valued derivation citing one neighbouring receipt passed");
  // And a containment claim whose cited ancestry test exited 1.
  const flipped = forge((derivation, observation) => {
    const first = derivation.tags_containing.value[0];
    const source = `tag-contains-${first}-${branch}`;
    observation.receipts = observation.receipts.map((receipt) => (receipt.source === source ? { ...receipt, exit_code: 1 } : receipt));
  });
  assert.ok(verifyObservation(flipped).some((f) => f.includes("exited 1")), "a containment claim whose cited command answered 'not contained' passed");
});

// SUPERSEDED is a distinct route, not a synonym for MERGED. Its whole premise is that the original
// commits were reimplemented rather than merged, so requiring containment of it deletes the route.
test("SUPERSEDED work that was reimplemented rather than merged is deletable on its own evidence", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const forged = withBranch(audit, active.name, {
    classification: "SUPERSEDED",
    recommendation: "safe_to_delete_after_578",
    open_pr: null,
    preserve: [],
    superseding: {
      pr: 610,
      issue: 559,
      sha: "2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49",
      note: "reimplemented on latest dev and merged there; the commits below are the ones this branch held that were not merged verbatim",
      // The commits the collector derived, not eighteen zero-padded strings of the right length.
      // This test asserted deletion-eligibility off a fabricated list, which made the one route by
      // which unmerged work becomes deletable satisfiable by counting.
      supersedes_commits: [...outstandingIds(audit, active.name)]
    },
    reason: "The work was reimplemented on dev under PR #610 and this branch's commits are individually accounted for by that replacement."
  });
  assert.ok(active.unique_commits_vs_dev_and_main > 0, "the branch holds nothing unmerged, so this test would not exercise the SUPERSEDED route");
  assert.deepEqual(classificationFindings(forged), [], `a reimplemented SUPERSEDED branch was refused: ${classificationFindings(forged).join(" | ")}`);
  assert.ok(deletionEligibility(forged).eligible.some((e) => e.name === active.name), "a SUPERSEDED branch with full replacement evidence was not deletion-eligible");
  // And on the path that has the evidence: the ids it accounts for are the ids the collector derived.
  assert.deepEqual(derivationFindings(forged).filter((f) => f.includes("accounts for commit ids")), [], "an honest SUPERSEDED accounting was refused");
});

// An id list that accounts for work has to be derived, not declared. The classification contract
// compares a length, and a length is satisfied by any 40-hex strings at all -- which is the whole
// route by which a branch holding unmerged commits becomes deletion-eligible.
test("a SUPERSEDED record accounting for commit ids the collector did not derive is refused", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const real = outstandingIds(audit, active.name);
  assert.ok(real.length > 0, "no branch holds a commit reaching neither line, so this test would check nothing");
  const supersede = (ids) => withBranch(audit, active.name, {
    classification: "SUPERSEDED",
    recommendation: "safe_to_delete_after_578",
    open_pr: null,
    preserve: [],
    superseding: { pr: 610, sha: "2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49", note: "reimplemented on latest dev and merged there under PR #610", supersedes_commits: ids }
  });
  const fabricated = real.map((_unused, index) => String(index).padStart(40, "0"));
  assert.equal(classificationFindings(supersede(fabricated)).length, 0, "the counting check refused it, so this test is not measuring the id comparison");
  assert.ok(derivationFindings(supersede(fabricated)).some((f) => f.includes("accounts for commit ids")), "a fabricated accounting of unmerged commits passed");
  // One valid-but-wrong id, so the refusal is about which commits rather than about how many.
  const swapped = [...real.slice(1), "0".repeat(40)];
  assert.ok(derivationFindings(supersede(swapped)).some((f) => f.includes("accounts for commit ids")), "an accounting that swapped one commit for another passed");
  assert.deepEqual(derivationFindings(supersede([...real])).filter((f) => f.includes("accounts for commit ids")), [], "the derived accounting was refused");
});

test("SUPERSEDED without a complete superseding record is refused, component by component", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const base = {
    classification: "SUPERSEDED",
    recommendation: "safe_to_delete_after_578",
    superseding: { pr: 610, sha: "2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49", note: "reimplemented on latest dev and merged there under PR #610" }
  };
  assert.deepEqual(classificationFindings(withBranch(audit, entry.name, base)), [], "a complete SUPERSEDED record over a contained branch was refused");
  for (const [field, broken] of [
    ["superseding", { superseding: null }],
    ["pr or issue", { superseding: { sha: base.superseding.sha, note: base.superseding.note } }],
    ["sha", { superseding: { ...base.superseding, sha: "not-a-sha" } }],
    ["note", { superseding: { ...base.superseding, note: "see above" } }]
  ]) {
    assert.notDeepEqual(classificationFindings(withBranch(audit, entry.name, { ...base, ...broken })), [], `SUPERSEDED with no ${field} passed the classification check`);
  }
});

test("SUPERSEDED must account for every commit that reaches neither dev nor main", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const forged = withBranch(audit, active.name, {
    classification: "SUPERSEDED",
    recommendation: "safe_to_delete_after_578",
    open_pr: null,
    preserve: [],
    superseding: { pr: 610, sha: "2e2e0afb0effbe2d88a1eee0ddbbcb9300c70a49", note: "reimplemented on latest dev and merged there under PR #610", supersedes_commits: ["0".repeat(40)] }
  });
  const findings = classificationFindings(forged);
  assert.ok(findings.some((f) => f.includes("accounted for by the replacement")), `an under-accounted SUPERSEDED branch passed: ${findings.join(" | ")}`);
});

test("UNKNOWN_HOLD must name what blocks the decision", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { classification: "UNKNOWN_HOLD", recommendation: "needs_decision" });
  assert.notDeepEqual(classificationFindings(forged), [], "UNKNOWN_HOLD naming nothing that blocks it passed the classification check");
});

test("a branch still carrying commits dev does not have is not deletion-eligible", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { unique_commits_vs_dev: 1 });
  assert.notDeepEqual(classificationFindings(forged), [], "a MERGED branch holding a commit dev lacks passed the classification check");
  assert.ok(!deletionEligibility(forged).eligible.some((e) => e.name === entry.name), "a branch with a commit dev lacks was deletion-eligible");
});

test("a protected branch is not deletion-eligible", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  assert.ok(!deletionEligibility(withBranch(audit, entry.name, { branch_protected: true })).eligible.some((e) => e.name === entry.name), "a protected branch was deletion-eligible");
});

test("a branch recorded as MERGED while a PR is open on it is still not deletion-eligible", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { open_pr: { number: 999, url: "https://example.invalid/999", state: "OPEN", base: "dev", head_sha: entry.head_sha } });
  assert.notDeepEqual(classificationFindings(forged), [], "a branch with an open PR classified as anything but ACTIVE passed the classification check");
  assert.ok(!deletionEligibility(forged).eligible.some((e) => e.name === entry.name), `${entry.name} was deletion-eligible while PR #999 was open on it`);
});

test("an unestablished fact that blocks deletion cannot sit on a branch marked deletable", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { unestablished: [{ fact: "whether a colleague is still working from this branch", bearing_on_deletion: "blocks_deletion" }] });
  assert.notDeepEqual(unestablishedFindings(forged), [], "a deletion-blocking unknown on a deletable branch passed the check");
  assert.deepEqual(deletionEligibility(forged).eligible, [], "an audit with a deletion-blocking unknown still produced eligible branches");
});

test("an unestablished fact dismissed as not bearing on deletion, with no argument, is refused", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { unestablished: [{ fact: "what this branch was for", bearing_on_deletion: "none", why_it_does_not_bear: "" }] });
  assert.notDeepEqual(unestablishedFindings(forged), [], "an unargued dismissal passed the check");
});

// The dismissal argument here is deliberately substantial, so the only rule that can refuse this
// entry is the one that checks the bearing value itself.
test("an unestablished fact whose bearing is neither none nor blocks_deletion is refused", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { unestablished: [{ fact: "what this branch was for", bearing_on_deletion: "probably fine", why_it_does_not_bear: "nothing in the repository refers to this branch any more, so it looks abandoned" }] });
  assert.notDeepEqual(unestablishedFindings(forged), [], "an invented bearing value passed the check");
});

test("a branch on origin that the audit does not cover is refused, and a covered branch not on origin is too", () => {
  const audit = loadAudit();
  assert.notDeepEqual(auditCoverageFindings({ ...audit, branches: audit.branches.slice(1) }), [], "a branch on origin that nobody audited passed the coverage check");
  assert.notDeepEqual(auditCoverageFindings({ ...audit, branches: [...audit.branches, { ...audit.branches[0], name: "task/issue-000-not-on-origin" }] }), [], "an audited branch that is not on origin passed the coverage check");
});

test("an entry audited at a commit the snapshot did not observe is refused", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { head_sha: audit.invariant_baseline.dev_sha });
  assert.notDeepEqual(auditCoverageFindings(forged), [], "an entry whose head disagrees with the snapshot passed the coverage check");
  assert.deepEqual(deletionEligibility(forged).eligible, [], "an audit whose entry names an unobserved commit still produced eligible branches");
});

test("a branch that names something worth preserving is never deletion-eligible", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  const forged = withBranch(audit, entry.name, { preserve: ["release evidence that was never migrated off this branch"] });
  assert.notDeepEqual(classificationFindings(forged), [], "a deletion recommendation over a non-empty preserve list passed the classification check");
  assert.ok(!deletionEligibility(forged).eligible.some((e) => e.name === entry.name), "a branch naming work to preserve was deletion-eligible");
});

test("an entry that records no preserve list, tag containment or reference scan is refused", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  for (const field of ["preserve", "release_tags_containing", "references"]) {
    assert.notDeepEqual(classificationFindings(withBranch(audit, entry.name, { [field]: undefined })), [], `an entry with no ${field} passed the classification check`);
  }
});

test("a finding on one branch empties the deletion-eligible set entirely", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  assert.ok(deletionEligibility(audit).eligible.length > 0, "nothing was eligible to begin with, so this test would check nothing");
  assert.deepEqual(deletionEligibility(withBranch(audit, active.name, { classification: "not-a-classification" })).eligible, [], "a broken entry elsewhere left other branches eligible");
});

// Neither difference alone answers "what would be lost": a commit on dev but not main is still
// elsewhere. The count deletion turns on is recorded separately and is the one the rules read.
test("the count that deletion turns on is commits reaching neither line, recorded separately", () => {
  const audit = loadAudit();
  const entry = merged(audit);
  // Asked of a state whose own contract does not read the count, so the general requirement is the
  // only rule that can refuse it.
  const active = audit.branches.find((e) => e.open_pr);
  assert.notDeepEqual(classificationFindings(withBranch(audit, active.name, { unique_commits_vs_dev_and_main: undefined })), [], "an entry with no unique_commits_vs_dev_and_main passed the classification check");
  const forged = withBranch(audit, entry.name, { unique_commits_vs_dev_and_main: 2 });
  assert.notDeepEqual(classificationFindings(forged), [], "a MERGED branch holding commits neither line has passed the classification check");
});

// #572 has two phases and only one has run. GitHub's closing keywords do not know about phases, so a
// PR that closed the issue here would take the blocked final-deletion phase with it. The canonical
// plan is the authority on which phases exist and which are blocked; the audit has to agree with it.
// R-01: the published contract told a consumer to call `authorizeDeletion`, which had been replaced
// by `runDeletion` and no longer existed. A document naming an API that is not there is a defect in
// the contract, not a typo, so the check is structural: every module function these documents tell a
// reader to call has to be exported by the module they say it lives in.
/**
 * Everywhere a name for this change's API, or for a command it retired, can survive a rename.
 *
 * The document and the fixture publish the contract; the two scripts are the contract's subject; the
 * three suites and the fixture harness are where a retired name goes on being true-looking prose
 * long after the thing it names is gone.
 */
const DRIFT_SOURCES = [
  "docs/STALE_BRANCH_AUDIT.md",
  "fixtures/stale-branches/audit.json",
  "scripts/collect-branch-state.mjs",
  "scripts/branch-audit.mjs",
  "tests/product/branch-state-fixture.mjs",
  "tests/product/branch-cleanup-invariants.test.mjs",
  "tests/product/no-open-pr-head-deletion.test.mjs",
  "tests/product/stale-branch-audit.test.mjs"
];

/** Helpers a suite defines for itself. Not the modules' API, and not what drifts. */
const LOCAL_TEST_HELPERS = new Set([
  "auditFor",
  "boundaryPair",
  "clearedCompletion",
  "collectedFindings",
  "completedLog",
  "contractNamedComposition",
  "loadAudit",
  "notYetLog",
  "recollect",
  "setResponses",
  "withBranch",
  "withFakeGitHub"
]);

/**
 * Commands this change removed from the collector, and the reason each had to go.
 *
 * `git tag --contains` answers from the local tag set rather than the repository's; `gh pr list`
 * takes a `--limit` that is a maximum, so an omitted pull request is indistinguishable from a branch
 * that never had one; `git fetch --tags` rewrites local tags, which is a write inside a read-only
 * instrument. The identifier pass above cannot see any of them: they are command lines, not
 * JavaScript names, and that is exactly how five prose sites went on describing a collector that had
 * stopped running them.
 */
const RETIRED_COMMANDS = ["git tag --contains", "gh pr list", "git fetch --tags"];

/** Function names this change removed. Mentioned only where their absence is asserted. */
const RETIRED_API = new Set(["authorizeDeletion", "makeDeletionRunner", "runDeletion"]);

test("every gate function the contract and the document name is actually exported", async () => {
  const audit = loadAudit();
  const gate = await import("../../scripts/branch-audit.mjs");
  const collector = await import("../../scripts/collect-branch-state.mjs");
  const exported = new Set([...Object.keys(gate), ...Object.keys(collector)]);

  const entry = /\b(\w+)\(/u.exec(audit.phase_b_contract.entry_point);
  assert.ok(entry, "the Phase B contract does not name an entry point to call");
  assert.ok(exported.has(entry[1]), `the contract names ${entry[1]}(), which the gate does not export`);

  // Anything API-shaped, wherever it is mentioned. This is what would have caught the drift: the
  // retired name survived in three files after the export was gone.
  const apiShaped = /\b((?:run|authorize|make|collect|verify)[A-Z]\w*|\w+(?:Findings|Digest|Snapshot|Observation|Eligibility))\b/gu;
  // Every file the drift can survive in, not only the ones that publish the contract. The scope was
  // the four below minus the tests, and `runDeletion` -- removed in this change -- went on describing
  // the fixture harness's purpose three files away from the assertion that it no longer exists. A
  // guard whose scope is narrower than the tree reports on the part of the tree it can see.
  const sources = Object.fromEntries(DRIFT_SOURCES.map((path) => [path, readFileSync(join(root, path), "utf8")]));
  const internal = new Set(["afterSnapshotComplaint", "collectLive", "derivationAnswerFindings", "liveOpenPr", "liveProtected", "observationBindingFindings", "withoutPaths"]);
  let checked = 0;
  for (const [where, text] of Object.entries(sources)) {
    for (const [, name] of text.matchAll(apiShaped)) {
      if (internal.has(name) && !where.startsWith("docs/") && !where.startsWith("fixtures/")) continue;
      // A test names its own local helpers, which are not the modules' API and are not what drifts.
      if (where.startsWith("tests/") && !exported.has(name) && LOCAL_TEST_HELPERS.has(name)) continue;
      // The retired names appear in exactly one place on purpose: the assertions below, which exist
      // to fail if any of them is exported again. Naming a thing in order to forbid it is not drift.
      if (where === "tests/product/stale-branch-audit.test.mjs" && RETIRED_API.has(name)) continue;
      checked += 1;
      assert.ok(exported.has(name), `${where} names ${name}, which neither script exports`);
    }
  }
  assert.ok(checked > 20, `only ${checked} API references were checked, so this test is not covering the documents`);
  // The retired name specifically, since it is the one that drifted.
  assert.equal(exported.has("authorizeDeletion"), false, "authorizeDeletion is exported again; the contract text and the export must be changed together");
  assert.equal(exported.has("makeDeletionRunner"), false, "the runner factory is exported again, which is a door in the gate");
  // Phase A ships verifiers, not an executor. A function that performs the deletion belongs to the
  // blocked phase, and the issue's own phase boundary allows 조회/분류/evidence/verifier only.
  assert.equal(exported.has("runDeletion"), false, "a deletion executor is exported from a read-only Phase A");
});

// The other direction of R-01. The forward check catches a document naming a gate that does not
// exist; it cannot catch a contract that fails to name the gate that enforces the rule -- which is
// how the whole evidence binding came to live in a function no contract, document or verifier list
// mentioned, while six assertions rested on it.
test("every gate the modules export is one the contract or the document tells a reader to call", async () => {
  const audit = loadAudit();
  const gate = await import("../../scripts/branch-audit.mjs");
  const contract = audit.phase_b_contract;
  const published = [contract.entry_point, contract.verifiers, contract.invariant_comparison, contract.prerequisite_authority, JSON.stringify(contract.required_shape), readFileSync(docPath, "utf8")].join("\n");

  // Gates: the exported functions that decide something about a deletion. Helpers that only compute
  // a value are declared here rather than left to a regex, so adding one is a decision.
  const notAGate = new Set(["CLASSIFICATIONS", "RECOMMENDATIONS", "DELETION_BLOCKED_BY", "OBSERVATION_MAX_AGE_SECONDS", "canonicalize", "loadCompletionSnapshot"]);
  const gates = Object.keys(gate).filter((name) => !notAGate.has(name));
  assert.ok(gates.length > 5, `only ${gates.length} gate(s) were found, so this test is not covering the module`);

  // Named, or called by something named -- a gate composed by a gate the contract names is reachable
  // from the documented sequence, which is what "the contract names the gate that is actually run"
  // means. A gate in neither set is one nothing tells anyone to run, which is where the whole
  // evidence binding lived while six assertions rested on it.
  const source = readFileSync(join(root, "scripts", "branch-audit.mjs"), "utf8");
  const bodyOf = (name) => {
    const start = source.indexOf(`export const ${name} =`);
    if (start < 0) return "";
    const next = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, next < 0 ? source.length : next);
  };
  const reachable = new Set(gates.filter((name) => published.includes(name)));
  for (let pass = 0; pass < gates.length; pass += 1) {
    const before = reachable.size;
    for (const from of [...reachable]) {
      for (const name of gates) if (bodyOf(from).includes(name)) reachable.add(name);
    }
    if (reachable.size === before) break;
  }
  for (const name of gates) {
    assert.ok(reachable.has(name), `${name} decides something about a deletion, and neither the Phase B contract nor the document reaches it`);
  }
  // And the composed gate specifically, since it is the one that went unnamed.
  assert.ok(contract.verifiers.includes("deletionAuthorizationFindings"), "the contract's verifier list does not name the gate that binds the record to its evidence");
  assert.ok(readFileSync(docPath, "utf8").includes("deletionAuthorizationFindings"), "the document's Phase B sequence does not name the gate that binds the record to its evidence");
});

// The identifier pass cannot see a command name. Five prose sites described the collector as running
// `git tag --contains` and `gh pr list --head` after this change removed both as unsafe, while zero
// receipts matched either -- a drift guard that covers one kind of name and not the other.
test("no document, fixture or suite describes the collector as running a command it retired", () => {
  const audit = loadAudit();
  // The surfaces that describe how these facts were collected: the rendered report and the record.
  // Not the scripts, where the retirement is decided and explained, and not the suites, which are
  // covered by the identifier pass above and have to be able to say what they refuse.
  for (const path of ["docs/STALE_BRANCH_AUDIT.md", "fixtures/stale-branches/audit.json"]) {
    const text = path === "fixtures/stale-branches/audit.json"
      // `revision_history` is the one place a superseded method belongs: it exists to say what an
      // earlier revision did and why it stopped. Everything else in the file describes what ran.
      ? JSON.stringify({ ...audit, revision_history: [] })
      : readFileSync(join(root, path), "utf8");
    for (const command of RETIRED_COMMANDS) {
      assert.ok(!text.includes(command), `${path} describes the collector as running \`${command}\`, which it does not`);
    }
  }
  // And against the receipts rather than against prose: what ran is what the observation recorded.
  const commands = audit.live_observation.receipts.map((receipt) => receipt.command);
  for (const command of RETIRED_COMMANDS) {
    assert.equal(commands.filter((one) => one.includes(command)).length, 0, `the observation carries a receipt for \`${command}\``);
  }
  assert.ok(commands.some((one) => one.includes("merge-base --is-ancestor")), "no ancestry receipt at all, so this test is not measuring the collector that ran");
});

test("a multi-phase issue is not closed by the phase that has run", async () => {
  const audit = loadAudit();
  const { PHASED_ISSUES } = await import("../../lib/execution-plan.mjs");
  const phases = PHASED_ISSUES[audit.issue];
  assert.ok(phases, `the canonical plan records no phases for #${audit.issue}`);
  assert.ok(Object.keys(phases).length > 1, `#${audit.issue} is not multi-phase, so this test would check nothing`);
  assert.equal(audit.closes_issue, false, "the audit does not record that this phase must not close the issue");
  assert.equal(audit.lifecycle.phase_completed, audit.phase, "the audit's lifecycle record disagrees with its own phase");
  assert.ok(Object.keys(phases).includes(audit.lifecycle.phase_outstanding), `the outstanding phase "${audit.lifecycle.phase_outstanding}" is not one the canonical plan knows about`);
  assert.notEqual(audit.lifecycle.phase_outstanding, audit.phase, "the outstanding phase is the one that already ran");
  assert.equal(audit.phase_b_contract.deletion_log_status, "NOT_YET", "the outstanding phase's output is recorded as done");
});

// The sweep's hits were collected and only its completeness was read, so a record could report
// fewer references than the search returned and nothing compared the two.
test("a record that under-reports the references the sweep returned is refused", () => {
  const audit = loadAudit();
  const withHits = audit.branches.find((entry) => entry.references.github_search.issues.length + entry.references.github_search.prs.length > 0);
  assert.ok(withHits, "no branch has a GitHub reference, so this test would check nothing");
  for (const patch of [
    { issues: [], prs: [] },
    { total_count: 0 }
  ]) {
    const forged = withBranch(audit, withHits.name, { references: { ...withHits.references, github_search: { ...withHits.references.github_search, ...patch } } });
    assert.notDeepEqual(derivationFindings(forged), [], `a record dropping ${JSON.stringify(patch)} from its reference scan passed`);
  }
});
