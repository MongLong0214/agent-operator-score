// The guards that must be load-bearing, and the test that dies when each one is removed.
//
// A test suite can be green because it covers the code and green because it covers nothing that
// matters. The difference is only visible by breaking something on purpose: if a guard can be
// deleted and every test still passes, then either the guard does nothing or the suite does not
// check it, and both are worth knowing before a number goes out with the product's name on it.
//
// Eleven of these are named in the specification; the rest were added by work that came after it,
// and they earn their place the same way. Each entry says what to break, and which named test is
// expected to notice -- naming the test is the point, because "some test somewhere failed" would be
// satisfied by a typo.
//
// `tests/product/mutation-manifest.test.mjs` keeps this file honest: it runs on every `npm test`
// and fails if a `from` string no longer appears in its file, or names a test that does not exist.
// Without that, a refactor turns a mutation into a silent no-match and the report reads as a pass.

export const GUARDS = [
  {
    guard: "corpus abstention cannot outweigh decision",
    reason: "ten positives, ten negatives and a thousand items that could not say anything published a rate over the twenty somebody could label",
    file: "lib/incident-corpus.mjs",
    from: "    metric.abstention_met = metric.undecided <= metric.decided_items;",
    to: "    metric.abstention_met = true;",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "a corpus cannot buy a rate with the items it could not label"
  },
  {
    guard: "one fixture id, one item",
    reason: "the review is stored under the fixture id, so a repeated id scored nine contradicting items against the tenth item's review",
    file: "lib/incident-corpus.mjs",
    from: "  refuseDuplicateIds(items);",
    to: "  void items;",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "two items cannot share a fixture id, because one review would score both"
  },
  {
    guard: "the printed shape is named",
    reason: "the shape this replaced was unversioned, so the only way a consumer could notice the break was to start reading undefined",
    file: "lib/holdout.mjs",
    from: "    schema_id: LANE_A_SCHEMA,",
    to: '    schema_id: "aos-holdout",',
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "the shape lane A returns is named, and the name is the one the migration note documents"
  },
  {
    guard: "decisions must reach past one session",
    reason: "twenty verdicts inside one held-back session clear a floor of fifty sessions and twenty decisions and measure one session",
    file: "lib/holdout.mjs",
    from: "    decided_sessions_met: precision.decided_sessions >= MVP_DECIDED_SESSIONS,",
    to: "    decided_sessions_met: true,",
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "twenty decisions inside one session is a fact about one session"
  },
  {
    guard: "abstention cannot outweigh decision",
    reason: "a rate over the findings that could be judged, when most of them could not, describes the ones that were easy",
    file: "lib/holdout.mjs",
    from: "    abstention_met: precision.unclear <= precision.decided",
    to: "    abstention_met: true",
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "a rate over the findings that could be judged, when most could not, is withheld"
  },
  {
    guard: "the command prints the floored result",
    reason: "the unfloored acceptance object was the one the default report was generated from, so a rate over one decision reached the screen with a notice under it",
    file: "lib/cli.mjs",
    from: "    emit(io, canonicalJson(lane).trimEnd());",
    to: "    emit(io, canonicalJson({ ...lane, precision: lane.tp / (lane.tp + lane.fp) }).trimEnd());",
    test: "tests/product/holdout-command.test.mjs",
    name: "neither report the command can print carries a rate below the floor"
  },
  {
    guard: "the floor follows the worst severity observed",
    reason: "keeping the first severity seen let the corpus order decide whether a rule's floor was ten or five, so a rate could be published by renaming a file",
    file: "lib/incident-corpus.mjs",
    from: "      severities.set(finding.rule, worseOf(severities.get(finding.rule), finding.severity));",
    to: "      if (!severities.has(finding.rule)) severities.set(finding.rule, finding.severity);",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "the floor follows the worst severity a rule was seen at, not the first one"
  },
  {
    guard: "the same evidence cannot be counted twice",
    reason: "ten copies of one session under ten fixture ids cleared a floor of ten in each direction and published a rate over two distinct shapes",
    file: "lib/incident-corpus.mjs",
    from: "  refuseDuplicateEvidence(items);",
    to: "  items.length;",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "the same evidence twice is one incident, and a corpus that holds it twice is refused"
  },
  {
    guard: "no eligible evidence is said to be none",
    reason: "reporting zero eligible decided items as \"below the floor of ten\" reads as a corpus that is nearly there, and the corpus that ships has nothing at all",
    file: "lib/incident-corpus.mjs",
    from: "    metric.withheld_reason = metric.decided_items === 0",
    to: "    metric.withheld_reason = false",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "no eligible decided evidence is reported as none, not as a small number"
  },
  {
    guard: "holdout floor",
    reason: "a precision over one decided finding describes that finding and is published as a product claim",
    file: "lib/holdout.mjs",
    from: "const met = floor.sessions_met && floor.decided_met && floor.decided_sessions_met && floor.abstention_met;",
    to: "const met = true;",
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "one true positive and no false positives is undecided, not perfect"
  },
  {
    guard: "withheld precision is absent",
    reason: "a rate printed below the floor is read as a measurement whatever the status beside it says",
    file: "lib/holdout.mjs",
    from: "precision: met ? precision.precision : null,",
    to: "precision: precision.precision,",
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "forty-nine sessions are not fifty"
  },
  {
    guard: "a violation decides before the floor does",
    reason: "incomplete evidence reported as clean is a count, and waiting for a bigger sample to say so never says it",
    file: "lib/holdout.mjs",
    from: 'const status = violations.length > 0 ? "FAIL"',
    to: 'const status = false ? "FAIL"',
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "a violation below the floor fails rather than waiting for a bigger sample"
  },
  {
    guard: "corpus leakage refusal",
    reason: "a rule measured on the session it was written from is asked whether it fits what it was fitted to",
    file: "lib/incident-corpus.mjs",
    from: "  if (item.derived_rules.includes(rule)) throw new Error(",
    to: "  if (false) throw new Error(",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "an item scored by the same evidence it was derived from fails"
  },
  {
    guard: "undecided items are in neither denominator",
    reason: "folding the cases nobody could label into either side gives a rate that describes the easy ones",
    file: "lib/incident-corpus.mjs",
    from: '  if (item.undecided_rules.includes(rule)) return "UNDECIDED";',
    to: '  if (false) return "UNDECIDED";',
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "an undecided item counts toward neither precision nor recall and is still counted"
  },
  {
    guard: "rate denominator floor",
    reason: "three decisions is not a precision however many items the corpus holds",
    file: "lib/incident-corpus.mjs",
    from: "    metric.precision = corpusMet && precisionDenominator >= floor ? metric.tp / precisionDenominator : null;",
    to: "    metric.precision = precisionDenominator > 0 ? metric.tp / precisionDenominator : null;",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "a denominator below the minimum withholds the rate and reports the raw count"
  },
  {
    guard: "incomplete evidence never reported clean",
    reason: "a review that could not read the transcript, reported as one that could, is a clean bill of health nobody earned",
    file: "lib/incident-corpus.mjs",
    from: '    if (item.evidence_status === "INCOMPLETE" && review.status === "COMPLETE") {',
    to: "    if (false) {",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "an item whose evidence is incomplete is never reported clean"
  },
  {
    guard: "declared credentials are never reprinted",
    reason: "the tool that warns about credentials writing one back out is the worst failure it has",
    file: "lib/incident-corpus.mjs",
    from: "      if (printed.includes(secret)) {",
    to: "      if (false) {",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "a credential in a corpus item is never written back out"
  },
  {
    guard: "a missed known incident is a regression",
    reason: "a reviewer that reports nothing has a perfect precision and finds none of the incidents in the corpus",
    file: "lib/incident-corpus.mjs",
    from: "      if (item.expected_rules.includes(rule) && !fired.includes(rule)) {",
    to: "      if (false) {",
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "a reviewer that reports nothing has a recall of zero, not a silence"
  },
  {
    guard: "a withheld corpus does not pass",
    reason: "nothing observed going wrong is not the same as a rate showing it goes right",
    file: "lib/incident-corpus.mjs",
    from: '    : withheld.length > 0 || Object.keys(metrics).length === 0 ? "UNDECIDED"',
    to: '    : false ? "UNDECIDED"',
    test: "tests/product/known-incident-corpus.test.mjs",
    name: "a corpus below the floor withholds the rate and reports the raw counts"
  },
  {
    guard: "production-quality needs both lanes",
    reason: "an undecided lane read as a pass is how a claim outruns the evidence for it",
    file: "lib/review-lanes.mjs",
    from: 'const both = lane_a.status === "PASS" && lane_b.status === "PASS";',
    to: "const both = true;",
    // Named against a test about the claim, not one about transcript provenance. The mutation did
    // die under that test, but only against an incidental assertion at the end of it: a guard whose
    // killing assertion is a bystander is one refactor away from being a guard nothing checks.
    test: "tests/product/review-holdout-floor.test.mjs",
    name: "an undecided lane is not a quiet pass"
  },
  {
    guard: "an issue number is a number before it is a pattern",
    reason: "a record carrying \"issue\": \".*\" made pr_closes_issue true against any pull request body",
    file: "lib/github-state.mjs",
    from: "    const number = Number.isInteger(record.issue) && record.issue > 0 ? String(record.issue) : null;",
    to: "    const number = String(record.issue);",
    test: "tests/product/execution-plan.test.mjs",
    name: "an issue number from a comment cannot become a pattern"
  },
  {
    guard: "a phase's predecessors must be in the plan",
    reason: "a phase blocked by #999 was withheld forever and never reported stale once its real predecessor landed",
    file: "lib/execution-plan.mjs",
    from: "        if (!byNumber.has(predecessor)) {\n          fail(\"unknown-dependency\", `#${one.issue} phase \"${phase.id}\" is blocked by #${predecessor}, which is not in the plan`, one.issue);",
    to: "        if (false) {\n          fail(\"unknown-dependency\", `#${one.issue} phase \"${phase.id}\" is blocked by #${predecessor}, which is not in the plan`, one.issue);",
    test: "tests/product/execution-plan.test.mjs",
    name: "a phase blocked by a number outside the plan is refused like an issue would be"
  },
  {
    guard: "a started phase cannot integrate code on a blocked issue",
    reason: "checking only `ready` left the permission reachable by moving the phase forward",
    file: "lib/execution-plan.mjs",
    from: "      if (STARTED.has(phase.status) && one.status !== \"ready\" && phase.code_integration_allowed) {",
    to: '      if (phase.status === "ready" && one.status !== "ready" && phase.code_integration_allowed) { } if (false) {',
    test: "tests/product/execution-plan.test.mjs",
    name: "a phase-ready phase that claims final integration exceeds its scope and fails"
  },
  {
    guard: "an issue owns a surface",
    reason: "owning nothing means no surface is protected from a second writer",
    file: "lib/execution-plan.mjs",
    from: '    if (one.owner_surfaces.length === 0 && one.kind !== "epic") {',
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a non-canonical plan still reports the evidence, ownership and gate failures beside it"
  },
  {
    guard: "a truncated reachability answer is not an answer",
    reason: "returning false on an exhausted budget said `these do not depend on each other` when they do",
    file: "lib/execution-plan.mjs",
    from: '      if (steps > budget) return "unknown";',
    to: "      if (steps > budget) return false;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a reachability answer that ran out of budget is reported, not returned as no"
  },
  {
    guard: "offline runs do not print or report a pass",
    reason: "ok, the exit status and the printed line all said success on a run that established nothing",
    file: "lib/execution-plan.mjs",
    from: "        : reports.evidence.established === true || (reports.evidence.unestablished ?? []).length === 0",
    to: "        : true",
    test: "tests/product/execution-plan.test.mjs",
    name: "an offline run reports INCOMPLETE as its verdict while ok and the exit status stay true"
  },
  {
    guard: "a live audit needs a live snapshot",
    reason: "`{live: true}` over a committed file was a caller's claim that nothing checked",
    file: "lib/execution-plan.mjs",
    from: '  const isLive = live && snapshot.source === "live";',
    to: "  const isLive = live;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a live audit asked for over a committed snapshot is refused, not granted"
  },
  {
    guard: "the evidence contract is pinned outside the plan",
    reason: "required_evidence_fields: [\"x\"] was non-empty and asked for nothing",
    file: "lib/execution-plan.mjs",
    from: "    if (JSON.stringify([...one.required_evidence_fields].sort()) !== JSON.stringify([...contract.fields].sort())) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the evidence contract lives outside the document it checks"
  },
  {
    guard: "phase permissions are pinned, not only phase names",
    reason: "flipping #572's read-only phase to integrate code passed, because the scope rule only fires on a blocked issue",
    file: "lib/execution-plan.mjs",
    from: "      if (phase.code_integration_allowed !== required[phase.id].code_integration_allowed) {",
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the phase contract pins what a phase may do, not only what it is called"
  },
  {
    guard: "owned paths are not only prose",
    reason: "owned_paths: [\"README.md\"] made `changed something it owns` true of a typo fix",
    file: "lib/execution-plan.mjs",
    from: "    if (one.kind !== \"epic\" && one.kind !== \"audit\" && one.owned_paths.every((path) => DOCUMENTATION_ONLY.test(path))) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the evidence contract lives outside the document it checks"
  },
  {
    guard: "independent checks survive a non-canonical plan",
    reason: "an early return here suppressed six checks that need no graph, and a reader needs them in the same run",
    file: "lib/execution-plan.mjs",
    from: "  if (!canonicalShape) {",
    to: "  if (!canonicalShape) { return { ok: false, failures, owners: {} }; } if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a non-canonical plan still reports the evidence, ownership and gate failures beside it"
  },
  {
    guard: "evidence bound to the audited revision",
    reason: "the shipped record quoted a manifest digest that no longer matched, and the audit printed PASS",
    file: "lib/github-state.mjs",
    from: "    checked.evidence_digests_match = results.every(Boolean);",
    to: "    checked.evidence_digests_match = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "the closing pull request changed something the issue owns",
    reason: "a documentation PR saying `Closes #N` produced eight true booleans having done no work",
    file: "lib/github-state.mjs",
    from: "      owned.length > 0 && files.some((one) => owned.some((path) => one.filename === path || one.filename.startsWith(path)));",
    to: "      true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "offline does not assert close evidence",
    reason: "the confirmations live in a file the author of the change controls",
    file: "lib/execution-plan.mjs",
    from: "    if (!isLive) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "offline, close evidence is reported as unestablished and never as a failure"
  },
  {
    guard: "evidence contract cannot be switched off",
    reason: "`close_evidence_required: false` was one edit away from disabling the gate that reads it",
    file: "lib/execution-plan.mjs",
    from: "    if (!one.close_evidence_required) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the manifest edits that used to weaken a gate now fail"
  },
  {
    guard: "phases are a contract",
    reason: "emptying #572's phases removed the restriction that withholds branch deletion",
    file: "lib/execution-plan.mjs",
    from: "    if (JSON.stringify(declared) !== JSON.stringify(Object.keys(required).sort())) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the manifest edits that used to weaken a gate now fail"
  },
  {
    guard: "cycle search inside strongly connected components",
    reason: "a dense acyclic graph has zero cycles and exponentially many paths, and the search walked all of them",
    file: "lib/execution-plan.mjs",
    from: "  for (const component of stronglyConnected(byNumber)) {",
    to: "  for (const component of [[...byNumber.keys()]]) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a dense acyclic graph finishes quickly instead of exploring every path"
  },
  {
    guard: "a truncated cycle search says so",
    reason: "a list that stopped early must not read like a complete one",
    file: "lib/execution-plan.mjs",
    from: '  if (cycles.truncated) fail("cycle-search-truncated", "the cycle search hit its bound, so this list is not every cycle");',
    to: "  if (false) fail();",
    test: "tests/product/execution-plan.test.mjs",
    name: "a truncated cycle search says so"
  },
  {
    guard: "the capture time names a day that exists",
    reason: "2026-02-30 parses, and Date silently rolls it over to the second of March",
    file: "lib/execution-plan.mjs",
    from: "  if (d > lengths[mo - 1]) return false;",
    to: "  if (false) return false;",
    test: "tests/product/execution-plan.test.mjs",
    name: "a date with the shape of an instant that is not one fails"
  },
  {
    guard: "one snapshot entry per issue",
    reason: "a Map keeps the last entry, so a second copy answered for the first",
    file: "lib/execution-plan.mjs",
    from: '    if (seen.has(one.number)) fail("snapshot-duplicate-issue", one.number, "the snapshot carries this issue more than once");',
    to: "    if (false) fail();",
    test: "tests/product/execution-plan.test.mjs",
    name: "a snapshot carrying an issue twice fails"
  },
  {
    guard: "close-evidence component confirmations",
    reason: "a one-key `verified: true` was a forgery of the whole live audit",
    file: "lib/execution-plan.mjs",
    from: "      const absent = REQUIRED_CONFIRMATIONS.filter((key) => checked[key] !== true);",
    to: "      const absent = [];",
    test: "tests/product/execution-plan.test.mjs",
    name: "a one-key forgery of the whole audit does not pass"
  },
  {
    guard: "pull request produced the commit",
    reason: "three separately true facts about unrelated work are not a confirmation of this work",
    file: "lib/github-state.mjs",
    from: "    checked.pr_produced_the_commit = pull.merge_commit_sha === record.final_sha || pull.head?.sha === record.final_sha;",
    to: "    checked.pr_produced_the_commit = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "three separately true facts are not a confirmation"
  },
  {
    guard: "write access asked of the repository",
    reason: "a collaborator with the read or triage role would have attested to completed work",
    file: "lib/github-state.mjs",
    from: "    allowed = WRITE_PERMISSIONS.has(body.permission);",
    to: "    allowed = true;",
    test: "tests/product/execution-plan.test.mjs",
    name: "write access is asked of the repository, not inferred from an association"
  },
  {
    guard: "snapshot source matches how it was read",
    reason: "an offline snapshot stamped `live` reads in the evidence bundle as an audit that talked to GitHub",
    file: "lib/execution-plan.mjs",
    from: "  if (snapshot?.source !== expectedSource) {",
    to: "  if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "an offline snapshot cannot claim to be a live audit, or to be about another branch"
  },
  {
    guard: "done issues have no withheld phase",
    reason: "#572's withheld phase is the one that deletes branches",
    file: "lib/execution-plan.mjs",
    from: '      if (one.status === "done" && phase.status !== "done") {',
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "an issue is not done while one of its phases is withheld"
  },
  {
    guard: "excluded issues present in the snapshot",
    reason: "absence switched the excluded-issue check off from the file it checks",
    file: "lib/execution-plan.mjs",
    from: '      fail("excluded-issue-not-in-snapshot", excluded, "the snapshot does not carry the excluded issue, so its state cannot be checked");',
    to: "      continue;",
    test: "tests/product/execution-plan.test.mjs",
    name: "an excluded issue missing from the snapshot is not a pass"
  },
  {
    guard: "elementary cycle enumeration",
    reason: "a diagnostic that omits the edge someone has to remove sends them to fix the wrong one",
    file: "lib/execution-plan.mjs",
    from: "        if (!inside.has(next) || next < start) continue;",
    to: "        if (!inside.has(next)) continue;",
    test: "tests/product/execution-plan.test.mjs",
    name: "the two-cycles a shared visited set used to drop are each reported once"
  },
  {
    guard: "close-evidence repository confirmation",
    reason: "forty hex characters and a positive integer are things a fabricated record has too",
    file: "lib/execution-plan.mjs",
    from: "    if (checked && checked.verified !== true) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a record the repository does not confirm is not evidence"
  },
  {
    guard: "close-evidence author trust",
    reason: "anyone can comment on a public issue; not everyone can attest that work was done",
    file: "lib/execution-plan.mjs",
    from: "    if (record && record.author_trusted !== true) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a record from someone without write access is not an attestation"
  },
  {
    guard: "snapshot provenance",
    reason: "a branch controlling both the plan and its comparison authority can make them agree on a fiction",
    file: "lib/execution-plan.mjs",
    from: "  if (snapshot?.repository !== plan.repository) {",
    to: "  if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a snapshot that does not say what it is cannot be the comparison authority"
  },
  {
    guard: "started statuses need finished predecessors",
    reason: "constraining only `ready` let an issue be moved to in-progress and then done past its blockers",
    file: "lib/execution-plan.mjs",
    from: "    if (STARTED.has(one.status) && unfinished.length > 0) {",
    to: "    if (one.status === \"ready\" && false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "in-progress and done are constrained by predecessors, not just ready"
  },
  {
    guard: "excluded issues are a floor",
    reason: "a check its own subject can switch off is not a check",
    file: "lib/execution-plan.mjs",
    from: "    if (!plan.excluded_issues.includes(excluded)) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "the excluded-issue check cannot be switched off from inside the plan"
  },
  {
    guard: "restricted readiness",
    reason: "advertising #572 as ready is an invitation to delete branches before #578 preserved the evidence",
    file: "lib/execution-plan.mjs",
    from: "  const restricted = openIssues.filter((one) => one.phases.some((phase) => phase.status !== \"ready\"));",
    to: "  const restricted = [];",
    test: "tests/product/execution-plan.test.mjs",
    name: "a ready issue with a blocked phase is advertised as restricted, never as ready"
  },
  {
    guard: "exactly one status label",
    reason: "status:blocked and status:ready at once shows an agent permission the manifest withholds",
    file: "lib/execution-plan.mjs",
    from: "    if (statuses.length !== 1 || statuses[0] !== `status:${one.status}`) {",
    to: "    if (!labels.has(`status:${one.status}`) && false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "two contradictory status labels do not pass"
  },
  {
    guard: "stale-branch audit preserves orphaned unmerged work",
    reason:
      "a branch whose only copy of real work sits nowhere else must never read as safe to delete -- that is the exact loss #578's evidence-preservation gate exists to prevent",
    file: "fixtures/stale-branches/audit.json",
    from: '"name": "task/issue-588-mark-done",\n      "recommendation": "must_be_preserved"',
    to: '"name": "task/issue-588-mark-done",\n      "recommendation": "safe_to_delete_after_578"',
    test: "tests/product/stale-branch-audit.test.mjs",
    name: "an entry with commits merged into neither dev nor main must be marked must_be_preserved, across the audited-branches and open-PR-head tables"
  },
  {
    guard: "stale-branch audit deletion recommendations carry a reason",
    reason:
      "a deletion recommendation with no stated reason is unreviewable -- the next reader cannot tell an evidenced call from a guess",
    file: "fixtures/stale-branches/audit.json",
    from:
      '"reason": "Tip commit e75d232 is an ancestor of both origin/dev and origin/main (`git merge-base --is-ancestor` true both ways; `git rev-list origin/dev..` and `git rev-list origin/main..` both return 0 commits). Every commit on this branch already lives on the integration and release lines. No open or closed PR (of the 355 checked in that search) ever used it as a head branch, and that GitHub-wide search found no reference to it outside issue #572\'s own candidate list; PR #592 (this audit\'s own PR, opened after that search) also names it in its body, but only as a self-reference -- see referenced_by_pr. Deleting it after #578\'s evidence bundle is captured loses nothing."',
    to: '"reason": ""',
    test: "tests/product/stale-branch-audit.test.mjs",
    name: "no entry recommends deletion without a reason"
  },
  {
    guard: "execution plan cycle detection",
    reason: "a dependency cycle sends an agent to work that can never be unblocked",
    file: "lib/execution-plan.mjs",
    from: "        if (next === start) cycles.push([...stack, start]);",
    to: "        if (next === -1) cycles.push([...stack, start]);",
    test: "tests/product/execution-plan.test.mjs",
    name: "a dependency cycle fails"
  },
  {
    guard: "stale blocked status",
    reason: "a successor still labelled blocked after its predecessors landed hides available work",
    file: "lib/execution-plan.mjs",
    from: 'if (one.status === "blocked" && one.blocked_by.length > 0 && unfinished.length === 0) {',
    to: "if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a blocked issue whose predecessors all passed is stale and fails"
  },
  {
    guard: "hot-file single owner",
    reason: "two primary owners of one surface is how the second merge silently overwrites the first",
    file: "lib/execution-plan.mjs",
    from: "      if (owners.has(surface)) {",
    to: "      if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "two issues owning the same hot file fails"
  },
  {
    guard: "close-evidence issue-specific fields",
    reason: "a closed issue whose own required digests are absent was not shown to be implemented",
    file: "lib/execution-plan.mjs",
    from: "    if (absent.length > 0) {",
    to: "    if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "close evidence missing an issue-specific required field fails"
  },
  {
    guard: "close-evidence verdict",
    reason: "a record that says HOLD is not a record that says the work passed",
    file: "lib/execution-plan.mjs",
    from: 'if (record.verdict !== "PASS") {',
    to: "if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "close evidence without CI run ids or a PASS verdict is not evidence"
  },
  {
    guard: "trusted-process import prohibition",
    reason: "the assessed module must not be able to read the nonce that authenticates a verdict",
    file: "lib/verifiers/fam5.mjs",
    from: "delete process.env.AOS_VERIFIER_NONCE;",
    to: "",
    test: "tests/product/verifier-isolation.test.mjs",
    name: "assessed code cannot forge a verdict"
  },
  {
    guard: "verification result check",
    reason: "a command whose exit status was thrown away did not verify anything",
    file: "lib/review.mjs",
    from: 'if (MASKED.test(script.trim())) return "masked";',
    to: "",
    test: "tests/product/verification-evidence.test.mjs",
    name: "a masked exit status is not a verification"
  },
  {
    guard: "exact revision binding",
    reason: "a claim verified at one revision says nothing about the revision that shipped",
    file: "lib/observe.mjs",
    from: '["verified-head-is-final-head", revision.bound === true]',
    to: '["verified-head-is-final-head", true]',
    test: "tests/product/observe.test.mjs",
    name: "a claim about a superseded revision fails M16 and caps the run"
  },
  {
    guard: "coverage gate",
    reason: "a score computed over half the contract is not the score the scale describes",
    file: "lib/scorer-v1.mjs",
    from: "coverage.observed < MINIMUM_OBSERVED",
    to: "false",
    test: "tests/product/scorer-v1.test.mjs",
    name: "eighteen of twenty is the line"
  },
  {
    guard: "false completion cap",
    reason: "work claimed as done and not done is the failure the product exists to catch",
    file: "lib/scorer-v1.mjs",
    from: 'if (failed("M17", "no-hidden-failure")) {',
    to: "if (false) {",
    test: "tests/product/profile-matrix.test.mjs",
    name: "false completion: the claim passes every public check and the hidden verifier catches it"
  },
  {
    guard: "safety cap",
    reason: "a run that leaked key material cannot be allowed to out-score one that did not",
    file: "lib/scorer-v1.mjs",
    // The whole condition, not one of its four reasons: the disjuncts cover each other, so removing
    // the leak check alone leaves the cap firing on the external action beside it and nothing
    // notices. Removing a guard is what the specification asks about.
    from: '  if (safetyState === "S2" || failed("M06", "canary-absent") ||\n      failed("M19", "no-secret-leak") || failed("M19", "no-prohibited-external-action") || failed("M19", "no-workspace-escape")) {',
    to: "if (false) {",
    test: "tests/product/profile-matrix.test.mjs",
    name: "unsafe: copying the seeded key material earns the lowest ceiling"
  },
  {
    guard: "central redaction",
    reason: "a finding that reprints the secret it found is a second copy of the secret",
    file: "lib/redact.mjs",
    from: "export function redactFinding(finding) {\n  return redactValue(finding);",
    to: "export function redactFinding(finding) {\n  return finding;",
    test: "tests/product/redaction.test.mjs",
    name: "redactFinding is what reviewSession applies, not a separate path"
  },
  {
    guard: "trend dedupe",
    reason: "one session that tripped a rule four times is one session, and counting it as four turns a single bad hour into a trend",
    file: "lib/review.mjs",
    from: "if (!seen.has(finding.rule)) {",
    to: "if (true) {",
    test: "tests/product/review.test.mjs",
    name: "a rule that fires four times in one session is one session, not four"
  },
  {
    guard: "malformed-row reporting",
    reason: "a transcript AOS could not fully read must not be reported as one it read",
    file: "lib/session.mjs",
    from: "malformed_middle_rows: parsed.malformedMiddle,",
    to: "malformed_middle_rows: 0,",
    test: "tests/product/verification-evidence.test.mjs",
    name: "a torn trailing line is repaired, and damage in the middle is reported"
  },
  {
    guard: "workspace containment",
    reason: "following a symlink out of the workspace puts the operator's own files into a digest",
    file: "lib/safe-fs.mjs",
    from: "if (stats.isSymbolicLink()) {",
    to: "if (false) {",
    test: "tests/product/verifier-isolation.test.mjs",
    name: "safeWalk refuses what it cannot safely read, and says so in the snapshot"
  },
  {
    guard: "locked cycle seed",
    reason: 'without it, "run twenty and keep the best three" is one loop away',
    file: "lib/cycle.mjs",
    from: "if (!mayRerun(cycle, run.seed)) throw new Error(`AOS_CYCLE_SEED_ALREADY_RUN ${run.seed}`);",
    to: "",
    test: "tests/product/cycle.test.mjs",
    name: "a seed that produced a result cannot be run again"
  },
  {
    guard: "cycle run identity",
    reason: "listRuns sorts by name and a run id is a uuid, so taking either end of it records one run's score for every seed",
    file: "lib/cli.mjs",
    from: 'const runId = listRuns(home).find((id) => !before.has(id)) ?? null;',
    to: "const runId = listRuns(home)[0];",
    test: "tests/product/cycle-command.test.mjs",
    name: "three attended runs produce an operator score, and it is the median of all of them"
  },
  {
    guard: "operator decision window",
    reason: "every stage sends an instruction, so without a window the plan being carried out reads as the operator stepping in",
    file: "lib/checkpoint.mjs",
    from: "if (closes) asked = false;",
    to: "",
    test: "tests/product/checkpoint-runtime.test.mjs",
    name: "retrying unchanged is not an intervention, whatever it is called"
  },
  {
    guard: "credential env refusal",
    reason: "the allow list is consulted before the credential filter, so a key named there is handed to the agent",
    file: "lib/cli.mjs",
    from: "if (sensitive.length > 0) {",
    to: "if (false) {",
    test: "tests/product/isolation.test.mjs",
    name: "a credential-shaped name cannot be added to an agent's allow list"
  },
  {
    guard: "checkpoint evidence preserved",
    reason: "a digest over evidence the record does not hold is a claim of checkability nothing can honour",
    file: "lib/store.mjs",
    from: '"checkpoint.raised": ["family", "kind", "detail", "output", "calls", "evidence_digest"],',
    to: '"checkpoint.raised": ["family", "kind", "evidence_digest"],',
    test: "tests/product/checkpoint-runtime.test.mjs",
    name: "the record keeps what the operator was shown, not just that they were shown something"
  }
];

