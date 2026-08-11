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

test("ticket-declared-operational-state-fixture-directory-is-admitted", () => {
  const message = "fixture declaration fixtures/operational-state/** is not ticket-derived";
  assertExported(ticketDeclaredFixtureDirectories, message);

  const operationalStatePath = ticketPath("D0-004");
  const expected = regularFilesBelow(repositoryRoot, "fixtures/operational-state");
  assert.ok(expected.length > 0, "live operational-state fixture corpus is empty");
  const admitted = census(repositoryRoot, liveCatalogTicketPaths, readLiveTicket);
  assert.deepEqual(
    admitted.admitted.filter((path) => path.startsWith("fixtures/operational-state/")),
    expected,
    message
  );
  assertNoMalformedTickets(admitted);

  const withoutD004Declaration = census(repositoryRoot, liveCatalogTicketPaths, (path) => {
    const text = readLiveTicket(path);
    if (path !== operationalStatePath) return text;
    assert.ok(text.includes("fixtures/operational-state/**"), "D0-004 declaration is absent from live corpus");
    return text.replace("fixtures/operational-state/**", "fixtures/operational-state");
  });
  assert.equal(
    withoutD004Declaration.admitted.some((path) => path.startsWith("fixtures/operational-state/")),
    false,
    message
  );
});

test("fixture-reference-does-not-admit", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; reference exclusion is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  const operationalStatePath = ticketPath("D0-004");
  const d0011Path = ticketPath("D0-011");
  const d0011Text = readLiveTicket(d0011Path);
  assert.ok(d0011Text.includes("fixtures/operational-state/**"), "D0-011 reference is absent from live corpus");
  const result = census(repositoryRoot, liveCatalogTicketPaths, (path) => {
    const text = readLiveTicket(path);
    return path === operationalStatePath
      ? text.replace("fixtures/operational-state/**", "fixtures/operational-state")
      : text;
  });
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
  // The same rule at the other shapes an item can take without naming one directory's glob. A
  // deeper non-glob path is refused for the same reason as the two-segment one; the fixtures root
  // is not a fixture directory; and an item that joined two declarations with a word rather than
  // a separator still ends in `**` but names no directory either ticket wrote.
  assert.equal(fixtureAdmissionGlob("fixtures/governance/effective-state"), null, message);
  assert.equal(fixtureAdmissionGlob("fixtures/**"), null, message);
  assert.equal(fixtureAdmissionGlob("fixtures/a/** and fixtures/b/**"), null, message);
  // Every glob metacharacter, not only the star: a directory segment that reads as a pattern
  // would match a literal directory of that name and admit what no ticket declared.
  assert.equal(fixtureAdmissionGlob("fixtures/a?/b/**"), null, message);
  assert.equal(fixtureAdmissionGlob("fixtures/a[0-9]/b/**"), null, message);

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

    // The other way a catalog-listed ticket is unreadable, and the one the live integration
    // actually produces: its read throws rather than returning null. A census that lets the
    // exception escape aborts the remaining corpus instead of recording the ticket.
    const throwingPath = "docs/tickets/D0/throws.md";
    const throwing = census(root, [throwingPath, validPath], (path) => {
      if (path === throwingPath) throw new Error("EACCES");
      return ticketText("fixtures/valid/**");
    });
    assert.deepEqual(throwing.admitted, ["fixtures/valid/admitted.json"], message);
    assert.deepEqual(throwing.malformed.map(({ path }) => path), [throwingPath], message);
    assert.match(throwing.malformed[0].reason, /^[a-z][a-z0-9-]*$/, message);

    // A ticket that reads cleanly but whose ownership section cannot be parsed as the list it is
    // required to be. Each of these yields no declaration, which is indistinguishable from a
    // ticket that declares no fixture unless the malformed state is reported.
    const unparsable = [
      ["docs/tickets/D0/open-quote.md", "# t\n\n## Exact ownership\n- `fixtures/broken/**\n\n## Preconditions\n"],
      ["docs/tickets/D0/not-a-list.md", "# t\n\n## Exact ownership\nnot a bullet\n\n## Preconditions\n"],
      ["docs/tickets/D0/empty-section.md", "# t\n\n## Exact ownership\n\n## Preconditions\n"]
    ];
    for (const [unparsablePath, body] of unparsable) {
      const result = census(root, [unparsablePath, validPath], (path) =>
        path === unparsablePath ? body : ticketText("fixtures/valid/**"));
      assert.deepEqual(result.admitted, ["fixtures/valid/admitted.json"], message);
      assert.deepEqual(result.malformed.map(({ path }) => path), [unparsablePath], message);
      assert.match(result.malformed[0].reason, /^[a-z][a-z0-9-]*$/, message);
    }

    // Reordering the catalog does not reorder the report. The same corpus listed either way is
    // the same census, so a caller cannot see a difference that is not in the tickets.
    const two = ["docs/tickets/D0/a.md", "docs/tickets/D0/b.md"];
    const readNone = () => null;
    assert.deepEqual(census(root, two, readNone), census(root, [...two].reverse(), readNone), message);
  });
});

