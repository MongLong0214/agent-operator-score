import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Sessions the operator already ran are the only material that costs nothing to grade and is
// about their own work. Claude Code writes one JSONL per session under ~/.claude/projects/<slug>/;
// Codex writes under ~/.codex/sessions/. Both are append-only lines of JSON.
const ROOTS = [
  { runtime: "claude-code", root: join(homedir(), ".claude", "projects") },
  { runtime: "codex", root: join(homedir(), ".codex", "sessions") }
];

const walkJsonl = (directory, out = []) => {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walkJsonl(full, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
};

export function findSessions({ limit = 20 } = {}) {
  const found = [];
  for (const { runtime, root } of ROOTS) {
    for (const path of walkJsonl(root)) {
      let stats;
      try { stats = statSync(path); } catch { continue; }
      found.push({ runtime, path, bytes: stats.size, modified: stats.mtimeMs });
    }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

const parseLines = (text) => {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn trailing line is not an error */ }
  }
  return rows;
};

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n");
};

const resultText = (value) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  // Claude Code stores tool results in several shapes depending on the tool. Reading the whole
  // record as text is deliberate: a grader that only understood one shape would silently see
  // nothing for every other tool.
  return JSON.stringify(value);
};

// Codex writes a different shape: session_meta carries cwd, and each step is a response_item or
// event_msg whose payload names the kind. Its tool calls are `function_call` with a JSON string of
// arguments, so the argument object has to be parsed before a grader can read a command from it.
const codexCall = (payload) => {
  let input = {};
  try { input = JSON.parse(payload.arguments ?? "{}"); } catch { /* an unparsable argument is not a call we can grade */ }
  const tool = payload.name === "exec_command" || payload.name === "shell" ? "Bash" : payload.name;
  return { tool, input: { ...input, command: input.command ?? input.cmd ?? "" } };
};

const fromCodex = (rows) => {
  const steps = [];
  let cwd = null;
  for (const row of rows) {
    const payload = row.payload ?? {};
    if (row.type === "session_meta" && typeof payload.cwd === "string") cwd = payload.cwd;
    const at = Date.parse(row.timestamp ?? "");

    if (payload.type === "function_call") {
      steps.push({ kind: "call", at, ...codexCall(payload) });
    } else if (payload.type === "function_call_output") {
      steps.push({ kind: "result", at, text: resultText(payload.output) });
    } else if (payload.type === "user_message" && typeof payload.message === "string") {
      steps.push({ kind: "message", role: "operator", at, text: payload.message });
    } else if (payload.type === "agent_message" && typeof payload.message === "string") {
      steps.push({ kind: "message", role: "agent", at, text: payload.message });
    } else if (payload.type === "message" && Array.isArray(payload.content)) {
      // `developer` is the harness speaking, not the operator, and counting it as an operator turn
      // would make every Codex session look attended.
      const role = payload.role === "user" ? "operator" : payload.role === "assistant" ? "agent" : null;
      const text = payload.content.map((part) => part.text ?? "").join("\n").trim();
      if (role && text) steps.push({ kind: "message", role, at, text });
    }
  }
  return { steps, cwd };
};

// Claude Code writes one JSONL entry per turn with the tool calls inline in message.content.
const fromClaude = (rows) => {
  const steps = [];
  let cwd = null;
  for (const row of rows) {
    if (!cwd && typeof row.cwd === "string") cwd = row.cwd;
    const at = Date.parse(row.timestamp ?? "");
    const role = row.type === "user" ? "operator" : row.type === "assistant" ? "agent" : null;
    const content = row.message?.content;

    if (role && textOf(content).trim()) {
      steps.push({ kind: "message", role, at, text: textOf(content).trim() });
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "tool_use") steps.push({ kind: "call", at, tool: part.name, input: part.input ?? {} });
    }
    if (row.toolUseResult !== undefined) steps.push({ kind: "result", at, text: resultText(row.toolUseResult) });
  }
  return { steps, cwd };
};

// One normalized shape both runtimes reduce to, so the graders never learn a vendor's schema.
export function loadSession(path) {
  const rows = parseLines(readFileSync(path, "utf8"));
  const isCodex = rows.some((row) => row.type === "session_meta" || row.type === "response_item");
  const { steps, cwd } = isCodex ? fromCodex(rows) : fromClaude(rows);

  let started = null;
  let ended = null;
  for (const step of steps) {
    if (!Number.isFinite(step.at)) continue;
    if (started === null || step.at < started) started = step.at;
    if (ended === null || step.at > ended) ended = step.at;
  }

  return {
    path,
    runtime: isCodex ? "codex" : "claude-code",
    cwd,
    started,
    ended,
    duration_ms: started !== null && ended !== null ? ended - started : null,
    steps,
    calls: steps.filter((step) => step.kind === "call"),
    operatorTurns: steps.filter((step) => step.kind === "message" && step.role === "operator")
  };
}
