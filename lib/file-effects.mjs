import { isAbsolute, resolve } from "node:path";

// What a session actually changed on disk.
//
// The write detector knew five tool names. Every other way a file changes was invisible: a shell
// redirection, `sed -i`, `tee`, `cp`, `mv`, a script that writes its own output. A session that
// edited that way looked like a session that edited nothing, so the rule about claiming completion
// after an unverified edit never fired for it -- and the rule about writing outside the working
// tree could not see the write at all.
//
// Confidence is reported rather than assumed. A native tool call names its path exactly; a shell
// line is parsed, and a parse of shell is an approximation. Saying which is which is what lets a
// reader weigh a finding built on it.

export const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "apply_patch"]);

const effect = (kind, path, source, confidence) => ({ kind, path, source, confidence });

/**
 * Whether a token parsed out of a shell line is plausibly a file.
 *
 * Shell text is full of things that sit where a path sits: file descriptors (`2`), the stdout
 * convention (`-`), and, when a command carries prose or code, ordinary words. Measured across
 * forty sessions the parser produced 5,709 distinct "files", of which the most frequent were `0`,
 * `1`, `2`, `-` and `The`. A path has a separator or an extension; a bare word does not.
 */
const looksLikePath = (token) => {
  if (token.length < 2) return false;
  if (/^\d+$/.test(token)) return false;
  // Every /dev entry, which covers the null sinks a redirection is usually aimed at: writing to
  // one changes nothing, and counting it made every `2>/dev/null` an edit.
  if (token.startsWith("/dev/")) return false;
  if (!/^[\w./~@+-]+$/.test(token)) return false;
  return token.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(token);
};

/**
 * Removes heredoc bodies, keeping the line that opened them.
 *
 * The earlier pattern required the marker to be the last thing on its line, so
 * `cat <<'EOF' > real.txt` was not recognised as a heredoc at all and its body was read as
 * commands. Keeping the opening line matters as much: the redirection on it is a real write.
 *
 * The terminator is a backreference to the marker, so a body containing another word on its own
 * line does not end the block early.
 */
