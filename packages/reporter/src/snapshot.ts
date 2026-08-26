const IMPERSONATION = "Snapshot can impersonate a verified result.";

const ALLOWED_INPUT = new Set(["estimate_band", "recommended_family", "next_command"]);

const FAMILIES = [
  "FAM-1 Intent & Contracting",
  "FAM-2 Context, RAG & Decoy",
  "FAM-3 Graph & Orchestration",
  "FAM-4 Loop, State & Continuity",
  "FAM-5 Verification & False Completion",
  "FAM-6 Recovery, Safety & Efficiency"
];

const LIMITATIONS = "Snapshot is an ESTIMATE only. It is not a performed assessment.";
const VERSION = "aos-snapshot.v0";
const SNAPSHOT_FIELDS = [
  "estimate_band",
  "recommended_family",
  "next_command",
  "watermark",
  "limitations",
  "version"
] as const;

type Snapshot = {
  estimate_band: string;
  recommended_family: string;
  next_command: string;
  watermark: "ESTIMATE";
  limitations: string;
  version: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const refuse = (): never => {
  throw new Error(IMPERSONATION);
};

export const buildSnapshot = (input: unknown): Snapshot => {
  if (!isPlainObject(input)) refuse();
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT.has(key)) refuse();
  }
  const band = input.estimate_band;
  const family = input.recommended_family;
  const next = input.next_command;
  if (typeof band !== "string" || band.length === 0 || /[0-9]/.test(band)) refuse();
  if (typeof family !== "string" || !FAMILIES.includes(family)) refuse();
  if (typeof next !== "string" || next.length === 0) refuse();
  return {
    estimate_band: band,
    recommended_family: family,
    next_command: next,
    watermark: "ESTIMATE",
    limitations: LIMITATIONS,
    version: VERSION
  };
};

export const renderSnapshot = (snapshot: unknown): string => {
  if (!isPlainObject(snapshot)) refuse();
  const expected = buildSnapshot({
    estimate_band: snapshot.estimate_band,
    recommended_family: snapshot.recommended_family,
    next_command: snapshot.next_command
  });
  if (Object.keys(snapshot).length !== SNAPSHOT_FIELDS.length) refuse();
  for (const field of SNAPSHOT_FIELDS) {
    if (!Object.hasOwn(snapshot, field) || snapshot[field] !== expected[field]) refuse();
  }
  return [
    "ESTIMATE",
    `estimate_band: ${expected.estimate_band}`,
    `recommended_family: ${expected.recommended_family}`,
    `next_command: ${expected.next_command}`,
    `limitations: ${expected.limitations}`,
    `version: ${expected.version}`
  ].join("\n");
};
