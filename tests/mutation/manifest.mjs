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
    guard: "realpath compare",
    reason: "a registered path that now resolves somewhere else is a different program under the same name",
    file: "lib/runtime-identity.mjs",
    from: "if (registered[field] !== current[field]) drifted.push(field);",
    to: "if (false) drifted.push(field);",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a path that has become a symlink to somewhere else is refused"
  },
  {
    guard: "fingerprint compare",
    reason: "a binary rewritten in place keeps its path, its name, its owner and its mode; only the bytes say so",
    file: "lib/runtime-identity.mjs",
    from: "const fingerprint = fingerprintOf(descriptor, stat);",
    to: 'const fingerprint = "sha256:unchanged";',
    test: "tests/product/runtime-identity.test.mjs",
    name: "a binary replaced after registration is refused before the credential is read"
  },
  {
    guard: "symlink chain audit",
    reason: "a hop in the middle of a symlink chain has its own holder, and whoever can write that directory repoints the run while both ends stay exactly as verified",
    file: "lib/runtime-identity.mjs",
    from: "const chain = executableChain(resolved.path, resolved.realpath);",
    to: "const chain = [resolved.realpath];",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a symlink hop through a writable directory is refused, not only the two ends of the chain"
  },
  {
    guard: "interpreter is part of the identity",
    reason: "a shebang hands the credential to a second program; a byte-identical script whose interpreter changed is a different runtime",
    file: "lib/runtime-identity.mjs",
    from: "interpreter_digest: interpreterChain.length === 0 ? null : `sha256:${sha256Value(interpreterChain)}`,",
    to: "interpreter_digest: null,",
    test: "tests/product/runtime-identity.test.mjs",
    name: "the interpreter a shebang selects is part of the identity"
  },
  {
    guard: "interpreter inherits its own findings",
    reason: "an interpreter reached through a directory somebody else can write is as replaceable as the script, and the script's status must say so",
    file: "lib/runtime-identity.mjs",
    from: "for (const reason of interpreter.untrusted_reasons) reasons.push(`interpreter ${reason}`);",
    to: "for (const reason of []) reasons.push(reason);",
    test: "tests/product/runtime-identity.test.mjs",
    name: "an interpreter reached through a world-writable directory makes the script untrusted"
  },
  {
    guard: "effective execute permission",
    reason: "an execute bit that does not apply to this process is a file execvp skips, so reading the mode describes a program the child would never run",
    file: "lib/runtime-identity.mjs",
    from: "accessSync(candidate, constants.X_OK);",
    to: "accessSync(candidate, constants.F_OK);",
    test: "tests/product/runtime-identity.test.mjs",
    name: "an execute bit that does not apply to this process is not an executable"
  },
  {
    guard: "parent writable refusal",
    reason: "anyone who can write the directory can replace the verified program between the check and the spawn",
    file: "lib/runtime-auth.mjs",
    from: 'if (autoRequested && current.identity_status !== "VERIFIED") {',
    to: "if (false) {",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a world-writable parent directory is refused however verified the file looks"
  },
  {
    guard: "identity-before-resolver ordering",
    reason: "a check that runs after the resolver has already read the operator's keychain for an unidentified program",
    // Suppressing the throw was the obvious mutation and it proved nothing: a failed verdict also
    // carries auto:false, so the resolver stayed uncalled and the test died on its `assert.throws`
    // rather than on the ordering. This one puts the lookup first and leaves the refusal intact,
    // which is the defect by name, and the test dies on the call count that measures it.
    file: "lib/runtime-auth.mjs",
    from: "const verdict = authorizeRuntimeAuth(agent, adapter, { env, platform });",
    to: "const asked = resolve(adapter, { platform, env, command: agent?.command }); const verdict = authorizeRuntimeAuth(agent, adapter, { env, platform });",
    test: "tests/product/runtime-identity.test.mjs",
    name: "the identity check runs before the credential resolver, not after"
  },
  {
    guard: "operator-env credential gate",
    reason: "a token already in the operator's shell must not travel to a binary whose identity failed, and the child must not start",
    file: "lib/core.mjs",
    // `resolved: null` was not enough: isolation then stripped the token on its own and only the
    // "child never starts" half of the name was exercised. This mutant carries the operator's own
    // variable through, which is what the refusal is actually preventing.
    from: "const { resolved: resolvedAuth, verdict: identityVerdict } = resolveRuntimeAuthForAgent(spec, adapterFor(spec), {});",
    to: 'const { resolved: resolvedAuth, verdict: identityVerdict } = { resolved: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "", source: "environment" }, verdict: { ok: true, identity: null } };',
    test: "tests/product/runtime-identity.test.mjs",
    name: "an operator's own token does not reach a binary whose identity failed, and the child never starts"
  },
  {
    guard: "spawn the verified file",
    reason: "the file handed to execve is the recorded realpath, not the configured name resolved a second time in the kernel; this is what removes the PATH search and the symlink chain from the spawn, and it does not close the check-to-execve window, which nothing short of executing a held descriptor would",
    file: "lib/core.mjs",
    from: "child = spawn(verifiedPath ?? spec.command, args, {",
    to: "child = spawn(spec.command, args, {",
    test: "tests/product/runtime-identity.test.mjs",
    name: "the file whose identity was verified is the file that is spawned"
  },
  {
    guard: "resolver ownership",
    reason: "an identity recorded for one adapter with another adapter's resolver asking is refused by name; adapter_id is in the drift comparison too, so what this guard holds is which refusal the operator is shown, not whether the credential is refused",
    file: "lib/runtime-auth.mjs",
    from: "if ((registered.adapter_id ?? null) !== (adapter?.id ?? null)) {",
    to: "if (false) {",
    test: "tests/product/runtime-identity.test.mjs",
    name: "the adapter that owns the credential resolver is not the adapter being spawned"
  },
  {
    guard: "legacy migration guard",
    reason: "an agent registered before identities existed must be migrated, not promoted by treating whatever is on disk now as what was registered then",
    file: "lib/runtime-auth.mjs",
    from: "const registered = agent?.runtime_identity ?? null;",
    to: "const registered = agent?.runtime_identity ?? current;",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a legacy agent with no identity record is refused, not promoted"
  },
  {
    guard: "secret-value scan",
    reason: "provenance names the credential variable and its source; a record that carried the value would publish it",
    file: "lib/runtime-auth.mjs",
    from: "credential_env_name: resolved?.name ?? null,",
    to: "credential_env_name: resolved?.value ?? null,",
    test: "tests/product/runtime-identity.test.mjs",
    name: "no credential value is ever written into an identity record"
  },
  {
    guard: "child output credential scrub",
    reason: "the child is handed the credential on purpose and may print it; the raw AOS_EVENT objects are kept verbatim in the result, past the projection the event store applies",
    file: "lib/core.mjs",
    from: 'const parsed = JSON.parse(scrub(line.slice("AOS_EVENT\\t".length)));',
    to: 'const parsed = JSON.parse(line.slice("AOS_EVENT\\t".length));',
    test: "tests/product/runtime-identity.test.mjs",
    name: "a credential the child quotes back does not survive into anything the run keeps"
  },
  {
    guard: "descriptor-bound fingerprint",
    reason: "reopening the verified name to hash it is a second resolution of that name, and the bytes it returns can belong to a file whose permissions were never the ones recorded",
    file: "lib/runtime-identity.mjs",
    from: "const fingerprint = fingerprintOf(descriptor, stat);",
    to: 'const fingerprint = fingerprintOf(openSync(resolved.realpath, "r"), stat);',
    test: "tests/product/runtime-identity.test.mjs",
    name: "the identity is read from the descriptor, not by reopening the name"
  },
  {
    guard: "descriptor-bound metadata",
    reason: "the mode and owner recorded have to describe the inode that was hashed, and re-stating the name is how they come to describe a different one",
    file: "lib/runtime-identity.mjs",
    from: "const stat = fstatSync(descriptor);",
    to: "const stat = statSync(resolved.realpath);",
    test: "tests/product/runtime-identity.test.mjs",
    name: "the identity is read from the descriptor, not by reopening the name"
  },
  {
    guard: "env option scan",
    reason: "the name env looks up is a second program nobody verified; a scan that skips dashes and takes the next word verifies the argument of -u instead, and passes",
    file: "lib/runtime-identity.mjs",
    from: "commands.push(envProgramOf(shebang.args));",
    to: 'commands.push(shebang.args.find((argument) => !argument.startsWith("-") && !argument.includes("=")) ?? null);',
    test: "tests/product/runtime-identity.test.mjs",
    name: "an env shebang with options still names the interpreter it will run"
  },
  {
    guard: "ACL replaceable rights",
    reason: "an allow entry granting add_file or delete_child is somebody else's file one mv away; read and list are not, and a deny entry is not a grant at all",
    file: "lib/runtime-identity.mjs",
    from: "if (!rights.some((right) => REPLACEABLE_RIGHTS.has(right))) continue;",
    to: "if (rights.length > 0) continue;",
    test: "tests/product/runtime-identity.test.mjs",
    name: "an ACL listing is read for the rights that let somebody replace a file"
  },
  {
    guard: "unread ACL is not a clean ACL",
    reason: "a listing that did not run, or that never mentions a path, has said nothing -- and reading silence as absence makes the check pass hardest exactly when it has stopped working",
    file: "lib/runtime-identity.mjs",
    from: "const unreadable = !answered || !seen.listed;",
    to: "const unreadable = false;",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a path the ACL listing never mentions is not read as clean"
  },
  {
    guard: "ACL walk",
    // macOS only, and deliberately so: Node has no interface to an ACL and `ls -lde` is the only
    // thing that will say. The mutation runner defers it rather than reporting SURVIVED for a guard
    // that holds everywhere it applies -- so a macOS lane has to run this one, and the two guards
    // above cover the rights and the failure behaviour as pure text on every platform.
    platform: "darwin",
    reason: "a directory at 0755 owned by the operator can still carry an ACL that lets another account replace what is in it, and the mode-bit walk reads it as clean",
    file: "lib/runtime-identity.mjs",
    from: "for (const risk of aclRisksOf([...new Set([...audited.map((entry) => entry.path), resolved.realpath])], platform)) record(risk);",
    to: "for (const risk of []) record(risk);",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a macOS ACL that lets somebody else replace the file is refused"
  },
  {
    guard: "configured argv0",
    reason: "spawning the resolved path is what makes the run verifiable, and argv0 is what keeps it compatible: a native runtime still reads the command the operator configured in argv[0] rather than a path it was never told about",
    file: "lib/core.mjs",
    from: "      argv0: spec.command",
    to: "      argv0: undefined",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a native runtime keeps the argv0 the operator configured"
  },
  {
    guard: "invocation identity provenance",
    reason: "the assessment is where anybody reads which program produced a score, and this mapping is the only place the run's identity record reaches it",
    file: "lib/cli.mjs",
    from: "runtime_identity: entry.runtime_identity ?? null",
    to: "runtime_identity_dropped: null",
    test: "tests/product/runtime-identity.test.mjs",
    name: "a stored assessment carries the executable identity each invocation was bound to"
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

/**
 * Every guard in `GUARDS`, accounted for, checked as an exact set.
 *
 * `REQUIRED_GUARDS` was a floor, and a floor only protects what is standing on it. Every guard
 * added after the specification -- which by now is most of them -- could have been deleted from
 * `GUARDS` and the ordinary suite would have stayed green, because nothing outside `GUARDS`
 * mentioned it. A manifest whose whole purpose is to notice a guard that quietly stopped being
 * load-bearing was doing exactly that to itself.
 *
 * The check is equality in both directions, which is what makes it different from the floor it
 * replaces rather than a second copy of the same mistake. A floor falls behind by default: adding a
 * guard and not listing it was allowed, so the list drifted while the suite stayed green. Under
 * equality neither drift is possible -- an unlisted guard fails, and a listed guard that has left
 * `GUARDS` fails -- so the list cannot be out of date and green at the same time, which is the only
 * property that matters.
 *
 * Adding a guard means adding its name here, in the same commit, sorted. Two branches adding guards
 * conflict here exactly as they already conflict in `GUARDS` above, and the resolution is the union.
 */
export const ACCOUNTED_GUARDS = [
  "ACL replaceable rights",
  "ACL walk",
  "central redaction",
  "checkpoint evidence preserved",
  "child output credential scrub",
  "close-evidence issue-specific fields",
  "close-evidence verdict",
  "configured argv0",
  "coverage gate",
  "credential env refusal",
  "cycle run identity",
  "descriptor-bound fingerprint",
  "descriptor-bound metadata",
  "effective execute permission",
  "env option scan",
  "exact revision binding",
  "execution plan cycle detection",
  "false completion cap",
  "fingerprint compare",
  "hot-file single owner",
  "identity-before-resolver ordering",
  "interpreter inherits its own findings",
  "interpreter is part of the identity",
  "invocation identity provenance",
  "legacy migration guard",
  "locked cycle seed",
  "malformed-row reporting",
  "operator decision window",
  "operator-env credential gate",
  "parent writable refusal",
  "phase-ready scope",
  "realpath compare",
  "resolver ownership",
  "safety cap",
  "secret-value scan",
  "spawn the verified file",
  "stale blocked status",
  "symlink chain audit",
  "trend dedupe",
  "trusted-process import prohibition",
  "unread ACL is not a clean ACL",
  "verification result check",
  "workspace containment"
];
