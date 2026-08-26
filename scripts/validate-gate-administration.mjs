import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const statuses = new Set(["PENDING", "PARTIAL", "ACCEPTED", "REJECTED", "INVALIDATED"]);
const batchStatuses = new Set(["PENDING", "ACCEPTED", "REJECTED", "INVALIDATED"]);
const transitionKinds = {
  ADR_ACCEPTED: "ADR",
  PRD_ACCEPTED: "PRD",
  TICKET_READY_FOR_RED: "TICKET"
};
const canonicalRegistryRelativePath = "docs/decisions/maintainer-gate-registry.v2.json";
const canonicalSchemaRelativePath = "docs/decisions/maintainer-gate.schema.json";
const validatorRelativePath = "scripts/validate-gate-administration.mjs";
const exactHeadSurfaces = [canonicalRegistryRelativePath, canonicalSchemaRelativePath, validatorRelativePath];
const canonicalRepositoryTarget = "github.com/MongLong0214/agent-operator-score";
const canonicalTargetBranch = "dev";
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rfc3339DateTime = (value) => {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1] || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
};
const hash40 = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const hash64 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const statusName = (value) => typeof value === "string" ? value.toLowerCase() : "invalid";

const safeRelativePath = (value) => typeof value === "string" &&
  /^[A-Za-z0-9._/-]+$/.test(value) &&
  !value.startsWith("/") &&
  !value.split("/").includes("..") &&
  !value.split("/").includes("");

const expectedPathForKind = (path, kind) => (
  (kind === "ADR" && /^docs\/adr\/ADR-\d{4}-.+\.md$/.test(path)) ||
  (kind === "PRD" && /^docs\/prd\/PRD-.+\.md$/.test(path)) ||
  (kind === "TICKET" && /^docs\/tickets\/[A-Z0-9-]+\/[A-Z0-9-]+-.+\.md$/.test(path))
);

const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
const pair = ({ path, kind }) => `${kind}:${path}`;
const isWithin = (root, path) => {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
};

const checkKeys = (value, allowed, required, label, errors) => {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of required) if (!own(value, key)) errors.push(`${label} missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label} has unexpected ${key}`);
  return true;
};

const checkSchemaContract = (schema, errors) => {
  if (!plainObject(schema)) return errors.push("Gate Administration schema must be an object");
  if (schema.title !== "AOS Pre-Implementation Gate Administration Registry v2") {
    errors.push("Gate Administration schema title is wrong");
  }
  if (schema.properties?.version?.const !== 2) errors.push("Gate Administration schema version must be 2");
  const declared = schema.properties?.status?.enum;
  if (!Array.isArray(declared) || !sameSet(new Set(declared), statuses)) {
    errors.push("Gate Administration schema lacks registry lifecycle states");
  }
  const declaredBatch = schema.properties?.batches?.items?.properties?.status?.enum;
  if (!Array.isArray(declaredBatch) || !sameSet(new Set(declaredBatch), batchStatuses)) {
    errors.push("Gate Administration schema lacks batch lifecycle states");
  }
  const targetProperties = schema.properties?.batches?.items?.properties?.target?.properties;
  if (targetProperties?.repository?.const !== canonicalRepositoryTarget || targetProperties?.branch?.const !== canonicalTargetBranch) {
    errors.push("Gate Administration schema has wrong canonical target");
  }
  const pendingDigestRequirement = schema.properties?.batches?.items?.allOf?.find((rule) => rule?.if?.properties?.status?.const === "PENDING");
  const pendingRequiredArtifactKeys = pendingDigestRequirement?.then?.properties?.required_artifacts?.items?.required;
  if (!Array.isArray(pendingRequiredArtifactKeys) || !sameSet(new Set(pendingRequiredArtifactKeys), new Set(["path", "sha256", "kind"]))) {
    errors.push("Gate Administration schema does not require SHA-256 for PENDING required artifacts");
  }
};

const readJson = (path, label, errors) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`invalid JSON ${label}`);
    return null;
  }
};

