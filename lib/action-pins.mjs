import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// Every external action this repository runs, pinned to a commit nobody can move.
//
// A tag is a name for a commit and the owner of the tag decides which commit that is, at any time,
// retroactively. `actions/checkout@v5` in a workflow with `contents: read` is still a promise to
// execute whatever the tag points at on the day the job runs. The supply-chain failure this
// prevents does not need anyone to compromise this repository at all.
//
// Two things make the check worth having rather than decorative: discovery is by shape rather than
// by a list of filenames -- a release workflow added next month is scanned without anyone
// remembering to add it -- and a file the reader cannot read is a failure rather than a skip,
// because a check that shrugs at what it does not understand reports green on the one file that
// was written to be misunderstood.

/** Forty lowercase hexadecimal characters. Not thirty-nine, not forty-one, not uppercase. */
export const ACTION_REF = /^[0-9a-f]{40}$/;

const POLICY_URL = new URL("../governance/action-pin-policy.json", import.meta.url);
export const loadPolicy = (url = POLICY_URL) => JSON.parse(readFileSync(url, "utf8"));

// Only the one directory that cannot contain a workflow GitHub would run. An earlier version also
// skipped node_modules, dist, .next and coverage, and that was a hole rather than an optimisation:
// a workflow saying `uses: ./dist` runs `dist/action.yml`, and a composite action there could name
// any external action at any mutable tag while the scan never entered the directory. Skipping by
// name is skipping the place someone would put it.
const SKIP_DIRECTORIES = new Set([".git"]);

/** A version a human can check: v5, v5.1, v5.1.0, optionally with a suffix. */
const DEFAULT_VERSION_COMMENT = "^v\\d+(\\.\\d+){0,2}([-+][0-9A-Za-z.-]+)?$";

/** A container image is pinned by digest, never by tag. */
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * Every workflow and action definition in the tree, found by where it sits and what it is called.
 *
 * `.github/workflows/**​/*.yml|yaml` and any `action.yml|yaml` anywhere. Naming the files instead
 * would mean a workflow added for the release, or for an admin task, is outside the check by
 * default -- and those are the two that carry the most permission.
 */
export function discoverWorkflowFiles(root) {
  const found = [];
  const unreadable = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      // Not skipped. A directory the scan cannot read is a directory whose contents are unknown,
      // and "unknown" has to reach the report rather than being swallowed by a bare catch.
      unreadable.push({ directory: relative(root, directory).split(sep).join("/") || ".", reason: error.code ?? "unreadable" });
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const inWorkflows = relative(root, path).split(sep).join("/").includes(".github/workflows/");
      const isWorkflow = inWorkflows && /\.ya?ml$/.test(entry.name);
      const isAction = /^action\.ya?ml$/.test(entry.name);
      if (isWorkflow || isAction) found.push(path);
    }
  };
  walk(root);
  found.sort();
  found.unreadable = unreadable;
  return found;
}

// --- a reader for the YAML a workflow is written in ---------------------------------------------
//
// Three independent reviews found three ways past the line-and-indentation scan that used to be
// here, and every one of them was valid YAML that `actionlint` accepts and GitHub runs:
//
//     - "\u0075ses": attacker/evil@main     an escaped key: YAML resolves the escape before the
//                                           key is a key, so matching the characters matched
//                                           something YAML had stopped calling that key
//     - if: |                               a block scalar written on a dashed line swallowed its
//         github.event_name == 'push'       own siblings, because the scan measured the block from
//       uses: attacker/evil@main            the dash rather than from the key
//     - ? >-                                an explicit key, written as a folded scalar, which no
//         uses                              single-line key pattern can see at all
//       : attacker/evil@main
//
// The pattern is the argument. Each fix was right and the next spelling was one nobody had thought
// of, and a check whose entire value is that it cannot be evaded cannot be assembled out of guesses
// about how somebody will write a mapping key. So this reads the structure instead: keys are the
// keys YAML resolves, a block scalar ends where YAML ends it, and what this cannot read it refuses
// -- which fails the check rather than passing it.
//
// It is not a complete YAML implementation and does not try to be. It covers what a workflow can
// contain: block mappings and sequences, flow mappings and sequences, plain, single-quoted and
// double-quoted scalars including their escapes and line folding, literal and folded block scalars
// with their indentation and chomping indicators, explicit keys, anchors, aliases and comments.
// Tags, a second document and a tab used as indentation are refused by name.

/** The escapes a YAML double-quoted scalar allows. */
const YAML_ESCAPES = {
  "0": "\0", a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b",
  " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029"
};

