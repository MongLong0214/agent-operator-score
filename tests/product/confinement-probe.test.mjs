import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

// The Phase-0 evidence for #556 is a document a person reads, a record a machine reads, and the raw
// output of every probe run that produced them. All three have to agree, and none of them is
// checked by anything else in the suite.
//
// The failure this file exists to prevent is specific. A support matrix earns the word OFFICIAL by
// naming a boundary that was measured. A row that says `denied` because nobody looked reads exactly
// like a row that says `denied` because the kernel refused, and the first one is how a lane nobody
// tested ends up carrying a released score.
//
// A first version of this file only required an observed row to carry non-empty command and probe
// strings. A reviewer defeated it in one edit: they changed an unobserved bubblewrap row to
// `denied`, typed plausible strings into it, recomputed the self-digest, and the validator returned
// nothing. The rule that closes that is below and it is the load-bearing one -- an observed row
// names the artefact it came from, and the outcome recorded in the row has to be the outcome
// sitting in that artefact. Inventing a row now means inventing a consistent raw run to go with it.
//
// Silence is still never coverage: an unrun probe is `not_observed`, it says why, and it can never
// sit under a backend the record calls supported.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const CONFINEMENT = join(root, "fixtures", "confinement");
const RECORD_PATH = join(CONFINEMENT, "probe.json");
const DOC_PATH = join(root, "docs", "STRICT_CONFINEMENT_FEASIBILITY.md");

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const doc = readFileSync(DOC_PATH, "utf8");

const sha = (text) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
const artefactPath = (relative) => join(CONFINEMENT, relative);
const readArtefact = (relative) => JSON.parse(readFileSync(artefactPath(relative), "utf8"));

const BOOLEAN_GATE_FIELDS = [
  "filesystem_enforced",
  "process_enforced",
  "setup_verified",
  "authenticated_runtime",
  "cleanup_verified"
];

/**
 * Every rule the record has to satisfy, returned as a list of complaints rather than thrown one at
 * a time. Written as a function over a parsed record so the negative tests below can feed it a
 * deliberately broken copy: a validator that has only ever seen valid input is no evidence that it
 * would reject invalid input.
 *
 * `resolve` reads a raw artefact. The negative tests override it to stage an artefact that does not
 * back its row without writing anything to disk.
 */
