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

// One normalized shape both runtimes reduce to, so the graders never learn a vendor's schema.
export function loadSession(path) {
  const rows = parseLines(readFileSync(path, "utf8"));
  const steps = [];
  let cwd = null;
  let started = null;
  let ended = null;

  for (const row of rows) {
    if (!cwd && typeof row.cwd === "string") cwd = row.cwd;
    const at = Date.parse(row.timestamp ?? "");
    if (Number.isFinite(at)) {
      if (started === null || at < started) started = at;
      if (ended === null || at > ended) ended = at;
    }

    const role = row.type === "user" ? "operator" : row.type === "assistant" ? "agent" : null;
    const content = row.message?.content;

    if (role && textOf(content).trim()) {
      steps.push({ kind: "message", role, at, text: textOf(content).trim() });
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "tool_use") {
        steps.push({ kind: "call", at, tool: part.name, input: part.input ?? {} });
      }
    }
    if (row.toolUseResult !== undefined) {
      steps.push({ kind: "result", at, text: resultText(row.toolUseResult) });
    }
  }

  return {
    path,
    cwd,
    started,
    ended,
    duration_ms: started !== null && ended !== null ? ended - started : null,
    steps,
    calls: steps.filter((step) => step.kind === "call"),
    operatorTurns: steps.filter((step) => step.kind === "message" && step.role === "operator")
  };
}
