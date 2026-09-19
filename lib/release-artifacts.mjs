import { canonicalJson, sha256Text } from "./core.mjs";

// What a release is allowed to contain, and what it must prove about itself.
//
// The asset a stranger downloads is the only thing most people will ever run. Everything this
// repository measures about its own honesty -- the withholding, the claim stage, the contract
// digests -- describes a program, and the tarball is where that program actually leaves. So the
// boundary is checked against a contract rather than against `.npmignore` behaving as expected,
// and the identity is a digest over content rather than a version string somebody typed.
//
// Nothing here builds anything. `scripts/build-release.mjs` runs the commands and hands the
// results in; this decides whether what came back may be released. The split is the one the
// promotion gate and the quickstart loop already use, and for the same reason: a release decision
// that could only be checked by releasing is a decision nobody checks.

export const INSTALL_MANIFEST_SCHEMA = "aos-agent-install.v2";
export const PROVENANCE_SCHEMA = "aos-release-provenance.v2";

/**
 * Paths a package may carry.
 *
 * A prefix list rather than a glob language: every entry is a directory or an exact file, so the
 * question "is this path allowed" has one answer and no precedence rules. `package.json` `files`
 * decides what npm actually packs; this decides whether that was the right set, which is a
 * different question and the reason both exist.
 */
export const PACKAGE_ALLOWLIST = Object.freeze([
  "bin/", "lib/", "contracts/", "schemas/", "reliance-events/", "scripts/", "docs/", "governance/",
  "fixtures/known-incidents/", "fixtures/scoring/", "fixtures/execution-plan/", "fixtures/confinement/",
  "fixtures/attacks/",
  "package.json", "README.md", "README.ko.md", "README.ja.md", "README.zh-CN.md",
  "LICENSE", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"
]);

/**
 * Shapes that must never be in a package, whatever the allowlist says.
 *
 * Checked in addition to the allowlist and not instead of it. An allowlist answers "was this
 * directory meant to ship"; this answers "is this particular file a thing that must never ship",
 * and a private file that lands inside an allowed directory is exactly the case where the first
 * question returns the wrong answer. Both run on every release or neither is load-bearing.
 */
export const PACKAGE_DENYLIST = Object.freeze([
  { id: "aos-home", test: (path) => /(^|\/)\.aos(\/|$)/u.test(path), why: "operator home data" },
  { id: "session-transcript", test: (path) => /(^|\/)(sessions?|transcripts?)(\/|$)/u.test(path), why: "raw session transcripts" },
  // The ledger itself, named exactly. `holdout[^/]*\.json` was the first draft and it matched the
  // shipped known-incident corpus -- `fixtures/known-incidents/holdout-320-*.json`, six files this
  // package is supposed to carry. Measured against a real `npm pack`, which is the only way that
  // was going to surface: a denylist tested only on invented paths agrees with whoever wrote it.
  { id: "holdout", test: (path) => /(^|\/)holdout\.json$/u.test(path), why: "the holdout ledger" },
  { id: "operator-plan", test: (path) => /(^|\/)operator-plans?(\/|$)/u.test(path), why: "operator plans" },
  { id: "runs", test: (path) => /(^|\/)runs(\/|$)/u.test(path), why: "recorded runs" },
  { id: "credential", test: (path) => /(^|\/)(\.env|\.netrc|id_rsa|[^/]*\.pem|[^/]*\.key|credentials?\.json)$/u.test(path), why: "credential material" },
  { id: "scratch", test: (path) => /(^|\/)(tmp|temp|scratch|\.cache|node_modules)(\/|$)/u.test(path), why: "scratch or cache" },
  { id: "vcs", test: (path) => /(^|\/)\.git(\/|$)/u.test(path), why: "version control internals" }
]);

/** A path that escapes the package, or is not an ordinary file. */
const unsafeShape = (entry) => {
  const path = typeof entry === "string" ? entry : entry.path;
  if (typeof path !== "string" || path.length === 0) return "an entry with no path";
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) return `${path}: absolute path`;
  if (path.split("/").includes("..")) return `${path}: traverses out of the package`;
  if (typeof entry === "object") {
    if (entry.type !== undefined && entry.type !== "File" && entry.type !== "file") return `${path}: ${entry.type}, not a regular file`;
    // A symlink whose target leaves the package is the traversal case wearing a different hat.
    if (typeof entry.linkpath === "string") {
      const target = entry.linkpath;
      if (target.startsWith("/") || target.split("/").includes("..")) return `${path}: symlink escaping to ${target}`;
    }
  }
  return null;
};

/**
 * Whether this file list may be released, and every reason it may not.
 *
 * Every reason at once. A boundary that reports the first forbidden file makes a release an
 * iterative game of discovery, and the person playing it starts looking for the flag that skips
 * the check.
 */
