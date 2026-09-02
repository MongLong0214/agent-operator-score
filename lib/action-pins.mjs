import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "coverage"]);

/**
 * Every workflow and action definition in the tree, found by where it sits and what it is called.
 *
 * `.github/workflows/**​/*.yml|yaml` and any `action.yml|yaml` anywhere. Naming the files instead
 * would mean a workflow added for the release, or for an admin task, is outside the check by
 * default -- and those are the two that carry the most permission.
 */
export function discoverWorkflowFiles(root) {
  const found = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
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
  return found.sort();
}

/**
 * The `uses:` references in a file, with the trailing comment kept separately.
 *
 * Line-based on purpose: this has to see a reference in a file the YAML reader below would refuse,
 * because refusing to parse must not mean refusing to look. Commented-out lines are skipped; a
 * value it cannot split into a reference is returned with `raw` set so the caller can fail on it.
 */
export function usesInText(text) {
  const found = [];
  for (const [index, line] of text.split("\n").entries()) {
    const match = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    if (/^\s*#/.test(line)) continue;
    let value = match[1];
    let comment = null;
    const hash = value.indexOf("#");
    if (hash >= 0) {
      comment = value.slice(hash + 1).trim() || null;
      value = value.slice(0, hash).trim();
    }
    value = value.replace(/^["']|["']$/g, "");
    found.push({ line: index + 1, raw: value, comment });
  }
  return found;
}

const classify = (raw) => {
  if (raw.startsWith("./") || raw.startsWith("../")) return { kind: "local" };
  if (raw.startsWith("docker://")) return { kind: "docker" };
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[A-Za-z0-9_.-]+)*)@(.+)$/.exec(raw);
  if (!match) return { kind: "unparsable" };
  return { kind: "external", owner: match[1], repository: `${match[1]}/${match[2]}`, path: match[3] || "", ref: match[4] };
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
  const pinned = [];
  const hashes = [];
  let external = 0;

  for (const file of files) {
    const bytes = readFileSync(file);
    const name = relative(root, file).split(sep).join("/");
    hashes.push(`${name} ${createHash("sha256").update(bytes).digest("hex")}`);

    for (const use of usesInText(bytes.toString("utf8"))) {
      const reference = classify(use.raw);
      const where = { file: name, line: use.line, uses: use.raw };

      if (reference.kind === "local" || reference.kind === "docker") continue;
      if (reference.kind === "unparsable") {
        unparsable.push(where);
        continue;
      }

      external += 1;
      if (!ACTION_REF.test(reference.ref)) {
        mutable.push({ ...where, ref: reference.ref });
        continue;
      }
      if (!policy.reviewed_owners.includes(reference.owner)) {
        unreviewed.push({ ...where, owner: reference.owner });
        continue;
      }
      // The pin is unreadable without it. A reviewer looking at forty hex characters cannot tell
      // whether the refresh moved from v5.0.0 to v5.1.0 or to something else entirely.
      if (!use.comment) {
        uncommented.push(where);
        continue;
      }
      pinned.push({ action: `${reference.repository}${reference.path}`, sha: reference.ref, version: use.comment, file: name, line: use.line });
    }
  }

  return {
    files_scanned: files.length,
    external_uses: external,
    mutable_refs: mutable,
    unreviewed_owners: unreviewed,
    uncommented,
    unparsable,
    pinned_actions: pinned.sort((a, b) => `${a.file}${a.line}`.localeCompare(`${b.file}${b.line}`)),
    workflow_digest: `sha256:${createHash("sha256").update(hashes.sort().join("\n")).digest("hex")}`,
    ok: mutable.length === 0 && unreviewed.length === 0 && uncommented.length === 0 && unparsable.length === 0
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
