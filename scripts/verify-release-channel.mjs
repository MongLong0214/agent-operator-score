#!/usr/bin/env node
// Whether the stable channel is actually a stable channel, read from GitHub rather than assumed.
//
// Two modes, and both are required by the contract this implements. `--live` asks the repository
// what is true right now; the default reads a committed fixture so the decision is exercised on
// every run of the suite, including on a machine with no network and no token. A verifier that only
// works live is a verifier CI cannot run, and one that only works on a fixture is a verifier that
// has never seen the repository it gates.
//
// Deliberately not part of `npm test` in live mode, for the same reason `execution-plan:live` is
// separate: a required check that needs a token would be indistinguishable from one nobody wired up
// on any runner that lacks it.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { promotionVerdict } from "../lib/release-channel.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const has = (flag) => process.argv.includes(flag);
const REPO = "MongLong0214/agent-operator-score";

const gh = (path) => {
  try {
    return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    return null;
  }
};

const planStatuses = () => {
  const plan = JSON.parse(readFileSync(join(root, "governance", "v0.2.0-execution-plan.json"), "utf8"));
  return Object.fromEntries((plan.issues ?? plan.plan ?? []).map((one) => [one.issue, one.status]));
};

// What "protected" means is read from the enforcement the API reports, never from a feature's name.
// The contract is explicit that a specific GitHub feature must not be guessed at, and the two
// shapes -- classic protection and a ruleset -- answer the same three questions differently.
const protectionOf = (branch) => {
  const found = gh(`repos/${REPO}/branches/${branch}/protection`);
  if (found === null) return null;
  return {
    required_checks: Boolean(found.required_status_checks),
    allow_force_push: found.allow_force_pushes?.enabled === true,
    allow_deletion: found.allow_deletions?.enabled === true
  };
};

const liveChannel = () => {
  const repo = gh(`repos/${REPO}`);
  // Null-prototype: this map is keyed by branch names read from the API, and a branch called
  // `__proto__` would otherwise write through to Object.prototype rather than into the map. The
  // branch names here are ones this repository controls, but a scanner that only fires on the
  // dangerous cases is a scanner that has to guess which those are.
  const protection = Object.create(null);
  for (const branch of ["main", "dev"]) {
    const found = protectionOf(branch);
    if (found !== null) protection[branch] = found;
  }
  return { defaultBranch: repo?.default_branch ?? null, protection, tag: null, backMerged: null, versions: {}, devOnlyMarkers: [] };
};

const fixtureChannel = () => {
  const path = join(root, "fixtures", "release-channel", "channel.json");
  if (!existsSync(path)) {
    process.stderr.write(`AOS_RELEASE_CHANNEL_FIXTURE_ABSENT: no fixture at ${path}\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

const live = has("--live");
const verdict = promotionVerdict({ planStatuses: planStatuses(), channel: live ? liveChannel() : fixtureChannel() });

if (has("--json")) {
  process.stdout.write(`${JSON.stringify({ ...verdict, source: live ? "live" : "fixture" }, null, 2)}\n`);
} else {
  process.stdout.write(`source ${live ? "live" : "fixture"}\n`);
  for (const row of verdict.gates) {
    process.stdout.write(`Gate ${row.gate.padEnd(6)} ${row.pass ? "PASS" : `waiting on ${row.waiting.map((n) => `#${n}`).join(", ")}`}\n`);
  }
  for (const reason of verdict.channel.problems) process.stdout.write(`channel  ${reason}\n`);
  process.stdout.write(verdict.promote
    ? "\nPROMOTE  every gate passed and the channel is shaped for a stable release\n"
    : `\nHOLD  ${verdict.reasons.length} condition(s) unmet; near-green is not a promotion condition\n`);
}
process.exit(verdict.promote ? 0 : 1);
