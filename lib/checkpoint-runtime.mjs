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
/**
 * The questions, in the order they are asked.
 *
 * A five-way menu where two entries also need an argument is a form, and a form at the one moment a
 * run is blocked is where operators stop answering -- which is the same as not being there, and this
 * product cannot measure a person who is not there. So it asks one thing at a time, and the answer is
 * y or Enter.
 *
 * The order is not persuasion. Looking comes first because it is the only answer that does not end
 * the checkpoint. Retrying unchanged is not a question at all: it is what happens when nothing was
 * changed, so it is reported as the outcome rather than offered as a choice that sounds equal to the
 * others. An operator who wants it presses Enter four times, which is exactly what they are doing.
 */
export const QUESTIONS = [
  { key: "inspect", ask: "Show the full evidence?", changes: null },
  { key: "reroute", ask: "Send it to another agent?", changes: "route-changed", needs: "agent" },
  { key: "stop", ask: "Stop here?", changes: "stopped" },
  // The one that cannot be y/n. M12 asks whether the instruction meaningfully changed; if AOS wrote
  // it, M12 would be scoring AOS. So the answer is still y/n, and the sentence is the operator's.
  { key: "instruct", ask: "Change the instruction?", changes: "instruction-changed", needs: "text" }
];

const AFFIRMATIVE = /^(y|yes|ㅇ|ㅇㅇ|네|예)$/i;
const NEGATIVE = /^(n|no|ㄴ|아니|아니오|아니요|)$/i;

/** y, Enter, or neither. Anything else is asked again rather than guessed at. */
export const readYesNo = (line) => {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (AFFIRMATIVE.test(trimmed)) return true;
  if (NEGATIVE.test(trimmed)) return false;
  return null;
};

export function renderCheckpoint(evidence, { agents = [], attempt = 1 } = {}) {
  const lines = [
    "",
    `AOS checkpoint (${attempt} of ${MAX_CHECKPOINTS_PER_STAGE}) — ${evidence.kind}`,
    evidence.detail,
    ...evidence.calls.map((call) => `  ${String(call).replace("\t", "  ")}`),
    // The last of what the stage said. Deciding from an exit code is deciding from nothing.
    ...(evidence.output ? ["", ...String(evidence.output).trimEnd().split("\n").slice(-12).map((line) => `  | ${line}`)] : []),
    `  evidence ${evidence.evidence_digest.slice(0, 16)}`,
    "",
    // The questions are printed here as well as asked one at a time, so the operator can see the whole
    // decision before answering any of it -- and so a page quoting this sample says what it does.
    "  y or Enter:",
    ...QUESTIONS.map((question) => `    ${question.ask}`),
    "  answering no to all four retries the stage unchanged"
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
  let inspected = 0;

  // One pass. The old menu looped because it had to be re-read after `inspect`; four questions asked
  // once do not, and asking them twice would turn "no" into a thing the operator has to keep saying.
  for (const question of QUESTIONS) {
    // Nowhere to send it is not a question worth asking.
    const others = agents.filter((id) => id !== evidence.agent_profile_id);
    if (question.key === "reroute" && others.length === 0) continue;

    const suffix = question.key === "reroute" && others.length > 0 ? ` (${others.join(", ")})` : "";
    let answer = null;
    // A channel that answers unreadably forever is not carrying a person, so this is bounded too.
    for (let tries = 0; tries < 4 && answer === null; tries += 1) {
      write(`  ${question.ask}${suffix} [y/N]`);
      const line = await ask();
      if (line === null) return { choice: "unanswered", changes: null, unanswered: true, inspected };
      answer = readYesNo(line);
      if (answer === null) write("  y or Enter");
    }
    if (answer !== true) continue;

    if (question.key === "inspect") {
      // Counted because it happened, and carrying no state change of its own -- the rule this file
      // exists to enforce. It shows more, and the remaining questions follow.
      inspected += 1;
      write(`  evidence ${evidence.evidence_digest}`);
      write(`  ${JSON.stringify(evidence.calls)}`);
      if (evidence.output) write(String(evidence.output).trimEnd().split("\n").map((line) => `  | ${line}`).join("\n"));
      continue;
    }

    if (question.key === "reroute") {
      // One other agent is not a choice to make, it is the answer. More than one still needs naming,
      // and a name this run cannot route to is asked again rather than guessed at.
      if (others.length === 1) return { choice: "reroute", route: others[0], changes: question.changes, inspected };
      for (let tries = 0; tries < 3; tries += 1) {
        write(`  which one? ${others.join(", ")}`);
        const named = (await ask() ?? "").trim();
        if (others.includes(named)) return { choice: "reroute", route: named, changes: question.changes, inspected };
        write(`  ${named || "nothing"} is not one of them`);
      }
      continue;
    }

    if (question.key === "instruct") {
      // The only text this asks for. M12 measures whether the instruction meaningfully changed, so a
      // sentence AOS wrote would make M12 a score of AOS.
      write("  the new instruction:");
      const instruction = (await ask() ?? "").trim();
      if (instruction.length === 0) { write("  nothing was typed, so nothing changed"); continue; }
      return { choice: "instruct", instruction, changes: question.changes, inspected };
    }

    return { choice: question.key, changes: question.changes, inspected };
  }

  // Every question answered no. Retrying unchanged is not offered above because it is not a choice
  // beside the others -- it is what is left when nothing was changed, and it is reported as that.
  write("  nothing changed, so the stage is retried as it was");
  return { choice: "retry", changes: null, inspected };
}