const violations = (candidate, resolve = readArtefact) => {
  const problems = [];
  const complain = (message) => problems.push(message);

  if (candidate.schema !== "aos-confinement-probe.v2") complain(`unknown schema ${candidate.schema}`);
  if (candidate.code_integration_allowed !== false) complain("the feasibility phase forbids code integration");

  const propertyIds = candidate.properties.map((one) => one.id);
  if (new Set(propertyIds).size !== propertyIds.length) complain("duplicate property id");

  // An observed row has to be readable back out of a committed run. This is the check that makes a
  // fabricated row expensive rather than free.
  const checkEvidence = (where, row, expected) => {
    if (!row.evidence) { complain(`${where}: ${row.observed} with no evidence`); return; }
    let artefact;
    try { artefact = resolve(row.evidence.file); }
    catch { complain(`${where}: evidence ${row.evidence.file} cannot be read`); return; }
    const captured = artefact.captured?.[row.evidence.key];
    if (captured === undefined || captured === null) {
      complain(`${where}: evidence ${row.evidence.file} has no ${row.evidence.key}`);
      return;
    }
    if (captured.outcome !== expected) {
      complain(`${where}: recorded ${expected} but ${row.evidence.file} says ${captured.outcome}`);
    }
    if (row.command !== artefact.command) {
      complain(`${where}: command does not match the one recorded in ${row.evidence.file}`);
    }
    if (row.errno !== (captured.errno ?? null)) {
      complain(`${where}: errno ${row.errno} does not match ${captured.errno ?? null} in ${row.evidence.file}`);
    }
  };

  for (const backend of candidate.backends) {
    const where = `backend ${backend.id}`;
    if (!candidate.support_vocabulary.includes(backend.support_status)) {
      complain(`${where}: support_status ${backend.support_status} is outside the vocabulary`);
    }

    const covered = backend.observations.map((one) => one.property);
    if (new Set(covered).size !== covered.length) complain(`${where}: the same property is observed twice`);
    for (const id of propertyIds) {
      if (!covered.includes(id)) complain(`${where}: property ${id} has no observation`);
    }
    for (const id of covered) {
      if (!propertyIds.includes(id)) complain(`${where}: observes ${id}, which is not a declared property`);
    }

    const anyObserved = backend.observations.some((one) => one.observed !== "not_observed");
    if (anyObserved && backend.available !== true) {
      // A backend the record says is absent, or whose presence was never established, cannot also
      // have measurements. One of the two statements is wrong and the record must not carry both.
      complain(`${where}: available=${backend.available} but carries observed rows`);
    }

    for (const observation of backend.observations) {
      const row = `${where}, ${observation.property}`;
      if (!candidate.outcome_vocabulary.includes(observation.observed)) {
        complain(`${row}: ${observation.observed} is outside the outcome vocabulary`);
      }
      if (observation.observed === "not_observed") {
        if (observation.command !== null) complain(`${row}: not_observed but names a command`);
        if (observation.enforcement !== null) complain(`${row}: not_observed but claims enforcement`);
        if (observation.evidence) complain(`${row}: not_observed but names evidence`);
        if (!observation.reason) complain(`${row}: not_observed without a reason`);
      } else {
        if (!observation.command) complain(`${row}: ${observation.observed} without the command that produced it`);
        if (!candidate.enforcement_vocabulary.includes(observation.enforcement)) {
          complain(`${row}: enforcement ${observation.enforcement} is outside the vocabulary`);
        }
        checkEvidence(row, observation, observation.observed);
      }
      if (observation.observed === "denied" && (observation.enforcement === "none" || observation.enforcement === "unknown")) {
        // Something refused it, and the record has to say what. "Denied by nothing" is the shape a
        // moved path takes when it is written up as a boundary.
        complain(`${row}: denied but nothing is named as enforcing it`);
      }
    }

    const gate = backend.strict_gate;
    for (const field of BOOLEAN_GATE_FIELDS) {
      if (!(field in gate)) complain(`${where}: issuance gate is missing ${field}`);
      const value = gate[field];
      if (value !== true && value !== false && value !== null) complain(`${where}: gate ${field} is ${value}`);
    }
    for (const field of backend.blocking_gate_fields) {
      if (!(field in gate)) complain(`${where}: blocks on ${field}, which is not a gate field`);
    }

    const supported = candidate.supported_release_set.includes(backend.support_status);
    if (supported) {
      for (const field of BOOLEAN_GATE_FIELDS) {
        if (gate[field] !== true) complain(`${where}: called ${backend.support_status} with ${field}=${gate[field]}`);
      }
      if (gate.boundary_canary !== "PASS") {
        complain(`${where}: called ${backend.support_status} with boundary_canary=${gate.boundary_canary}`);
      }
      const unmeasured = backend.observations.filter((one) => one.observed === "not_observed");
      if (unmeasured.length > 0) {
        complain(`${where}: called ${backend.support_status} with ${unmeasured.length} unobserved properties`);
      }
      if (backend.blocking_gate_fields.length > 0) {
        complain(`${where}: called ${backend.support_status} while naming blocking gate fields`);
      }
    } else if (backend.support_status === "BLOCKED" && backend.blocking_gate_fields.length === 0) {
      complain(`${where}: BLOCKED without naming what blocks it`);
    }
  }

  // The authentication cells are the part an earlier draft got wrong, so they carry the same rule:
  // a verdict is read back out of the run that produced it.
  for (const cell of candidate.authentication_cells) {
    const where = `auth cell ${cell.id}/${cell.runtime}`;
    if (!candidate.outcome_vocabulary.includes(cell.observed)) {
      complain(`${where}: ${cell.observed} is outside the outcome vocabulary`);
    }
    if (cell.observed === "not_observed") { complain(`${where}: an auth cell with no run should not be listed`); continue; }
    let artefact;
    try { artefact = resolve(cell.evidence.file); }
    catch { complain(`${where}: evidence ${cell.evidence.file} cannot be read`); continue; }
    if (artefact.exit_status !== cell.exit_status) {
      complain(`${where}: exit ${cell.exit_status} but ${cell.evidence.file} recorded ${artefact.exit_status}`);
    }
    if (artefact.command !== cell.command) complain(`${where}: command does not match ${cell.evidence.file}`);
    // Re-derived from the recorded output rather than trusted. `allowed` has to be visible in what
    // the runtime actually printed.
    const text = `${artefact.stdout_excerpt ?? ""}${artefact.stderr_excerpt ?? ""}`;
    const looksLoggedIn = /Logged in using/.test(text) || /"loggedIn":\s*true/.test(text);
    if (cell.observed === "allowed" && !looksLoggedIn) {
      complain(`${where}: recorded allowed but ${cell.evidence.file} does not show a logged-in runtime`);
    }
    if (cell.observed === "denied" && looksLoggedIn) {
      complain(`${where}: recorded denied but ${cell.evidence.file} shows a logged-in runtime`);
    }
  }

  const stated = candidate.evidence_digest;
  const recomputed = sha(JSON.stringify({
    host: candidate.host,
    properties: candidate.properties,
    backends: candidate.backends,
    authentication_cells: candidate.authentication_cells,
    process_axis: candidate.process_axis
  }));
  if (stated !== recomputed) complain(`evidence_digest ${stated} does not describe this record`);

  return problems;
};

