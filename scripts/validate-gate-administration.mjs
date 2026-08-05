import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const statuses = new Set(["PENDING", "PARTIAL", "ACCEPTED", "REJECTED", "INVALIDATED"]);
const batchStatuses = new Set(["PENDING", "ACCEPTED", "REJECTED", "INVALIDATED"]);
const transitionKinds = {
  ADR_ACCEPTED: "ADR",
  PRD_ACCEPTED: "PRD",
  TICKET_READY_FOR_RED: "TICKET"
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dateTime = (value) => typeof value === "string" && value.includes("T") && !Number.isNaN(Date.parse(value));
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
    if (!dateTime(event.recorded_at) || typeof event.recorded_by !== "string" || !event.recorded_by) {
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
  if (batch.target.repository !== "agent-operator-score" || batch.target.branch !== "dev") {
    errors.push(`${label} has wrong repository target`);
  }

  if (!Array.isArray(batch.required_artifacts) || !batch.required_artifacts.length) {
    errors.push(`${label} has no required artifacts`);
    return;
  }
  const requiredPairs = new Set();
  for (const [index, artifact] of batch.required_artifacts.entries()) {
    if (!checkKeys(artifact, ["path", "kind"], ["path", "kind"], `${label}.required_artifacts[${index}]`, errors)) continue;
    if (!safeRelativePath(artifact.path) || !expectedPathForKind(artifact.path, artifact.kind)) {
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
    return;
  }

  if (!checkKeys(batch.preparation, ["prepared_by"], ["prepared_by"], `${label}.preparation`, errors) ||
    !checkKeys(batch.approval, ["approved_by", "approved_at", "role"], ["approved_by", "approved_at", "role"], `${label}.approval`, errors)) return;
  if (typeof batch.preparation.prepared_by !== "string" || !batch.preparation.prepared_by ||
    typeof batch.approval.approved_by !== "string" || !batch.approval.approved_by ||
    !dateTime(batch.approval.approved_at) || batch.approval.role !== "MAINTAINER") {
    errors.push(`${label} has malformed preparation or Maintainer approval`);
  }
  if (batch.preparation.prepared_by === batch.approval.approved_by) errors.push(`${label} is self-approved`);

  if (batch.status === "REJECTED") {
    if (batch.artifacts.length || batch.transitions.length || own(batch.target, "reviewed_head") || own(batch, "invalidation")) {
      errors.push(`${label} rejected state contains acceptance evidence`);
    }
    return;
  }

  const reviewedHeadIsValid = verifyReviewedHead(root, batch.target.reviewed_head, errors, label);
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
      !dateTime(batch.invalidation.invalidated_at) || typeof batch.invalidation.invalidated_by !== "string" || !batch.invalidation.invalidated_by ||
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

export const validateGateAdministration = ({ root, registryPath } = {}) => {
  const resolvedRoot = root ? resolve(root) : resolve(fileURLToPath(new URL("..", import.meta.url)));
  const errors = [];
  const schemaPath = resolve(resolvedRoot, "docs/decisions/maintainer-gate.schema.json");
  const requestedPath = registryPath ?? "docs/decisions/maintainer-gate-registry.v2.json";
  const resolvedRegistryPath = resolve(resolvedRoot, requestedPath);
  if (isAbsolute(requestedPath) || relative(resolvedRoot, resolvedRegistryPath).startsWith("..")) {
    errors.push("Gate Administration registry override escapes repository root");
  }
  const schema = readJson(schemaPath, "Gate Administration schema", errors);
  const registry = errors.length ? null : readJson(resolvedRegistryPath, "Gate Administration registry", errors);
  if (schema) checkSchemaContract(schema, errors);
  if (!registry) return { errors, status: "invalid", counts: {} };
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
  const counts = Object.fromEntries(["ACCEPTED", "REJECTED", "INVALIDATED"].map((status) => [status.toLowerCase(),
    Array.isArray(registry.batches) ? registry.batches.filter((batch) => batch.status === status).length : 0]));
  return { errors, status: statusName(registry.status), counts, batches: registry.batches?.length ?? 0 };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const registryArgument = args.find((argument) => argument.startsWith("--gate-registry="));
  if (args.some((argument) => argument !== registryArgument)) {
    console.error("GATE_ADMINISTRATION_FAIL 1");
    console.error("- unknown argument");
    process.exit(1);
  }
  const result = validateGateAdministration({ registryPath: registryArgument?.slice("--gate-registry=".length) });
  if (result.errors.length) {
    console.error(`GATE_ADMINISTRATION_FAIL ${result.errors.length}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`GATE_ADMINISTRATION_PASS registry=${result.status} batches=${result.batches} accepted=${result.counts.accepted} rejected=${result.counts.rejected} invalidated=${result.counts.invalidated}`);
}
