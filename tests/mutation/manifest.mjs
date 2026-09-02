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
    guard: "an alias is the node it names",
    reason: "an alias that resolves to nothing is a mapping's inherited keys silently vanishing, and answering wrongly is worse than refusing",
    file: "lib/action-pins.mjs",
    from: "    const target = anchors.get(source.slice(from, at));",
    to: "    const target = null;",
    test: "tests/product/action-pins.test.mjs",
    name: "an alias is the node it names, so a merge key cannot hide a reference or a permission"
  },
  {
    guard: "merge keys bring their keys with them",
    reason: "`<<: *defaults` is where a step's action reference and a job's permissions live, and dropping it hides both",
    file: "lib/action-pins.mjs",
    from: "    if (!node.entries.some((entry) => entry.key === \"<<\")) return node;",
    to: "    return node;",
    test: "tests/product/action-pins.test.mjs",
    name: "an alias is the node it names, so a merge key cannot hide a reference or a permission"
  },
  {
    guard: "quoted keys are keys",
    reason: "a quoted key is a real mapping key GitHub honours, and a reader that only knows the bare spelling does not see the mapping at all",
    file: "lib/action-pins.mjs",
    from: "const KEY_TEXT = /^(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^']|'')*'|[^\\s#\"'{}[\\],*&!|>%@`:](?:[^:#]|:(?=\\S))*?)\\s*:(\\s|$)/;",
    to: "const KEY_TEXT = /^(?:[^\\s#\\\"'{}[\\],*&!|>%@`:](?:[^:#]|:(?=\\S))*?)\\s*:(\\s|$)/;",
    test: "tests/product/action-pins.test.mjs",
    name: "the uses spellings GitHub honours are seen, escapes included, and inert text is not"
  },
  {
    guard: "a resolved key is the key",
    reason: "the permission audit read the characters rather than the key, so a job-level \"permissions\" in quotes was no permission at all and the baseline that recorded none still matched",
    file: "lib/action-pins.mjs",
    from: "      const key = character === '\"' ? readDoubleQuoted().value : readSingleQuoted().value;",
    to: "      const key = JSON.stringify(character === '\"' ? readDoubleQuoted().value : readSingleQuoted().value);",
    test: "tests/product/action-pins.test.mjs",
    name: "a quoted permissions key is the same key, so a job cannot gain write access behind quotes"
  },
  {
    guard: "escaped key resolved before it is a key",
    reason: "YAML unescapes \"r\\u0075n\" to run before it is a key, so matching the characters on the line matches something YAML has stopped calling that key",
    file: "lib/action-pins.mjs",
    from: "  if (code.length > 1) return String.fromCodePoint(Number.parseInt(code.slice(1), 16));",
    to: "  if (false) return \"\";",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses key spelled with an escape is seen, and an escaped run key stays inert"
  },
  {
    guard: "flow-mapping uses",
    reason: "`- { uses: attacker/evil@main }` is a step GitHub runs, and a reader that treats braces as text never sees it",
    file: "lib/action-pins.mjs",
    from: "    if (character === \"{\" || character === \"[\") return finishLine(readFlow());",
    to: "    if (false) return finishLine(readFlow());",
    test: "tests/product/action-pins.test.mjs",
    name: "the uses spellings GitHub honours are seen, escapes included, and inert text is not"
  },
  {
    guard: "block scalar measured from its key",
    reason: "a block scalar on a dashed line ends two columns inside the dash, so measuring it from the line swallowed every sibling of that key -- the uses beside it included",
    file: "lib/action-pins.mjs",
    from: "        if (here < indent) break;",
    to: "        if (here <= keyIndent - 2) break;",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses beside a block scalar in the same step is not swallowed by it"
  },
  {
    guard: "explicit keys are keys",
    reason: "`? uses` / `: value` resolves to a uses key GitHub runs, and it can be written as a folded scalar that no single-line pattern can see",
    file: "lib/action-pins.mjs",
    from: "      if (explicitHere()) entries.push(readExplicitEntry(indent));",
    to: "      if (false) entries.push(readExplicitEntry(indent));",
    test: "tests/product/action-pins.test.mjs",
    name: "an explicit key, folded over lines, is still the key it spells"
  },
  {
    guard: "version comment after a flow mapping",
    reason: "the comment sits outside the braces, so losing it turns a correctly pinned reference into a pin with no readable version",
    file: "lib/action-pins.mjs",
    from: "    const carried = node.flow && node.comment && usesCount(node, chain) === 1 ? node.comment : inherited;",
    to: "    const carried = inherited;",
    test: "tests/product/action-pins.test.mjs",
    name: "a version comment after a flow mapping is kept"
  },
  {
    guard: "carriage returns stripped",
    reason: "a workflow written on Windows leaves a carriage return on every value, and an ordinary pinned reference came back unreadable",
    file: "lib/action-pins.mjs",
    from: "  const source = text.replace(/\\r\\n?/g, \"\\n\");",
    to: "  const source = text;",
    test: "tests/product/action-pins.test.mjs",
    name: "a workflow with CRLF line endings reads the same as one without"
  },
  {
    guard: "uses under with: or env: is an input",
    reason: "an input that happens to be called uses is not an action reference, and reporting it was a false positive on valid YAML",
    file: "lib/action-pins.mjs",
    from: "      if (entry.key === \"uses\" && !chain.includes(\"with\") && !chain.includes(\"env\")) {",
    to: "      if (entry.key === \"uses\") {",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses under with: or env: is an input, not an action reference"
  },
  {
    guard: "a refused file fails the check",
    reason: "\"I could not read this file\" and \"this file is clean\" are the two answers that must never look the same",
    file: "lib/action-pins.mjs",
    from: "    return [{ line: Number(/at line (\\d+)/.exec(error.message)?.[1] ?? 1), raw: null, comment: null, form: \"unreadable\" }];",
    to: "    return [];",
    test: "tests/product/action-pins.test.mjs",
    name: "a file the reader cannot read fails the check rather than passing it"
  },
  {
    guard: "supply-chain digest covers the .npmrc",
    reason: "script-shell in a repository .npmrc makes every npm script exit zero without running anything, which decides the outcome while leaving every other hashed byte identical",
    file: "lib/action-pins.mjs",
    from: "  const npmrcBytes = existsSync(npmrc) ? createHash(\"sha256\").update(readFileSync(npmrc)).digest(\"hex\") : \"absent\";",
    to: "  const npmrcBytes = \"absent\";",
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the verifier, the npm script and the .npmrc that run the check"
  },
  {
    guard: "directory skip list",
    reason: "skipping node_modules and dist by name is skipping the place someone would put it",
    file: "lib/action-pins.mjs",
    from: 'const SKIP_DIRECTORIES = new Set([".git"]);',
    to: 'const SKIP_DIRECTORIES = new Set([".git", "dist", "node_modules"]);',
    test: "tests/product/action-pins.test.mjs",
    name: "discovery finds workflows by shape, and skips .git and symlinks"
  },
  {
    guard: "supply-chain digest covers the verifier",
    reason: "the verifier combines the two results and sets the exit status, so `ok: true` there turns failure into success with every hashed byte unchanged",
    file: "lib/action-pins.mjs",
    from: "  const runnerBytes = createHash(\"sha256\").update(readFileSync(new URL(\"../scripts/verify-action-pins.mjs\", import.meta.url))).digest(\"hex\");",
    to: "  const runnerBytes = \"\";",
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the verifier, the npm script and the .npmrc that run the check"
  },
  {
    guard: "local reference redirection",
    reason: "a local composite action is a bridge to whatever external action it names",
    file: "lib/action-pins.mjs",
    from: "        if (!target) localMissing.push({ ...where, reason: \"no action.yml at that path\" });",
    to: "        if (!target) { /* skipped */ }",
    test: "tests/product/action-pins.test.mjs",
    name: "a local reference pointing at nothing fails"
  },
  {
    guard: "container image digest",
    reason: "docker://image:latest is attacker-controlled external code on a runner with our credentials",
    file: "lib/action-pins.mjs",
    from: '        if (!IMAGE_DIGEST.test(reference.digest ?? "")) {',
    to: "        if (false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "a container action is external code and needs a digest too"
  },
  {
    guard: "version comment is a version",
    reason: '"definitely v99, trust me" is a comment, not something a reviewer can check',
    file: "lib/action-pins.mjs",
    from: "      if (!use.comment || !versionComment.test(use.comment)) {",
    to: "      if (!use.comment && false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "a comment that is not a version is not a version"
  },
  {
    guard: "unreadable directory reported",
    reason: "a directory the scan cannot read has unknown contents, and unknown is not a pass",
    file: "lib/action-pins.mjs",
    from: '      unreadable.push({ directory: relative(root, directory).split(sep).join("/") || ".", reason: error.code ?? "unreadable" });',
    to: "      return;",
    test: "tests/product/action-pins.test.mjs",
    name: "a directory the scan cannot read is reported, not skipped"
  },
  {
    guard: "supply-chain digest covers the policy",
    reason: "reviewed_actions could change what passes while the digest stayed identical",
    file: "lib/action-pins.mjs",
    from: "  const policyBytes = createHash(\"sha256\").update(JSON.stringify(policy)).digest(\"hex\");",
    to: '  const policyBytes = "";',
    test: "tests/product/action-pins.test.mjs",
    name: "the supply-chain digest covers the policy that decides what passes"
  },
  {
    guard: "full-SHA action reference",
    reason: "a tag is a name whose owner decides which commit it means, at any time and retroactively",
    file: "lib/action-pins.mjs",
    from: "export const ACTION_REF = /^[0-9a-f]{40}$/;",
    to: "export const ACTION_REF = /^[0-9a-fA-Fv.]{2,40}$/;",
    test: "tests/product/action-pins.test.mjs",
    name: "a full lowercase forty-character SHA is the only external reference that passes"
  },
  {
    guard: "composite action discovery",
    reason: "a workflow saying `uses: ./dist` runs dist/action.yml, which can name any external action",
    file: "lib/action-pins.mjs",
    from: "      const isAction = /^action\\.ya?ml$/.test(entry.name);",
    to: '      const isAction = entry.name === "never-matches.yml";',
    test: "tests/product/action-pins.test.mjs",
    name: "a local action is a redirection, not a free pass"
  },
  {
    guard: "unreadable uses: fails closed",
    reason: "a scanner that shrugs at what it cannot parse reports green on the line written to be misunderstood",
    file: "lib/action-pins.mjs",
    from: "        unparsable.push(where);",
    to: "        continue;",
    test: "tests/product/action-pins.test.mjs",
    name: "a uses: line the scanner cannot parse fails rather than being skipped"
  },
  {
    guard: "reviewed action allowlist",
    reason: "a pinned commit from an action nobody looked at is still code nobody looked at",
    file: "lib/action-pins.mjs",
    from: "      if (!reviewed.has(action)) {",
    to: "      if (false) {",
    test: "tests/product/action-pins.test.mjs",
    name: "the allowlist is per action, not per owner"
  },
  {
    guard: "workflow permission drift",
    reason: "a pin refresh that quietly arrives with contents: write is the change this watches for",
    file: "lib/action-pins.mjs",
    from: 'if (before !== after) fail("permission-drift", name, `recorded ${before}, found ${after}`);',
    to: "if (false) fail();",
    test: "tests/product/action-pins.test.mjs",
    name: "a job that quietly gains write access fails"
  },
  {
    guard: "execution plan cycle detection",
    reason: "a dependency cycle sends an agent to work that can never be unblocked",
    file: "lib/execution-plan.mjs",
    from: "      if (onStack.has(next)) {",
    to: "      if (false) {",
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
    guard: "phase-ready scope",
    reason: "a phase opened while its issue is blocked must not merge the integration the block withholds",
    file: "lib/execution-plan.mjs",
    from: 'if (phase.status === "ready" && one.status !== "ready" && phase.code_integration_allowed) {',
    to: "if (false) {",
    test: "tests/product/execution-plan.test.mjs",
    name: "a phase-ready phase that claims final integration exceeds its scope and fails"
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
