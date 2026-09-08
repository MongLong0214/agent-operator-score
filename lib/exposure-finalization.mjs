import { sign, verify } from "node:crypto";
import { canonicalJson, sha256Value } from "./core.mjs";
import { classifyAdministration, openExposureLedger, recordExposure } from "./form-class.mjs";
import { withholdPublishedClaim } from "./result-schema.mjs";

// The private key exists only in the assessing process. Its public key was committed in the
// reservation before reveal; a pending file cannot supply or replace that authority. This has
// the ledger's existing trust boundary: rewriting the ledger AND its entire unkeyed chain is
// outside its tamper-evidence guarantee. No secret is persisted in the home or workspace.
export function signExposureFinalization(payload, privateKey) {
  return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
}

/** Pure replay: verify the producer, derive policy from the ledger, and transition one exact row. */
export function finalizeExposure(ledger, pending, administrationId) {
  const opened = openExposureLedger(ledger);
  const reserved = opened.entries.find((row) => row.administration_id === administrationId);
  const payload = pending?.payload;
  if (reserved === undefined || payload?.administration_id !== administrationId
      || reserved.run_id !== administrationId || payload?.result?.run?.run_id !== administrationId
      || payload?.record?.run_id !== administrationId
      || payload?.form_contract_digest !== reserved.form_contract_digest) {
    throw new Error("AOS_EXPOSURE_PENDING_IDENTITY pending completion must name exactly its reserved administration and form");
  }
  let authentic = false;
  try {
    authentic = typeof reserved.terminal_public_key === "string"
      && verify(null, Buffer.from(canonicalJson(payload)), reserved.terminal_public_key, Buffer.from(pending.signature, "base64"));
  } catch { /* Missing keys and malformed signatures provide no producer evidence. */ }
  if (!authentic) throw new Error("AOS_EXPOSURE_PENDING_SIGNATURE completion was not signed by this reservation's producer");
  if (payload.schema_id !== "aos-exposure-finalization.v1") {
    throw new Error("AOS_EXPOSURE_PENDING_SCHEMA unrecognised completion payload");
  }
  const pendingDigest = sha256Value(pending);
  let committed = opened;
  let receipt = reserved.finalization;
  if (reserved.state === "TERMINAL") {
    if (receipt?.pending_digest !== pendingDigest) {
      throw new Error("AOS_EXPOSURE_PENDING_CONFLICT this administration committed a different completion");
    }
  } else {
    const administrationClass = classifyAdministration(opened, reserved);
    const result = payload.result;
    const safety = payload.safety;
    const status = safety === "S2" ? "UNSAFE"
      : administrationClass.official_scoring_permitted !== true ? "PRACTICE"
      : result.aos_composite.issued ? "ISSUED" : "INCOMPLETE";
    const practiceReason = administrationClass.official_scoring_permitted !== true
      ? administrationClass.reasons[0] ?? "AOS_FORM_NOT_OFFICIAL this administration is not this form's official attempt"
      : null;
    // This receipt is committed WITH the terminal transition, never in the pending artifact.
    // A retry after the ledger rename must publish the same decision even if siblings changed
    // meanwhile. Its digest binds the exact signed completion; it cannot finalize another one.
    receipt = { pending_digest: pendingDigest, status, practice_reason: practiceReason };
    committed = recordExposure(opened, {
      ...reserved,
      administered_class: reserved.cycle_id !== null ? administrationClass.administered_class
        : administrationClass.administered_class === "OPERATIONAL" ? "PRACTICE" : administrationClass.administered_class,
      occurred_at: payload.occurred_at,
      scored: reserved.cycle_id !== null && administrationClass.official_scoring_permitted === true,
      score: result.aos_composite.value,
      duration_ms: payload.duration_ms,
      finalization: receipt
    }).ledger;
  }
  const practiceReason = receipt.practice_reason;
  const status = receipt.status;
  const result = payload.result;
  const publishedResult = practiceReason !== null
    ? withholdPublishedClaim(result, ["operator_process_profile", "system_outcome_profile", "aos_composite"], practiceReason)
    : result;
  return {
    ledger: committed,
    result: publishedResult,
    record: { ...payload.record, practice_withholding: practiceReason !== null ? { reason: practiceReason } : null },
    terminal: { run_id: administrationId, status, result_digest: sha256Value(publishedResult), committed_at: payload.occurred_at }
  };
}
