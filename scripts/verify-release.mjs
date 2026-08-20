/**
 * G4 independent-reproduction and publication gate for E14-003.
 *
 * Accept a signed environment/toolchain manifest and output digests from an
 * independent run, compare them to the public schema/fixture/scorer bytes,
 * run the G0–G4 blockers, and emit PASS or FAIL. A protocol PASS under test
 * injection is not a live publication clearance. Self-attested reproductions
 * are refused.
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
const GIT_SHA = /^[a-f0-9]{40}$/i;
const DIGEST_SHAPE = /^[a-f0-9]{64}$/;
const DEFAULT_GATES = Object.freeze({ G1: "UNRESOLVED", G2: "UNRESOLVED", G3: "UNRESOLVED" });

const isPlainRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultReadFile = (path) => readFileSync(resolve(root, path), "utf8");

const parseRecordBlocks = (text) => {
  const matches = [...String(text).matchAll(/^## (?<heading>.+)\n\n```json\n(?<json>[\s\S]*?)\n```/gm)];
  return new Map(matches.map(({ groups }) => [groups.heading, JSON.parse(groups.json)]));
};

const loadLivePublicationRequirements = (readFile) => {
  const blocks = parseRecordBlocks(readFile(CLEARANCE_PATH));
  const ledger = blocks.get("Requirement ledger");
  return Array.isArray(ledger?.requirements) ? ledger.requirements : [];
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

const compareOutputDigests = (recorded, readFile) => {
  const errors = [];
  const live = new Map(
    G0_DIGEST_MANIFEST.map((entry) => [entry.path, digestFileText(readFile(entry.path))])
  );
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
    seen.set(entry.path, entry.bytes_sha256);
  }
  for (const path of live.keys()) {
    if (!seen.has(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is gated but carries no recorded digest`);
      continue;
    }
    const computed = live.get(path);
    const claimed = seen.get(path);
    if (claimed !== computed) {
      errors.push(`WRONG_DIGEST ${path} recorded ${claimed} but computed ${computed}`);
    }
  }
  return { errors, bytes_ok: errors.length === 0 };
};

export const runG4Gate = ({
  readFile = defaultReadFile,
  reproduction,
  localEnvironment,
  headSha,
  publicationRequirements,
  gateStatus,
  runG0
} = {}) => {
  const errors = [];
  const localId = isPlainRecord(localEnvironment) && typeof localEnvironment.id === "string"
    ? localEnvironment.id
    : `local:${hostname()}`;
  const expectedHead = typeof headSha === "string" && headSha.length > 0 ? headSha : readHeadSha();

  const reproductionState = {
    independent: false,
    signature_ok: false,
    bytes_ok: false,
    head_ok: false
  };

  if (reproduction === undefined || reproduction === null) {
    errors.push(
      "NO_INDEPENDENT_REPRODUCTION no independent environment has reproduced exact public fixture bytes."
    );
  } else if (!isPlainRecord(reproduction)) {
    errors.push("MANIFEST_MALFORMED the reproduction manifest must be an object");
  } else {
    const { signature, ...body } = reproduction;
    const environment = isPlainRecord(body.environment) ? body.environment : {};
    const envId = typeof environment.id === "string" ? environment.id : "";
    const toolchain = isPlainRecord(body.toolchain) ? body.toolchain : {};
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
    } else if (!verifySignature(body, signature, body.public_key)) {
      errors.push("INVALID_SIGNATURE the reproduction signature did not verify");
    } else {
      reproductionState.signature_ok = true;
    }

    if (envId.length > 0 && envId === localId) {
      errors.push("SELF_ATTESTED the verifying host attested this reproduction");
    }

    const bytes = compareOutputDigests(body.output_digests, readFile);
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

    reproductionState.independent = reproductionState.signature_ok && envId.length > 0 && envId !== localId;
  }

  const g0 = typeof runG0 === "function" ? runG0() : runG0Gate({ readFile });
  if (!g0 || g0.ok !== true) errors.push("UNRESOLVED_GATE G0");

  const status = isPlainRecord(gateStatus) ? gateStatus : DEFAULT_GATES;
  for (const gate of ["G1", "G2", "G3"]) {
    if (status[gate] !== "RESOLVED") errors.push(`UNRESOLVED_GATE ${gate}`);
  }

  let requirements;
  try {
    requirements = Array.isArray(publicationRequirements)
      ? publicationRequirements
      : loadLivePublicationRequirements(readFile);
  } catch (error) {
    requirements = [];
    errors.push(`UNRESOLVED_GATE publication ledger could not be read: ${String(error)}`);
  }
  if (!Array.isArray(requirements) || requirements.length === 0) {
    errors.push("UNRESOLVED_GATE publication ledger is empty");
  } else {
    for (const requirement of requirements) {
      if (!isPlainRecord(requirement) || typeof requirement.id !== "string") {
        errors.push("UNRESOLVED_GATE a publication requirement is malformed");
        continue;
      }
      if (requirement.status !== "RESOLVED") {
        errors.push(`UNRESOLVED_GATE ${requirement.id}`);
      }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = runG4Gate();
  if (!run.ok) {
    console.error(`G4_FAIL ${run.errors.length}`);
    for (const error of run.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`G4_PASS permits_publication=${run.permits_publication}`);
}