const copy = () => JSON.parse(JSON.stringify(record));

// The document's matrix, parsed back into the same shape as the record, so the two can be compared
// row by row rather than by heading.
const documentedMatrix = () => {
  const matrix = doc.slice(doc.indexOf("\n## Matrix"));
  const sections = matrix.split(/^### /m).slice(1);
  const parsed = new Map();
  for (const section of sections) {
    const id = section.slice(0, section.indexOf("\n")).trim();
    // Every column, not the first four. The earlier form read property, outcome, enforcement and
    // errno and ignored the rest, so a row could cite the wrong raw artefact, the wrong command or a
    // note the record never made and still match. The Cmd letter resolves through the section's own
    // legend so what is compared is the command, not the letter.
    const legend = new Map(
      [...section.matchAll(/^([A-Z])  (.+)$/gm)].map((match) => [match[1], match[2].trim()])
    );
    const rows = [...section.matchAll(/^\| `([a-z_]+)` \| (\w+) \| ([\w-]+|--) \| (\S+) \| ([A-Z]|--) \| (?:`([^`]+)`|--) \| ([^|]*) \|/gm)];
    parsed.set(id, { text: section, rows: rows.map((match) => ({
      property: match[1],
      observed: match[2],
      enforcement: match[3] === "--" ? null : match[3],
      errno: match[4] === "--" ? null : match[4],
      command: match[5] === "--" ? null : (legend.get(match[5]) ?? `unknown legend letter ${match[5]}`),
      raw: match[6] ?? null,
      note: match[7].trim() === "" || match[7].trim() === "--" ? null : match[7].trim()
    })) });
  }
  return parsed;
};

test("the confinement probe record parses and satisfies every rule it declares", () => {
  assert.deepEqual(violations(record), []);
});

test("every observed row is backed by a committed raw run that says the same thing", () => {
  // The positive form of the rule the negative tests below exercise. Stated separately because it
  // is the difference between a matrix and a list of assertions.
  let checked = 0;
  for (const backend of record.backends) {
    for (const observation of backend.observations) {
      if (observation.observed === "not_observed") continue;
      assert.ok(existsSync(artefactPath(observation.evidence.file)),
        `${backend.id}/${observation.property}: ${observation.evidence.file} is missing`);
      const captured = readArtefact(observation.evidence.file).captured[observation.evidence.key];
      assert.equal(captured.outcome, observation.observed,
        `${backend.id}/${observation.property} disagrees with its raw run`);
      checked += 1;
    }
  }
  assert.ok(checked > 60, `expected the matrix to be mostly measured, only ${checked} rows were`);
});

test("each raw run whose captured stdout is JSON parses to the result it recorded", () => {
  // Forging a row now means forging the run behind it. This raises that price again: an artefact's
  // parsed result has to be what its recorded stdout actually parses to, so a fabricated run cannot
  // just assert a captured outcome next to unrelated output. It reaches the artefacts whose stdout
  // is a JSON document -- the probe programs' own output. Runs that captured a ps line, a shell
  // status or a tool's banner are checked for presence and outcome above, not re-parsed here, and
  // the count below says how many this test actually read.
  const files = new Set();
  for (const backend of record.backends) {
    for (const observation of backend.observations) {
      if (observation.evidence) files.add(observation.evidence.file);
    }
  }
  assert.ok(files.size > 0);
  let reparsedFiles = 0;
  for (const file of files) {
    const artefact = readArtefact(file);
    if (artefact.parse_error !== null || artefact.captured === null) continue;
    let reparsed;
    try { reparsed = JSON.parse(artefact.stdout_excerpt); }
    catch { continue; }
    assert.deepEqual(artefact.captured, reparsed,
      `${file}: the parsed result is not what its recorded stdout parses to`);
    reparsedFiles += 1;
  }
  assert.ok(reparsedFiles >= 18, `expected the probe programs' runs to be re-parsed, only ${reparsedFiles} were`);
});

test("the probe programs printed in the document are the committed ones", () => {
  const printed = [...doc.matchAll(/```javascript\n([\s\S]*?)```/g)].map((match) => match[1].trimEnd());
  assert.ok(printed.length >= 7, `expected every probe to be printed, found ${printed.length}`);
  const names = ["probe.mjs", "auth-probe.mjs", "descendant-probe.mjs", "child-probe.mjs", "leak-probe.mjs", "setsid-probe.mjs", "pg-check.mjs"];
  for (const name of names) {
    const source = readFileSync(join(CONFINEMENT, "probes", name), "utf8").trimEnd();
    assert.ok(printed.includes(source), `${name} is not printed in the document, or is printed differently from the committed file`);
  }
});

test("the record covers every backend the feasibility document claims, and no others", () => {
  const documented = [...documentedMatrix().keys()];
  assert.ok(documented.length > 0, "the document has no backend sections");
  assert.deepEqual(
    documented.slice().sort(),
    record.backends.map((one) => one.id).sort(),
    "the document and the record disagree about which backends were probed"
  );
});

test("every matrix row in the document matches the record row it renders", () => {
  // The earlier version of this test compared headings only, which let the two disagree about every
  // result they contained while still passing.
  const documented = documentedMatrix();
  for (const backend of record.backends) {
    const section = documented.get(backend.id);
    assert.ok(section, `${backend.id} has no table in the document`);
    const { rows, text } = section;
    assert.equal(rows.length, backend.observations.length, `${backend.id}: the document renders a different number of rows`);
    for (const [index, row] of rows.entries()) {
      const source = backend.observations[index];
      // A row that was not observed carries a `reason` instead of a `note`. The document renders it
      // in the Note column when one row was skipped, and once in the section's prose when the whole
      // backend was; either way the words must be the record's, or the document is explaining a gap
      // in terms the record never used.
      const reason = source.observed === "not_observed" ? source.reason ?? null : null;
      const explainedInProse = reason !== null && row.note === null && text.includes(reason);
      assert.deepEqual(
        { property: row.property, observed: row.observed, enforcement: row.enforcement, errno: row.errno, command: row.command, raw: row.raw, note: row.note },
        {
          property: source.property,
          observed: source.observed,
          enforcement: source.enforcement,
          errno: source.errno,
          command: source.command ?? null,
          raw: source.evidence ? basename(source.evidence.file) : null,
          note: source.note ?? (explainedInProse ? null : reason)
        },
        `${backend.id}/${source.property}: the document and the record disagree`
      );
    }
  }
});

test("the document states the digest of the record it describes", () => {
  assert.ok(doc.includes(record.evidence_digest),
    "the document does not carry the record's evidence digest, so the two can drift apart unnoticed");
});

test("the sandbox profiles printed in the document are the ones the record digested", () => {
  const printed = [...doc.matchAll(/```scheme\n([\s\S]*?)```/g)].map((match) => sha(match[1].trimEnd() + "\n"));
  assert.equal(printed.length, 3, "expected the three macOS profiles to be printed in full");
  const digested = record.backends.filter((one) => one.policy_digest !== null).map((one) => one.policy_digest);
  assert.equal(digested.length, 3);
  for (const digest of digested) {
    assert.ok(printed.includes(digest), `policy_digest ${digest} matches no profile printed in the document`);
  }
});

test("no backend is called supported on this stack", () => {
  // Not a style rule. The issue's completion condition needs one real runtime lane and Phase 0 found
  // none; if a later edit promotes a backend without new observations behind it, this says so.
  const supported = record.backends.filter((one) => record.supported_release_set.includes(one.support_status));
  assert.deepEqual(supported.map((one) => one.id), []);
});

test("a fabricated row is rejected because no raw run backs it", () => {
  // The edit that defeated the first version of this file: an unobserved backend's row promoted to
  // a measured denial, with plausible strings typed in and the digest recomputed.
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-bubblewrap");
  backend.available = true;
  const row = backend.observations.find((one) => one.property === "read_workspace_parent");
  delete row.reason;
  Object.assign(row, {
    observed: "denied",
    enforcement: "kernel",
    errno: "EPERM",
    command: "cd @WORKSPACE@ && bwrap --ro-bind / / node fixtures/confinement/probes/probe.mjs",
    evidence: { file: "observations/linux-bubblewrap.filesystem.json", key: "read_workspace_parent" },
    note: null
  });
  broken.evidence_digest = sha(JSON.stringify({
    host: broken.host, properties: broken.properties, backends: broken.backends,
    authentication_cells: broken.authentication_cells, process_axis: broken.process_axis
  }));
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("cannot be read")),
    `expected the missing raw run to be caught, got ${JSON.stringify(problems)}`);
});

