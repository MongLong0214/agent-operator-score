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
// remembering to add it -- and a `uses:` line the scanner cannot parse is a failure rather than a
// skip, because a scanner that shrugs at what it does not understand reports green on the one line
// that was written to be misunderstood.

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

/** The escapes a YAML double-quoted scalar allows. */
const ESCAPES = {
  "0": "\0", a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b",
  " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029"
};

// YAML resolves a double-quoted key's escapes before it is a key, so a scanner matching the
// characters on the line is matching something YAML has already stopped calling that key.
const unescapeDouble = (body) =>
  body.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/g, (whole, code) => {
    if (code.length > 1) return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
    return ESCAPES[code] ?? code;
  });

/** A key as YAML reads it: quotes removed, escapes resolved. */
const keyName = (token) => {
  if (/^"[\s\S]*"$/.test(token)) return unescapeDouble(token.slice(1, -1));
  if (/^'[\s\S]*'$/.test(token)) return token.slice(1, -1).replace(/''/g, "'");
  return token.trim();
};

// A block-mapping key, quoted or not, with the sequence dash in front of it if there is one. The
// captured prefix is the key's column, which is how the scan knows whose child the key is; braces
// and brackets are excluded from a plain key so that a flow mapping is not read as one.
const KEY_LINE = /^(\s*(?:-\s+)?)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#"'{}[\],][^:{}[\]#]*?)\s*:(\s.*|)$/;

