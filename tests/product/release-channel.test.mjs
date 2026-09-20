import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { RELEASE_CHANNEL_SCHEMA, RELEASE_GATES, channelState, gateMatrix, promotionVerdict } from "../../lib/release-channel.mjs";

const planStatuses = () => {
  const plan = JSON.parse(readFileSync(new URL("../../governance/v0.2.0-execution-plan.json", import.meta.url), "utf8"));
  return Object.fromEntries((plan.issues ?? plan.plan ?? []).map((one) => [one.issue, one.status]));
};

const promoted = {
  defaultBranch: "main",
  protection: {
    main: { required_checks: true, allow_force_push: false, allow_deletion: false },
    dev: { required_checks: true, allow_force_push: false, allow_deletion: false }
  }
};

test("every gate names real issues, and an issue the plan does not know is not passing", () => {
  // An absent entry and a done one read identically to a reader who only counts failures, and only
  // one of them is true.
  const known = planStatuses();
  const named = Object.values(RELEASE_GATES).flat();
  for (const issue of named) {
    assert.ok(issue in known, `gate names #${issue}, which the execution plan does not carry`);
  }
  assert.equal(new Set(named).size, named.length, "an issue is named by two gates, so one of them is not the gate it looks like");

  // The absent case, made explicit: a gate whose issues the plan has never heard of does not pass.
  const blind = gateMatrix({});
  assert.equal(blind.pass, false);
  assert.deepEqual([...blind.waiting].sort((a, b) => a - b), [...named].sort((a, b) => a - b));
});

test("near-green is not a promotion condition", () => {
  // The failure this exists to prevent: every gate but one, a plausible story about why that one
  // does not count, and a stable channel pointing at work nobody finished.
  const allDone = Object.fromEntries(Object.values(RELEASE_GATES).flat().map((issue) => [issue, "done"]));
  assert.equal(promotionVerdict({ planStatuses: allDone, channel: promoted }).promote, true);

  for (const gate of Object.keys(RELEASE_GATES)) {
    const oneShort = { ...allDone, [RELEASE_GATES[gate][0]]: "ready" };
    const verdict = promotionVerdict({ planStatuses: oneShort, channel: promoted });
    assert.equal(verdict.promote, false, `${gate}: one unfinished issue still promoted`);
    assert.ok(verdict.reasons.some((reason) => reason.includes(`#${RELEASE_GATES[gate][0]}`)),
      `${gate}: the refusal does not name the issue it is waiting on`);
  }
});

test("a channel that is not shaped for a stable release refuses, and says every reason at once", () => {
  // Fixing one and rediscovering the next is how a release takes a day instead of an hour, and how
  // somebody starts looking for the flag that skips the check.
  const unshaped = channelState({ defaultBranch: "dev", protection: {} });
  assert.equal(unshaped.ok, false);
  assert.equal(unshaped.problems.length, 3, "the reasons are reported one at a time");
  assert.ok(unshaped.problems.some((p) => /default branch is dev/u.test(p)));
  assert.ok(unshaped.problems.some((p) => /^main has no protection/u.test(p)));
  assert.ok(unshaped.problems.some((p) => /^dev has no protection/u.test(p)));

  // Protection is read from the enforcement that was observed, never from a feature's name: each
  // of the three axes refuses on its own.
  for (const [field, value, needle] of [
    ["required_checks", false, "required checks"],
    ["allow_force_push", true, "no force push"],
    ["allow_deletion", true, "no deletion"]
  ]) {
    const weakened = channelState({ ...promoted, protection: { ...promoted.protection, main: { ...promoted.protection.main, [field]: value } } });
    assert.equal(weakened.ok, false, field);
    assert.ok(weakened.problems.some((p) => p.includes(needle)), `${field}: the refusal does not name what is unenforced`);
  }
  assert.deepEqual(channelState(promoted), { ok: true, problems: [] });
});

test("a tag that does not describe the stable channel refuses", () => {
  const tag = {
    name: "v0.2.0", version: "0.2.0", commit: "abc", release_target: "abc",
    tree: "t1", main_tree: "t1", reachable_from_main: true
  };
  assert.deepEqual(channelState({ ...promoted, tag }).problems, []);

  for (const [label, broken, needle] of [
    ["unreachable", { ...tag, reachable_from_main: false }, "not reachable from main"],
    ["release elsewhere", { ...tag, release_target: "def" }, "release targets"],
    ["tree differs", { ...tag, tree: "t2" }, "released tree does not match"]
  ]) {
    const state = channelState({ ...promoted, tag: broken });
    assert.equal(state.ok, false, label);
    assert.ok(state.problems.some((p) => p.includes(needle)), label);
  }

  // Every surface that states a version states the same one. A plugin manifest that lags the tag is
  // how a stable install ends up describing a release it is not.
  const lagging = channelState({ ...promoted, tag, versions: { "the plugin manifest": "0.1.17" } });
  assert.equal(lagging.ok, false);
  assert.ok(lagging.problems.some((p) => /the plugin manifest says 0\.1\.17 and the tag says 0\.2\.0/u.test(p)));
});

test("a dev-only marker in the stable tree, and a missing back-merge, each refuse", () => {
  const withMarker = channelState({ ...promoted, devOnlyMarkers: ["DEV_ONLY.txt"] });
  assert.equal(withMarker.ok, false);
  assert.ok(withMarker.problems.some((p) => p.includes("DEV_ONLY.txt")));

  // Back-merge is the only condition about what happens AFTER a release: dev must contain main, or
  // the next integration work starts from a tree the release is not in.
  assert.equal(channelState({ ...promoted, backMerged: false }).ok, false);
  assert.equal(channelState({ ...promoted, backMerged: true }).ok, true);
  // Not yet asked is not a failure.
  assert.equal(channelState({ ...promoted, backMerged: null }).ok, true);
});

test("the verdict is reproducible and carries a digest of what it decided from", () => {
  const allDone = Object.fromEntries(Object.values(RELEASE_GATES).flat().map((issue) => [issue, "done"]));
  const once = promotionVerdict({ planStatuses: allDone, channel: promoted });
  const twice = promotionVerdict({ planStatuses: allDone, channel: promoted });
  assert.equal(once.schema_id, RELEASE_CHANNEL_SCHEMA);
  assert.equal(once.digest, twice.digest);
  assert.match(once.digest, /^sha256:[0-9a-f]{64}$/u);
  // A different decision is a different digest, so a recorded verdict cannot be reused for a
  // repository it was not computed from.
  assert.notEqual(once.digest, promotionVerdict({ planStatuses: allDone, channel: { ...promoted, defaultBranch: "dev" } }).digest);
});

test("the shipped plan is what the gates are actually measured against", () => {
  // Measured, not asserted: this is the repository's own state today. It is allowed to be
  // incomplete -- the point is that the matrix is computed from the plan rather than from a
  // hand-kept list that drifts from it.
  const verdict = promotionVerdict({ planStatuses: planStatuses(), channel: promoted });
  const waiting = verdict.gates.flatMap((row) => row.waiting);
  for (const issue of waiting) {
    assert.notEqual(planStatuses()[issue], "done", `#${issue} is waiting but the plan says done`);
  }
  assert.equal(verdict.promote, waiting.length === 0, "the verdict and the matrix disagree");
});
