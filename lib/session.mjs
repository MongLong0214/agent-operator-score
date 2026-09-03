import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Sessions the operator already ran are the only material that costs nothing to grade and is
// about their own work. Claude Code writes one JSONL per session under ~/.claude/projects/<slug>/;
// Codex writes under ~/.codex/sessions/. Both are append-only lines of JSON.
const ROOTS = [
  { runtime: "claude-code", root: join(homedir(), ".claude", "projects") },
  { runtime: "codex", root: join(homedir(), ".codex", "sessions") },
  // Grok CLI keeps one directory per working directory, url-encoded, and one per session inside it.
  // Only the transcript is a session; `prompt_history.jsonl` sits beside it and is a list of what
  // the operator typed, which is read for timestamps rather than walked as a session of its own.
  { runtime: "grok", root: join(homedir(), ".grok", "sessions"), file: "chat_history.jsonl" }
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

/**
 * A transcript AOS produced itself, running the suite.
 *
 * `assess` runs its agents in workspaces under the AOS store, and both runtimes write a transcript
 * per workspace into the same tree this walks. Reviewed as the operator's own work they are worse
 * than noise: a suite family is *designed* to end without verification, to plant a false completion
 * and to write where it should not, so AOS reports its own instructions back as the operator's
 * findings -- and they crowd out the real sessions, because a full run is seven invocations all
 * newer than anything that came before it.
 *
 * Matched on the path, because that is what discovery has before it reads anything. Claude Code
 * slugs the working directory into the project folder name, so both the literal and the slugged
 * form are checked.
 */
// #556 moved the workspaces out of the store, so both layouts are matched: the old
// `<store>/runs/<run>/workspaces/<family>` and the current `<store>-workspaces/<run>/<family>`,
// each in its literal and its Claude-Code-slugged form.
const AOS_WORKSPACE = /(?:\/|-)aos-runs-run-[0-9a-f-]+-workspaces-|\/\.aos\/runs\/run-[0-9a-f-]+\/workspaces\/|(?:\/|-)aos-workspaces[/-]run-[0-9a-f-]+[/-]|(?:\/|-)[A-Za-z0-9_.-]*-workspaces[/-]run-[0-9a-f-]+[/-]/u;

// The root an operator configured, which the patterns above cannot guess. `AOS_WORKSPACES` accepts
// any absolute path, and the recogniser only knew roots whose name ends in `-workspaces` -- so
// under that supported knob AOS stopped recognising its own suite transcripts and reported them
// back as the operator's sessions, which is the exact inversion this function exists to prevent.
// The root is matched literally and in Claude Code's slugged form, and only when a run id follows
// it: a configured root is still not a licence to skip everything under it.
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const configuredWorkspaceRoot = (env = process.env) => {
  const value = env.AOS_WORKSPACES;
  if (typeof value !== "string" || value.length < 2) return null;
  return value.replace(/\/+$/u, "");
};

const underConfiguredRoot = (path, root) => {
  if (root === null) return false;
  const literal = new RegExp(`(?:^|/)${escapeForRegExp(root.replace(/^\//u, ""))}/run-[0-9a-f-]+/`, "u");
  const slugged = new RegExp(`(?:^|/|-)${escapeForRegExp(root.replace(/^\//u, "").replace(/\//gu, "-"))}-run-[0-9a-f-]+[/-]`, "u");
  return literal.test(path) || slugged.test(path);
};

export const isAosWorkspaceTranscript = (path, env = process.env) => AOS_WORKSPACE.test(path) || underConfiguredRoot(path, configuredWorkspaceRoot(env));

export const RUNTIMES = ROOTS.map((entry) => entry.runtime);

export function findSessions({ limit = 20 } = {}) {
  const found = [];
  let skipped = 0;
  for (const { runtime, root, file } of ROOTS) {
    for (const path of walkJsonl(root)) {
      if (file && !path.endsWith(`/${file}`)) continue;
      if (isAosWorkspaceTranscript(path)) { skipped += 1; continue; }
      let stats;
      try { stats = statSync(path); } catch { continue; }
      found.push({ runtime, path, bytes: stats.size, modified: stats.mtimeMs });
    }
  }
  const sessions = found.sort((a, b) => b.modified - a.modified).slice(0, limit);
  // Said rather than dropped silently: an operator who just ran an assessment should be told why
  // their newest transcripts are not in the window.
  sessions.aosWorkspacesSkipped = skipped;
  return sessions;
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

/**
 * The argument object inside a `custom_tool_call`.
 *
 * Newer Codex does not send a JSON argument string. It sends a line of JavaScript --
 * `const r = await tools.exec_command({"cmd": "...", "workdir": "..."});` -- so the object has to be
 * cut out of the source before anything can read a command from it. Scanning respects string state,
 * because a brace inside the command would otherwise close the object early and lose the rest.
 */
/**
 * Quotes the identifier keys of a JavaScript object literal so JSON can read it.
 *
 * Codex writes both `{"cmd": "..."}` and `{cmd: "..."}`, and only the first is JSON. Twenty-seven
 * per cent of the tool calls in the owner's own corpus took the second shape, fell back to keeping
 * the raw JavaScript as the command, and were then invisible to every rule that reads one -- a
 * session that ran `node --test` after every edit was told nothing had checked it.
 *
 * Keys are quoted only outside string state. Rewriting `key:` wherever it appeared would corrupt a
 * command that contains one, and a corrupted literal fails to parse anyway.
 */
const quoteBareKeys = (source) => {
  let out = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      out += character;
      if (character === "\\") { out += source[index + 1] ?? ""; index += 1; }
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; out += character; continue; }
    if (character === "{" || character === ",") {
      out += character;
      const key = /^(\s*)([A-Za-z_$][\w$]*)(\s*:)/.exec(source.slice(index + 1));
      if (key) { out += `${key[1]}"${key[2]}"${key[3]}`; index += key[0].length; }
      continue;
    }
    out += character;
  }
  return out;
};

