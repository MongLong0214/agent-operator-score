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
import { REQUIRED_DERIVATIONS, observationDigest, verifyObservation } from "../../scripts/collect-branch-state.mjs";

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
  assert.equal(audit.schema, "aos-stale-branch-audit.v4");
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
  assert.equal(observation.schema, "aos-branch-live-observation.v2");
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
      assert.ok(audit.live_observation.receipts.some((r) => r.source === derived[field].source), `${entry.name}: ${field} cites a receipt that is not there`);
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
  const live = { schema: "aos-branch-live-observation.v2", heads, rest_heads: heads, open_prs: [] };
  const findings = auditCoverageFindings(audit, live);
  assert.ok(findings.some((f) => f.includes("task/issue-000-unaudited") && f.includes("appears nowhere in this audit")), `an unaudited live head passed coverage: ${findings.join(" | ")}`);
  assert.ok(findings.some((f) => f.includes("no open pull request")), "the audit's own after-snapshot branch was excused without a PR in this observation");

  // The audit's own branch is claimed under the after-snapshot exception, so a clean observation has
  // to show its pull request open -- that is what earns the exception.
  const self = audit.heads_created_after_this_snapshot[0];
  const consistent = {
    schema: "aos-branch-live-observation.v2",
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

// The exception is not the name being on a list. An earlier version excused any name written into
// `heads_created_after_this_snapshot`, so an orphan branch created after the snapshot could be
// covered by asserting it. It is now excused only while an open pull request has it as a head.
test("an after-snapshot head is excused only while an open PR has it as a head", () => {
  const audit = loadAudit();
  const self = audit.heads_created_after_this_snapshot[0].name;
  const heads = [...audit.ls_remote_snapshot, { name: self, sha: "1".repeat(40) }];
  const withPr = { schema: "aos-branch-live-observation.v2", heads, rest_heads: heads, open_prs: [{ number: 612, head_branch: self, head_sha: "1".repeat(40), base: "dev", state: "OPEN" }] };
  assert.deepEqual(auditCoverageFindings(audit, withPr), [], "the audit's own branch was not excused while its PR was open");

  const withoutPr = { ...withPr, open_prs: [] };
  const findings = auditCoverageFindings(audit, withoutPr);
  assert.ok(findings.some((f) => f.includes(self) && f.includes("no open pull request")), `an unbacked after-snapshot head was excused: ${findings.join(" | ")}`);

  // The reviewer's reproduction: an arbitrary orphan written into the list and present live.
  const orphan = "task/later-orphan";
  const forged = { ...audit, heads_created_after_this_snapshot: [...audit.heads_created_after_this_snapshot, { name: orphan, sha: null, classification: "ACTIVE", note: "x".repeat(50) }] };
  const orphanHeads = [...audit.ls_remote_snapshot, { name: orphan, sha: "2".repeat(40) }];
  const orphanLive = { schema: "aos-branch-live-observation.v2", heads: orphanHeads, rest_heads: orphanHeads, open_prs: [] };
  assert.notDeepEqual(auditCoverageFindings(forged, orphanLive), [], "an arbitrary after-snapshot orphan was silently considered covered");
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
  assert.match(contract.entry_point, /authorizeDeletion/u, "the contract does not name the entry point that collects its own observation");
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
      supersedes_commits: Array.from({ length: active.unique_commits_vs_dev_and_main }, (_unused, index) => String(index).padStart(40, "0"))
    },
    reason: "The work was reimplemented on dev under PR #610 and this branch's commits are individually accounted for by that replacement."
  });
  assert.deepEqual(classificationFindings(forged), [], `a reimplemented SUPERSEDED branch was refused: ${classificationFindings(forged).join(" | ")}`);
  assert.ok(deletionEligibility(forged).eligible.some((e) => e.name === active.name), "a SUPERSEDED branch with full replacement evidence was not deletion-eligible");
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