const verifyReviewedArtifact = (root, reviewedHead, artifact, errors, label, verifyActive) => {
  const livePath = resolve(root, artifact.path);
  if (!livePath.startsWith(`${root}/`) || !existsSync(livePath)) {
    errors.push(`${label} artifact has wrong target ${artifact.path}`);
    return;
  }
  if (verifyActive) {
    const activeDigest = sha256(readFileSync(livePath));
    if (activeDigest !== artifact.sha256) errors.push(`${label} artifact digest is stale ${artifact.path}`);
  }
  try {
    const reviewedBytes = execFileSync("git", ["show", `${reviewedHead}:${artifact.path}`], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (sha256(reviewedBytes) !== artifact.sha256) {
      errors.push(`${label} artifact does not match reviewed head ${artifact.path}`);
    }
  } catch {
    errors.push(`${label} artifact is absent from reviewed head ${artifact.path}`);
  }
};

const normalizeGitHubRepository = (remoteUrl) => {
  const value = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match = value.match(/^(?:(?:https?|ssh):\/\/)?(?:[^@/]+@)?github\.com(?::|\/)([^/]+)\/([^/]+)$/);
  return match ? `github.com/${match[1]}/${match[2]}` : null;
};

const verifyCandidateTarget = (root, target, errors, label) => {
  try {
    const actualRepository = normalizeGitHubRepository(execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }));
    if (actualRepository !== target.repository) errors.push(`${label} has wrong actual repository target`);
  } catch {
    errors.push(`${label} has no verifiable actual repository target`);
  }
  const targetRef = `refs/remotes/origin/${target.branch}`;
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", targetRef], {
      cwd: root,
      stdio: "ignore"
    });
  } catch {
    errors.push(`${label} target ref origin/${target.branch} is unavailable`);
    return null;
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", targetRef, "HEAD"], {
      cwd: root,
      stdio: "ignore"
    });
  } catch {
    errors.push(`${label} exact candidate HEAD is not based on target ref origin/${target.branch}`);
    return null;
  }
  return targetRef;
};

const isAncestor = (root, ancestor, descendant) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
};

