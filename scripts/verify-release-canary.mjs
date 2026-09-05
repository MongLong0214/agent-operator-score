#!/usr/bin/env node
// The release gate #639 asked for: reads the durable `aos-strict-canary.v1` record and decides
// whether a release may cite it as proof that the STRICT lane ran, authenticated, on a real
// runtime.
//
// Deliberately not part of `npm test`, `verify:mvp` or any required CI job -- the same reason
// `verify:real-runtime-strict` itself is kept out of them (see `.github/workflows/ci.yml`,
// `security-gates`): the only host that can produce an `OBSERVED` record here is an authenticated
// darwin machine with Seatbelt, which is not what CI runners are, and a required check that can
// only ever see `NOT_OBSERVED` here would be indistinguishable from one that was never wired up.
// This script is the deliberate, separate step a release runs by hand (or from a release job that
// is not gated by ordinary PR CI), exactly the way `execution-plan-live` is separate from
// `execution-plan`.
//
// Decision made for v0.2.0 (stated once, here, and in the PR this shipped with): an absent or
// unaccepted canary BLOCKS this script -- it exits non-zero -- rather than merely printing a
// warning. The scope this shipped against already said as much: "release gate가 OBSERVED를
// 요구하고, 없으면 그 사실을 표시하고 발행을 보류한다"; withholding is the second half of that
// sentence, not an option beside it. A "display only" gate would let a release aggregate a missing
// or PROVIDER_REFUSED canary into "shipped anyway", which is exactly the "silence is not coverage"
// failure the rest of `lib/confinement.mjs` -- `issuanceGate`, `officialIssuanceFor` -- refuses
// everywhere else in this module. There is no other condition in this file that is reported but not
// enforced, and this one is not the first exception.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseCanaryGate } from "../lib/confinement.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPath = join(root, "fixtures", "confinement", "strict-canary.json");
const path = process.argv[2] ? resolve(process.argv[2]) : defaultPath;

if (!existsSync(path)) {
  process.stderr.write(`AOS_RELEASE_CANARY_ABSENT: no strict canary evidence at ${path}\n`);
  process.stderr.write(
    "this release gate withholds issuance without a recorded OBSERVED canary; run " +
    "`npm run verify:real-runtime-strict` on an authenticated darwin host with the installed Codex " +
    "runtime, then commit the fixture it writes, before releasing.\n"
  );
  process.exit(1);
}

let record;
try {
  record = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  process.stderr.write(`AOS_RELEASE_CANARY_UNREADABLE: ${path} did not parse as JSON: ${error.message}\n`);
  process.exit(1);
}

const decision = releaseCanaryGate(record);

if (!decision.accepted) {
  process.stderr.write(`AOS_RELEASE_CANARY_NOT_ACCEPTED: outcome=${decision.outcome ?? "unknown"} reasons=${decision.reasons.join(",")}\n`);
  process.exit(1);
}

process.stdout.write(`strict canary accepted: observed_at=${record.observed_at} runtime_version=${record.runtime_version}\n`);
