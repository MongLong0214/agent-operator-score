import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

import { writeJson } from "../../lib/core.mjs";
import { exposureLedgerTestHooks } from "../../lib/cli.mjs";
import { classifyAdministration, markRevealed, openExposureLedger, recordExposure, reserveExposure } from "../../lib/form-class.mjs";
import { exposureLedgerPath, readEvents, readExposureLedgerFile, runPaths } from "../../lib/store.mjs";
import { addAgent, assessAtATerminal, initBare, makePlan, newestRunId, run } from "./helpers.mjs";
import { finalizeExposure, signExposureFinalization } from "../../lib/exposure-finalization.mjs";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const fixture = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-finalization-"));
  initBare(cwd);
  addAgent(cwd, "solo");
  return { cwd, home: join(cwd, ".aos"), plan: makePlan(cwd, { default: "solo" }) };
};
const clean = (cwd) => {
  exposureLedgerTestHooks.afterReserve = null;
  exposureLedgerTestHooks.afterReveal = null;
  rmSync(cwd, { recursive: true, force: true });
};

test("a graded administration survives a held finalize lock and replays on the next ledger open", async () => {
  const { cwd, home, plan } = fixture();
  const lock = join(home, "exposure-ledger.lock");
  try {
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    const before = openExposureLedger(json(exposureLedgerPath(home)));
    assert.equal(before.entries[0].state, "REVEALED");
    assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), true, "the scored run must be durable before competing for the finalize lock");
    assert.equal(existsSync(runPaths(home, runId).terminal), false, "contention must not commit an INTERNAL_ERROR over the scored run");
    rmSync(lock);
    const recovered = openExposureLedger(readExposureLedgerFile(home));
    assert.equal(recovered.entries[0].state, "TERMINAL");
    assert.equal(recovered.revision, before.revision + 1);
    assert.equal(json(runPaths(home, runId).result).run.run_id, runId);
    assert.notEqual(json(runPaths(home, runId).terminal).status, "INTERNAL_ERROR");
    assert.deepEqual(openExposureLedger(readExposureLedgerFile(home)), recovered, "reopening must not consume another revision");
    assert.equal(readdirSync(home).filter((name) => /^exposure-pending-.*\.json$/u.test(name)).length, 0);
  } finally { clean(cwd); }
});

test("verify uses the classifier when a sibling reveals after this administration reserved", async () => {
  const { cwd, home, plan } = fixture();
  try {
    exposureLedgerTestHooks.afterReserve = () => {
      const ledger = openExposureLedger(json(exposureLedgerPath(home)));
      const entry = ledger.entries[0];
      assert.equal(entry.prior_exposure_count, 0);
      writeJson(exposureLedgerPath(home), reserveExposure(ledger, {
        ...entry, administration_id: "run-sibling", run_id: "run-sibling", occurred_at: new Date().toISOString()
      }).ledger);
    };
    exposureLedgerTestHooks.afterReveal = () => {
      const ledger = markRevealed(json(exposureLedgerPath(home)), { administration_id: "run-sibling" }).ledger;
      const sibling = ledger.entries.find((entry) => entry.administration_id === "run-sibling");
      writeJson(exposureLedgerPath(home), recordExposure(ledger, { ...sibling, occurred_at: new Date().toISOString() }).ledger);
    };
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    const ledger = openExposureLedger(readExposureLedgerFile(home));
    const entry = ledger.entries.find((row) => row.administration_id === runId);
    assert.equal(entry.prior_exposure_count, 0, "reservation-time inputs do not see the later reveal");
    assert.equal(classifyAdministration(ledger, entry).official_scoring_permitted, false);
    assert.equal(json(runPaths(home, runId).terminal).status, "PRACTICE");
    const report = JSON.parse(run(cwd, ["verify", "--run", runId, "--json"], 0).stdout);
    assert.equal(report.checks.find((check) => check.check === "recompute").decision, true);
  } finally { clean(cwd); }
});

