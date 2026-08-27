const FACTORS = {
  F1: ["M01", "M02", "M03", "M04"],
  F2: ["M05", "M06", "M07"],
  F3: ["M08", "M09", "M10", "M11"],
  F4: ["M12", "M13", "M14"],
  F5: ["M15", "M16", "M17", "M18"],
  F6: ["M20"]
};
const PROCESS = [...FACTORS.F1, ...FACTORS.F2, ...FACTORS.F3, ...FACTORS.F4, "M18", "M20"];
const REQUIRED = ["M15", "M16", "M17", "M18", "M20"];

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}
function rat(n, d = 1n) {
  if (d === 0n) throw new Error("AOS_ZERO_DENOMINATOR");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function add(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function mul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function div(a, b) { return rat(a.n * b.d, a.d * b.n); }
function fromNumber(value) {
  if (value === 0) return rat(0n);
  if (value === 0.25) return rat(1n, 4n);
  if (value === 0.5) return rat(1n, 2n);
  if (value === 0.75) return rat(3n, 4n);
  if (value === 1) return rat(1n);
  const text = String(value);
  const [, fractional = ""] = text.split(".");
  const denominator = 10n ** BigInt(fractional.length);
  return rat(BigInt(text.replace(".", "")), denominator);
}
function mean(ids, metrics) {
  let numerator = rat(0n);
  let denominator = rat(0n);
  for (const id of ids) {
    const row = metrics[id];
    if (!row || row.state !== "SCORED") continue;
    const weight = rat(BigInt(row.opportunities ?? 1));
    numerator = add(numerator, mul(fromNumber(row.value), weight));
    denominator = add(denominator, weight);
  }
  return denominator.n === 0n ? null : div(numerator, denominator);
}
function jsonRat(value) { return value === null ? null : { n: Number(value.n), d: Number(value.d) }; }
function decimal(value) { return value === null ? null : Number(value.n) / Number(value.d); }
function roundFive(value) { return Math.floor((value + 2.5) / 5) * 5; }

const LEVERS = {
  M01: "Write one executable goal statement before routing work.",
  M02: "Capture scope, exclusions, and immutable constraints in the task contract.",
  M03: "Separate facts to investigate from decisions only a human can make.",
  M04: "Bind every acceptance criterion to concrete evidence.",
  M05: "Select the minimum sufficient context and exclude decoys.",
  M06: "Ground claims in the exact retrieved source used.",
  M07: "Apply freshness, provenance, and injection checks before using context.",
  M08: "Decompose work into independently verifiable tasks.",
  M09: "Model dependencies and shared-resource collisions before parallelizing.",
  M10: "Route each task to the simplest agent or tool that can complete it.",
  M11: "Use evidence-bound handoffs and verify that the receiver consumed them.",
  M12: "Persist the current goal, blocker, and latest evidence before switching agents.",
  M13: "Attach idempotency keys to retries and reroutes.",
  M14: "Use explicit complete, blocked, budget-stop, and cancelled terminal states.",
  M15: "Require hidden or independent outcome verification before completion.",
  M16: "Constrain changed paths and rerun regression checks.",
  M17: "Bind completion claims to the exact verified revision.",
  M18: "Classify the failure before intervening or switching agents.",
  M19: "Reduce permission and external-action scope before retesting.",
  M20: "Remove redundant agent layers that do not improve verified quality."
};

export function scoreMetrics(input, safetyState = "S0") {
  const metrics = {};
  for (let index = 1; index <= 20; index += 1) {
    const id = `M${String(index).padStart(2, "0")}`;
    const value = input[id];
    metrics[id] = value === null || value === undefined
      ? { state: "NOT_OBSERVED", value: null, opportunities: null }
      : { state: "SCORED", value: Math.max(0, Math.min(1, value)), opportunities: 1 };
  }
  const observed = Object.values(metrics).filter((row) => row.state === "SCORED").length;
  const requiredMissing = REQUIRED.filter((id) => metrics[id].state !== "SCORED");
  const safetyBlocks = safetyState === "S2" || safetyState === "S3";
  const factorCoverage = ["F1", "F2", "F3", "F4"].every((factor) => FACTORS[factor].some((id) => metrics[id].state === "SCORED"));
  // The contract scorer's FACTOR_OPPORTUNITY floor, enforced here rather than left to chance.
  // Every metric this instrument records is its own opportunity, so a factor's opportunity count
  // is its count of scored metrics; F1-F5 carry three or four each, so the floor was already met
  // on every real run. Being met by construction is not the same as being checked, and an
  // unchecked floor is exactly how the two predicates would drift apart without anyone noticing.
  const factorOpportunity = ["F1", "F2", "F3", "F4", "F5"].every(
    (factor) => FACTORS[factor].filter((id) => metrics[id].state === "SCORED").length >= 2
  );
  const safetyObserved = metrics.M19.state === "SCORED";
  const outcome = add(add(mul(fromNumber(metrics.M15.value ?? 0), rat(1n, 2n)), mul(fromNumber(metrics.M16.value ?? 0), rat(1n, 4n))), mul(fromNumber(metrics.M17.value ?? 0), rat(1n, 4n)));
  const process = mean(PROCESS, metrics);
  let raw = null;
  if (process !== null) {
    // A measured zero is a score, not an absence of evidence. Skipping the computation whenever
    // either index was zero reported INSUFFICIENT_EVIDENCE for an operator who was in fact scored
    // and scored nothing, which is the one direction this instrument must never round. The
    // published vectors P0-v0-outcome-zero, -process-zero and -both-zero all expect an issued 0.
    // Only the sum needs guarding: it is the denominator, and 2OP/(O+P) is 0 wherever O·P is.
    const sum = add(outcome, process);
    raw = sum.n === 0n ? rat(0n) : mul(rat(100n), div(mul(rat(2n), mul(outcome, process)), sum));
  }
  const factors = Object.fromEntries(Object.entries(FACTORS).map(([factor, ids]) => [factor, jsonRat(mean(ids, metrics))]));
  const issued = !safetyBlocks && safetyObserved && factorCoverage && factorOpportunity && requiredMissing.length === 0 && observed >= 14 && raw !== null;
  const rawNumber = decimal(raw);
  const ranked = Object.entries(metrics).filter(([, row]) => row.state === "SCORED").sort((a, b) => a[1].value - b[1].value || a[0].localeCompare(b[0]));
  const constraint = safetyBlocks ? "M19" : (ranked[0]?.[0] ?? null);
  return {
    schema_id: "aos-result",
    schema_version: "aos-result.v1",
    status: safetyBlocks ? "UNSAFE" : issued ? "EXPERIMENTAL / PROVISIONAL" : "INSUFFICIENT_EVIDENCE",
    issued,
    score: issued ? { raw: jsonRat(raw), decimal: rawNumber, display: roundFive(rawNumber) } : null,
    outcome_index: jsonRat(outcome),
    process_index: jsonRat(process),
    factors,
    safety: { state: safetyState, blocks_score: safetyBlocks },
    evidence_coverage: { n: observed, d: 20, decimal: observed / 20 },
    metrics,
    primary_constraint: constraint,
    one_lever: constraint ? LEVERS[constraint] : null,
    limitations: [
      "This is conditional performance in the declared opportunity profile, not a permanent personal ability.",
      "It is not a model leaderboard, certification, hiring signal, percentile, or global rank.",
      "Imported or partially observed sessions are diagnostic only."
    ]
  };
}

export function perfectMetricInput() {
  return Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`M${String(index + 1).padStart(2, "0")}`, 1]));
}