export function packageBoundary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const pathOf = (entry) => (typeof entry === "string" ? entry : entry.path);
  const unsafe = list.map(unsafeShape).filter((reason) => reason !== null);
  const forbidden = [];
  const unexpected = [];
  for (const entry of list) {
    const path = pathOf(entry);
    if (typeof path !== "string") continue;
    const denied = PACKAGE_DENYLIST.find((rule) => rule.test(path));
    if (denied !== undefined) forbidden.push(`${path}: ${denied.why}`);
    else if (!PACKAGE_ALLOWLIST.some((allowed) => (allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed))) {
      unexpected.push(path);
    }
  }
  return {
    ok: unsafe.length === 0 && forbidden.length === 0 && unexpected.length === 0,
    unsafe, forbidden, unexpected,
    counted: list.length
  };
}

/**
 * Every surface that states a version, and the ones that disagree.
 *
 * A plugin manifest that lags the tag is how a stable install ends up describing a release it is
 * not. Named per surface, because "versions disagree" sends the reader to check all of them.
 */
export function versionConsistency(expected, surfaces) {
  const mismatched = Object.entries(surfaces ?? {})
    .filter(([, value]) => value !== expected)
    .map(([surface, value]) => `${surface} says ${value ?? "nothing"}, the release is ${expected}`);
  return { ok: mismatched.length === 0, expected, mismatched };
}

// --- the two records a release publishes ----------------------------------------------------------

const digestOf = (value) => `sha256:${sha256Text(canonicalJson(value))}`;

/**
 * The manifest an installer consumes, and its digest over its own canonical bytes.
 *
 * `manifest_digest` is not part of what it digests -- a record cannot contain its own digest and
 * still be checkable. The digest covers everything else, so a consumer recomputes it from the
 * bytes it received rather than trusting the field beside them.
 */
export function buildInstallManifest({
  repository, version, sourceCommit, releaseTag, artifacts, checksumsUrl, sbomUrl, provenanceUrl,
  node, entryCommand = "aos quickstart --agent-mode --json", installPolicy = "user-scope", generatedAt
}) {
  const body = {
    schema_id: INSTALL_MANIFEST_SCHEMA,
    repository,
    channel: "stable",
    version,
    source_commit: sourceCommit,
    release_tag: releaseTag,
    artifacts: [...artifacts].map((one) => ({ kind: one.kind, name: one.name, sha256: one.sha256, url: one.url })),
    checksums_url: checksumsUrl,
    sbom_url: sbomUrl,
    provenance_url: provenanceUrl,
    node,
    entry_command: entryCommand,
    install_policy: installPolicy,
    generated_at: generatedAt
  };
  return Object.freeze({ ...body, manifest_digest: digestOf(body) });
}

/**
 * The provenance record, with its reproducible core separated from when it was built.
 *
 * `built_at` is metadata. Two builds of the same source produce the same `core_digest` and
 * different `built_at`, and a reproducibility claim that folded the clock in would be a claim
 * nobody could ever check twice. The contract says this in one line and this is where it holds.
 */
export function buildProvenance({
  version, sourceCommit, tag, mainCommit, packageName, packageSha256, packageFileManifestDigest,
  installManifestDigest, sbomDigest, workflowDigest, pinnedActions = [], ciRunIds = [],
  nodeVersion, measurementContractDigest, builtAt
}) {
  const core = {
    schema_id: PROVENANCE_SCHEMA,
    version,
    source_commit: sourceCommit,
    tag,
    main_commit: mainCommit,
    package_name: packageName,
    package_sha256: packageSha256,
    package_file_manifest_digest: packageFileManifestDigest,
    install_manifest_digest: installManifestDigest,
    sbom_digest: sbomDigest,
    workflow_digest: workflowDigest,
    pinned_actions: [...pinnedActions].sort(),
    ci_run_ids: [...ciRunIds].map(String).sort(),
    node_version: nodeVersion,
    measurement_contract_digest: measurementContractDigest
  };
  return Object.freeze({ ...core, built_at: builtAt, core_digest: digestOf(core) });
}

/** The digest of the packed file list itself, so a changed set of files is a changed release. */
export const packageFileManifestDigest = (entries) => digestOf(
  [...(entries ?? [])].map((entry) => (typeof entry === "string" ? entry : entry.path)).sort()
);

/**
 * Whether the source a release claims and the source it was built from are the same source.
 *
 * Every identity in one place: a release cut from `dev`, or a tag naming one commit while the
 * provenance names another, is caught here rather than by a reader comparing two files.
 */
export function sourceAuthority({ mainCommit, tagCommit, releaseTargetCommit, provenanceSourceCommit, installManifestSourceCommit }) {
  const seen = { main: mainCommit, tag: tagCommit, release_target: releaseTargetCommit, provenance: provenanceSourceCommit, install_manifest: installManifestSourceCommit };
  const absent = Object.entries(seen).filter(([, value]) => typeof value !== "string" || value.length === 0).map(([name]) => name);
  const distinct = [...new Set(Object.values(seen).filter((one) => typeof one === "string" && one.length > 0))];
  const problems = [
    ...absent.map((name) => `${name} commit is not recorded, so nothing can be compared to it`),
    ...(distinct.length > 1
      ? [`the release names ${distinct.length} different commits: ${Object.entries(seen).map(([name, value]) => `${name}=${value ?? "none"}`).join(", ")}`]
      : [])
  ];
  return { ok: problems.length === 0, problems };
}
