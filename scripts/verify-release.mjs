/**
 * G4 independent-reproduction and publication gate for E14-003.
 *
 * Accept a signed environment/toolchain manifest and output digests from an
 * independent run, compare those digests to the G0 pin (not the verifier's
 * current bytes), run the live G0–G4 blockers, and emit PASS or FAIL.
 *
 * A caller-supplied publication array, G1–G3 map, or G0 stub cannot mint a
 * pass. G1 closes only on the E12 token PASS_TO_CONTINUE. G2 and G3 are
 * deferred calibration studies; the n=20 feasibility record cannot close
 * them, so this tree cannot emit G4_PASS. Self-attested reproductions and
 * keys missing from the G4-VERDICT allowlist are refused.
 */

import { spawnSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  G0_DIGEST_MANIFEST,
  canonicalJsonBytes,
  digestFileText,
  runG0Gate,
  sha256Hex
} from "./verify-g0.mjs";

export { canonicalJsonBytes, digestFileText, sha256Hex };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CLEARANCE_PATH = "docs/decisions/PUBLICATION-CLEARANCE.md";
const VERDICT_PATH = "docs/decisions/G4-VERDICT.md";
const FEASIBILITY_PATH = "docs/decisions/FEASIBILITY-VERDICT.md";
const GIT_SHA = /^[a-f0-9]{40}$/i;
const DIGEST_SHAPE = /^[a-f0-9]{64}$/;
// E12-003 / PRD AC-E12-3 / SSOT §7.3 G1: the only E12 token that continues.
// INCONCLUSIVE, PIVOT_REQUIRED, and the G4-local token RESOLVED do not close G1.
// SSOT §7.3 G2/G3: deferred calibration studies; the n=20 record cannot close them.
const E12_GATE_PASS = "PASS_TO_CONTINUE";

export const G4_PUBLICATION_REQUIREMENT_IDS = Object.freeze([
  "contributor_terms",
  "formal_publication_review",
  "license",
  "redistribution",
  "security_policy",
  "third_party_notices"
]);

const PINNED_DIGESTS = Object.freeze(
  Object.fromEntries(G0_DIGEST_MANIFEST.map((entry) => [entry.path, entry.bytes_sha256]))
);
const PINNED_PATHS = Object.freeze(G0_DIGEST_MANIFEST.map((entry) => entry.path));

const isPlainRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultReadFile = (path) => readFileSync(resolve(root, path), "utf8");