test("a row whose raw run recorded a different outcome is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-provider-lane");
  const row = backend.observations.find((one) => one.property === "survive_cleanup_as_detached_descendant");
  row.observed = "denied";
  row.enforcement = "kernel";
  broken.evidence_digest = sha(JSON.stringify({
    host: broken.host, properties: broken.properties, backends: broken.backends,
    authentication_cells: broken.authentication_cells, process_axis: broken.process_axis
  }));
  assert.ok(violations(broken).some((one) => one.includes("but observations/") && one.includes("says allowed")));
});

test("an authentication cell that contradicts its recorded output is rejected", () => {
  const broken = copy();
  const cell = broken.authentication_cells.find((one) => one.id === "best-effort-cli" && one.runtime === "codex");
  cell.observed = "allowed";
  broken.evidence_digest = sha(JSON.stringify({
    host: broken.host, properties: broken.properties, backends: broken.backends,
    authentication_cells: broken.authentication_cells, process_axis: broken.process_axis
  }));
  assert.ok(violations(broken).some((one) => one.includes("does not show a logged-in runtime")));
});

test("an unrun probe recorded as a pass is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-landlock");
  const row = backend.observations.find((one) => one.property === "read_workspace_parent");
  row.observed = "denied";
  delete row.reason;
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("without the command that produced it")),
    `expected a missing-command complaint, got ${JSON.stringify(problems)}`);
});