const verifyReviewedHead = (root, reviewedHead, errors, label) => {
  if (!hash40(reviewedHead)) {
    errors.push(`${label} missing or malformed reviewed_head`);
    return false;
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${reviewedHead}^{commit}`], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    errors.push(`${label} reviewed_head is not a resolvable commit`);
    return false;
  }
};

const verifyTargetArtifact = (root, targetRef, artifact, errors, label) => {
  try {
    const targetBytes = execFileSync("git", ["show", `${targetRef}:${artifact.path}`], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (sha256(targetBytes) !== artifact.sha256) {
      errors.push(`${label} target branch tip artifact digest is stale ${artifact.path}`);
    }
  } catch {
    errors.push(`${label} target branch tip lacks accepted artifact ${artifact.path}`);
  }
};

const verifyTargetRegistry = (root, targetRef, errors, label) => {
  try {
    const targetBytes = execFileSync("git", ["show", `${targetRef}:${canonicalRegistryRelativePath}`], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (!targetBytes.equals(readFileSync(resolve(root, canonicalRegistryRelativePath)))) {
      errors.push(`${label} target branch tip canonical registry does not match exact candidate registry`);
    }
  } catch {
    errors.push(`${label} target branch tip lacks canonical registry`);
  }
};

const verifyEvents = (batch, errors, label) => {
  const expected = batch.status === "PENDING" ? []
    : batch.status === "ACCEPTED" ? [["PENDING", "ACCEPTED"]]
      : batch.status === "REJECTED" ? [["PENDING", "REJECTED"]]
        : [["PENDING", "ACCEPTED"], ["ACCEPTED", "INVALIDATED"]];
  if (!Array.isArray(batch.events) || batch.events.length !== expected.length) {
    errors.push(`${label} has an invalid lifecycle event count`);
    return;
  }
  batch.events.forEach((event, index) => {
    if (!checkKeys(event, ["from", "to", "recorded_at", "recorded_by"], ["from", "to", "recorded_at", "recorded_by"], `${label}.events[${index}]`, errors)) return;
    const [from, to] = expected[index];
    if (event.from !== from || event.to !== to) errors.push(`${label} has an invalid lifecycle transition`);
    if (!rfc3339DateTime(event.recorded_at) || typeof event.recorded_by !== "string" || !event.recorded_by) {
      errors.push(`${label} has malformed lifecycle evidence`);
    }
  });
};

const verifyBatch = (root, batch, errors) => {
  const label = `batch ${batch?.id ?? "<unknown>"}`;
  const allowed = [
    "id", "status", "scope", "target", "required_artifacts", "required_transitions",
    "artifacts", "transitions", "events", "preparation", "approval", "invalidation"
  ];
  const required = ["id", "status", "scope", "target", "required_artifacts", "required_transitions", "artifacts", "transitions", "events"];
  if (!checkKeys(batch, allowed, required, label, errors)) return;
  if (typeof batch.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(batch.id)) errors.push(`${label} has malformed id`);
  if (!batchStatuses.has(batch.status)) errors.push(`${label} has invalid status`);
  if (typeof batch.scope !== "string" || !batch.scope) errors.push(`${label} has invalid scope`);
  if (!checkKeys(batch.target, ["repository", "branch", "reviewed_head"], ["repository", "branch"], `${label}.target`, errors)) return;
  if (batch.target.repository !== canonicalRepositoryTarget || batch.target.branch !== canonicalTargetBranch) {
    errors.push(`${label} has wrong repository target`);
  }

  if (!Array.isArray(batch.required_artifacts) || !batch.required_artifacts.length) {
    errors.push(`${label} has no required artifacts`);
    return;
  }
  const requiredPairs = new Set();
  for (const [index, artifact] of batch.required_artifacts.entries()) {
    if (!checkKeys(artifact, ["path", "sha256", "kind"], ["path", "kind"], `${label}.required_artifacts[${index}]`, errors)) continue;
    if (!safeRelativePath(artifact.path) || !expectedPathForKind(artifact.path, artifact.kind) ||
      (own(artifact, "sha256") && !hash64(artifact.sha256))) {
      errors.push(`${label} has wrong required artifact target ${artifact.path}`);
    }
    const key = pair(artifact);
    if (requiredPairs.has(key)) errors.push(`${label} has duplicate required artifact ${artifact.path}`);
    requiredPairs.add(key);
  }
  if (!Array.isArray(batch.required_transitions) || !batch.required_transitions.length) {
    errors.push(`${label} has no required transitions`);
    return;
  }
  const requiredTransitionSet = new Set(batch.required_transitions);
  if (requiredTransitionSet.size !== batch.required_transitions.length ||
    [...requiredTransitionSet].some((type) => !own(transitionKinds, type))) {
    errors.push(`${label} has invalid required transitions`);
  }
  verifyEvents(batch, errors, label);
  if (!Array.isArray(batch.artifacts) || !Array.isArray(batch.transitions) || !Array.isArray(batch.events)) {
    errors.push(`${label} has malformed evidence arrays`);
    return;
  }

  if (batch.status === "PENDING") {
    if (batch.artifacts.length || batch.transitions.length || own(batch, "preparation") || own(batch, "approval") ||
      own(batch, "invalidation") || own(batch.target, "reviewed_head")) {
      errors.push(`${label} pending state contains acceptance or invalidation evidence`);
    }
    for (const artifact of batch.required_artifacts) {
      const artifactPath = resolve(root, artifact.path);
      if (!artifactPath.startsWith(`${root}/`) || !existsSync(artifactPath)) {
        errors.push(`${label} pending required artifact has wrong target ${artifact.path}`);
      } else if (!hash64(artifact.sha256)) {
        errors.push(`${label} pending required artifact has missing or malformed sha256 ${artifact.path}`);
      } else if (sha256(readFileSync(artifactPath)) !== artifact.sha256) {
        errors.push(`${label} pending required artifact digest is stale ${artifact.path}`);
      }
    }
    return;
  }

  if (!checkKeys(batch.preparation, ["prepared_by"], ["prepared_by"], `${label}.preparation`, errors) ||
    !checkKeys(batch.approval, ["approved_by", "approved_at", "role"], ["approved_by", "approved_at", "role"], `${label}.approval`, errors)) return;
  if (typeof batch.preparation.prepared_by !== "string" || !batch.preparation.prepared_by ||
    typeof batch.approval.approved_by !== "string" || !batch.approval.approved_by ||
    !rfc3339DateTime(batch.approval.approved_at) || batch.approval.role !== "MAINTAINER") {
    errors.push(`${label} has malformed preparation or Maintainer approval`);
  }
  if (batch.preparation.prepared_by === batch.approval.approved_by) errors.push(`${label} is self-approved`);

  if (batch.status === "REJECTED") {
    if (batch.artifacts.length || batch.transitions.length || own(batch.target, "reviewed_head") || own(batch, "invalidation")) {
      errors.push(`${label} rejected state contains acceptance evidence`);
    }
    return;
  }

  const targetRef = batch.status === "ACCEPTED" ? verifyCandidateTarget(root, batch.target, errors, label) : null;
  const reviewedHeadIsValid = verifyReviewedHead(
    root,
    batch.target.reviewed_head,
    errors,
    label
  );
  const requiresTargetTipDigestProof = batch.status === "ACCEPTED" && reviewedHeadIsValid && targetRef &&
    !isAncestor(root, batch.target.reviewed_head, "HEAD");
  if (requiresTargetTipDigestProof) verifyTargetRegistry(root, targetRef, errors, label);
  const actualPairs = new Set();
  if (!Array.isArray(batch.artifacts) || batch.artifacts.length !== requiredPairs.size) {
    errors.push(`${label} has partial accepted artifacts`);
  }
  for (const [index, artifact] of batch.artifacts.entries()) {
    if (!checkKeys(artifact, ["path", "sha256", "kind"], ["path", "sha256", "kind"], `${label}.artifacts[${index}]`, errors)) continue;
    if (!safeRelativePath(artifact.path) || !expectedPathForKind(artifact.path, artifact.kind) || !hash64(artifact.sha256)) {
      errors.push(`${label} has malformed accepted artifact ${artifact.path}`);
      continue;
    }
    const key = pair(artifact);
    if (actualPairs.has(key)) errors.push(`${label} has duplicate accepted artifact ${artifact.path}`);
    actualPairs.add(key);
    if (reviewedHeadIsValid) {
      verifyReviewedArtifact(root, batch.target.reviewed_head, artifact, errors, label, batch.status !== "INVALIDATED");
    }
    if (requiresTargetTipDigestProof) verifyTargetArtifact(root, targetRef, artifact, errors, label);
  }
  if (!sameSet(requiredPairs, actualPairs)) errors.push(`${label} accepted artifacts do not exactly close required scope`);

  const actualTransitionSet = new Set();
  if (!Array.isArray(batch.transitions) || batch.transitions.length !== requiredTransitionSet.size) {
    errors.push(`${label} has partial accepted transitions`);
  }
  for (const [index, transition] of batch.transitions.entries()) {
    if (!checkKeys(transition, ["type", "artifact_paths"], ["type", "artifact_paths"], `${label}.transitions[${index}]`, errors)) continue;
    actualTransitionSet.add(transition.type);
    const expectedKind = transitionKinds[transition.type];
    if (!expectedKind || !Array.isArray(transition.artifact_paths) || !transition.artifact_paths.length) {
      errors.push(`${label} has malformed transition ${transition.type}`);
      continue;
    }
    const paths = new Set(transition.artifact_paths);
    if (paths.size !== transition.artifact_paths.length) errors.push(`${label} transition ${transition.type} repeats an artifact`);
    for (const path of paths) {
      if (!safeRelativePath(path) || !actualPairs.has(`${expectedKind}:${path}`)) {
        errors.push(`${label} transition ${transition.type} has wrong artifact target ${path}`);
      }
    }
    const expectedPaths = new Set([...requiredPairs]
      .filter((value) => value.startsWith(`${expectedKind}:`))
      .map((value) => value.slice(expectedKind.length + 1)));
    if (!sameSet(paths, expectedPaths)) errors.push(`${label} transition ${transition.type} is partial`);
  }
  if (!sameSet(requiredTransitionSet, actualTransitionSet)) errors.push(`${label} accepted transitions do not exactly close required scope`);

  if (batch.status === "INVALIDATED") {
    if (!checkKeys(batch.invalidation, ["invalidated_at", "invalidated_by", "reason"], ["invalidated_at", "invalidated_by", "reason"], `${label}.invalidation`, errors) ||
      !rfc3339DateTime(batch.invalidation.invalidated_at) || typeof batch.invalidation.invalidated_by !== "string" || !batch.invalidation.invalidated_by ||
      typeof batch.invalidation.reason !== "string" || !batch.invalidation.reason) {
      errors.push(`${label} has malformed invalidation evidence`);
    }
  } else if (own(batch, "invalidation")) {
    errors.push(`${label} accepted state contains invalidation evidence`);
  }
};

const deriveRegistryStatus = (batches) => {
  const values = batches.map(({ status }) => status);
  if (values.includes("INVALIDATED")) return "INVALIDATED";
  if (values.includes("REJECTED")) return "REJECTED";
  if (values.every((status) => status === "PENDING")) return "PENDING";
  if (values.every((status) => status === "ACCEPTED")) return "ACCEPTED";
  if (values.every((status) => status === "PENDING" || status === "ACCEPTED")) return "PARTIAL";
  return null;
};

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const asSourceBytes = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return null;
};

const effectiveStateError = (kind) => new Error(`effective state rejected: ${kind} input`);

const isAuthenticatedGitHubApprovalFact = (fact, batchId) =>
  plainObject(fact) &&
  fact.batch_id === batchId &&
  fact.authenticated === true &&
  Number.isInteger(fact.github_user_id) &&
  fact.github_user_id > 0 &&
  typeof fact.login === "string" &&
  fact.login.length > 0 &&
  Number.isInteger(fact.approval_id) &&
  fact.approval_id > 0 &&
  typeof fact.html_url === "string" &&
  /^https:\/\/github\.com\//.test(fact.html_url);

const collectRowPaths = (batch) => {
  const paths = [];
  for (const artifact of [...(Array.isArray(batch?.required_artifacts) ? batch.required_artifacts : []),
    ...(Array.isArray(batch?.artifacts) ? batch.artifacts : [])]) {
    if (typeof artifact?.path === "string") paths.push(artifact.path);
  }
  for (const transition of Array.isArray(batch?.transitions) ? batch.transitions : []) {
    if (!Array.isArray(transition?.artifact_paths)) continue;
    for (const path of transition.artifact_paths) {
      if (typeof path === "string") paths.push(path);
    }
  }
  return paths;
};

export const deriveEffectiveGateState = (input) => {
  if (input == null) throw effectiveStateError("missing");
  if (!plainObject(input)) throw effectiveStateError("malformed");
  if (!own(input, "source_registry")) throw effectiveStateError("missing");
  if (typeof input.source_path === "string" && !safeRelativePath(input.source_path)) {
    throw effectiveStateError("unsafe");
  }
  if (!plainObject(input.source_registry)) throw effectiveStateError("malformed");
  const registry = input.source_registry;
  if (registry.version !== 2 || !Array.isArray(registry.batches)) {
    throw effectiveStateError("malformed");
  }
  if (own(input, "github_approval_facts") && !Array.isArray(input.github_approval_facts)) {
    throw effectiveStateError("malformed");
  }
  const sourceBytes = own(input, "source_bytes") ? asSourceBytes(input.source_bytes) : null;
  if (own(input, "source_bytes") && !sourceBytes) throw effectiveStateError("malformed");
  const claimedDigest = input.source_sha256;
  if (typeof claimedDigest !== "string" || !hash64(claimedDigest)) {
    throw effectiveStateError("unverified");
  }
  if (sourceBytes) {
    if (sha256(sourceBytes) !== claimedDigest) throw effectiveStateError("unverified");
    let parsedBytes;
    try {
      parsedBytes = JSON.parse(sourceBytes.toString("utf8"));
    } catch {
      throw effectiveStateError("unverified");
    }
    if (stableJson(parsedBytes) !== stableJson(registry)) throw effectiveStateError("unverified");
  } else if (sha256(Buffer.from(JSON.stringify(registry), "utf8")) !== claimedDigest) {
    throw effectiveStateError("unverified");
  }

  const approvalFacts = Array.isArray(input.github_approval_facts) ? input.github_approval_facts : [];
  const seenIds = new Set();
  const records = [];
  for (const batch of registry.batches) {
    if (!plainObject(batch) || typeof batch.id !== "string" || !batch.id) {
      throw effectiveStateError("malformed");
    }
    if (seenIds.has(batch.id)) throw effectiveStateError("duplicate");
    seenIds.add(batch.id);
    if (own(batch, "status") && typeof batch.status !== "string") {
      throw effectiveStateError("malformed");
    }
    for (const path of collectRowPaths(batch)) {
      if (!safeRelativePath(path)) throw effectiveStateError("unsafe");
    }
    if (batch.status !== "ACCEPTED") continue;
    const authenticated = approvalFacts.some((fact) => isAuthenticatedGitHubApprovalFact(fact, batch.id));
    records.push({
      source_record_id: batch.id,
      source_digest: sha256(Buffer.from(stableJson(batch), "utf8")),
      structural_state: "ACCEPTED",
      effective_gate_state: authenticated ? "ACCEPTED" : "LEGACY_UNAUTHENTICATED",
      effective_gate_state_reason: authenticated
        ? "authenticated GitHub approval fact present"
        : "no authenticated GitHub approval fact"
    });
  }
  return { ok: true, records, freeze_inputs: [] };
};

const verifyCanonicalRegistry = (root, errors) => {
  const registryPath = resolve(root, canonicalRegistryRelativePath);
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    errors.push("Gate Administration repository root is not resolvable");
    return registryPath;
  }
  try {
    const registryStat = lstatSync(registryPath);
    if (!registryStat.isFile() || registryStat.isSymbolicLink()) {
      errors.push("Gate Administration canonical registry must be a regular non-symlink file");
      return registryPath;
    }
    if (!isWithin(realRoot, realpathSync(registryPath))) {
      errors.push("Gate Administration canonical registry realpath escapes repository root");
    }
  } catch {
    errors.push("Gate Administration canonical registry must be a regular non-symlink file");
  }
  return registryPath;
};

const resolveCandidateHead = (root, errors, required) => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    if (required) errors.push("Gate Administration cannot resolve exact candidate HEAD");
    return null;
  }
};

const verifyExactHeadSurfaces = (root, errors) => {
  const candidateHead = resolveCandidateHead(root, errors, true);
  if (!candidateHead) return null;
  for (const path of exactHeadSurfaces) {
    try {
      const liveBytes = readFileSync(resolve(root, path));
      const headBytes = execFileSync("git", ["show", `${candidateHead}:${path}`], {
        cwd: root,
        encoding: "buffer",
        stdio: ["ignore", "pipe", "ignore"]
      });
      if (!liveBytes.equals(headBytes)) errors.push(`Gate Administration exact-head mismatch ${path}`);
    } catch {
      errors.push(`Gate Administration exact-head mismatch ${path}`);
    }
  }
  return candidateHead;
};

export const validateGateAdministration = (...args) => {
  const errors = [];
  if (args.length) errors.push("Gate Administration does not accept programmatic overrides");
  const resolvedRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const schemaPath = resolve(resolvedRoot, canonicalSchemaRelativePath);
  const resolvedRegistryPath = verifyCanonicalRegistry(resolvedRoot, errors);
  const schema = readJson(schemaPath, "Gate Administration schema", errors);
  const registry = errors.length ? null : readJson(resolvedRegistryPath, "Gate Administration registry", errors);
  if (schema) checkSchemaContract(schema, errors);
  if (!registry) return { errors, status: "invalid", counts: {}, currentAcceptedTickets: [] };
  const allPending = registry.status === "PENDING" && Array.isArray(registry.batches) &&
    registry.batches.length > 0 && registry.batches.every((batch) => batch?.status === "PENDING");
  const candidateHead = allPending && !resolveCandidateHead(resolvedRoot, errors, false)
    ? "unavailable_pending"
    : verifyExactHeadSurfaces(resolvedRoot, errors);
  if (!checkKeys(registry, ["version", "status", "batches", "invalidation"], ["version", "status", "batches", "invalidation"], "registry", errors)) {
    return { errors, status: "invalid", counts: {} };
  }
  if (registry.version !== 2 || !statuses.has(registry.status)) errors.push("Gate Administration registry has invalid version or status");
  if (!checkKeys(registry.invalidation, ["on_artifact_or_reviewed_head_change", "effect"], ["on_artifact_or_reviewed_head_change", "effect"], "registry.invalidation", errors) ||
    registry.invalidation.on_artifact_or_reviewed_head_change !== true ||
    registry.invalidation.effect !== "invalidate_affected_batch_and_require_fresh_pending_batch") {
    errors.push("Gate Administration registry has invalid invalidation policy");
  }
  if (!Array.isArray(registry.batches) || !registry.batches.length) {
    errors.push("Gate Administration registry has no batches");
  } else {
    const ids = new Set();
    for (const batch of registry.batches) {
      if (ids.has(batch?.id)) errors.push(`Gate Administration registry has duplicate batch ${batch?.id}`);
      ids.add(batch?.id);
      verifyBatch(resolvedRoot, batch, errors);
    }
    const derived = deriveRegistryStatus(registry.batches);
    if (!derived || registry.status !== derived) errors.push("Gate Administration registry status is inconsistent with batches");
  }
  const acceptedTicketBatchByPath = new Map();
  if (Array.isArray(registry.batches)) {
    for (const batch of registry.batches) {
      if (batch?.status !== "ACCEPTED" || !Array.isArray(batch.artifacts)) continue;
      for (const artifact of batch.artifacts) {
        if (artifact?.kind !== "TICKET" || typeof artifact.path !== "string") continue;
        if (acceptedTicketBatchByPath.has(artifact.path)) {
          errors.push(`Gate Administration has multiple current accepted batches for ticket ${artifact.path}`);
          continue;
        }
        acceptedTicketBatchByPath.set(artifact.path, batch.id);
      }
    }
  }
  const currentAcceptedTickets = errors.length ? [] : [...acceptedTicketBatchByPath.keys()].sort();
  const counts = Object.fromEntries(["ACCEPTED", "REJECTED", "INVALIDATED"].map((status) => [status.toLowerCase(),
    Array.isArray(registry.batches) ? registry.batches.filter((batch) => batch.status === status).length : 0]));
  return {
    errors,
    status: errors.length ? "invalid" : statusName(registry.status),
    counts,
    batches: registry.batches?.length ?? 0,
    currentAcceptedTickets,
    externalGateEvidence: counts.accepted ? "required" : "not_applicable",
    candidateHead
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length) {
    console.error("GATE_ADMINISTRATION_FAIL 1");
    console.error("- canonical registry only; arguments are not supported");
    process.exit(1);
  }
  const result = validateGateAdministration();
  if (result.errors.length) {
    console.error(`GATE_ADMINISTRATION_FAIL ${result.errors.length}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  const currentAcceptedTickets = result.currentAcceptedTickets.length ? result.currentAcceptedTickets.join(",") : "none";
  console.log(`GATE_ADMINISTRATION_STRUCTURAL_PASS registry=${result.status} batches=${result.batches} accepted=${result.counts.accepted} rejected=${result.counts.rejected} invalidated=${result.counts.invalidated} external_gate_evidence=${result.externalGateEvidence} not_authorization candidate_head=${result.candidateHead} current_accepted_tickets=${currentAcceptedTickets}`);
}