const resolveEscape = (code) => {
  if (code.length > 1) return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
  return YAML_ESCAPES[code] ?? code;
};

// A line that opens a block mapping: a key, quoted or not, followed by a colon and a space. The
// first character of an unquoted key cannot be one that opens something else -- `{`, `[`, `&`, `*`
// and the block-scalar indicators all begin a value, and reading `{ uses: x }` as a key named
// `{ uses` is how a flow mapping stopped being one.
const KEY_TEXT = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#"'{}[\],*&!|>%@`:](?:[^:#]|:(?=\S))*?)\s*:(\s|$)/;

/**
 * Reads a workflow into a small node tree, or throws with the line it gave up on.
 *
 * Nodes are `{kind: "map", entries: [{key, value, line}]}`, `{kind: "seq", items}`,
 * `{kind: "scalar", value, style}` and `{kind: "alias"}`. Every node carries the line it starts on
 * and the comment that follows it, because the version beside a pin is the comment on the line the
 * reference ends on and nothing else can tell you which reference it belongs to.
 *
 * Entries are a list rather than an object: two `uses` keys in one mapping is something GitHub
 * resolves one way and a reader that kept only the survivor would report one of them.
 */
export function parseYaml(text) {
  // A byte-order mark is not content, and a document can open with `%YAML` / `%TAG` directives
  // before its `---`. GitHub reads both; a reader that refused them failed on a valid workflow,
  // which is the one outcome a check that exists to be routed around must not have.
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") starts.push(index + 1);

  let at = 0;
  // What `&name` attached itself to, so that `*name` is the node it names. A reader that answered
  // "nothing" for an alias read a job without the permissions it has and a step without the action
  // it runs, and answering wrongly is worse than refusing.
  const anchors = new Map();

  const lineNumber = (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const fail = (what) => {
    throw new Error(`${what}, at line ${lineNumber(at)}`);
  };
  const endOfLine = () => {
    const next = source.indexOf("\n", at);
    return next < 0 ? source.length : next;
  };
  const rest = () => source.slice(at, endOfLine());
  const toNextLine = () => {
    at = Math.min(endOfLine() + 1, source.length);
  };
  const toLineStart = () => {
    at = starts[lineNumber(at) - 1];
  };
  const done = () => at >= source.length;

  // A blank line and a comment line carry no structure. A tab does not indent in YAML, so a file
  // that uses one is not the file its author is looking at, and guessing which one they meant is
  // the class of guess this reader exists to stop making.
  const skipBlank = () => {
    while (!done()) {
      toLineStart();
      const line = rest();
      if (line.trim() === "" || /^ *#/.test(line)) {
        toNextLine();
        continue;
      }
      return;
    }
  };
  const indentHere = () => {
    const lead = /^[ \t]*/.exec(rest())[0];
    if (lead.includes("\t")) fail("a tab where YAML requires spaces");
    return lead.length;
  };
  const toColumn = (column) => {
    at = starts[lineNumber(at) - 1] + column;
  };

  /** What follows a value on its line: a comment, or nothing this reader will accept. */
  const trailing = () => {
    const text = rest().trim();
    at = endOfLine();
    if (text === "") return null;
    if (!text.startsWith("#")) fail(`"${text.slice(0, 24)}" where a comment or the end of the line was expected`);
    return text.slice(1).trim() || null;
  };
  const finishLine = (node) => {
    node.comment = trailing();
    toNextLine();
    return node;
  };

  const readDoubleQuoted = () => {
    const line = lineNumber(at);
    at += 1;
    let value = "";
    for (;;) {
      if (done()) fail("an unterminated double-quoted string");
      const character = source[at];
      if (character === '"') {
        at += 1;
        break;
      }
      if (character === "\\") {
        // A backslash at the end of a line joins it to the next one with nothing between.
        if (source[at + 1] === "\n") {
          at += 2;
          while (source[at] === " ") at += 1;
          continue;
        }
        const escape = /^\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/.exec(source.slice(at));
        if (!escape) fail("an unfinished escape");
        value += resolveEscape(escape[1]);
        at += escape[0].length;
        continue;
      }
      if (character === "\n") {
        at += 1;
        while (source[at] === " ") at += 1;
        value += " ";
        continue;
      }
      value += character;
      at += 1;
    }
    return { kind: "scalar", value, style: "double", line, comment: null };
  };

  const readSingleQuoted = () => {
    const line = lineNumber(at);
    at += 1;
    let value = "";
    for (;;) {
      if (done()) fail("an unterminated single-quoted string");
      const character = source[at];
      if (character === "'") {
        if (source[at + 1] === "'") {
          value += "'";
          at += 2;
          continue;
        }
        at += 1;
        break;
      }
      if (character === "\n") {
        at += 1;
        while (source[at] === " ") at += 1;
        value += " ";
        continue;
      }
      value += character;
      at += 1;
    }
    return { kind: "scalar", value, style: "single", line, comment: null };
  };

  // `|` and `>`, with their chomping and indentation indicators. The indentation that ends the
  // block is measured from the key, not from the line: `- if: |` on a dashed line has its siblings
  // two columns further in than the dash, and measuring from the dash swallowed them.
  const readBlockScalar = (keyIndent) => {
    const line = lineNumber(at);
    const folded = source[at] === ">";
    at += 1;
    let chomp = "clip";
    let explicit = null;
    for (;;) {
      const character = source[at];
      if (character === "+") {
        chomp = "keep";
        at += 1;
        continue;
      }
      if (character === "-") {
        chomp = "strip";
        at += 1;
        continue;
      }
      if (character >= "1" && character <= "9") {
        explicit = Number(character);
        at += 1;
        continue;
      }
      break;
    }
    const comment = trailing();
    toNextLine();

    let indent = explicit === null ? null : keyIndent + explicit;
    const rows = [];
    while (!done()) {
      toLineStart();
      const line2 = rest();
      const blank = line2.trim() === "";
      if (!blank) {
        const here = indentHere();
        if (indent === null) {
          if (here <= keyIndent) break;
          indent = here;
        }
        if (here < indent) break;
      }
      rows.push(blank ? "" : line2.slice(indent ?? 0));
      toNextLine();
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();

    let value = "";
    if (!folded) value = rows.join("\n");
    else {
      for (const row of rows) {
        if (row === "") {
          value += "\n";
          continue;
        }
        if (value !== "" && !value.endsWith("\n")) value += " ";
        value += row;
      }
    }
    if (chomp !== "strip" && rows.length > 0) value += "\n";
    return { kind: "scalar", value, style: folded ? "folded" : "literal", block: true, line, comment };
  };

  const readAlias = () => {
    const line = lineNumber(at);
    at += 1;
    const from = at;
    while (at < source.length && !/[\s,{}[\]]/.test(source[at])) at += 1;
    const target = anchors.get(source.slice(from, at));
    // An anchor this reader has already seen is the node it named. One it has not seen is a value
    // it cannot resolve, and an unresolved value fails rather than passes.
    return target ? { ...target, line, comment: null } : { kind: "alias", line, comment: null };
  };

  // `<<: *defaults` is a mapping's inherited keys, and dropping them hides whatever they carry --
  // a job's permissions, or a step's action reference.
  const withMerges = (node) => {
    if (!node.entries.some((entry) => entry.key === "<<")) return node;
    const entries = [];
    for (const entry of node.entries) {
      if (entry.key !== "<<") {
        entries.push(entry);
        continue;
      }
      for (const inherited of entry.value.kind === "seq" ? entry.value.items : [entry.value]) {
        if (!inherited || inherited.kind !== "map") fail("a merge key whose value is not a mapping");
        for (const one of inherited.entries) entries.push({ ...one });
      }
    }
    node.entries = entries;
    return node;
  };

  const readPlainScalar = (parentIndent, flow) => {
    const line = lineNumber(at);
    const take = () => {
      const text = rest();
      let end = text.length;
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        // A `#` opens a comment only after a space, so `owner/repo@sha#fragment` is one scalar.
        if (character === "#" && (index === 0 || /\s/.test(text[index - 1]))) {
          end = index;
          break;
        }
        if (!flow) continue;
        if (character === "," || character === "}" || character === "]") {
          end = index;
          break;
        }
        // A colon ends a plain scalar in a flow collection only when a separator follows it, which
        // is what lets `docker://image:3` be one value inside braces.
        if (character === ":" && /[\s,}\]]/.test(text[index + 1] ?? " ")) {
          end = index;
          break;
        }
      }
      at += end;
      return text.slice(0, end).trimEnd();
    };

    let value = take();
    if (!flow) {
      // A plain scalar continues onto more-indented lines that are not themselves keys or list
      // items, which is how a long `if:` is written without a block scalar.
      for (;;) {
        if (rest().trim() !== "") break;
        const mark = at;
        toNextLine();
        if (done()) {
          at = mark;
          break;
        }
        toLineStart();
        const following = rest();
        if (following.trim() === "" || /^ *#/.test(following)) {
          at = mark;
          break;
        }
        if (indentHere() <= parentIndent) {
          at = mark;
          break;
        }
        const body = following.trim();
        if (/^-(\s|$)/.test(body) || KEY_TEXT.test(body)) {
          at = mark;
          break;
        }
        value += ` ${body}`;
        toColumn(following.length);
      }
    }
    return { kind: "scalar", value, style: "plain", line, comment: null, flow: Boolean(flow) };
  };

  const scalarKey = (node) => {
    if (node.kind !== "scalar" || node.value === null) fail("a flow key that is not a scalar");
    return node.value;
  };

  const skipFlowSpace = () => {
    for (;;) {
      const character = source[at];
      if (character === " " || character === "\n" || character === "\t") {
        at += 1;
        continue;
      }
      if (character === "#") {
        at = endOfLine();
        continue;
      }
      return;
    }
  };

  const readFlowNode = () => {
    const character = source[at];
    if (character === "{" || character === "[") return readFlow();
    if (character === '"') {
      const node = readDoubleQuoted();
      node.flow = true;
      return node;
    }
    if (character === "'") {
      const node = readSingleQuoted();
      node.flow = true;
      return node;
    }
    if (character === "*") {
      const node = readAlias();
      node.flow = true;
      return node;
    }
    if (character === "&") {
      at += 1;
      const from = at;
      while (at < source.length && !/[\s,{}[\]]/.test(source[at])) at += 1;
      const name = source.slice(from, at);
      skipFlowSpace();
      const node = readFlowNode();
      anchors.set(name, node);
      return node;
    }
    if (character === "!") fail("a tag, which this reader does not resolve");
    return readPlainScalar(null, true);
  };

  const readFlow = () => {
    const line = lineNumber(at);
    const mapping = source[at] === "{";
    const closer = mapping ? "}" : "]";
    at += 1;
    const entries = [];
    const items = [];
    for (;;) {
      skipFlowSpace();
      if (done()) fail("an unterminated flow collection");
      if (source[at] === closer) {
        at += 1;
        break;
      }
      if (source[at] === ",") {
        at += 1;
        continue;
      }
      const before = at;
      const first = readFlowNode();
      skipFlowSpace();
      const empty = { kind: "scalar", value: null, style: "plain", line: first.line, comment: null, flow: true };
      if (source[at] === ":" && /[\s,}\]]/.test(source[at + 1] ?? " ")) {
        at += 1;
        skipFlowSpace();
        const value = source[at] === "," || source[at] === closer ? empty : readFlowNode();
        const pair = { key: scalarKey(first), value, line: first.line };
        // A `key: value` inside a flow *sequence* is a mapping of one pair, which is how
        // `- [uses: attacker/evil@main]` names an action.
        if (mapping) entries.push(pair);
        else items.push({ kind: "map", entries: [pair], flow: true, line: first.line, comment: null });
      } else if (mapping) entries.push({ key: scalarKey(first), value: empty, line: first.line });
      else items.push(first);
      if (at === before) fail("a flow collection this reader cannot advance through");
    }
    return mapping
      ? withMerges({ kind: "map", entries, flow: true, line, comment: null })
      : { kind: "seq", items, flow: true, line, comment: null };
  };

  const readInlineNode = (parentIndent) => {
    const character = source[at];
    if (character === "|" || character === ">") return readBlockScalar(parentIndent);
    if (character === "&") {
      at += 1;
      const from = at;
      while (at < source.length && !/\s/.test(source[at])) at += 1;
      const name = source.slice(from, at);
      while (source[at] === " ") at += 1;
      if (rest().trim() === "" || rest().trimStart().startsWith("#")) {
        const line = lineNumber(at);
        const comment = trailing();
        toNextLine();
        const child = parseBlockNode(parentIndent + 1);
        if (child) {
          anchors.set(name, child);
          return child;
        }
        return { kind: "scalar", value: null, style: "plain", line, comment };
      }
      const node = readInlineNode(parentIndent);
      anchors.set(name, node);
      return node;
    }
    if (character === "*") return finishLine(readAlias());
    if (character === "!") fail("a tag, which this reader does not resolve");
    if (character === "{" || character === "[") return finishLine(readFlow());
    if (character === '"') return finishLine(readDoubleQuoted());
    if (character === "'") return finishLine(readSingleQuoted());
    return finishLine(readPlainScalar(parentIndent, false));
  };

  const readValue = (keyIndent) => {
    while (source[at] === " ") at += 1;
    const remainder = rest();
    if (remainder.trim() === "" || remainder.trimStart().startsWith("#")) {
      const line = lineNumber(at);
      const comment = trailing();
      toNextLine();
      // A block sequence may sit at the key's own indentation -- `on:` over `- push`, `steps:` over
      // `- uses:` -- and that is the commonest way a workflow is written. The dash is what makes it
      // the value rather than a sibling key: a sibling would be a key, and a key cannot start with
      // `- `.
      skipBlank();
      if (!done() && indentHere() === keyIndent) {
        toColumn(keyIndent);
        if (/^-(\s|$)/.test(rest())) return readBlockSequence(keyIndent);
      }
      const child = parseBlockNode(keyIndent + 1);
      return child ?? { kind: "scalar", value: null, style: "plain", line, comment };
    }
    return readInlineNode(keyIndent);
  };

  const explicitHere = () => source[at] === "?" && /\s/.test(source[at + 1] ?? "\n");

  // `? key` / `: value`, where the key is a node of its own and may therefore be written as a
  // folded scalar spread over lines. Nothing that reads one line at a time can see this at all.
  const readExplicitEntry = (indent) => {
    const line = lineNumber(at);
    at += 1;
    while (source[at] === " ") at += 1;
    let keyNode;
    if (rest().trim() === "" || rest().trimStart().startsWith("#")) {
      trailing();
      toNextLine();
      keyNode = parseBlockNode(indent + 1);
    } else keyNode = readInlineNode(indent);
    if (!keyNode || keyNode.kind !== "scalar" || keyNode.value === null) fail("an explicit key that is not a scalar");
    skipBlank();
    if (done() || indentHere() !== indent) fail("an explicit key with no value");
    toColumn(indent);
    if (source[at] !== ":" || !/\s/.test(source[at + 1] ?? "\n")) fail("an explicit key with no value");
    at += 1;
    return { key: keyNode.value.trim(), value: readValue(indent), line };
  };

  const readBlockMapping = (indent) => {
    const line = lineNumber(at);
    const entries = [];
    for (;;) {
      const before = at;
      if (explicitHere()) entries.push(readExplicitEntry(indent));
      else {
        const keyLine = lineNumber(at);
        const key = readKey();
        if (key === null) fail("a line that is neither a mapping key nor a list item");
        entries.push({ key, value: readValue(indent), line: keyLine });
      }
      if (at === before) fail("a mapping this reader cannot advance through");
      skipBlank();
      if (done() || indentHere() !== indent) break;
      toColumn(indent);
      if (/^-(\s|$)/.test(rest())) break;
      if (!explicitHere() && !KEY_TEXT.test(rest())) break;
    }
    return withMerges({ kind: "map", entries, line, comment: null });
  };

  const readKey = () => {
    const character = source[at];
    if (character === '"' || character === "'") {
      const key = character === '"' ? readDoubleQuoted().value : readSingleQuoted().value;
      while (source[at] === " ") at += 1;
      if (source[at] !== ":") return null;
      at += 1;
      return key;
    }
    const match = KEY_TEXT.exec(rest());
    if (!match) return null;
    const colon = match[0].lastIndexOf(":");
    const key = match[0].slice(0, colon).trim();
    at += colon + 1;
    return key;
  };

  const readItemOrValue = (indent) => {
    if (/^-(\s|$)/.test(rest())) return readBlockSequence(indent);
    if (explicitHere() || KEY_TEXT.test(rest())) return readBlockMapping(indent);
    return readInlineNode(indent);
  };

  const readBlockSequence = (indent) => {
    const line = lineNumber(at);
    const items = [];
    for (;;) {
      at += 1;
      const remainder = rest();
      if (remainder.trim() === "" || remainder.trimStart().startsWith("#")) {
        const itemLine = lineNumber(at);
        trailing();
        toNextLine();
        items.push(parseBlockNode(indent + 1) ?? { kind: "scalar", value: null, style: "plain", line: itemLine, comment: null });
      } else {
        while (source[at] === " ") at += 1;
        items.push(readItemOrValue(at - starts[lineNumber(at) - 1]));
      }
      skipBlank();
      if (done() || indentHere() !== indent) break;
      toColumn(indent);
      if (!/^-(\s|$)/.test(rest())) break;
    }
    return { kind: "seq", items, line, comment: null };
  };

  function parseBlockNode(minimum) {
    skipBlank();
    if (done()) return null;
    const indent = indentHere();
    if (indent < minimum) return null;
    toColumn(indent);
    if (/^-(\s|$)/.test(rest())) return readBlockSequence(indent);
    return readItemOrValue(indent);
  }

  skipBlank();
  while (!done() && rest().startsWith("%")) toNextLine();
  skipBlank();
  if (rest().trim() === "---") toNextLine();
  const root = parseBlockNode(0);
  skipBlank();
  if (!done() && rest().trim() === "...") toNextLine();
  skipBlank();
  if (!done()) fail("a second document, or text this reader does not understand");
  return root ?? { kind: "map", entries: [], line: 1, comment: null };
}

