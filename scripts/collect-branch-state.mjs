#!/usr/bin/env node
// The live half of #572's cleanup gate.
//
// The audit is a document, and a document cannot observe anything. Everything a deletion decision
// turns on -- which refs exist, which pull requests are open, what protection and rulesets say, what
// the published install source is -- is mutable state on GitHub that moves while the document sits
// still. So this collector, and not the audit, is where those facts enter: it runs the read-only
// commands, records the exact command and a digest of its raw bytes beside each answer, and emits
// one observation record.
//
// The point of separating it is narrow and worth stating plainly. `scripts/branch-audit.mjs`
// authorizes a deletion only against an observation, never against the audit's own copy of these
// facts -- otherwise the party proposing the deletion supplies both the evidence and the verdict.
// What this cannot do is prove that the observation itself came from GitHub rather than from a text
// editor: an offline checker has no way to authenticate a transcript. The receipts are there so a
// human or a CI job with credentials can re-run each command and compare, which is the honest
// boundary rather than a pretended one.
//
// Read-only by construction. Every command below reads; none creates, deletes or updates a ref.

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

import { sha256Bytes } from "../lib/digest.mjs";

export const OBSERVATION_SCHEMA = "aos-branch-live-observation.v1";

/** The files that decide how someone installs this project. A cleanup may not change them. */
export const INSTALL_SOURCE_FILES = Object.freeze([".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"]);

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");

/** Runs one read-only command and keeps the bytes it produced, not only what we parsed out of them. */
const receipted = (receipts, source, command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "buffer", ...options });
  const stdout = result.stdout ?? Buffer.alloc(0);
  receipts.push({
    source,
    command: [command, ...args].join(" "),
    exit_code: result.status,
    bytes: stdout.length,
    digest: sha256Bytes(stdout)
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${source}: \`${[command, ...args].join(" ")}\` exited ${result.status}: ${stderr}`);
  }
  return stdout.toString("utf8");
};

const api = (receipts, source, path, jq) =>
  JSON.parse(receipted(receipts, source, "gh", ["api", path, ...(jq ? ["--jq", jq] : [])]).trim() || "null");

/**
 * Collect everything a deletion decision reads, from the live repository, once.
 *
 * `repository` is only used to build API paths; the git transport half uses the checkout's `origin`,
 * so the two halves are independent sources for the same head list rather than one source read twice.
 */
export const collect = ({ repository, cwd = process.cwd(), branchNames = [] } = {}) => {
  const receipts = [];
  const collectedAt = nowIso();

  const heads = receipted(receipts, "git-ls-remote", "git", ["ls-remote", "--heads", "origin"], { cwd })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/u);
      return { name: ref.replace("refs/heads/", ""), sha };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // The same list again, over REST rather than the git protocol. Two transports disagreeing is
  // information; one transport read twice is not.
  const restHeads = api(receipts, "rest-branches", `repos/${repository}/branches?per_page=100`, "[.[]|{name:.name,sha:.commit.sha,protected:.protected}]")
    .sort((a, b) => a.name.localeCompare(b.name));

  const openPrs = api(receipts, "rest-open-prs", `repos/${repository}/pulls?state=open&per_page=100`,
    "[.[]|{number:.number,head_branch:.head.ref,head_sha:.head.sha,base:.base.ref,state:\"OPEN\"}]")
    .sort((a, b) => a.number - b.number);

  const tags = receipted(receipts, "git-ls-remote-tags", "git", ["ls-remote", "--tags", "origin"], { cwd })
    .split("\n")
    .filter(Boolean)
    .reduce((map, line) => {
      const [sha, ref] = line.split(/\s+/u);
      const name = ref.replace("refs/tags/", "");
      if (name.endsWith("^{}")) map.get(name.slice(0, -3)).commit_sha = sha;
      else map.set(name, { name, ref_sha: sha, commit_sha: sha });
      return map;
    }, new Map());

  // The whole protection object, not three booleans out of it. A projection cannot report that a
  // field it never carried has changed.
  const protection = Object.fromEntries(
    ["main", "dev"].map((ref) => [ref, api(receipts, `rest-protection-${ref}`, `repos/${repository}/branches/${ref}/protection`)])
  );

  const rulesets = api(receipts, "rest-rulesets", `repos/${repository}/rulesets`);
  const settings = api(receipts, "rest-repo", `repos/${repository}`,
    "{default_branch:.default_branch,delete_branch_on_merge:.delete_branch_on_merge}");

  const installSource = {
    files: INSTALL_SOURCE_FILES.map((path) => ({ path, digest: sha256Bytes(readFileSync(`${cwd}/${path}`)) })),
    package: (() => {
      const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
      return { name: pkg.name, bin: pkg.bin, files: pkg.files };
    })()
  };

  // "Nothing refers to this branch" is a claim about the whole repository, so it needs a search over
  // the whole repository -- recorded per branch name, with the receipt, so a later reader can tell a
  // search that found nothing from a search that never ran.
  const referenceSweep = branchNames.map((name) => ({
    branch: name,
    query: `repo:${repository} "${name}"`,
    hits: api(receipts, `search-${name}`, `search/issues?q=${encodeURIComponent(`repo:${repository} "${name}"`)}&per_page=100`,
      "[.items[]|{number:.number,is_pull_request:(.pull_request!=null),state:.state,title:.title}]")
  }));

  return {
    schema: OBSERVATION_SCHEMA,
    repository,
    collected_at: collectedAt,
    collector: "scripts/collect-branch-state.mjs",
    heads,
    rest_heads: restHeads,
    open_prs: openPrs,
    tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
    protection,
    rulesets,
    settings,
    install_source: installSource,
    reference_sweep: referenceSweep,
    receipts
  };
};

/** Stable bytes for the observation, so its digest can be bound into a record that cites it. */
export const observationDigest = (observation) => {
  const { digest: _ignored, ...rest } = observation;
  return sha256Bytes(Buffer.from(JSON.stringify(rest, Object.keys(rest).sort()), "utf8"));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const repository = process.argv[2] ?? "MongLong0214/agent-operator-score";
  const out = process.argv[3];
  const first = collect({ repository });
  const named = first.heads.map((head) => head.name).filter((name) => name !== "main" && name !== "dev");
  const observation = collect({ repository, branchNames: named });
  observation.digest = observationDigest(observation);
  const text = `${JSON.stringify(observation, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