const objectAfterCall = (source) => {
  const opened = /tools\.[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\{/.exec(source);
  if (!opened) return null;
  const start = source.indexOf("{", opened.index);
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const literal = source.slice(start, index + 1);
        try { return JSON.parse(literal); } catch { /* a JavaScript object literal, not JSON */ }
        try { return JSON.parse(quoteBareKeys(literal)); } catch { return null; }
      }
    }
  }
  return null;
};

/**
 * A `custom_tool_call`, which is how this Codex writes every shell command it runs.
 *
 * Nine hundred and twenty-nine of nine hundred and thirty-one tool calls in the owner's own corpus
 * are this shape and the parser read two of them, so every rule that looks at a command was blind
 * to almost all Codex work. When the wrapper cannot be parsed the raw source is kept as the command
 * rather than dropped: it still contains the command text, and a rule that sees the text can still
 * find what is in it, where a dropped call can never be graded at all.
 */
const codexCustomCall = (payload) => {
  const source = typeof payload.input === "string" ? payload.input : "";
  const parsed = objectAfterCall(source);
  const command = parsed?.cmd ?? parsed?.command ?? source;
  return {
    tool: "Bash",
    input: { ...(parsed ?? {}), command, cwd: parsed?.workdir ?? undefined }
  };
};

// Row shapes this parser knows and deliberately turns into nothing: reasoning, telemetry and the
// envelope. Everything else that carries transcript content and is *not* here counts as unread --
// see the coverage note in loadSession for why that distinction is the whole point.
const CODEX_CONTENT_ROW = "response_item";
const CODEX_UNDERSTOOD = new Set([
  "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output",
  "user_message", "agent_message", "message", "reasoning"
]);