test("a denial with nothing named as enforcing it is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-deny-default");
  backend.observations.find((one) => one.property === "read_operator_home_absolute").enforcement = "none";
  assert.ok(violations(broken).some((one) => one.includes("nothing is named as enforcing it")));
});

test("a backend that drops a property is rejected rather than silently under-covered", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-provider-lane");
  backend.observations = backend.observations.filter((one) => one.property !== "escape_via_symlink");
  assert.ok(violations(broken).some((one) => one.includes("escape_via_symlink has no observation")));
});

test("measurements under a backend the record says is absent are rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-container-vm");
  backend.available = false;
  assert.ok(violations(broken).some((one) => one.includes("available=false but carries observed rows")));
});

test("a supported verdict over an unobserved backend is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-bubblewrap");
  backend.support_status = "SUPPORTED";
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("unobserved properties")));
  assert.ok(problems.some((one) => one.includes("filesystem_enforced=null")));
});

test("a supported verdict over a failed boundary canary is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-provider-lane");
  backend.support_status = "SUPPORTED_WITH_CONSTRAINTS";
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("boundary_canary=FAIL")));
  assert.ok(problems.some((one) => one.includes("process_enforced=false")));
});

test("an edited record whose digest was not recomputed is rejected", () => {
  const broken = copy();
  broken.backends.find((one) => one.id === "best-effort-cli").strict_gate.filesystem_enforced = true;
  assert.ok(violations(broken).some((one) => one.includes("does not describe this record")));
});