const plainValue = (node) => {
  if (!node) return null;
  if (node.kind === "alias") return null;
  if (node.kind === "map") {
    // Defined rather than assigned: a key is whatever the workflow author wrote, and `__proto__`
    // assigned into a plain object sets the object's prototype instead of adding an entry to it.
    const map = {};
    for (const entry of node.entries) {
      Object.defineProperty(map, entry.key, { value: plainValue(entry.value), enumerable: true, writable: true, configurable: true });
    }
    return map;
  }
  if (node.kind === "seq") return node.items.map(plainValue);
  if (node.value === null) return null;
  if (node.style === "plain") {
    if (node.value === "true") return true;
    if (node.value === "false") return false;
    if (node.value === "null" || node.value === "~") return null;
    if (/^-?\d+$/.test(node.value)) return Number(node.value);
  }
  return node.value;
};

/**
 * A workflow as ordinary JavaScript values, for the permission audit.
 *
 * Keys are the keys YAML resolves, which is the whole point: a job-level `"permissions"` in quotes
 * is the same key as `permissions`, and a reader that kept the quotes observed no job permissions
 * at all and matched a baseline that said there were none.
 */
export function parseYamlSubset(text) {
  return plainValue(parseYaml(text));
}

/** How many action references a subtree holds, so a comment can be attached only when it is clear. */
const usesCount = (node, chain) => {
  if (!node) return 0;
  if (node.kind === "map") {
    let total = 0;
    for (const entry of node.entries) {
      if (entry.key === "uses" && !chain.includes("with") && !chain.includes("env")) total += 1;
      total += usesCount(entry.value, [...chain, entry.key]);
    }
    return total;
  }
  if (node.kind === "seq") return node.items.reduce((sum, item) => sum + usesCount(item, chain), 0);
  return 0;
};