test("outside-repository-symlinked-fixture-directory-is-not-admitted", () => {
  const message = "ticketDeclaredFixtureDirectories is not exported; outside-repository symlink rejection is unproven";
  assertExported(ticketDeclaredFixtureDirectories, message);

  withTempRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "aos-fixture-admission-outside-"));
    try {
      writeFixture(outside, "outside.json");
      writeFixture(outside, "child/deep.json");
      mkdirSync(resolve(root, "fixtures"), { recursive: true });
      symlinkSync(outside, resolve(root, "fixtures/outside"), "dir");
      const result = census(root, ["docs/tickets/D0/outside.md"], () => ticketText("fixtures/outside/**"));
      assert.deepEqual(result.admitted, [], message);
      assertNoMalformedTickets(result);

      // The prefix form: the declared directory is an ordinary directory, but a segment above it
      // is the link that leaves the repository. An implementation that resolves the whole
      // declared path before judging it reads outside before refusing what it already read.
      const prefixed = census(root, ["docs/tickets/D0/prefix.md"], () => ticketText("fixtures/outside/child/**"));
      assert.deepEqual(prefixed.admitted, [], message);
      assertNoMalformedTickets(prefixed);

      // The entry form: the declared directory is legitimately inside the repository, but one
      // file in it is a link out. Following it would place an outside file into the skeleton
      // under a path that looks local.
      writeFixture(root, "fixtures/inside/real.json");
      symlinkSync(resolve(outside, "outside.json"), resolve(root, "fixtures/inside/linked.json"), "file");
      const withLinkedEntry = census(root, ["docs/tickets/D0/inside.md"], () => ticketText("fixtures/inside/**"));
      assert.deepEqual(withLinkedEntry.admitted, ["fixtures/inside/real.json"], message);
      assertNoMalformedTickets(withLinkedEntry);
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
    // The nested match is the other half of the predicate: `*.json` names this directory's own
    // files, so a matching file one level down is refused too. Without it, an implementation that
    // recursed for `*.json` would satisfy every other assertion here.
    fixtureFiles(root, "fixtures/doctor", ["declared.json", "not-declared.txt", "nested/deep.json"]);
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

    // The same directory declared twice contributes one entry, not two. Every declaration in the
    // bullet above names a different directory, so a census that appended instead of collecting
    // would agree with the expectation above and disagree only here.
    const twice = census(root, ["docs/tickets/D0/twice.md"], () =>
      ["# t", "", "## Exact ownership", "- fixtures/prescription/**; fixtures/prescription/**", "", "## Preconditions", ""].join("\n"));
    assert.deepEqual(twice.admitted, ["fixtures/prescription/fixture.json"], message);
    assertNoMalformedTickets(twice);
  });
});