const parseRecordBlocks = (text) => {
  const matches = [...String(text).matchAll(/^## (?<heading>.+)\n\n```json\n(?<json>[\s\S]*?)\n```/gm)];
  return new Map(matches.map(({ groups }) => [groups.heading, JSON.parse(groups.json)]));
};

const emptyReproductionState = () => ({
  independent: false,
  signature_ok: false,
  bytes_ok: false,
  head_ok: false
});

const failClosed = (errors) => ({
  ok: false,
  verdict: null,
  errors,
  reproduction: emptyReproductionState(),
  gates: { G0: "UNRESOLVED", G1: "UNRESOLVED", G2: "UNRESOLVED", G3: "UNRESOLVED" },
  permits_publication: false
});

const loadLivePublicationRequirements = (readFile) => {
  const blocks = parseRecordBlocks(readFile(CLEARANCE_PATH));
  const ledger = blocks.get("Requirement ledger");
  return Array.isArray(ledger?.requirements) ? ledger.requirements : [];
};

const loadTrustedPrincipals = (readFile) => {
  try {
    const blocks = parseRecordBlocks(readFile(VERDICT_PATH));
    const record = blocks.get("Trusted principals");
    const principals = Array.isArray(record?.principals) ? record.principals : [];
    return principals.filter(
      (principal) => isPlainRecord(principal) && typeof principal.public_key === "string" && principal.public_key.length > 0
    );
  } catch {
    return [];
  }
};

const loadLiveGateStatus = (readFile) => {
  const status = { G1: "UNRESOLVED", G2: "UNRESOLVED", G3: "UNRESOLVED" };
  let text;
  try {
    text = readFile(FEASIBILITY_PATH);
  } catch {
    return status;
  }
  try {
    const blocks = parseRecordBlocks(text);
    const record = blocks.get("Gate verdicts") ?? blocks.get("Derived verdict") ?? blocks.get("Gate blockers");
    if (!isPlainRecord(record)) return status;
    if (record.G1 === E12_GATE_PASS) status.G1 = "RESOLVED";
    return status;
  } catch {
    return status;
  }
};

const loadTreeResidentReproduction = (readFile, reproductionPath) => {
  if (typeof reproductionPath === "string" && reproductionPath.length > 0) {
    try {
      return { reproduction: JSON.parse(readFile(reproductionPath)), error: null };
    } catch (error) {
      return {
        reproduction: undefined,
        error: `NO_INDEPENDENT_REPRODUCTION could not read ${reproductionPath}: ${String(error)}`
      };
    }
  }
  try {
    const blocks = parseRecordBlocks(readFile(VERDICT_PATH));
    const live = blocks.get("Live reproduction");
    if (isPlainRecord(live) && live.kind === "independent-reproduction") {
      return { reproduction: live, error: null };
    }
    return { reproduction: undefined, error: null };
  } catch (error) {
    return {
      reproduction: undefined,
      error: `NO_INDEPENDENT_REPRODUCTION live reproduction could not be read: ${String(error)}`
    };
  }
};

const readHeadSha = () => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
};

const verifySignature = (body, signature, publicKeyB64) => {
  if (typeof signature !== "string" || signature.length === 0) return false;
  if (typeof publicKeyB64 !== "string" || publicKeyB64.length === 0) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.from(canonicalJsonBytes(body)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
};

const compareOutputDigests = (recorded) => {
  const errors = [];
  const seen = new Map();
  if (!Array.isArray(recorded)) {
    errors.push("MANIFEST_MALFORMED output_digests must be an array");
    return { errors, bytes_ok: false };
  }
  for (const entry of recorded) {
    if (!isPlainRecord(entry) || typeof entry.path !== "string") {
      errors.push("MANIFEST_MALFORMED a digest entry must record a path and its digest");
      continue;
    }
    if (!DIGEST_SHAPE.test(entry.bytes_sha256)) {
      errors.push(`MANIFEST_MALFORMED ${entry.path} must record a 64-character lowercase hex digest`);
      continue;
    }
    if (seen.has(entry.path)) {
      errors.push(`MANIFEST_MALFORMED ${entry.path} is recorded more than once`);
      continue;
    }
    if (!Object.hasOwn(PINNED_DIGESTS, entry.path)) {
      errors.push(`MANIFEST_INCOMPLETE ${entry.path} is recorded but is not a gated document`);
      continue;
    }
    seen.set(entry.path, entry.bytes_sha256);
  }
  for (const path of PINNED_PATHS) {
    if (!seen.has(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is gated but carries no recorded digest`);
      continue;
    }
    const claimed = seen.get(path);
    const pinned = PINNED_DIGESTS[path];
    if (claimed !== pinned) {
      errors.push(`WRONG_DIGEST ${path} recorded ${claimed} but pinned ${pinned}`);
    }
  }
  return { errors, bytes_ok: errors.length === 0 };
};

const evaluateG4Gate = (input) => {
  const errors = [];
  const readFile = typeof input.readFile === "function" ? input.readFile : defaultReadFile;
  const localEnvironment = input.localEnvironment;
  const headSha = input.headSha;
  const localId = isPlainRecord(localEnvironment) && typeof localEnvironment.id === "string"
    ? localEnvironment.id
    : `local:${hostname()}`;
  const expectedHead = typeof headSha === "string" && headSha.length > 0 ? headSha : readHeadSha();
  const principals = loadTrustedPrincipals(readFile);

  const reproductionState = emptyReproductionState();

  let reproduction = input.reproduction;
  let reproductionLoadError = null;
  if (!Object.hasOwn(input, "reproduction")) {
    const loaded = loadTreeResidentReproduction(readFile, input.reproductionPath);
    reproductionLoadError = loaded.error;
    if (loaded.error) errors.push(loaded.error);
    reproduction = loaded.reproduction;
  }

  if (reproduction === undefined || reproduction === null) {
    if (!reproductionLoadError) {
      errors.push(
        "NO_INDEPENDENT_REPRODUCTION no independent environment has reproduced exact public fixture bytes."
      );
    }
  } else if (!isPlainRecord(reproduction)) {
    errors.push("MANIFEST_MALFORMED the reproduction manifest must be an object");
  } else {
    const { signature, ...body } = reproduction;
    const environment = isPlainRecord(body.environment) ? body.environment : {};
    const envId = typeof environment.id === "string" ? environment.id : "";
    const toolchain = isPlainRecord(body.toolchain) ? body.toolchain : {};
    const publicKey = typeof body.public_key === "string" ? body.public_key : "";
    const allowlisted = principals.some((principal) => principal.public_key === publicKey);
    if (envId.length === 0) errors.push("MANIFEST_MALFORMED environment.id is required");
    if (typeof toolchain.node !== "string" || toolchain.node.length === 0) {
      errors.push("MANIFEST_MALFORMED toolchain.node is required");
    }
    if (typeof toolchain.engines !== "string" || toolchain.engines.length === 0) {
      errors.push("MANIFEST_MALFORMED toolchain.engines is required");
    }
    if (typeof body.head_sha !== "string" || body.head_sha.length === 0) {
      errors.push("MANIFEST_MALFORMED head_sha is required");
    }

    if (typeof signature !== "string" || signature.length === 0) {
      errors.push("UNSIGNED the reproduction manifest carries no signature");
    } else if (!verifySignature(body, signature, publicKey)) {
      errors.push("INVALID_SIGNATURE the reproduction signature did not verify");
    } else {
      reproductionState.signature_ok = true;
    }

    if (envId.length > 0 && envId === localId) {
      errors.push("SELF_ATTESTED the verifying host attested this reproduction");
    } else if (publicKey.length > 0 && !allowlisted) {
      errors.push("UNTRUSTED_PRINCIPAL the reproduction key is not in the G4-VERDICT allowlist");
    }

    const bytes = compareOutputDigests(body.output_digests);
    errors.push(...bytes.errors);
    reproductionState.bytes_ok = bytes.bytes_ok;

    const recordedHead = typeof body.head_sha === "string" ? body.head_sha : "";
    if (recordedHead.length === 0 || !GIT_SHA.test(recordedHead) || recordedHead !== expectedHead) {
      errors.push(
        `STALE_HEAD recorded ${recordedHead || "none"} but current head is ${expectedHead || "none"}`
      );
    } else {
      reproductionState.head_ok = true;
    }

    reproductionState.independent =
      reproductionState.signature_ok && envId.length > 0 && envId !== localId && allowlisted;
  }

  const g0 = runG0Gate({ readFile });
  if (!g0 || g0.ok !== true) {
    errors.push("UNRESOLVED_GATE G0");
    if (g0 && Array.isArray(g0.errors)) errors.push(...g0.errors);
  }

  const status = loadLiveGateStatus(readFile);
  for (const gate of ["G1", "G2", "G3"]) {
    if (status[gate] !== "RESOLVED") errors.push(`UNRESOLVED_GATE ${gate}`);
  }

  let requirements = [];
  try {
    requirements = loadLivePublicationRequirements(readFile);
  } catch (error) {
    errors.push(`UNREADABLE publication ledger could not be read: ${String(error)}`);
  }
  const byId = new Map();
  if (!Array.isArray(requirements) || requirements.length === 0) {
    errors.push("UNRESOLVED_GATE publication ledger is empty");
  } else {
    for (const requirement of requirements) {
      if (!isPlainRecord(requirement) || typeof requirement.id !== "string") {
        errors.push("UNRESOLVED_GATE a publication requirement is malformed");
        continue;
      }
      byId.set(requirement.id, requirement);
    }
  }
  for (const id of G4_PUBLICATION_REQUIREMENT_IDS) {
    const requirement = byId.get(id);
    if (!requirement || requirement.status !== "RESOLVED") {
      errors.push(`UNRESOLVED_GATE ${id}`);
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    verdict: ok ? "G4_PASS" : null,
    errors,
    reproduction: reproductionState,
    gates: {
      G0: g0 && g0.ok === true ? "RESOLVED" : "UNRESOLVED",
      G1: status.G1 === "RESOLVED" ? "RESOLVED" : "UNRESOLVED",
      G2: status.G2 === "RESOLVED" ? "RESOLVED" : "UNRESOLVED",
      G3: status.G3 === "RESOLVED" ? "RESOLVED" : "UNRESOLVED"
    },
    permits_publication: ok
  };
};

export const runG4Gate = (input = {}) => {
  try {
    return evaluateG4Gate(isPlainRecord(input) ? input : {});
  } catch (error) {
    return failClosed([`UNREADABLE ${String(error)}`]);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reproductionPath = process.argv[2];
  const run = runG4Gate(reproductionPath ? { reproductionPath } : {});
  if (!run.ok) {
    console.error(`G4_FAIL ${run.errors.length}`);
    for (const error of run.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`G4_PASS permits_publication=${run.permits_publication}`);
}
