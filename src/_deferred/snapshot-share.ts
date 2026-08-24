const LEAK = "unknown/private fields may leak into a share card.";

// This module imports nothing. A share card is the one artifact here that is meant to leave
// the machine, so "it can reach no remote party" should be settleable by reading one file
// rather than by walking a dependency graph. The frozen vocabulary below is transcribed from
// SSOT 5.2 and the aos-snapshot.v0 contract, the same way the test lanes transcribe it.
const FAMILIES = [
  "FAM-1 Intent & Contracting",
  "FAM-2 Context, RAG & Decoy",
  "FAM-3 Graph & Orchestration",
  "FAM-4 Loop, State & Continuity",
  "FAM-5 Verification & False Completion",
  "FAM-6 Recovery, Safety & Efficiency"
];

const WATERMARK = "ESTIMATE";
const LIMITATIONS = "Snapshot is an ESTIMATE only. It is not a performed assessment.";
const VERSION = "aos-snapshot.v0";
const SHARE_COMMAND = "share";

const SNAPSHOT_FIELDS = [
  "estimate_band",
  "recommended_family",
  "next_command",
  "watermark",
  "limitations",
  "version"
];

// specs/share-allowlist.v0.json is the frozen statement of this list. `next_command` is a
// Snapshot field and is deliberately not here: it is operator-supplied free text that can
// carry a local filesystem path. Default deny, so a field nobody allowlisted never travels.
const SHARE_FIELDS = [
  "estimate_band",
  "recommended_family",
  "watermark",
  "limitations",
  "version"
];

// A band is a word. Letters and single spaces admit no digit, separator, address, or key
// material, so an allowlisted key cannot become a channel for an unallowlisted value.
const BAND = /^[A-Za-z][A-Za-z ]*$/;

type SnapshotShare = {
  estimate_band: string;
  recommended_family: string;
  watermark: "ESTIMATE";
  limitations: string;
  version: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const refuse = (): never => {
  throw new Error(LEAK);
};

const hasExactlyFields = (value: Record<string, unknown>, fields: string[]): boolean => {
  if (Object.keys(value).length !== fields.length) return false;
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) return false;
  }
  return true;
};

// Values are checked as strictly as names. A key allowlist that trusts whatever the value
// holds is not a privacy boundary; it only moves the leak one level down.
const admit = (value: Record<string, unknown>): SnapshotShare => {
  const band = value.estimate_band;
  const family = value.recommended_family;
  if (typeof band !== "string" || !BAND.test(band)) refuse();
  if (typeof family !== "string" || !FAMILIES.includes(family)) refuse();
  if (value.watermark !== WATERMARK) refuse();
  if (value.limitations !== LIMITATIONS) refuse();
  if (value.version !== VERSION) refuse();
  return {
    estimate_band: band,
    recommended_family: family,
    watermark: WATERMARK,
    limitations: LIMITATIONS,
    version: VERSION
  };
};

export const projectSnapshotShare = (snapshot: unknown, request?: unknown): SnapshotShare => {
  // Never by default. Exactly one explicit request shape yields a card, and a widened
  // request is not that shape.
  if (!isPlainObject(request)) refuse();
  if (!hasExactlyFields(request, ["command"])) refuse();
  if (request.command !== SHARE_COMMAND) refuse();
  // The input is a whole Snapshot, so a caller cannot pre-trim it into something this
  // projection would have refused to read.
  if (!isPlainObject(snapshot)) refuse();
  if (!hasExactlyFields(snapshot, SNAPSHOT_FIELDS)) refuse();
  const next = snapshot.next_command;
  if (typeof next !== "string" || next.length === 0) refuse();
  // Frozen, so the artifact cannot be widened between projection and rendering.
  return Object.freeze(admit(snapshot));
};

export const renderSnapshotCard = (share: unknown): string => {
  if (!isPlainObject(share)) refuse();
  if (!hasExactlyFields(share, SHARE_FIELDS)) refuse();
  const admitted = admit(share);
  return [
    WATERMARK,
    `estimate_band: ${admitted.estimate_band}`,
    `recommended_family: ${admitted.recommended_family}`,
    `limitations: ${admitted.limitations}`,
    `version: ${admitted.version}`
  ].join("\n");
};