const describeUses = (value, line, inherited) => {
  const comment = value?.comment ?? inherited ?? null;
  if (!value || value.kind === "alias") return { line, raw: null, comment, form: value ? "anchor" : "empty" };
  if (value.kind === "map" || value.kind === "seq") return { line, raw: null, comment, form: "unrecognised" };
  if (value.value === null) return { line, raw: null, comment, form: "empty" };
  // An expression names an action chosen at run time, which no offline check can resolve.
  if (value.value.includes("${{")) return { line, raw: null, comment, form: "expression" };
  const form = value.flow ? "flow" : value.line === line ? "block" : "continued";
  return { line, raw: value.value.trim(), comment, form };
};

const collectUses = (node, chain, found, inherited) => {
  if (!node) return;
  if (node.kind === "map" || node.kind === "seq") {
    // The version comment on `- { uses: <sha> } # v5.1.0` sits outside the braces and belongs to
    // the collection, not to the value inside it. Only when the collection holds one reference,
    // because with two there is no saying whose comment it is.
    const carried = node.flow && node.comment && usesCount(node, chain) === 1 ? node.comment : inherited;
    if (node.kind === "seq") {
      for (const item of node.items) collectUses(item, chain, found, carried);
      return;
    }
    for (const entry of node.entries) {
      // A `uses` under a step's `with:` or `env:` is an input that happens to be called that.
      if (entry.key === "uses" && !chain.includes("with") && !chain.includes("env")) {
        found.push(describeUses(entry.value, entry.line, carried));
      }
      collectUses(entry.value, [...chain, entry.key], found, carried);
    }
  }
};