const completion = () => {
  const keys = generateKeyPairSync("ed25519");
  const identity = {
    form_id: "form-fixture", form_contract_digest: `sha256:${"a".repeat(64)}`,
    declared_class: "OPERATIONAL", administration_id: "run-target", run_id: "run-target",
    occurred_at: "2026-09-08T00:00:00.000Z", cycle_id: "cycle-fixture",
    terminal_public_key: keys.publicKey.export({ type: "spki", format: "pem" })
  };
  const ledger = markRevealed(reserveExposure(undefined, identity).ledger, {
    administration_id: identity.administration_id, occurred_at: identity.occurred_at
  }).ledger;
  const payload = {
    schema_id: "aos-exposure-finalization.v1", administration_id: identity.administration_id,
    form_contract_digest: identity.form_contract_digest, occurred_at: "2026-09-08T00:01:00.000Z",
    safety: "S0", duration_ms: 60000, record: { run_id: identity.run_id },
    result: { run: { run_id: identity.run_id }, aos_composite: { issued: true, value: 73 } }
  };
  return { keys, identity, ledger, payload, pending: signExposureFinalization(payload, keys.privateKey) };
};

test("pending replay preserves the chain and changes only the exact administration", () => {
  const { identity, ledger, pending } = completion();
  const siblings = reserveExposure(ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger;
  const completed = finalizeExposure(siblings, pending, identity.administration_id);
  assert.equal(openExposureLedger(completed.ledger).revision, siblings.revision + 1);
  assert.equal(completed.ledger.entries[0].state, "TERMINAL");
  assert.equal(completed.ledger.entries[0].score, 73);
  const { chain_digest: beforeChain, ...before } = siblings.entries[1];
  const { chain_digest: afterChain, ...after } = completed.ledger.entries[1];
  assert.notEqual(beforeChain, afterChain, "an earlier transition must rechain its following siblings");
  assert.deepEqual(after, before, "no sibling's state, identity or revision may change");
});

test("replaying a committed pending completion is byte-identical even after a sibling reveals", () => {
  const { identity, ledger, pending } = completion();
  const first = finalizeExposure(ledger, pending, identity.administration_id);
  const siblings = markRevealed(reserveExposure(first.ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger,
    { administration_id: "run-sibling" }).ledger;
  const repeated = finalizeExposure(siblings, pending, identity.administration_id);
  assert.deepEqual(repeated.ledger, siblings);
  assert.deepEqual(repeated.result, first.result);
  assert.deepEqual(repeated.terminal, first.terminal);
  assert.deepEqual(repeated.record, first.record);
});

test("a pending artifact cannot replace the public key pinned in its reservation", () => {
  const { identity, ledger, payload, pending } = completion();
  assert.equal(finalizeExposure(ledger, pending, identity.administration_id).ledger.entries[0].state, "TERMINAL");
  const outsider = generateKeyPairSync("ed25519");
  const forged = signExposureFinalization(payload, outsider.privateKey);
  forged.public_key = outsider.publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => finalizeExposure(ledger, forged, identity.administration_id), /AOS_EXPOSURE_PENDING_SIGNATURE/);
});

test("an authenticated pending payload still cannot target a different administration", () => {
  const { identity, ledger, payload, keys } = completion();
  // Use the accepted producer key deliberately, so this witness cannot die at signature checking.
  const wrongId = signExposureFinalization({ ...payload, administration_id: "run-other" }, keys.privateKey);
  assert.throws(() => finalizeExposure(ledger, wrongId, identity.administration_id), /AOS_EXPOSURE_PENDING_IDENTITY/);
});

test("a different signed completion cannot replace an already committed terminal receipt", () => {
  const { identity, ledger, pending, payload, keys } = completion();
  const first = finalizeExposure(ledger, pending, identity.administration_id);
  const changed = signExposureFinalization({ ...payload, duration_ms: 90000 }, keys.privateKey);
  assert.throws(() => finalizeExposure(first.ledger, changed, identity.administration_id), /AOS_EXPOSURE_PENDING_CONFLICT/);
});

test("pending replay derives withholding from current ledger exposure instead of payload permission", () => {
  const { identity, ledger, payload, keys } = completion();
  const siblings = markRevealed(reserveExposure(ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger,
    { administration_id: "run-sibling" }).ledger;
  const pending = signExposureFinalization({ ...payload, official_scoring_permitted: true }, keys.privateKey);
  const completed = finalizeExposure(siblings, pending, identity.administration_id);
  assert.equal(completed.terminal.status, "PRACTICE");
  assert.equal(completed.ledger.entries[0].scored, false);
  assert.equal(completed.result.aos_composite.issued, false);
  assert.match(completed.record.practice_withholding.reason, /AOS_FORM_EXPOSED_WITHOUT_TERMINAL/);
});

test("an unrecognised signed pending schema cannot be replayed", () => {
  const { identity, ledger, payload, keys } = completion();
  const pending = signExposureFinalization({ ...payload, schema_id: "future-completion" }, keys.privateKey);
  assert.throws(() => finalizeExposure(ledger, pending, identity.administration_id), /AOS_EXPOSURE_PENDING_SCHEMA/);
});

test("process death before during and after the pending write preserves exposure and recovers only committed completions", () => {
  for (const stage of ["before", "during", "pending", "ledger", "result", "event", "terminal"]) {
    const { cwd, home, plan } = fixture();
    try {
      const killed = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
        stage, "assess", "--plan", plan, "--seed", "5"], {
        cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
      });
      assert.equal(killed.signal, "SIGKILL", `${stage}: ${killed.stdout}\n${killed.stderr}`);
      const runId = newestRunId(cwd);
      const before = openExposureLedger(json(exposureLedgerPath(home)));
      const wasCommitted = !["before", "during"].includes(stage);
      assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), wasCommitted, stage);
      // A new process opens the home, not an in-memory object carrying the signing key.
      const reopened = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
        "recover", "session", "list", "--json"], {
        cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
      });
      assert.equal(reopened.status, 0, `${stage}: ${reopened.stderr}`);
      const after = openExposureLedger(json(exposureLedgerPath(home)));
      if (wasCommitted) {
        assert.equal(after.entries[0].state, "TERMINAL", stage);
        const result = json(runPaths(home, runId).result);
        assert.equal(result.run.run_id, runId);
        assert.equal(typeof result.aos_composite, "object");
        const terminal = json(runPaths(home, runId).terminal);
        assert.equal(terminal.status, "INCOMPLETE");
        assert.equal(readEvents(home, runId).filter((event) => event.event_type === "assessment.ended").length, 1);
        const bytes = readFileSync(exposureLedgerPath(home), "utf8");
        run(cwd, ["session", "recover", runId]);
        assert.equal(readFileSync(exposureLedgerPath(home), "utf8"), bytes, stage);
        assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), false);
      } else {
        assert.deepEqual(after, before, stage);
        assert.equal(after.entries[0].state, "REVEALED");
        assert.equal(existsSync(runPaths(home, runId).result), false);
        const refusal = classifyAdministration(after, { ...after.entries[0], administration_id: "run-next" });
        assert.equal(refusal.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
      }
    } finally { clean(cwd); }
  }
});