/** Every `uses` value inside one flow mapping, by the key YAML reads rather than the one written. */
const flowUses = (text) => {
  const values = [];
  for (const match of text.matchAll(/(?:^|[{,\s])("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:,{}]+)\s*:\s*([^,}]*)/g)) {
    if (keyName(match[1]) === "uses") values.push(match[2]);
  }
  return values;
};

/**
 * The `uses:` references in a file, with the trailing comment kept separately.
 *
 * Line-based on purpose: this has to see a reference in a file the structured reader below would
 * refuse, because refusing to parse must not mean refusing to look.
 *
 * The first version matched one spelling — `uses:` at the start of a line, value on the same line —
 * and every other spelling YAML allows was invisible to it. All of these are real `uses` keys that
 * GitHub honours and the scanner did not see:
 *
 *     - "uses": attacker/evil@main          a quoted key
 *     - "\u0075ses": attacker/evil@main     the same key, written with an escape
 *     - uses:                               the value on the following line
 *         attacker/evil@main
 *     - { uses: attacker/evil@main }        a flow mapping
 *     - &pwn { uses: attacker/evil@main }   the same, behind an anchor
 *
 * So the scan handles those, and anything it still cannot resolve is returned with `raw` set to
 * null so the caller fails on it. Block scalars are skipped wholesale, because `run: |` followed by
 * a line reading `uses: something` is text a shell prints, not an action anyone runs, and reporting
 * it was a false positive that would teach people to ignore this check.
 *
 * Three things this reads that matching the characters on the line cannot. It resolves a quoted
 * key's escapes before deciding what the key is, because YAML does, and both directions of that
 * bypass matter: `"run": |` is a block scalar whose contents must stay inert, and
 * `"uses": attacker/evil@main` is a live reference. It strips carriage returns, because a
 * workflow written on Windows leaves one on every value and an ordinary pinned reference came back
 * unreadable. And it tracks which key a `uses` sits under, because `with:` and `env:` can hold an
 * input of that name and reporting those as mutable references was a false positive on valid YAML.
 */
export function usesInText(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  let blockIndent = null;
  const parents = [];

  const indentOf = (line) => line.length - line.trimStart().length;
  const split = (value) => {
    let comment = null;
    let rest = value;
    const hash = rest.indexOf("#");
    if (hash >= 0) {
      comment = rest.slice(hash + 1).trim() || null;
      rest = rest.slice(0, hash);
    }
    return { value: rest.trim().replace(/^["']|["']$/g, ""), comment };
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indent = indentOf(line);

    // Inside a literal or folded block: everything more indented than the key is content.
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    if (/^\s*#/.test(line)) continue;

    const keyMatch = KEY_LINE.exec(line);
    const key = keyMatch ? keyName(keyMatch[2]) : null;
    const column = keyMatch ? keyMatch[1].length : indent;
    const inline = keyMatch ? keyMatch[3] : "";

    // Whose child this key is, by column. A `uses` under a step is an action reference; a `uses`
    // under that step's `with:` or `env:` is an input that happens to be called that.
    if (keyMatch) while (parents.length > 0 && parents[parents.length - 1].column >= column) parents.pop();
    const scope = parents.map((one) => one.key);
    if (keyMatch) scope.push(key);
    const isInput = scope.includes("with") || scope.includes("env");
    if (keyMatch) parents.push({ column, key });

    if (keyMatch && /^\s*[|>][-+0-9]*\s*(#.*)?$/.test(inline)) {
      blockIndent = indent;
      // A block scalar is a string, so `uses: |` names no action GitHub runs. It is still a
      // spelling this scanner cannot resolve, and an unresolved spelling fails rather than passes.
      if (key === "uses" && !isInput) found.push({ line: index + 1, raw: null, comment: null, form: "block-scalar" });
      continue;
    }

    if (key === "uses") {
      if (isInput) continue;
      if (inline.trim() !== "") {
        const { value, comment } = split(inline);
        // An alias or an anchored value is a reference this scanner cannot resolve on its own.
        if (/^[*&]/.test(value)) found.push({ line: index + 1, raw: null, comment, form: "anchor" });
        else if (value.includes("${{")) found.push({ line: index + 1, raw: null, comment, form: "expression" });
        else found.push({ line: index + 1, raw: value, comment, form: "block" });
        continue;
      }
      // The value is on a following line.
      const next = lines.slice(index + 1).find((one) => one.trim() !== "");
      if (next && indentOf(next) > indent && !/^\s*-/.test(next)) {
        const { value, comment } = split(next);
        found.push({ line: index + 1, raw: /^[*&]/.test(value) ? null : value, comment, form: "continued" });
      } else {
        found.push({ line: index + 1, raw: null, comment: null, form: "empty" });
      }
      continue;
    }

    // A flow mapping, with or without an anchor in front of it. Checked after the ordinary key
    // form, and with `${{ ... }}` masked out first: a GitHub expression is braced too, and treating
    // `uses: ${{ matrix.action }}` as a flow mapping made the scanner skip the line entirely --
    // exactly the reference it most needs to refuse. The mask keeps the original length, so the
    // text on either side of the braces can still be read off the real line.
    const masked = line.replace(/\$\{\{[^}]*\}\}/g, (expression) => "E".repeat(expression.length));
    const flows = [...masked.matchAll(/\{[^}]*\}/g)];
    if (flows.length > 0) {
      const entries = [];
      for (const flow of flows) {
        const end = flow.index + flow[0].length;
        for (const value of flowUses(line.slice(flow.index, end))) entries.push({ value, end });
      }
      if (!isInput) {
        for (const entry of entries) {
          const { value, comment } = split(entry.value);
          // The version comment sits outside the braces, so the flow match cannot contain it:
          // `- { uses: <sha> } # v5.1.0` arrived with no version at all and failed as an
          // uncommented pin. Only when the line holds one reference, because with two there is no
          // saying whose comment it is.
          const after = entries.length === 1 ? line.slice(entry.end) : "";
          const hash = after.indexOf("#");
          const trailing = hash >= 0 ? after.slice(hash + 1).trim() || null : null;
          if (value.includes("${{")) found.push({ line: index + 1, raw: null, comment: comment ?? trailing, form: "expression" });
          else found.push({ line: index + 1, raw: value || null, comment: comment ?? trailing, form: "flow" });
        }
      }
      continue;
    }

    // The safety net. Anything else on this line that looks like a `uses` key is a spelling this
    // scanner does not know, and an unknown spelling has to fail rather than pass. A `uses:` that
    // is part of *another* key's scalar value -- `run: echo "uses: x"` -- is not one of those.
    if (/(?:^|[\s,{["'])uses\s*:/.test(line) && !keyMatch) {
      found.push({ line: index + 1, raw: null, comment: null, form: "unrecognised" });
    }
  }
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
  // npm scripts that decide what the required check actually runs. Hashing only the workflows left
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
    supply_chain_digest: `sha256:${createHash("sha256").update([...hashes.sort(), `policy ${policyBytes}`, `scanner ${selfBytes}`, `runner ${runnerBytes}`, `scripts ${scriptBytes}`].join("\n")).digest("hex")}`,
    ok:
      mutable.length === 0 &&
      unreviewed.length === 0 &&
      uncommented.length === 0 &&
      unparsable.length === 0 &&
      localMissing.length === 0 &&
      (files.unreadable ?? []).length === 0
  };
}

// --- a very small YAML reader -----------------------------------------------------------------

/**
 * Enough YAML to read a workflow's permissions, and no more.
 *
 * Block mappings, block sequences, flow sequences of scalars, and scalars. Not anchors, not
 * multi-line strings, not flow mappings. This exists because the permission audit needs structure
 * and the product ships with no dependencies; it is deliberately small, and every construct it does
 * not handle is one that does not appear in a workflow file in this repository.
 */
export function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim() });
  }

  const scalar = (value) => {
    if (value === "") return null;
    const stripped = value.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    if (/^\[.*\]$/.test(stripped)) {
      const inner = stripped.slice(1, -1).trim();
      return inner === "" ? [] : inner.split(",").map((one) => scalar(one.trim()));
    }
    if (stripped === "true") return true;
    if (stripped === "false") return false;
    if (/^-?\d+$/.test(stripped)) return Number(stripped);
    return stripped;
  };

  let cursor = 0;
  const block = (indent) => {
    // A block is a sequence if its first entry starts with "- ", otherwise a mapping.
    if (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith("- ")) {
      const items = [];
      while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith("- ")) {
        const entry = lines[cursor].text.slice(2).trim();
        const key = /^([^:\s][^:]*):\s*(.*)$/.exec(entry);
        if (key) {
          // A sequence item that is itself a mapping: re-read it as one at a deeper indent.
          const item = {};
          item[key[1].trim()] = key[2] === "" ? null : scalar(key[2]);
          cursor += 1;
          while (cursor < lines.length && lines[cursor].indent > indent && !lines[cursor].text.startsWith("- ")) {
            const pair = /^([^:\s][^:]*):\s*(.*)$/.exec(lines[cursor].text);
            if (!pair) break;
            item[pair[1].trim()] = pair[2] === "" ? null : scalar(pair[2]);
            cursor += 1;
          }
          items.push(item);
          continue;
        }
        items.push(scalar(entry));
        cursor += 1;
      }
      return items;
    }

    const map = {};
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const pair = /^([^:\s][^:]*):\s*(.*)$/.exec(lines[cursor].text);
      if (!pair) break;
      const key = pair[1].trim();
      const inline = pair[2];
      cursor += 1;
      if (inline !== "") {
        map[key] = scalar(inline);
        continue;
      }
      map[key] = cursor < lines.length && lines[cursor].indent > indent ? block(lines[cursor].indent) : null;
    }
    return map;
  };

  return lines.length === 0 ? {} : block(lines[0].indent);
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