/**
 * Every action reference in a file, with the version comment kept beside it.
 *
 * A file this reader refuses comes back as one unresolvable reference rather than as nothing:
 * refusing to read must fail the check, because "I did not understand this file" and "this file is
 * clean" are the two answers that must never look the same.
 */
export function usesInText(text) {
  let document;
  try {
    document = parseYaml(text);
  } catch (error) {
    return [{ line: Number(/at line (\d+)/.exec(error.message)?.[1] ?? 1), raw: null, comment: null, form: "unreadable" }];
  }
  const found = [];
  collectUses(document, [], found, null);
  return found;
}

const classify = (raw) => {
  if (raw === null) return { kind: "unparsable" };
  if (raw.startsWith("./") || raw.startsWith("../")) return { kind: "local", path: raw };
  // GitHub's other spelling for an action in this same repository: `$/path/to/action` is resolved
  // against the repository root rather than the workflow. Refusing it as unparsable was fail-closed
  // but wrong -- it is a documented, valid reference, and a check that fails on valid syntax is one
  // people route around. It is a redirection like `./path` is, and is held to the same rule.
  if (raw.startsWith("$/")) return { kind: "local", path: `.${raw.slice(1)}` };
  // A container action is external code too, and `:latest` is a tag like any other. The first
  // version skipped these entirely, so `docker://ghcr.io/anyone/anything:latest` ran on a runner
  // holding this repository's credentials without a digest, an owner or a comment.
  if (raw.startsWith("docker://")) {
    const image = raw.slice("docker://".length);
    const at = image.lastIndexOf("@");
    return at < 0
      ? { kind: "image", name: image, digest: null }
      : { kind: "image", name: image.slice(0, at), digest: image.slice(at + 1) };
  }
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[A-Za-z0-9_.-]+)*)@(.+)$/.exec(raw);
  if (!match) return { kind: "unparsable" };
  return { kind: "external", owner: match[1], repository: `${match[1]}/${match[2]}`, path: match[3] || "", ref: match[4] };
};

