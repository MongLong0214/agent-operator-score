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

// Every parse failure used to be discarded. A torn last line is the one an append-only writer can
// legitimately produce; damage anywhere else means rows are missing, and a review that silently
// drops them reports a clean session because it never saw the part that went wrong.
const parseLines = (text) => {
  const rows = [];
  const lines = text.split("\n");
  let malformedMiddle = 0;
  let tornTrailing = 0;
  let total = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    total += 1;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // "Last" means no further non-blank line follows, not "last element of the array".
      const isLast = lines.slice(index + 1).every((rest) => !rest.trim());
      if (isLast) tornTrailing += 1;
      else malformedMiddle += 1;
    }
  }
  return { rows, total, malformedMiddle, tornTrailing };
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
      steps.push({ kind: "call", at, call_id: payload.call_id ?? null, ...codexCall(payload) });
    } else if (payload.type === "function_call_output") {
      // Codex records no exit status here, so `ok` is null: unknown, which is neither success nor
      // failure and must not be read as either.
      steps.push({ kind: "result", at, call_id: payload.call_id ?? null, ok: null, text: resultText(payload.output) });
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
      if (part?.type === "tool_use") {
        steps.push({ kind: "call", at, call_id: part.id ?? null, tool: part.name, input: part.input ?? {} });
      }
      // `is_error` is the runtime's own verdict on the call. It is the difference between a test
      // command that ran and a test command that failed, and nothing else in the record carries it.
      if (part?.type === "tool_result") {
        steps.push({
          kind: "result",
          at,
          call_id: part.tool_use_id ?? null,
          ok: part.is_error === true ? false : true,
          text: resultText(part.content)
        });
      }
    }
    // Emitted alongside the tool_result part, not instead of it. The part carries the id and the
    // error flag; this carries the full stdout and stderr, and skipping it when a part was present
    // dropped the text four sessions' worth of secret material was being found in.
    if (row.toolUseResult !== undefined) {
      steps.push({ kind: "result", at, call_id: null, ok: null, text: resultText(row.toolUseResult) });
    }
  }
  return { steps, cwd };
};

// One normalized shape both runtimes reduce to, so the graders never learn a vendor's schema.
export function loadSession(path) {
  const parsed = parseLines(readFileSync(path, "utf8"));
  const rows = parsed.rows;
  const isCodex = rows.some((row) => row.type === "session_meta" || row.type === "response_item");
  const { steps, cwd } = isCodex ? fromCodex(rows) : fromClaude(rows);

  let started = null;
  let ended = null;
  for (const step of steps) {
    if (!Number.isFinite(step.at)) continue;
    if (started === null || step.at < started) started = step.at;
    if (ended === null || step.at > ended) ended = step.at;
  }

  const calls = steps.filter((step) => step.kind === "call");
  const results = steps.filter((step) => step.kind === "result");
  const byCallId = new Map();
  for (const result of results) {
    if (result.call_id) byCallId.set(result.call_id, result);
  }
  // Attribution is by id where the runtime records one. Nothing is guessed from adjacency: a
  // result matched to the wrong call is worse than an unpaired one, because it answers a question
  // about a command that never ran.
  for (const call of calls) call.result = call.call_id ? byCallId.get(call.call_id) ?? null : null;
  const paired = calls.filter((call) => call.result !== null).length;

  const recognized = rows.length;
  // The torn last line is out of the denominator. It means the writer was mid-append, not that the
  // transcript has holes, and counting it as lost content marked a perfectly readable session
  // INCOMPLETE. It is still reported on its own line, so the reader can see it happened.
  const readable = parsed.total - parsed.tornTrailing;
  const coverage = readable <= 0 ? 1 : recognized / readable;

  return {
    path,
    runtime: isCodex ? "codex" : "claude-code",
    // A review cannot be clean about a session it could not fully read, and the only way to say so
    // is to carry what was and was not read all the way into the result.
    coverage: {
      total_rows: parsed.total,
      recognized_rows: recognized,
      malformed_middle_rows: parsed.malformedMiddle,
      torn_trailing_rows: parsed.tornTrailing,
      tool_calls: calls.length,
      paired_results: paired,
      unpaired_calls: calls.length - paired,
      coverage,
      // One condition, not two. A malformed middle row is the only thing that lowers coverage
      // here, so `coverage < threshold` would be the same test written twice -- and a second term
      // that can never be the deciding one is a guard nobody can verify. Coverage is still
      // reported, because the count and the ratio answer different questions for a reader.
      status: parsed.malformedMiddle > 0 ? "INCOMPLETE" : "COMPLETE"
    },
    cwd,
    started,
    ended,
    duration_ms: started !== null && ended !== null ? ended - started : null,
    steps,
    calls,
    operatorTurns: steps.filter((step) => step.kind === "message" && step.role === "operator")
  };
}
