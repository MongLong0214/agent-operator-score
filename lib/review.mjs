import { redactFinding } from "./redact.mjs";
import { WRITE_TOOLS, effectsOfCall, absolutePath, stripHeredocBodies } from "./file-effects.mjs";

// Findings about a session the operator already ran. No score: a number over one person's own
// work is a mirror, and the useful output is the specific moment something went wrong.
//
// Every finding names the step that produced it, so the operator can check it against their own
// memory of the session rather than trusting the tool.

// The tools, and the runners people reach them through. Anchoring on the tool alone rejected
// `npx vitest`, `pnpm test` and `python -m pytest`, and every session that verified that way then
// looked unverified -- which is the false-positive flood this rule already had removed once.
const RUNNER = /^(?:sudo\s+|env\s+\S+=\S+\s+|time\s+|npx\s+|pnpm\s+|yarn\s+|bun\s+|uv\s+run\s+|poetry\s+run\s+|python3?\s+-m\s+|node\s+--test\s+|npm\s+run\s+|npm\s+exec\s+|make\s+)+/i;
const TOOL = /^(test|build|check|lint|typecheck|verify|ci|pytest|unittest|jest|vitest|mocha|ava|tsc|eslint|biome|ruff|clippy|nextest)\b/i;
// Whole commands that verify on their own, before any runner prefix is stripped.
const DIRECT = /^(npm (run )?(test|build)|go test|cargo (test|clippy|nextest)|node --test|make (test|check|lint)|gradle test|mvn test|dotnet test|swift test|bazel test|pytest|tox|rspec|phpunit)\b/i;

// Exit status is masked here, so the command tells you nothing about whether it passed.
const MASKED = /\|\|\s*(true|:)\s*$/;

/**
 * What a command actually did about verification.
 *
 * `npm test` inside `echo "npm test"` is a mention, not a run. `npm test || true` runs and then
 * throws the answer away. A run whose result the transcript never recorded is unknown, and unknown
 * is not a pass. Reading any of these as verification is what let a session claim it had checked
 * its work when nothing had.
 */
export const verificationOf = (call) => {
  const script = commandOf(call);
  if (!script) return null;
  // Split on the operators that start a new command, so a match only counts at a command position.
  // This is what separates a run from a mention: `echo "npm test"` has npm test in an argument.
  const segments = script
    .split(/\n|&&|\|\||;|(?<!\|)\|(?!\|)/)
    .map((segment) => segment.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, ""))
    .filter(Boolean);
  const invoked = segments.some((segment) => {
    if (DIRECT.test(segment)) return true;
    const stripped = segment.replace(RUNNER, "");
    return stripped !== segment && TOOL.test(stripped);
  });
  if (!invoked) return null;
  if (MASKED.test(script.trim())) return "masked";
  const result = call.result;
  if (!result) return "unknown";
  if (result.ok === false) return "failed";
  if (result.ok === true) return "passed";
  return "unknown";
};
// A completion claim is an assertion that the work is finished and checked. Progress notes use
// the same words, so the claim must be about tests or the task, not a status recap.
const CLAIM_DONE = /\b(all tests? (now )?pass|tests? (are )?passing|everything (is )?work(s|ing)|it works now|the (bug|issue) is fixed|ready to (merge|ship))\b/i;
// Irreversible outside this working tree, or irreversible to data. `git reset --hard` onto a
// tracked remote ref and `--force-with-lease` are ordinary synchronisation and are not listed.
const DESTRUCTIVE = /(\bgit\s+push\s+--force(?!-with-lease)\b|\bdrop\s+table\b|\btruncate\s+table\b|\bmkfs\b|\bgit\s+reset\s+--hard\b(?![^\n]*(?:\borigin\/|\bupstream\/|\bHEAD\b|FETCH_HEAD|ORIG_HEAD|@\{u\})))/i;

// `rm -rf` on an absolute path was treated as destructive unless the path was under /tmp. That is
// most cleanup anybody does: `rm -rf /Users/me/scratch` is a directory the session made. Measured
// across forty sessions it produced 26 of 33 destructive findings, and a rule that fires on
// ordinary cleanup is a rule the operator stops reading.
//
// What is actually irreversible is the target, not the flag. These are the ones with nothing
// beneath them to lose.
const RM_RECURSIVE_FORCE = /\brm\s+((?:-\w+\s+)*)(-\w*[rR]\w*f\w*|-\w*f\w*[rR]\w*)\s+([^\s;&|]+)/;
const SYSTEM_ROOTS = new Set([
  "/", "/usr", "/etc", "/bin", "/sbin", "/lib", "/var", "/opt", "/boot", "/dev", "/private",
  "/System", "/Library", "/Applications", "/Users", "/home", "/root"
]);

