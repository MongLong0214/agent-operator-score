import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const temporary = (name) => mkdtempSync(join(tmpdir(), name));

const aosIn = (cwd, home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

const ledgerOf = (home) => {
  try { return JSON.parse(readFileSync(join(home, "cycle-abandoned.json"), "utf8")).cycles; }
  catch { return []; }
};

// #488. `cycle start --force` drew fresh seeds over the open cycle and the previous one -- its
// seeds and every run counted against them -- was gone. That is exactly the loop the cycle
// mechanism exists to prevent, reachable through a documented flag on the same command: open, see a
// low run, --force, start again. `cycle.mjs` refuses to discard a run for what it scored; nothing
// refused to discard the cycle holding it.
test("a cycle can be abandoned, but never made not to have happened", () => {
  const home = temporary("aos-abandon-");
  try {
    aosIn(home, home, ["agent", "add", "codex", "--command", "/usr/bin/true"]);
    const first = aosIn(home, home, ["cycle", "start", "--runs", "3"]);
    const openedId = first.stdout.match(/(cycle-[0-9a-f]+)/)[1];

    // Bare --force is refused now: the flag alone was the whole loop.
    const bare = aosIn(home, home, ["cycle", "start", "--runs", "3", "--force"]);
    assert.notEqual(bare.status, 0);
    assert.match(bare.stdout + bare.stderr, /AOS_CYCLE_ABANDON_REASON_REQUIRED/);
    assert.deepEqual(ledgerOf(home), []);

    // A one-word reason is not a reason.
    const thin = aosIn(home, home, ["cycle", "start", "--runs", "3", "--force", "--reason", "no"]);
    assert.notEqual(thin.status, 0);

    const forced = aosIn(home, home, ["cycle", "start", "--runs", "3", "--force", "--reason", "opened against the wrong profile"]);
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);

    const ledger = ledgerOf(home);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].cycle_id, openedId);
    assert.equal(ledger[0].reason, "opened against the wrong profile");
    // The seeds it was abandoned on are kept, so "these were not the seeds I wanted" is checkable.
    assert.equal(ledger[0].seeds.length, 3);
    assert.match(ledger[0].replaced_by, /^cycle-/);

    // And it is printed beside the score rather than filed away where nobody looks.
    const shown = aosIn(home, home, ["cycle"]);
    assert.match(shown.stdout, new RegExp(`abandoned earlier: ${openedId}`));
    assert.match(shown.stdout, /opened against the wrong profile/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a replacement that cannot be created abandons nothing", () => {
  // The first version of this fix recorded the abandonment before building the replacement, so a
  // bad --seed left the old cycle open *and* written into the abandoned ledger. The same cycle both
  // live and abandoned is a worse record than either.
  const home = temporary("aos-abandon-order-");
  try {
    aosIn(home, home, ["agent", "add", "codex", "--command", "/usr/bin/true"]);
    const opened = aosIn(home, home, ["cycle", "start", "--runs", "3"]);
    const openedId = opened.stdout.match(/(cycle-[0-9a-f]+)/)[1];

    const failed = aosIn(home, home, [
      "cycle", "start", "--runs", "3", "--force", "--reason", "trying to change the seeds",
      "--seed", "aaaa", "--seed", "bbbb"
    ]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /AOS_CYCLE_SEED_COUNT/);
    assert.deepEqual(ledgerOf(home), [], "the open cycle was recorded as abandoned and stayed open");
    assert.match(aosIn(home, home, ["cycle"]).stdout, new RegExp(openedId));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// #486. The note fired on the existence of the old file alone, so neither remedy it offered stopped
// it, and it printed on every command including `assess`. The only thing that silenced it was
// deleting a file the note never mentioned.
test("the legacy-store note stops when the operator does what it asks", () => {
  const project = temporary("aos-legacy-");
  const home = temporary("aos-legacy-home-");
  try {
    mkdirSync(join(project, ".aos"), { recursive: true });
    writeFileSync(join(project, ".aos", "agents.json"), JSON.stringify({ agents: { codex: {}, claude: {} } }));

    const before = aosIn(project, home, ["agent", "list"]);
    assert.match(before.stderr, /kept the store beside the project/);
    // It names the thing that actually removes it, which the old note never did.
    assert.match(before.stderr, new RegExp(`delete .*${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    aosIn(project, home, ["agent", "add", "codex", "--command", "/usr/bin/true"]);
    const after = aosIn(project, home, ["agent", "list"]);
    assert.doesNotMatch(after.stderr, /kept the store beside the project/, "re-adding the agents did not stop it");

    // And it is gone from every command, not only the one that was run.
    assert.doesNotMatch(aosIn(project, home, ["doctor"]).stderr, /kept the store beside the project/);
  } finally {
    for (const dir of [project, home]) rmSync(dir, { recursive: true, force: true });
  }
});
