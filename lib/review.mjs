// Findings about a session the operator already ran. No score: a number over one person's own
// work is a mirror, and the useful output is the specific moment something went wrong.
//
// Every finding names the step that produced it, so the operator can check it against their own
// memory of the session rather than trusting the tool.

const VERIFY = /\b(npm (run )?test|npm test|pytest|go test|cargo test|jest|vitest|node --test|make test|npm run build|tsc|eslint)\b/i;
// A completion claim is an assertion that the work is finished and checked. Progress notes use
// the same words, so the claim must be about tests or the task, not a status recap.
const CLAIM_DONE = /\b(all tests? (now )?pass|tests? (are )?passing|everything (is )?work(s|ing)|it works now|the (bug|issue) is fixed|ready to (merge|ship))\b/i;
// Irreversible outside this working tree, or irreversible to data. `git reset --hard` onto a
// tracked remote ref and `--force-with-lease` are ordinary synchronisation and are not listed.
const DESTRUCTIVE = /(\brm\s+-rf?\s+\/(?!private\/tmp|tmp\b)|\bgit\s+push\s+--force(?!-with-lease)\b|\bdrop\s+table\b|\btruncate\s+table\b|\bmkfs\b|\bgit\s+reset\s+--hard\b(?![^\n]*(?:\borigin\/|\bupstream\/|\bHEAD\b)))/i;
const SECRET_MATERIAL = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9]{20,}/
];
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "apply_patch"]);

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

  session.steps.forEach((step, index) => {
    if (step.kind === "call" && WRITE_TOOLS.has(step.tool)) lastWrite = index;
    if (step.kind === "call" && VERIFY.test(commandOf(step))) lastVerify = index;
    if (step.kind === "message" && step.role === "agent" && CLAIM_DONE.test(step.text)) {
      if (lastWrite > lastVerify) {
        findings.push({
          rule: "completion-claimed-without-verification",
          severity: "high",
          where: at(session, step),
          what: "the agent reported success after an edit that nothing re-checked",
          evidence: step.text.slice(0, 220).replace(/\s+/g, " ")
        });
      }
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
    if (VERIFY.test(commandOf(step))) { verifiedAt = index; editsSince = 0; return; }
    if (WRITE_TOOLS.has(step.tool) && verifiedAt >= 0) editsSince += 1;
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
    if (!WRITE_TOOLS.has(call.tool)) continue;
    const path = pathOf(call);
    if (!path || !path.startsWith("/")) continue;
    if (path === session.cwd || path.startsWith(`${session.cwd}/`)) continue;
    outside.set(path, (outside.get(path) ?? 0) + 1);
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
    const heredocBodies = /<<\s*'?[A-Za-z_]+'?\n[\s\S]*?\n[A-Za-z_]+\n?/g;
    const offending = script
      .replace(heredocBodies, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("#") && !line.startsWith("//"))
      .find((line) => DESTRUCTIVE.test(line));
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
    for (const pattern of SECRET_MATERIAL) {
      if (text && pattern.test(text)) {
        findings.push({
          rule: "secret-material-in-session",
          severity: "high",
          where: at(session, step),
          what: "key material appeared in the transcript; treat it as exposed and rotate it",
          evidence: "match withheld"
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
  const findings = RULES.flatMap((rule) => rule(session));
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    path: session.path,
    cwd: session.cwd,
    duration_ms: session.duration_ms,
    calls: session.calls.length,
    operator_turns: session.operatorTurns.length,
    findings
  };
}