/** The local action a `uses: ./path` reference actually runs, or null if there is no such file. */
const localActionFile = (root, reference) => {
  const target = resolve(root, reference.replace(/^\.\//, ""));
  if (/\.ya?ml$/.test(target)) return existsSync(target) ? target : null;
  for (const name of ["action.yml", "action.yaml"]) {
    if (existsSync(join(target, name))) return join(target, name);
  }
  return null;
};

/**
 * Scans the tree and reports every way an action reference falls short of the policy.
 *
 * Returns a report rather than throwing: the useful output is all of it at once, and a scan that
 * stops at the first mutable tag makes a workflow with five look like a workflow with one.
 */
export function scanActionPins(root, policy) {
  const files = discoverWorkflowFiles(root);
  const mutable = [];
  const unreviewed = [];
  const uncommented = [];
  const unparsable = [];
  const localMissing = [];
  const pinned = [];
  const hashes = [];
  let external = 0;

  const reviewed = new Set(policy.reviewed_actions ?? []);
  const versionComment = new RegExp(policy.version_comment_pattern ?? DEFAULT_VERSION_COMMENT);
  const scanned = new Set(files.map((one) => resolve(one)));

  for (const file of files) {
    const bytes = readFileSync(file);
    const name = relative(root, file).split(sep).join("/");
    hashes.push(`${name} ${createHash("sha256").update(bytes).digest("hex")}`);

    for (const use of usesInText(bytes.toString("utf8"))) {
      const reference = classify(use.raw);
      const where = { file: name, line: use.line, uses: use.raw ?? `<${use.form}>` };

      if (reference.kind === "unparsable") {
        unparsable.push(where);
        continue;
      }

      if (reference.kind === "local") {
        // A local reference is not a free pass, it is a redirection. `uses: ./dist` runs
        // `dist/action.yml`, and a composite action there can name any external action at any
        // mutable tag -- so the file it points at has to be one this scan actually read.
        const target = localActionFile(root, reference.path);
        if (!target) localMissing.push({ ...where, reason: "no action.yml at that path" });
        else if (!scanned.has(resolve(target))) localMissing.push({ ...where, reason: "the action it runs was not scanned" });
        continue;
      }

      external += 1;

      if (reference.kind === "image") {
        if (!IMAGE_DIGEST.test(reference.digest ?? "")) {
          mutable.push({ ...where, ref: reference.digest ?? "no digest" });
          continue;
        }
        if (!reviewed.has(`docker://${reference.name}`)) {
          unreviewed.push({ ...where, owner: reference.name });
          continue;
        }
        pinned.push({ action: `docker://${reference.name}`, sha: reference.digest, version: use.comment ?? "", file: name, line: use.line });
        continue;
      }

      if (!ACTION_REF.test(reference.ref)) {
        mutable.push({ ...where, ref: reference.ref });
        continue;
      }
      // Action-wide, not owner-wide. `actions` being reviewed said nothing about a repository under
      // that owner which nobody has ever looked at.
      const action = `${reference.repository}${reference.path}`;
      if (!reviewed.has(action)) {
        unreviewed.push({ ...where, owner: action });
        continue;
      }
      // The pin is unreadable without a version, and unverifiable with an arbitrary one: a reviewer
      // looking at forty hex characters cannot tell whether the refresh moved to v5.1.0 or
      // somewhere else, and "definitely v99, trust me" is not a version.
      if (!use.comment || !versionComment.test(use.comment)) {
        uncommented.push({ ...where, comment: use.comment });
        continue;
      }
      pinned.push({ action, sha: reference.ref, version: use.comment, file: name, line: use.line });
    }
  }

  // The digest covers what passing depends on: every scanned file, the policy that decides what
  // passes, this scanner, the verifier that combines its result with the permission audit, and the
  // npm scripts and `.npmrc` that decide what the required check actually runs. Hashing only the workflows left
  // `reviewed_actions` and the permission baseline free to change while the digest stayed
  // identical, and hashing this file too still left `ok: pins.ok && permissions.ok` one edit away
  // from `ok: true` with every hashed byte unchanged.
  const policyBytes = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  const selfBytes = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");
  // This scanner is not the whole check. `scripts/verify-action-pins.mjs` combines the pin scan
  // with the permission audit and decides the exit status, and `package.json` decides which file
  // `npm run verify:action-pins` actually runs -- editing either one turns failure into success
  // while every workflow, the policy and this file stay byte-identical.
  const runnerBytes = createHash("sha256").update(readFileSync(new URL("../scripts/verify-action-pins.mjs", import.meta.url))).digest("hex");
  const scriptBytes = createHash("sha256").update(JSON.stringify(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts ?? {})).digest("hex");
  // And an `.npmrc` decides whether an `npm run` executes anything at all: `script-shell=/usr/bin/true`
  // in a repository-level file makes every npm script exit zero without running node. CI invokes
  // the verifier directly for that reason, and the digest covers the file either way -- including
  // its absence, so that adding one moves the digest.
  const npmrc = new URL("../.npmrc", import.meta.url);
  const npmrcBytes = existsSync(npmrc) ? createHash("sha256").update(readFileSync(npmrc)).digest("hex") : "absent";

  return {
    files_scanned: files.length,
    external_uses: external,
    mutable_refs: mutable,
    unreviewed_owners: unreviewed,
    uncommented,
    unparsable,
    local_action_unresolved: localMissing,
    unreadable_directories: files.unreadable ?? [],
    pinned_actions: pinned.sort((a, b) => `${a.file}${a.line}`.localeCompare(`${b.file}${b.line}`)),
    workflow_digest: `sha256:${createHash("sha256").update(hashes.sort().join("\n")).digest("hex")}`,
    supply_chain_digest: `sha256:${createHash("sha256").update([...hashes.sort(), `policy ${policyBytes}`, `scanner ${selfBytes}`, `runner ${runnerBytes}`, `scripts ${scriptBytes}`, `npmrc ${npmrcBytes}`].join("\n")).digest("hex")}`,
    ok:
      mutable.length === 0 &&
      unreviewed.length === 0 &&
      uncommented.length === 0 &&
      unparsable.length === 0 &&
      localMissing.length === 0 &&
      (files.unreadable ?? []).length === 0
  };
}

/**
 * Every workflow's permissions against the recorded baseline.
 *
 * A baseline rather than a rule, because "least privilege" is not a property a scanner can decide:
 * whether a job needs `contents: write` depends on what the job is for. What a scanner *can* decide
 * is whether the permissions changed, and a change that nobody wrote down is the review failure --
 * a pin refresh that quietly arrives with `contents: write` is the shape this is watching for.
 */
export function auditPermissions(root, policy) {
  const failures = [];
  const fail = (check, file, detail) => failures.push({ check, file, detail });
  const observed = {};

  for (const file of discoverWorkflowFiles(root)) {
    const name = relative(root, file).split(sep).join("/");
    if (/action\.ya?ml$/.test(name)) continue;

    let document;
    try {
      document = parseYamlSubset(readFileSync(file, "utf8"));
    } catch (error) {
      fail("workflow-unreadable", name, error.message);
      continue;
    }

    const jobs = Object.fromEntries(
      Object.entries(document.jobs ?? {})
        .filter(([, job]) => job && typeof job === "object" && job.permissions)
        .map(([id, job]) => [id, job.permissions])
    );
    observed[name] = { workflow: document.permissions ?? null, jobs };

    if (!document.permissions) {
      fail("permissions-undeclared", name, "the workflow declares no top-level permissions, so it inherits the repository default");
    }

    const baseline = policy.workflow_permissions?.[name];
    if (!baseline) {
      fail("permissions-unrecorded", name, "no recorded baseline, so a change to this workflow's permissions would be invisible");
      continue;
    }
    const before = JSON.stringify(baseline);
    const after = JSON.stringify(observed[name]);
    if (before !== after) fail("permission-drift", name, `recorded ${before}, found ${after}`);
  }

  for (const name of Object.keys(policy.workflow_permissions ?? {})) {
    if (!observed[name]) fail("permissions-baseline-orphan", name, "the baseline names a workflow that no longer exists");
  }

  return { ok: failures.length === 0, failures, observed };
}
