import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as workspaceSkeleton from "./workspace-skeleton.test.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const {
  fixtureAdmissionSegment,
  fixtureAdmissionGlob,
  ticketDeclaredFixtureDirectories
} = workspaceSkeleton;

const issuesCatalog = JSON.parse(readFileSync(resolve(repositoryRoot, "docs/issues.json"), "utf8"));
const liveCatalogTicketPaths = issuesCatalog.tickets.map(({ ticket_path: path }) => path).sort();
const ticketPath = (id) => {
  const record = issuesCatalog.tickets.find((ticket) => ticket.id === id);
  assert.ok(record, `planning catalog omits ${id}`);
  return record.ticket_path;
};
const readLiveTicket = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const ticketText = (declaration) => [
  "# Fixture declaration",
  "",
  "## Exact ownership",
  `- ${declaration}`,
  "",
  "## Preconditions",
  ""
].join("\n");

const assertExported = (value, message) => assert.equal(typeof value, "function", message);
const census = (root, catalogTicketPaths, readTicket) =>
  ticketDeclaredFixtureDirectories({ root, catalogTicketPaths, readTicket });
const writeFixture = (root, path, contents = "fixture\n") => {
  const absolutePath = resolve(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  return absolutePath;
};
const withTempRoot = (body) => {
  const root = mkdtempSync(join(tmpdir(), "aos-fixture-admission-"));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const regularFilesBelow = (root, directory) => {
  const absoluteDirectory = resolve(root, directory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory).sort().flatMap((entry) => {
    const absolutePath = join(absoluteDirectory, entry);
    const info = lstatSync(absolutePath);
    const path = relative(root, absolutePath).replaceAll("\\", "/");
    if (info.isSymbolicLink()) return [];
    if (info.isDirectory()) return regularFilesBelow(root, path);
    return info.isFile() ? [path] : [];
  });
};
const fixtureFiles = (root, directory, names) => names.map((name) => writeFixture(root, `${directory}/${name}`));
const assertNoMalformedTickets = (result) => assert.deepEqual(result.malformed, []);
const operationalStatePath = ticketPath("D0-004");
const d0011Path = ticketPath("D0-011");
const ownershipFragment = "fixtures/operational-state/**";

const overlayWithoutOwnedFragment = (path, text, fragment) => {
  if (path !== operationalStatePath) return text;
  const heading = "## Exact ownership";
  const start = text.indexOf(heading);
  assert.ok(start >= 0, "D0-004 Exact ownership section is missing");
  const afterHeading = start + heading.length;
  const rest = text.slice(afterHeading);
  const nextHeading = rest.search(/^## /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  assert.ok(section.includes(fragment), "D0-004 declaration is absent from live corpus");
  const rewritten = section.replaceAll(`\`${fragment}\``, "").replaceAll(fragment, "");
  return `${text.slice(0, afterHeading)}${rewritten}${nextHeading === -1 ? "" : rest.slice(nextHeading)}`;
};

test("ticket-declared-operational-state-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/operational-state/** is not ticket-derived";
  assertExported(ticketDeclaredFixtureDirectories, message);

  const expected = regularFilesBelow(repositoryRoot, "fixtures/operational-state");
  assert.ok(expected.length > 0, "live operational-state fixture corpus is empty");
  const admitted = census(repositoryRoot, liveCatalogTicketPaths, readLiveTicket);
  assert.deepEqual(
    admitted.admitted.filter((path) => path.startsWith("fixtures/operational-state/")),
    expected,
    message
  );
  assertNoMalformedTickets(admitted);

  let sawReference = false;
  const withoutD004Declaration = census(repositoryRoot, liveCatalogTicketPaths, (path) => {
    const text = readLiveTicket(path);
    if (path === d0011Path) sawReference = text.includes(ownershipFragment);
    return overlayWithoutOwnedFragment(path, text, ownershipFragment);
  });
  assert.equal(sawReference, true, message);
  assert.equal(
    withoutD004Declaration.admitted.some((path) => path.startsWith("fixtures/operational-state/")),
    false,
    message
  );
});

test("fixture-reference-does-not-admit", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; reference exclusion is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  const d0011Text = readLiveTicket(d0011Path);
  assert.ok(d0011Text.includes(ownershipFragment), "D0-011 reference is absent from live corpus");
  let sawReference = false;
  const result = census(repositoryRoot, liveCatalogTicketPaths, (path) => {
    const text = readLiveTicket(path);
    if (path === d0011Path) sawReference = text.includes(ownershipFragment);
    return overlayWithoutOwnedFragment(path, text, ownershipFragment);
  });
  assert.equal(sawReference, true, message);
  assert.equal(
    result.admitted.some((path) => path.startsWith("fixtures/operational-state/")),
    false,
    message
  );
});

test("ticket-declared-doctor-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/doctor/*.json was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/doctor", ["capabilities.json"]);
    const result = census(root, [ticketPath("E0B-003")], readLiveTicket);
    assert.deepEqual(result.admitted, ["fixtures/doctor/capabilities.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("ticket-declared-effective-state-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/governance/effective-state/** was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/governance/effective-state", ["state.json", "nested/record.json"]);
    const result = census(root, [ticketPath("D0-006")], readLiveTicket);
    assert.deepEqual(result.admitted, [
      "fixtures/governance/effective-state/nested/record.json",
      "fixtures/governance/effective-state/state.json"
    ], message);
    assertNoMalformedTickets(result);
  });
});

test("ticket-declared-artifact-manifest-v3-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/governance/artifact-manifest-v3/** was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/governance/artifact-manifest-v3", ["manifest.json"]);
    const result = census(root, [ticketPath("D0-007")], readLiveTicket);
    assert.deepEqual(result.admitted, ["fixtures/governance/artifact-manifest-v3/manifest.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("ticket-declared-github-acceptance-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/governance/github-acceptance/** was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/governance/github-acceptance", ["acceptance.json"]);
    const result = census(root, [ticketPath("D0-008")], readLiveTicket);
    assert.deepEqual(result.admitted, ["fixtures/governance/github-acceptance/acceptance.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("ticket-declared-authenticated-review-activation-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/governance/authenticated-review-activation/** was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/governance/authenticated-review-activation", ["activation.json"]);
    const result = census(root, [ticketPath("D0-009")], readLiveTicket);
    assert.deepEqual(result.admitted, ["fixtures/governance/authenticated-review-activation/activation.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("ticket-declared-absent-fixture-directory-is-not-admitted", () => {
  const message = "fixtureAdmissionGlob is not exported; absent-declaration rejection is unproven";
  assertExported(fixtureAdmissionGlob, message);
  assert.deepEqual(
    fixtureAdmissionGlob("fixtures/absent/**"),
    { directory: "fixtures/absent", predicate: "subtree" },
    message
  );

  withTempRoot((root) => {
    const result = census(root, ["docs/tickets/D0/absent.md"], () => ticketText("fixtures/absent/**"));
    assert.deepEqual(result.admitted, [], message);
    assertNoMalformedTickets(result);
  });
});

test("non-glob-fixture-declaration-is-not-admitted", () => {
  const message = "non-glob fixture declaration fixtures/operational-state was admitted";
  assertExported(fixtureAdmissionGlob, message);
  assert.equal(fixtureAdmissionGlob("fixtures/operational-state"), null, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/operational-state", ["must-not-admit.json"]);
    const result = census(root, ["docs/tickets/D0/non-glob.md"], () => ticketText("fixtures/operational-state"));
    assert.deepEqual(result.admitted, [], message);
    assertNoMalformedTickets(result);
  });
});

test("traversal-fixture-declaration-is-rejected", () => {
  const message = "fixtureAdmissionSegment is not exported; traversal rejection is unproven";
  assertExported(fixtureAdmissionSegment, message);
  assert.equal(fixtureAdmissionSegment("fixtures"), true, message);
  assert.equal(fixtureAdmissionSegment("."), false, message);
  assert.equal(fixtureAdmissionSegment(".."), false, message);
  assert.equal(fixtureAdmissionGlob("fixtures/../etc/*"), null, message);
  assert.equal(fixtureAdmissionGlob("fixtures/./audit/**"), null, message);
});

test("malformed-ticket-does-not-admit-or-abort-census", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; malformed-ticket handling is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/valid", ["admitted.json"]);
    const malformedPath = "docs/tickets/D0/malformed.md";
    const validPath = "docs/tickets/D0/valid.md";
    const readTicket = (path) => path === malformedPath ? null : ticketText("fixtures/valid/**");
    const result = census(root, [malformedPath, validPath], readTicket);
    const repeated = census(root, [malformedPath, validPath], readTicket);
    assert.deepEqual(result.admitted, ["fixtures/valid/admitted.json"], message);
    assert.deepEqual(result.malformed.map(({ path }) => path), [malformedPath], message);
    assert.equal(typeof result.malformed[0]?.reason, "string", message);
    assert.match(result.malformed[0].reason, /^[a-z][a-z0-9-]*$/, message);
    assert.deepEqual(repeated.malformed, result.malformed, message);
  });
});

test("outside-repository-symlinked-fixture-directory-is-not-admitted", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; outside-repository symlink rejection is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "aos-fixture-admission-outside-"));
    try {
      writeFixture(outside, "outside.json");
      mkdirSync(resolve(root, "fixtures"), { recursive: true });
      symlinkSync(outside, resolve(root, "fixtures/outside"), "dir");
      const result = census(root, ["docs/tickets/D0/outside.md"], () => ticketText("fixtures/outside/**"));
      assert.deepEqual(result.admitted, [], message);
      assertNoMalformedTickets(result);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("planning-catalog-ticket-corpus-is-exact", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; planning-catalog ticket corpus is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    const catalogPath = "docs/tickets/D0/catalog-listed.md";
    const lookalikePath = "docs/tickets/D0/not-listed.md";
    writeFixture(root, catalogPath, ticketText("fixtures/catalog-listed/**"));
    writeFixture(root, lookalikePath, ticketText("fixtures/not-listed/**"));
    fixtureFiles(root, "fixtures/catalog-listed", ["admitted.json"]);
    fixtureFiles(root, "fixtures/not-listed", ["must-not-admit.json"]);
    const reads = [];
    const result = census(root, [catalogPath], (path) => {
      reads.push(path);
      return readFileSync(resolve(root, path), "utf8");
    });
    assert.deepEqual(result.admitted, ["fixtures/catalog-listed/admitted.json"], message);
    assert.deepEqual(reads, [catalogPath], message);
    assertNoMalformedTickets(result);
  });
});

test("declared-file-predicate-refuses-nonmatching-file", () => {
  const message = "fixtureAdmissionGlob is not exported; file-predicate rejection is unproven";
  assertExported(fixtureAdmissionGlob, message);
  assert.deepEqual(
    fixtureAdmissionGlob("fixtures/doctor/*.json"),
    { directory: "fixtures/doctor", predicate: "json" },
    message
  );

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/doctor", ["declared.json", "not-declared.txt"]);
    const result = census(root, ["docs/tickets/D0/doctor.md"], () => ticketText("fixtures/doctor/*.json"));
    assert.deepEqual(result.admitted, ["fixtures/doctor/declared.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("absolute-fixture-declaration-is-rejected", () => {
  const message = "fixtureAdmissionGlob is not exported; absolute-path rejection is unproven";
  assertExported(fixtureAdmissionGlob, message);
  assert.equal(fixtureAdmissionGlob("/tmp/fixtures/doctor/**"), null, message);

  withTempRoot((root) => {
    const result = census(root, ["docs/tickets/D0/absolute.md"], () => ticketText("/tmp/fixtures/doctor/**"));
    assert.deepEqual(result.admitted, [], message);
    assertNoMalformedTickets(result);
  });
});

test("outside-fixtures-declaration-is-rejected", () => {
  const message = "fixtureAdmissionGlob is not exported; fixtures-root rejection is unproven";
  assertExported(fixtureAdmissionGlob, message);
  assert.equal(fixtureAdmissionGlob("packages/schema/**"), null, message);

  withTempRoot((root) => {
    fixtureFiles(root, "packages/schema", ["must-not-admit.json"]);
    const result = census(root, ["docs/tickets/D0/outside-fixtures.md"], () => ticketText("packages/schema/**"));
    assert.deepEqual(result.admitted, [], message);
    assertNoMalformedTickets(result);
  });
});

test("unquoted-final-fixture-declaration-is-admitted", () => {
  const message = "fixture declaration fixtures/prescription/*.json was not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    fixtureFiles(root, "fixtures/prescription", ["prescription.json"]);
    const result = census(root, [ticketPath("E0D-003")], readLiveTicket);
    assert.deepEqual(result.admitted, ["fixtures/prescription/prescription.json"], message);
    assertNoMalformedTickets(result);
  });
});

test("repeated-unquoted-fixture-declarations-are-admitted", () => {
  const message = "repeated unquoted fixture declarations were not admitted";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    const directories = [
      "fixtures/reference-pass",
      "fixtures/reference-fail",
      "fixtures/false-completion",
      "fixtures/stale-evidence",
      "fixtures/duplicate-run",
      "fixtures/unsafe-action",
      "fixtures/insufficient-evidence",
      "fixtures/manual-takeover",
      "fixtures/prescription"
    ];
    const expected = directories.map((directory) => {
      writeFixture(root, `${directory}/fixture.json`);
      return `${directory}/fixture.json`;
    }).sort();
    const result = census(root, [ticketPath("E2-004")], readLiveTicket);
    assert.deepEqual(result.admitted, expected, message);
    assertNoMalformedTickets(result);
  });
});
