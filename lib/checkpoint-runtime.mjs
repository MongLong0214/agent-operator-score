import { sha256Text } from "./core.mjs";

// The moment AOS stops and asks.
//
// A stage failed. AOS can point at that, and it is the only moment in a run where what the operator
// does is observable at all -- so it shows what it saw, offers the five things a person can do about
// it, and records what happened next. Everything about the shape here follows from one rule stated
// in checkpoint.mjs: the choice is never the score. The state the choice produced is.
//
// That is why `inspect` is not a decision. It shows more and asks again, because a run where the
// operator looked and then chose is the same run as one where they chose, and rewarding the look
// would make the cautious-sounding label the cheapest thing to claim.
//
// Nothing here asks whether anyone is watching. The operator says so by passing --checkpoints, and
// an answer that never arrives is an unattended run, which is a result this product knows how to
// report. Testing stdin for a tty would be asking about the channel instead of the person.

/** How many times one stage may stop before the run goes on without an answer. */
export const MAX_CHECKPOINTS_PER_STAGE = 3;

export const CHOICES = [
  { key: "retry", number: 1, label: "retry unchanged", changes: null },
  { key: "instruct", number: 2, label: "modify instruction", changes: "instruction-changed", needs: "text" },
  { key: "reroute", number: 3, label: "reroute to another agent", changes: "route-changed", needs: "agent" },
  { key: "inspect", number: 4, label: "inspect evidence", changes: null },
  { key: "stop", number: 5, label: "stop blocked", changes: "stopped" }
];

const CHOICE_BY_KEY = new Map(CHOICES.map((choice) => [choice.key, choice]));
const CHOICE_BY_NUMBER = new Map(CHOICES.map((choice) => [String(choice.number), choice]));

/**
 * What the operator is shown.
 *
 * The evidence digest is printed with it. A decision recorded against a payload nobody can
 * reconstruct is a decision about nothing, and the digest is what makes "they were shown this"
 * checkable after the run.
 */
export function renderCheckpoint(evidence, { agents = [], attempt = 1 } = {}) {
  const lines = [
    "",
    `AOS checkpoint (${attempt} of ${MAX_CHECKPOINTS_PER_STAGE}) — ${evidence.kind}`,
    evidence.detail,
    ...evidence.calls.map((call) => `  ${call.outcome}  ${call.signature}`),
    // The last of what the stage said. Deciding from an exit code is deciding from nothing.
    ...(evidence.output ? ["", ...String(evidence.output).trimEnd().split("\n").slice(-12).map((line) => `  | ${line}`)] : []),
    `  evidence ${evidence.evidence_digest.slice(0, 16)}`,
    "",
    ...CHOICES.map((choice) => `  ${choice.number}. ${choice.label}${choice.needs === "text" ? " <text>" : choice.needs === "agent" ? " <agent>" : ""}`)
  ];
  if (agents.length > 0) lines.push(`  agents: ${agents.join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Reads one answer.
 *
 * Both the number and the word are accepted, because the menu prints both and refusing one of them
 * would be a puzzle rather than a prompt. An answer that names something this run cannot do -- an
 * agent that is not in the plan, a new instruction with nothing in it -- comes back as a problem to
 * show, not as a decision, so the operator is asked again rather than having their intent guessed.
 */
export function parseDecision(line, { agents = [] } = {}) {
  if (typeof line !== "string") return { error: "no answer" };
  const trimmed = line.trim();
  if (trimmed.length === 0) return { error: "no answer" };
  const [head, ...rest] = trimmed.split(/\s+/);
  const choice = CHOICE_BY_NUMBER.get(head) ?? CHOICE_BY_KEY.get(head.toLowerCase());
  if (!choice) return { error: `${head} is not one of 1-5` };

  const argument = rest.join(" ").trim();
  if (choice.needs === "text") {
    if (argument.length === 0) return { error: "modify instruction needs the new instruction after it" };
    return { choice: choice.key, instruction: argument, changes: choice.changes };
  }
  if (choice.needs === "agent") {
    if (argument.length === 0) return { error: "reroute needs an agent id after it" };
    if (agents.length > 0 && !agents.includes(argument)) {
      return { error: `${argument} is not an agent in this plan (${agents.join(", ")})` };
    }
    return { choice: choice.key, route: argument, changes: choice.changes };
  }
  return { choice: choice.key, changes: choice.changes };
}

/**
 * Runs one checkpoint to a decision.
 *
 * `inspect` is the only answer that does not end this: it prints the full evidence and asks again,
 * which is why it carries no state change of its own. `ask` returning null is the operator not
 * answering -- the run goes on unattended, and that is recorded as the outcome rather than treated
 * as an error.
 */
export async function resolveCheckpoint({ evidence, agents = [], attempt = 1, ask, write }) {
  write(renderCheckpoint(evidence, { agents, attempt }));
  for (let asked = 0; asked < 8; asked += 1) {
    const line = await ask();
    if (line === null) return { choice: "unanswered", changes: null, unanswered: true };
    const decision = parseDecision(line, { agents });
    if (decision.error) {
      write(`  ${decision.error}`);
      continue;
    }
    if (decision.choice === "inspect") {
      write(`  evidence ${evidence.evidence_digest}`);
      write(`  ${JSON.stringify(evidence.calls)}`);
      write(renderCheckpoint(evidence, { agents, attempt }));
      continue;
    }
    return decision;
  }
  // Eight unreadable answers in a row is a channel that is not carrying a person. Going on is the
  // same outcome as never being answered, and it is recorded as that rather than as a decision.
  return { choice: "unanswered", changes: null, unanswered: true };
}

/** The digest of an instruction, so a changed one is visible without the text being stored. */
export const instructionDigest = (text) => sha256Text(text);