test("an error after the pending rename cannot overwrite the scored completion with an internal error", () => {
  const { cwd, home, plan } = fixture();
  try {
    const interrupted = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
      "write-error", "assess", "--plan", plan, "--seed", "5"], {
      cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
    });
    assert.match(interrupted.stderr, /injected pending directory fsync failure/);
    const runId = newestRunId(cwd);
    assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), true);
    assert.equal(existsSync(runPaths(home, runId).result), false, "the error path must preserve the scored journal without publishing a diagnostic over it");
    assert.equal(existsSync(runPaths(home, runId).terminal), false);
    const recovered = openExposureLedger(readExposureLedgerFile(home));
    assert.equal(recovered.entries[0].state, "TERMINAL");
    assert.notEqual(json(runPaths(home, runId).terminal).status, "INTERNAL_ERROR");
  } finally { clean(cwd); }
});

test("the completion producer signs its measured working record without rereading a replaced file", () => {
  const { cwd, home, plan } = fixture();
  try {
    const assessed = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
      "record-change", "assess", "--plan", plan, "--seed", "5"], {
      cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
    });
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    assert.equal(json(runPaths(home, runId).record).run_id, runId);
    assert.equal(json(runPaths(home, runId).terminal).status, "INCOMPLETE");
  } finally { clean(cwd); }
});