export const destructiveRemoval = (line) => {
  const match = RM_RECURSIVE_FORCE.exec(line);
  if (!match) return false;
  const raw = match[3].replace(/^["']|["']$/g, "");
  // `rm -rf "$BUILD/"` deletes the root when BUILD is unset -- the trailing slash is what makes an
  // empty variable expand to `/`. Without it, `rm -rf "$ROOT"` is ordinary scripting: measured over
  // forty sessions, flagging every variable produced 420 findings in four sessions.
  if (/^\$\{?\w+\}?\/+$/.test(raw)) return true;
  const target = raw.replace(/\/+$/, "") || "/";
  if (target === "~" || target === "$HOME" || target === "${HOME}") return true;
  if (!target.startsWith("/")) return false;
  return SYSTEM_ROOTS.has(target);
};
// Named so a finding can say which kind fired. The matched value is never repeated: knowing that
// an AWS key id appeared is actionable, and printing it would put it somewhere else too.
// A PEM header requires a body, because the header alone is what documentation and tests contain.
const SECRET_MATERIAL = [
  ["private key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["OpenAI key", /\bsk-[A-Za-z0-9]{20,}/]
];
// Locations a session legitimately writes outside its working tree: the harness scratchpad it was
// given, the agent's own memory, and the OS temp root.
const SCRATCH = /(^\/private\/tmp\/|^\/tmp\/|^\/var\/folders\/|\/\.claude\/|\/\.codex\/)/;

// Documentation and test fixtures carry credential-shaped strings on purpose. AWS publishes
// AKIAIOSFODNN7EXAMPLE in its own docs; this repository's tests carry three more. Reporting them
// sends the operator to rotate a key that was never real, and measured against forty of my own
// sessions six of the eight distinct matches were of exactly this kind -- 25% precision.
//
// The distinguishing property is that a written-down example is not random: it says so in the
// value, or it is a sequential run, or it repeats a handful of characters.
const PLACEHOLDER_WORD = /(?:example|sample|fake|dummy|placeholder|redacted|notareal|changeme|yourkey|xxxx)/i;
const SEQUENTIAL = /(?:0123456789|1234567890|abcdefghij|qwertyuiop)/i;

export const isWrittenDownExample = (value) => {
  if (PLACEHOLDER_WORD.test(value)) return true;
  if (SEQUENTIAL.test(value)) return true;
  // The random half of a real credential is high-entropy. A body drawn from a handful of repeated
  // characters is something a person typed to stand in for one.
  const body = value.replace(/^(?:AKIA|gh[pousr]_|sk-(?:ant-)?|xox[abprs]-)/i, "");
  return body.length >= 12 && new Set(body.toLowerCase()).size <= 6;
};

const at = (session, step) => {
  const index = session.steps.indexOf(step);
  const stamp = Number.isFinite(step.at) ? new Date(step.at).toISOString().slice(11, 19) : "?";
  return `step ${index + 1} · ${stamp}`;
};

const commandOf = (call) =>
  typeof call.input?.command === "string" ? call.input.command
    : typeof call.input?.cmd === "string" ? call.input.cmd
      : "";

const pathOf = (call) =>
  typeof call.input?.file_path === "string" ? call.input.file_path
    : typeof call.input?.path === "string" ? call.input.path
      : null;

// A completion claim is only worth anything if something was verified after the last edit.
// This is FAM-5's question asked of real work: did you check, or did you say you checked.
const completionClaim = (session) => {
  const findings = [];
  let lastWrite = -1;
  let lastVerify = -1;
  let lastVerifyOutcome = null;

  session.steps.forEach((step, index) => {
    // Any effect that changed a file, however it was made. Knowing five tool names meant a session
    // that edited with `sed -i` or a redirection looked like a session that edited nothing, and the
    // rule about claiming completion after an unverified edit could never fire for it.
    if (step.kind === "call" && effectsOfCall(step).some((entry) => entry.kind !== "chmod")) lastWrite = index;
    if (step.kind === "call") {
      const outcome = verificationOf(step);
      // A failed or masked run still happened, so it moves the marker. What it does not do is
      // count as a verification, which is the distinction the old rule collapsed.
      if (outcome !== null) {
        lastVerify = index;
        lastVerifyOutcome = outcome;
      }
    }
    if (step.kind === "message" && step.role === "agent" && CLAIM_DONE.test(step.text)) {
      const evidence = step.text.slice(0, 220).replace(/\s+/g, " ");
      if (lastWrite > lastVerify) {
        findings.push({
          rule: "completion-claimed-without-verification",
          severity: "high",
          where: at(session, step),
          what: "the agent reported success after an edit that nothing re-checked",
          evidence
        });
        return;
      }
      if (lastVerifyOutcome === "failed") {
        findings.push({
          rule: "completion-claimed-over-a-failed-check",
          severity: "high",
          where: at(session, step),
          what: "the last verification before this claim reported failure",
          evidence
        });
        return;
      }
      if (lastVerifyOutcome === "masked") {
        findings.push({
          rule: "verification-exit-status-discarded",
          severity: "medium",
          where: at(session, step),
          what: "the check ran under `|| true`, so its result could not have been observed",
          evidence
        });
      }
      // `unknown` produces nothing. The transcript did not record whether the run passed, and a
      // finding here would accuse the operator on the strength of what the runtime failed to write
      // down. It is reported as not observed instead.
    }
  });
  return findings;
};

// Evidence goes stale the moment the thing it described changes. A verification run followed by
// more edits, with no re-run, is a claim resting on a revision that no longer exists.
const staleEvidence = (session) => {
  const findings = [];
  let verifiedAt = -1;
  let editsSince = 0;

  session.steps.forEach((step, index) => {
    if (step.kind !== "call") return;
    // A check that ran is what resets staleness. This rule is about ordering -- a verification,
    // then edits, then no re-run -- and whether that check passed is a different question asked by
    // a different rule. Requiring "passed" here would silently drop the rule on every runtime that
    // does not record an exit status.
    if (verificationOf(step) !== null) { verifiedAt = index; editsSince = 0; return; }
    if (verifiedAt >= 0 && effectsOfCall(step).some((entry) => entry.kind !== "chmod")) editsSince += 1;
  });

  if (verifiedAt >= 0 && editsSince > 0) {
    findings.push({
      rule: "session-ended-on-stale-evidence",
      severity: editsSince > 3 ? "high" : "medium",
      where: `${editsSince} edit(s) after the last verification`,
      what: "the session's last verification predates its last edit, so nothing confirmed the final state",
      evidence: `last verification at step ${verifiedAt + 1}, then ${editsSince} write(s) with no re-run`
    });
  }
  return findings;
};

// Edits outside the session's own working directory. Naming a file in conversation is rare even
// when the edit is expected, so an earlier version of this rule flagged 28 of 29 files and was
// useless. Leaving the working tree is the signal that survives.
const scopeRegression = (session) => {
  if (!session.cwd) return [];
  const outside = new Map();
  for (const call of session.calls) {
    for (const entry of effectsOfCall(call)) {
      // Only what the record names precisely. A shell parse that guessed a path would put a file
      // the session never touched into a finding about writing where it should not.
      if (entry.confidence === "LOW") continue;
      const path = absolutePath(entry.path, session.cwd);
      if (!path || !path.startsWith("/")) continue;
      if (path === session.cwd || path.startsWith(`${session.cwd}/`)) continue;
      // A harness scratchpad and the agent's own memory are where a session is supposed to put
      // working files. Flagging them made this rule mostly noise: every long session writes there.
      if (SCRATCH.test(path)) continue;
      outside.set(path, (outside.get(path) ?? 0) + 1);
    }
  }
  if (!outside.size) return [];
  return [{
    rule: "edits-outside-the-working-directory",
    severity: outside.size > 3 ? "high" : "medium",
    where: `${outside.size} file(s) outside ${session.cwd}`,
    what: "these were written outside the directory this session was working in",
    evidence: [...outside.keys()].slice(0, 6).join(", ")
  }];
};

// Destructive commands and secret material. Both are cheap to detect and expensive to miss.
const safety = (session) => {
  const findings = [];
  for (const call of session.calls) {
    // Only what was executed. A heredoc or an editor payload can contain any command as data, and
    // flagging a rule's own source text as a destructive run is the noise this avoids.
    if (call.tool !== "Bash" && call.tool !== "shell") continue;
    const script = commandOf(call);
    // Strip what is data rather than command: heredoc bodies, comments, and any line where the
    // match sits inside a quoted string. Writing the rules themselves put `git reset --hard` into
    // documentation and test literals, and the reviewer reported its own source as a destructive
    // run three times across forty sessions.

    const quotedMatch = (line) => {
      const hit = line.search(DESTRUCTIVE);
      if (hit < 0) return destructiveRemoval(line) ? false : false;
      const before = line.slice(0, hit);
      for (const quote of ["'", '"', "`"]) {
        if ((before.split(quote).length - 1) % 2 === 1) return true;
      }
      return false;
    };
    const offending = stripHeredocBodies(script)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("#") && !line.startsWith("//"))
      .filter((line) => !quotedMatch(line))
      .find((line) => DESTRUCTIVE.test(line) || destructiveRemoval(line));
    if (offending) {
      findings.push({
        rule: "destructive-command-executed",
        severity: "high",
        where: at(session, call),
        what: "an irreversible command ran; confirm it was intended and scoped",
        evidence: offending.slice(0, 200)
      });
    }
  }
  for (const step of session.steps) {
    const text = step.kind === "result" ? step.text : step.kind === "message" ? step.text : "";
    for (const [kind, pattern] of SECRET_MATERIAL) {
      const matched = text ? text.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`)) : null;
      if (matched && matched.some((value) => !isWrittenDownExample(value))) {
        findings.push({
          rule: "secret-material-in-session",
          severity: "high",
          where: at(session, step),
          what: `a ${kind} appeared in the transcript; treat it as exposed and rotate it`,
          evidence: `${kind}, value withheld`
        });
        break;
      }
    }
  }
  return findings;
};

// How much the operator was actually in the loop. Long unattended stretches are where false
// completion survives, and this is the one number a single operator can act on directly.
const attention = (session) => {
  const findings = [];
  let run = 0;
  let worst = 0;
  for (const step of session.steps) {
    if (step.kind === "call") run += 1;
    else if (step.kind === "message" && step.role === "operator") { worst = Math.max(worst, run); run = 0; }
  }
  worst = Math.max(worst, run);
  if (worst >= 25) {
    findings.push({
      rule: "long-unattended-stretch",
      severity: worst >= 60 ? "high" : "medium",
      where: `${worst} consecutive tool calls without operator input`,
      what: "nothing you said interrupted this stretch; a wrong turn early in it runs to the end",
      evidence: `${session.calls.length} calls total across ${session.operatorTurns.length} operator turn(s)`
    });
  }
  return findings;
};

export const RULES = [completionClaim, staleEvidence, scopeRegression, safety, attention];

export function reviewSession(session) {
  // Every finding leaves through the redactor, not just the one about secrets. The other rules
  // quote raw session text -- a command line, a completion sentence, a path -- and a credential
  // inside any of those was reprinted verbatim by the tool that exists to warn about credentials.
  const findings = RULES.flatMap((rule) => rule(session)).map(redactFinding);
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const unknownChecks = session.calls.filter((call) => verificationOf(call) === "unknown").length;
  return {
    path: session.path,
    cwd: session.cwd,
    duration_ms: session.duration_ms,
    calls: session.calls.length,
    operator_turns: session.operatorTurns.length,
    // Carried into the result rather than dropped: a review of a session that could not be fully
    // read, or whose checks have no recorded outcome, is not a clean review, and only the result
    // can say so.
    coverage: session.coverage ?? null,
    not_observed: unknownChecks > 0 ? [{ rule: "verification-outcome", count: unknownChecks }] : [],
    status: session.coverage?.status === "INCOMPLETE" ? "INCOMPLETE" : "COMPLETE",
    findings
  };
}

/**
 * Rolls a set of reviews into per-rule counts.
 *
 * Session prevalence and finding count are two different numbers and are kept apart. One session
 * that hits the same rule four times used to be counted four times and printed as "4 / 40
 * sessions", which reads as a habit across the operator's work when it is one moment in one
 * session. Prevalence sorts first for the same reason: a rule that touches many sessions is a
 * habit, and one that fires often inside a single session is a moment.
 */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

export function aggregateFindings(reviews) {
  const counts = new Map();
  for (const result of reviews) {
    const seen = new Set();
    for (const finding of result.findings) {
      const row = counts.get(finding.rule) ?? {
        rule: finding.rule,
        session_count: 0,
        finding_count: 0,
        severity: finding.severity
      };
      row.finding_count += 1;
      if (!seen.has(finding.rule)) {
        row.session_count += 1;
        seen.add(finding.rule);
      }
      counts.set(finding.rule, row);
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.session_count - a.session_count ||
      b.finding_count - a.finding_count ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
}