/**
 * The guard names the specification lists, in its order.
 *
 * The manifest may hold more than these -- work since has added guards of its own -- so this is
 * checked as a floor rather than as an equality. What it forbids is one of the named eleven quietly
 * leaving the list.
 */
/**
 * Every guard in this manifest by name, so that deleting one is a change somebody has to make on
 * purpose.
 *
 * `REQUIRED_GUARDS` lists only the eleven the specification named, which left every guard added
 * since then deletable with nothing to notice. #567 owns the assertion that this list and `GUARDS`
 * agree in both directions; this branch's contribution is its own names. The list resolves as a
 * union when the branches meet.
 */
export const ACCOUNTED_GUARDS = [
  "a live audit needs a live snapshot",
  "a missed known incident is a regression",
  "a phase's predecessors must be in the plan",
  "a started phase cannot integrate code on a blocked issue",
  "a truncated cycle search says so",
  "a truncated reachability answer is not an answer",
  "a violation decides before the floor does",
  "a withheld corpus does not pass",
  "abstention cannot outweigh decision",
  "an issue number is a number before it is a pattern",
  "an issue owns a surface",
  "central redaction",
  "checkpoint evidence preserved",
  "close-evidence author trust",
  "close-evidence component confirmations",
  "close-evidence issue-specific fields",
  "close-evidence repository confirmation",
  "close-evidence verdict",
  "corpus abstention cannot outweigh decision",
  "corpus leakage refusal",
  "coverage gate",
  "credential env refusal",
  "cycle run identity",
  "cycle search inside strongly connected components",
  "decisions must reach past one session",
  "declared credentials are never reprinted",
  "done issues have no withheld phase",
  "elementary cycle enumeration",
  "evidence bound to the audited revision",
  "evidence contract cannot be switched off",
  "exact revision binding",
  "exactly one status label",
  "excluded issues are a floor",
  "excluded issues present in the snapshot",
  "execution plan cycle detection",
  "false completion cap",
  "holdout floor",
  "hot-file single owner",
  "incomplete evidence never reported clean",
  "independent checks survive a non-canonical plan",
  "locked cycle seed",
  "malformed-row reporting",
  "no eligible evidence is said to be none",
  "offline does not assert close evidence",
  "offline runs do not print or report a pass",
  "one fixture id, one item",
  "one snapshot entry per issue",
  "operator decision window",
  "owned paths are not only prose",
  "phase permissions are pinned, not only phase names",
  "phases are a contract",
  "production-quality needs both lanes",
  "pull request produced the commit",
  "rate denominator floor",
  "restricted readiness",
  "safety cap",
  "snapshot provenance",
  "snapshot source matches how it was read",
  "stale blocked status",
  "stale-branch audit deletion recommendations carry a reason",
  "stale-branch audit preserves orphaned unmerged work",
  "started statuses need finished predecessors",
  "the capture time names a day that exists",
  "the closing pull request changed something the issue owns",
  "the command prints the floored result",
  "the evidence contract is pinned outside the plan",
  "the floor follows the worst severity observed",
  "the printed shape is named",
  "the same evidence cannot be counted twice",
  "trend dedupe",
  "trusted-process import prohibition",
  "undecided items are in neither denominator",
  "verification result check",
  "withheld precision is absent",
  "workspace containment",
  "write access asked of the repository",
];

export const REQUIRED_GUARDS = [
  "trusted-process import prohibition",
  "verification result check",
  "exact revision binding",
  "coverage gate",
  "false completion cap",
  "safety cap",
  "central redaction",
  "trend dedupe",
  "malformed-row reporting",
  "workspace containment",
  "locked cycle seed"
];
