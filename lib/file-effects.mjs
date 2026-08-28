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
 * Reads the file effects of a shell script.
 *
 * The whole text is scanned once for quoting, then examined. Scanning per line was wrong for any
 * command carrying a multi-line quoted argument: each fragment looks unbalanced on its own, and the
 * fragment holding the redirection is the one that gets refused.
 *
 * Only forms whose target is unambiguous in the text are read. A script that writes through a
 * program AOS cannot parse -- `python build.py`, a Makefile -- produces nothing here.
 */
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

export const effectsOfScript = (script) => {
  // Instead of the shell parse, not beside it. The rest of an apply_patch call is JavaScript, and
  // running a shell parser over JavaScript is what turned `a => b` into a redirection once already.
  const patched = applyPatchEffects(script);
  if (patched.length > 0) return patched;
  const text = stripHeredocBodies(script);
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

export const sessionEffects = (session) =>
  session.calls.flatMap((call) =>
    effectsOfCall(call).map((entry) => ({ ...entry, absolute: absolutePath(entry.path, session.cwd), call }))
  );