test("the process-axis record is what its raw runs captured", () => {
  const axis = record.process_axis;
  const unconfined = axis.setsid_probes.find((one) => one.id === "setsid.none");
  assert.equal(unconfined.child_leads_own_process_group, true);
  for (const attempt of ["setsid.deny-syscall-by-name", "setsid.deny-syscall-by-number"]) {
    const probe = axis.setsid_probes.find((one) => one.id === attempt);
    assert.equal(probe.child_leads_own_process_group, true, `${attempt} was expected to fail to stop the escape`);
  }
  // Presence was all this checked before, and a record can name a file that says the opposite.
  // Each figure the document quotes is read back out of the run it cites.
  for (const probe of axis.setsid_probes) {
    const captured = readArtefact(probe.evidence.file).captured;
    assert.equal(captured[probe.evidence.key], probe.child_leads_own_process_group,
      `${probe.id}: the record disagrees with ${probe.evidence.file}`);
  }
  const enumeration = axis.aos_cleanup_enumeration;
  assert.equal(enumeration.detached_descendant_reported_by_processGroupMembers, false);
  assert.equal(enumeration.detached_descendant_alive_after_group_kill, true);
  assert.equal(enumeration.in_group_child_alive_after_group_kill, false);
  const run = readArtefact(enumeration.evidence.file).captured;
  assert.equal(run.group_kill, "sent", "the enumeration run did not actually send the group kill");
  assert.equal(run.before_cleanup.detached_descendant.reported, enumeration.detached_descendant_reported_by_processGroupMembers);
  assert.equal(run.before_cleanup.in_group_child.reported, enumeration.in_group_child_reported_by_processGroupMembers);
  assert.equal(run[enumeration.evidence.key].detached_descendant_alive, enumeration.detached_descendant_alive_after_group_kill);
  assert.equal(run[enumeration.evidence.key].in_group_child_alive, enumeration.in_group_child_alive_after_group_kill);
});

test("the record still says the feasibility phase forbade code integration", () => {
  assert.equal(record.issue, 556);
  assert.equal(record.phase, "feasibility-proof");
  assert.equal(record.code_integration_allowed, false);
});