export const stripHeredocBodies = (script) =>
  script.replace(/(<<\s*-?\s*(['"]?)([A-Za-z_]\w*)\2[^\n]*)\n[\s\S]*?\n\3[ \t]*(?=\n|$)/g, "$1");

/**
 * Removes the body of a patch envelope, keeping the call that applies it.
 *
 * The lines between `*** Begin Patch` and `*** End Patch` are file content, and file content is not
 * a command. Two of the ten high-severity findings in the owner's held-back sessions were
 * `DROP TABLE` inside a sqlite migration being *written* by an agent, reported as an irreversible
 * command that ran. This is the same rule the heredoc stripper already applies, in the shape Codex
 * uses -- and the envelope arrives inside a JavaScript string, so its line breaks are usually the
 * two characters backslash-n.
 *
 * The `*** Update File:` headers stay: they name what was written, and applyPatchEffects reads them.
 */
const PATCH_HEADER = /^\s*\*\*\* (?:Begin Patch|End Patch|Add File:|Update File:|Delete File:|Move to:)/;

export const stripPatchBodies = (script) => {
  if (!script.includes("*** Begin Patch")) return script;
  const start = script.indexOf("*** Begin Patch");
  const end = script.indexOf("*** End Patch", start);
  if (end < 0) return script;
  const finish = end + "*** End Patch".length;
  // Split on both kinds of line break: the envelope usually travels inside a JavaScript string, so
  // its breaks are the two characters backslash-n rather than newlines. Written as a capture so the
  // separators come back and the text can be rebuilt as it was.
  const parts = script.slice(start, finish).split(/(\\n|\n)/);
  const kept = parts.filter((part, index) => index % 2 === 1 || PATCH_HEADER.test(part));
  // Rebuild with one separator between survivors rather than the ones that happened to follow them.
  const separator = parts.find((part, index) => index % 2 === 1) ?? "\\n";
  const body = kept.filter((part, index) => !(index % 2 === 1)).length > 0
    ? kept.filter((part) => PATCH_HEADER.test(part)).join(separator)
    : "";
  return `${script.slice(0, start)}${body}${script.slice(finish)}`;
};

/**
 * Walks a line once, tracking shell quoting.
 *
 * Counting `'` and `"` separately is wrong in the way that matters here: in `echo "don't" > f.txt`
 * the apostrophe is literal, but a per-character count reads the line as unbalanced and refuses it.
 * Measured, that refusal dropped 154 real paths -- `.serena/project.yml`, `./review-target.diff`.
 *
 * Returns which positions sit inside a quoted run, and whether the line closed everything it
 * opened. A line that did not is a fragment of something larger and cannot be read as shell.
 */
const scanQuotes = (line) => {
  const inside = new Array(line.length).fill(false);
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && double) {
      inside[index] = true;
      if (index + 1 < line.length) inside[index + 1] = true;
      index += 1;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      inside[index] = true;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      inside[index] = true;
      continue;
    }
    inside[index] = single || double;
  }
  return { inside, balanced: !single && !double };
};

/**
 * Whether a fragment cannot be read as shell on its own.
 *
 * Kept for a single line handed in without its script. The parser itself scans the whole command,
 * because splitting first is what made this question come up: `echo "line one\nline two" > out.txt`
 * splits into two fragments that are each unbalanced, and the second carries a real redirection.
 * Refusing them dropped 152 real paths.
 */
export const isUnparsableShell = (line) => !scanQuotes(line).balanced;

const unquote = (token) => token.replace(/^["']|["']$/g, "");

// Tokens that are options rather than paths.
const isOption = (token) => token.startsWith("-");

const pathsAfter = (segment, command) => {
  const tokens = segment.split(/\s+/).slice(1).filter((token) => !isOption(token));
  if (command === "mv" || command === "cp") return tokens.slice(-1).map(unquote);
  return tokens.map(unquote);
};

/**
 * The files a Codex `apply_patch` call writes.
 *
 * Codex does not edit through a tool with a path argument. It runs a shell call whose source builds
 * a patch envelope in a string and hands it to `tools.apply_patch`, so every write it makes is
 * invisible to a parser looking for redirections and native tool arguments -- and every rule here
 * that asks what a session wrote was answering about Codex sessions with "nothing".
 *
 * The call has to be present, not just the envelope. A file that quotes the patch format while
 * explaining it is prose, and prose is not a write; requiring `apply_patch` at the point of use is
 * what separates the two. The envelope arrives inside a JavaScript string literal, so the line
 * breaks are usually the two characters backslash-n rather than newlines.
 */
const APPLY_PATCH_CALL = /\bapply_patch\s*\(/;
const PATCH_TARGET = /\*\*\*\s*(Add|Update|Delete)\s+File:\s*([^\n"'\\]+)/g;

export const applyPatchEffects = (script) => {
  if (!APPLY_PATCH_CALL.test(script) || !script.includes("*** Begin Patch")) return [];
  const found = [];
  for (const match of script.matchAll(PATCH_TARGET)) {
    const path = match[2].trim().replace(/[),;:]+$/, "");
    if (!path || !looksLikePath(path)) continue;
    // Named by the envelope itself and applied by the call beside it: there is no parse to be wrong
    // about, which is the same standing as a native tool that records its path.
    found.push(effect(match[1].toLowerCase() === "delete" ? "delete" : "write", path, "apply-patch", "HIGH"));
  }
  return found;
};

/**
 * Reads the file effects of a shell script.
 *
 * The whole text is scanned once for quoting, then examined. Scanning per line was wrong for any
 * command carrying a multi-line quoted argument: each fragment looks unbalanced on its own, and the
 * fragment holding the redirection is the one that gets refused.
 *
 * Only forms whose target is unambiguous in the text are read. A script that writes through a
 * program AOS cannot parse -- `python build.py`, a Makefile -- produces nothing here.
 */
export const effectsOfScript = (script) => {
  // Instead of the shell parse, not beside it. The rest of an apply_patch call is JavaScript, and
  // running a shell parser over JavaScript is what turned `a => b` into a redirection once already.
  // Heredocs first, for the patch path too.
  //
  // `applyPatchEffects` read the raw script, so a heredoc *writing a file that contains* a patch
  // envelope -- a test fixture, a document quoting one -- produced HIGH-confidence writes to the
  // paths named in that content. Six of those became an `edits-outside-the-working-directory`
  // finding on this repository's own test file. The heredoc stripper is exactly the rule that
  // already exists for this, and it was applied to the shell path only.
  //
  // A real apply_patch call is not inside a heredoc, so stripping first cannot hide one.
  const text = stripHeredocBodies(script);
  const patched = applyPatchEffects(text);
  if (patched.length > 0) return patched;
  const quotes = scanQuotes(text);
  const found = [];
  const add = (kind, path, confidence) => {
    // Trailing punctuation comes from the surrounding line, not from the name: `2>/dev/null)` was
    // the single most frequent "file" this produced.
    const cleaned = unquote(path).replace(/[),;:]+$/, "");
    if (!cleaned || cleaned.startsWith("$")) return;
    if (!looksLikePath(cleaned)) return;
    found.push(effect(kind, cleaned, "shell-parser", confidence));
  };

  // Redirection. `>` and `>>` both create or replace; `2>` is the same write to a different stream.
  // The operator has to sit at a token boundary. Without that, `a => b` and `if (x > y)` are
  // redirections, which is how JavaScript in a command became a list of files.
  const redirect = /(?:^|\s)([0-9]?)(>>?)(?![|&])[ \t]*("[^"\n]+"|'[^'\n]+'|[^\s;&|<>=]+)/g;
  for (const match of text.matchAll(redirect)) {
    // The offset of the operator itself, not of the leading whitespace the pattern also consumed.
    const operatorAt = match.index + match[0].indexOf(match[2]);
    if (quotes.inside[operatorAt]) continue;
    add("write", match[3], "MEDIUM");
  }

  let offset = 0;
  for (const rawLine of text.split("\n")) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // A line that begins inside a quoted run is data carried over from the line before it.
    if (quotes.inside[lineStart + (rawLine.length - rawLine.trimStart().length)]) continue;

    for (const segment of line.split(/&&|\|\||;|(?<!\|)\|(?!\|)/).map((part) => part.trim())) {
      const command = segment.split(/\s+/)[0]?.replace(/^\S*\//, "");
      if (command === "tee") {
        for (const path of pathsAfter(segment, "tee")) add("write", path, "MEDIUM");
      } else if (command === "sed" && /\s-[a-zA-Z]*i/.test(segment)) {
        // `sed -i` rewrites in place; its last argument is the file, the rest is the script.
        const tokens = segment.split(/\s+/).filter((token) => !isOption(token));
        if (tokens.length > 2) add("write", tokens.at(-1), "MEDIUM");
      } else if (command === "perl" && /\s-[a-zA-Z]*i/.test(segment)) {
        const tokens = segment.split(/\s+/).filter((token) => !isOption(token));
        if (tokens.length > 1) add("write", tokens.at(-1), "MEDIUM");
      } else if (command === "cp") {
        for (const path of pathsAfter(segment, "cp")) add("write", path, "MEDIUM");
      } else if (command === "mv") {
        for (const path of pathsAfter(segment, "mv")) add("rename", path, "MEDIUM");
      } else if (command === "rm") {
        for (const path of pathsAfter(segment, "rm")) add("delete", path, "MEDIUM");
      } else if (command === "touch") {
        for (const path of pathsAfter(segment, "touch")) add("write", path, "LOW");
      } else if (command === "chmod" || command === "chown") {
        for (const path of pathsAfter(segment, command).slice(1)) add("chmod", path, "LOW");
      } else if (command === "ln" && /\s-[a-zA-Z]*s/.test(segment)) {
        const tokens = segment.split(/\s+/).filter((token) => !isOption(token));
        if (tokens.length > 2) add("symlink", tokens.at(-1), "MEDIUM");
      }
    }
  }
  return found;
};

/** One line, for callers that have only a line. The script path is the one the product uses. */
export const effectsOfShellLine = (line) => effectsOfScript(line);

const nativePath = (input) =>
  typeof input?.file_path === "string" ? input.file_path
    : typeof input?.path === "string" ? input.path
      : typeof input?.notebook_path === "string" ? input.notebook_path
        : null;

/** Every file effect one call produced, from whichever source could see it. */
/**
 * The directory a command's relative paths are actually resolved against.
 *
 * #502: nothing tracked `cd`, so `cd /private/tmp/x && cat > prompt.txt` had `prompt.txt` resolved
 * against the session's original cwd. The write landed in the repository as far as the rules were
 * concerned, and a file written *after* the last verification looked like an edit to the work --
 * which is how `session-ended-on-stale-evidence` reported a session that had done nothing wrong.
 *
 * Per call, never across them: each Bash invocation is a fresh shell, so a `cd` in one command does
 * not move the next one. Only a leading `cd`, because `foo && cd bar` moves nothing that came
 * before it, and a `cd` inside a heredoc or a quoted payload is text.
 */
export const effectiveCwd = (call, cwd) => {
  const command = typeof call?.input?.command === "string" ? call.input.command : "";
  if (!command) return cwd;
  const leading = stripHeredocBodies(command).trimStart().match(/^cd\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
  const target = leading?.[1] ?? leading?.[2] ?? leading?.[3];
  if (!target || target === "-" || target.startsWith("~")) return cwd;
  return target.startsWith("/") ? target : (cwd ? `${cwd}/${target}` : cwd);
};

export const effectsOfCall = (call) => {
  if (WRITE_TOOLS.has(call.tool)) {
    const path = nativePath(call.input);
    // The tool wrote, even when the record does not name where. Dropping the effect entirely would
    // report a session that edited as one that did not.
    return [effect("write", path, "native-tool", path === null ? "LOW" : "HIGH")];
  }
  if (call.tool !== "Bash" && call.tool !== "shell") return [];
  const script = typeof call.input?.command === "string" ? call.input.command
    : typeof call.input?.cmd === "string" ? call.input.cmd : "";
  return effectsOfScript(script);
};

/** Resolves an effect's path against the session's working directory, when it has one. */
export const absolutePath = (path, cwd) => {
  if (path === null) return null;
  if (isAbsolute(path)) return path;
  return cwd ? resolve(cwd, path) : null;
};

/**
 * What two snapshots of one workspace say changed in it.
 *
 * The rest of this file reads a transcript: it asks what a session's tool calls and shell lines
 * *said* they would do, which is the best a review of somebody else's recording can do. This asks a
 * different question with a different authority -- what was on disk before, what was on disk after
 * -- and it is the fourth source in #557's precedence ladder for exactly that reason. A snapshot
 * diff cannot be argued with about whether a file changed, and it cannot say who changed it.
 *
 * A rename is not claimed. Two snapshots show a path gone and a path arrived, and calling that one
 * rename is an inference about intent that the evidence does not carry; both halves are reported as
 * what they are. `lib/safe-fs.mjs` records a directory and a refused entry as markers rather than
 * digests, and both are changes: an agent that creates a directory outside its scope, or replaces a
 * file with something the walk refuses to read, has changed the workspace either way.
 *
 * The two snapshots are null-prototype maps from `safeWalk`, because a workspace path is
 * attacker-chosen: read through a `Map` here so that a file called `__proto__` is a key like any
 * other rather than a write to `Object.prototype` that leaves the diff reporting no change.
 */
export const diffSnapshots = (baseline, final) => {
  const before = new Map(Object.entries(baseline ?? Object.create(null)));
  const after = new Map(Object.entries(final ?? Object.create(null)));
  const changed = [];
  for (const [path, digest] of after) {
    if (!before.has(path)) changed.push({ kind: "file.write", path, source: "filesystem-diff", confidence: "MEDIUM" });
    else if (before.get(path) !== digest) changed.push({ kind: "file.write", path, source: "filesystem-diff", confidence: "MEDIUM" });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push({ kind: "file.delete", path, source: "filesystem-diff", confidence: "MEDIUM" });
  }
  // Sorted, so two runs of one diff produce one order and a digest over the result is stable.
  return changed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
};