const fromCodex = (rows) => {
  const steps = [];
  let cwd = null;
  for (const row of rows) {
    const payload = row.payload ?? {};
    if (row.type === "session_meta" && typeof payload.cwd === "string") cwd = payload.cwd;
    const at = Date.parse(row.timestamp ?? "");

    if (payload.type === "custom_tool_call") {
      steps.push({ kind: "call", at, call_id: payload.call_id ?? null, ...codexCustomCall(payload) });
    } else if (payload.type === "custom_tool_call_output") {
      steps.push({ kind: "result", at, call_id: payload.call_id ?? null, ok: null, text: resultText(payload.output) });
    } else if (payload.type === "function_call") {
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
  const content = rows.filter((row) => row.type === CODEX_CONTENT_ROW);
  return {
    steps,
    cwd,
    contentRows: content.length,
    understoodRows: content.filter((row) => CODEX_UNDERSTOOD.has(row.payload?.type)).length
  };
};

// The content parts this parser turns into something, or knows to be prose rather than work.
// Anything else inside a transcript message is a shape nobody here has seen.
const CLAUDE_UNDERSTOOD = new Set(["tool_use", "tool_result", "text", "thinking", "image"]);

// What the harness puts in a `user` row, taken from what the runtimes on this machine actually
// emit rather than from a guess: across sixty Claude Code sessions and forty Grok ones the tags
// are `task-notification` (much the most common), `system-reminder`, `user_info`, the
// `local-command-*` and `command-*` families, and `fork-boilerplate`.
//
// Whole-text, not a substring: an operator who quotes a reminder while asking about it is still an
// operator taking a turn.
const HARNESS_TAGS = [
  "system-reminder", "task-notification", "user_info", "fork-boilerplate",
  "local-command-stdout", "local-command-stderr", "local-command-caveat",
  "command-name", "command-message", "command-args"
].join("|");
const HARNESS_BLOCK = new RegExp(`^(?:<(${HARNESS_TAGS}|hook-[\\w-]+)>[\\s\\S]*?<\\/\\1>\\s*)+$`);
export const isHarnessBlock = (text) => HARNESS_BLOCK.test(text.trim());

// Grok wraps what the operator typed in a tag of its own. It is the prompt, not the harness, so it
// is unwrapped rather than dropped -- treating every tagged row as harness would leave a Grok
// session with no operator turns at all.
const USER_QUERY = /^<user_query>([\s\S]*?)<\/user_query>$/;
export const operatorText = (text) => USER_QUERY.exec(text.trim())?.[1].trim() ?? text.trim();

// Claude Code writes one JSONL entry per turn with the tool calls inline in message.content.
const fromClaude = (rows) => {
  const steps = [];
  let contentRows = 0;
  let understoodRows = 0;
  let cwd = null;
  for (const row of rows) {
    if (!cwd && typeof row.cwd === "string") cwd = row.cwd;
    const at = Date.parse(row.timestamp ?? "");
    const role = row.type === "user" ? "operator" : row.type === "assistant" ? "agent" : null;
    const content = row.message?.content;
    if (role && Array.isArray(content)) {
      contentRows += 1;
      if (content.every((part) => CLAUDE_UNDERSTOOD.has(part?.type))) understoodRows += 1;
    }

    const said = textOf(content).trim();
    // A `user` row is not always the operator. Claude Code uses it for what the harness injects --
    // system reminders, local command output, hook results -- and counting those as operator turns
    // makes a session look attended that nobody was attending. `fromCodex` already draws this line
    // for `developer` rows; this is the same line on this side.
    //
    // Measured over sixty sessions here it moved no finding, because the rule that reads operator
    // turns needs a long stretch and these are sparse. It does not stay that way: a hook that emits
    // context on every turn injects one per turn, and each one would reset the counter.
    if (role && said && !(role === "operator" && isHarnessBlock(said))) {
      steps.push({ kind: "message", role, at, text: said });
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
  return { steps, cwd, contentRows, understoodRows };
};

/**
 * Grok CLI transcripts.
 *
 * The rows are flat and the tool calls carry their own ids: an `assistant` row holds
 * `tool_calls: [{id, name, arguments}]` and every `tool_result` carries the matching
 * `tool_call_id`. Measured over forty real transcripts here, 1,757 of 1,757 results paired, so
 * nothing has to be guessed from adjacency -- which is what the other two adapters refuse to do.
 *
 * `reasoning` is the row this parser deliberately turns into nothing, and `system` is the harness.
 * The working directory is the url-encoded directory name two levels up; there is no row that
 * carries it.
 *
 * There are no timestamps in the transcript. `prompt_history.jsonl` beside it carries one per
 * operator prompt, matched here by the text of the prompt rather than by position -- the first
 * `user` row is an injected `<user_info>` block, so position does not line up. A step with no
 * timestamp keeps `NaN`, which the rest of this file already treats as unknown rather than as zero.
 */
const GROK_TOOLS = {
  run_terminal_command: { tool: "Bash", input: (a) => ({ ...a, command: a.command ?? "" }) },
  write: { tool: "Write", input: (a) => ({ ...a, file_path: a.file_path }) },
  search_replace: { tool: "Edit", input: (a) => ({ ...a, file_path: a.file_path }) }
};
const GROK_UNDERSTOOD = new Set(["user", "assistant", "tool_result", "reasoning", "system", "backend_tool_call"]);

const grokPromptTimes = (path) => {
  const id = basename(dirname(path));
  const history = join(dirname(dirname(path)), "prompt_history.jsonl");
  if (!existsSync(history)) return [];
  const times = [];
  for (const line of readFileSync(history, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.session_id === id && typeof row.prompt === "string") times.push({ at: Date.parse(row.timestamp ?? ""), prompt: row.prompt });
    } catch { /* a prompt history line that will not parse is not a prompt */ }
  }
  return times;
};

const fromGrok = (rows, path) => {
  const steps = [];
  const cwd = (() => {
    try { return decodeURIComponent(basename(dirname(dirname(path)))); } catch { return null; }
  })();
  const pending = grokPromptTimes(path);
  let contentRows = 0;
  let understoodRows = 0;

  for (const row of rows) {
    contentRows += 1;
    if (GROK_UNDERSTOOD.has(row.type)) understoodRows += 1;
    const at = Number.NaN;

    if (row.type === "user") {
      const raw = (Array.isArray(row.content) ? row.content : [])
        .map((part) => part?.text ?? "").join("\n").trim();
      if (!raw || isHarnessBlock(raw)) continue;
      const text = operatorText(raw);
      if (!text) continue;
      // In order, by what the operator actually typed. The transcript has no clock of its own.
      const index = pending.findIndex((entry) => text.includes(entry.prompt.slice(0, 40)));
      const stamped = index >= 0 ? pending.splice(0, index + 1).at(-1).at : at;
      steps.push({ kind: "message", role: "operator", at: stamped, text });
      continue;
    }
    if (row.type === "assistant") {
      if (typeof row.content === "string" && row.content.trim()) {
        steps.push({ kind: "message", role: "agent", at, text: row.content.trim() });
      }
      for (const call of Array.isArray(row.tool_calls) ? row.tool_calls : []) {
        let args = {};
        try { args = JSON.parse(call.arguments ?? "{}"); } catch { /* an unparsable argument is not a call we can grade */ }
        const mapped = GROK_TOOLS[call.name];
        steps.push({
          kind: "call",
          at,
          call_id: call.id ?? null,
          tool: mapped ? mapped.tool : call.name,
          input: mapped ? mapped.input(args) : args
        });
      }
      continue;
    }
    if (row.type === "tool_result") {
      // Grok records no exit status, so `ok` is null: unknown, which is neither success nor failure.
      steps.push({ kind: "result", at, call_id: row.tool_call_id ?? null, ok: null, text: resultText(row.content) });
    }
  }
  return { steps, cwd, contentRows, understoodRows };
};

// One normalized shape every runtime reduces to, so the graders never learn a vendor's schema.
export function loadSession(path) {
  const parsed = parseLines(readFileSync(path, "utf8"));
  const rows = parsed.rows;
  const isGrok = path.endsWith("chat_history.jsonl");
  const isCodex = !isGrok && rows.some((row) => row.type === "session_meta" || row.type === "response_item");
  const { steps, cwd, contentRows, understoodRows } =
    isGrok ? fromGrok(rows, path) : isCodex ? fromCodex(rows) : fromClaude(rows);

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

  // Rows the parser understood, over rows that could have carried work. This used to be
  // `rows.length / readable` -- every row that was valid JSON counted as read -- so a session whose
  // entire tool history was in a shape this parser had never seen reported coverage 1.0, COMPLETE,
  // and no findings. That is the exact shape of a clean bill of health nobody earned, and it was
  // true of nine hundred and twenty-nine of the nine hundred and thirty-one Codex tool calls in the
  // owner's own sessions. The denominator is transcript content, not the envelope: telemetry and
  // metadata rows are not work and counting them would only dilute the number.
  const coverage = contentRows <= 0 ? 1 : understoodRows / contentRows;

  return {
    path,
    runtime: isGrok ? "grok" : isCodex ? "codex" : "claude-code",
    // A review cannot be clean about a session it could not fully read, and the only way to say so
    // is to carry what was and was not read all the way into the result.
    coverage: {
      total_rows: parsed.total,
      // Named for what it counts. `recognized_rows` counted rows that parsed as JSON, which is a
      // different question from whether anything here knew what they were.
      content_rows: contentRows,
      understood_rows: understoodRows,
      unread_content_rows: contentRows - understoodRows,
      malformed_middle_rows: parsed.malformedMiddle,
      torn_trailing_rows: parsed.tornTrailing,
      tool_calls: calls.length,
      paired_results: paired,
      unpaired_calls: calls.length - paired,
      coverage,
      // Two conditions now, and both can decide it. A row that was damaged on disk and a row whose
      // shape this parser has never seen are different failures with the same consequence: content
      // that was never read. When coverage only moved with malformed rows this second term would
      // have been the same test written twice; it is not any more, and the session that proved it
      // was reported clean.
      status: parsed.malformedMiddle > 0 || understoodRows < contentRows ? "INCOMPLETE" : "COMPLETE"
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
