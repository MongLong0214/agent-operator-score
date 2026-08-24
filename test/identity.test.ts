import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  TRANSPORTS,
  isIdentifier,
  isTransport,
  validatePool,
  type AgentPool
} from "../src/core/identity.ts";

const profile = (over: Partial<AgentPool["profiles"][number]> = {}) => ({
  profile_id: "claude-main",
  vendor: "claude-code",
  product: "opus",
  transports: ["process"] as const,
  available: true,
  metadata: {},
  ...over
});

const pool = (over: Partial<AgentPool> = {}): AgentPool => ({
  session_id: "s-1",
  profiles: [profile()],
  instances: [{ instance_id: "claude-main-01", profile_id: "claude-main" }],
  producers: [{ producer_id: "p-1", instance_id: "claude-main-01", transport: "process" }],
  ...over
});

describe("agent identity", () => {
  test("a well-formed pool has no problems", () => {
    assert.deepEqual(validatePool(pool()), []);
  });

  test("vendors are free-form, not a closed list", () => {
    // A closed enum makes adding a runtime a code change and makes a session that used an unlisted
    // agent unrepresentable rather than merely unfamiliar.
    for (const vendor of ["grok", "hermes", "gemini", "something-that-does-not-exist-yet"]) {
      const problems = validatePool(pool({ profiles: [profile({ vendor, profile_id: `p-${vendor}` })], instances: [], producers: [] }));
      assert.deepEqual(problems, [], vendor);
    }
  });

  test("an empty vendor is still refused", () => {
    // Free-form is not the same as absent: a profile with no vendor cannot be grouped or reported.
    const problems = validatePool(pool({ profiles: [profile({ vendor: "" })], instances: [], producers: [] }));
    assert.equal(problems.some((p) => p.reason.includes("no vendor")), true);
  });

  test("the same product at different settings is a different profile", () => {
    // Two Claude Code profiles that differ only in model are two profiles, and both are valid.
    const problems = validatePool(
      pool({
        profiles: [
          profile({ profile_id: "claude-opus", product: "opus" }),
          profile({ profile_id: "claude-haiku", product: "haiku" })
        ],
        instances: [],
        producers: []
      })
    );
    assert.deepEqual(problems, []);
  });

  test("one profile may have several instances", () => {
    // Running the same profile twice is two instances; merging them would hide a retry.
    const problems = validatePool(
      pool({
        instances: [
          { instance_id: "codex-01", profile_id: "claude-main" },
          { instance_id: "codex-02", profile_id: "claude-main" }
        ],
        producers: []
      })
    );
    assert.deepEqual(problems, []);
  });

  test("one instance may have several producers", () => {
    const problems = validatePool(
      pool({
        producers: [
          { producer_id: "wrapper", instance_id: "claude-main-01", transport: "process" },
          { producer_id: "bridge", instance_id: "claude-main-01", transport: "aos-event-bridge" }
        ]
      })
    );
    assert.deepEqual(problems, []);
  });

  test("a producer may belong to no instance", () => {
    // A workspace or git observer watches the session, not one agent.
    const problems = validatePool(
      pool({ producers: [{ producer_id: "git-observer", instance_id: null, transport: "native" }] })
    );
    assert.deepEqual(problems, []);
  });

  test("referential integrity is checked, not trusted", () => {
    // An instance naming a missing profile would drop out of every per-profile grouping while still
    // contributing its events to the totals.
    const orphanInstance = validatePool(pool({ instances: [{ instance_id: "x-01", profile_id: "not-declared" }], producers: [] }));
    assert.equal(orphanInstance.some((p) => p.reason.includes("unknown profile")), true);

    const orphanProducer = validatePool(pool({ producers: [{ producer_id: "p", instance_id: "not-declared", transport: "process" }] }));
    assert.equal(orphanProducer.some((p) => p.reason.includes("unknown instance")), true);
  });

  test("duplicate ids are refused at every level", () => {
    const dupProfile = validatePool(
      pool({ profiles: [profile(), profile()], instances: [], producers: [] })
    );
    assert.equal(dupProfile.some((p) => p.reason.includes("more than once")), true);

    const dupInstance = validatePool(
      pool({
        instances: [
          { instance_id: "a", profile_id: "claude-main" },
          { instance_id: "a", profile_id: "claude-main" }
        ],
        producers: []
      })
    );
    assert.equal(dupInstance.some((p) => p.reason.includes("more than once")), true);
  });

  test("every declared transport is accepted and an undeclared one is not", () => {
    for (const transport of TRANSPORTS) {
      assert.equal(isTransport(transport), true, transport);
      const problems = validatePool(
        pool({
          profiles: [profile({ transports: [transport] })],
          instances: [],
          producers: [{ producer_id: "p", instance_id: null, transport }]
        })
      );
      assert.deepEqual(problems, [], transport);
    }
    assert.equal(isTransport("ssh"), false);
    assert.equal(isTransport(""), false);
  });

  test("opaque is a transport, so an unobservable agent can still be declared", () => {
    // An operator who used an agent that produced nothing observable must be able to say so.
    // Without this the pool would describe the tooling that happened to fit rather than the session.
    assert.equal(isTransport("opaque"), true);
  });

  test("a profile with no transport is refused", () => {
    const problems = validatePool(pool({ profiles: [profile({ transports: [] })], instances: [], producers: [] }));
    assert.equal(problems.some((p) => p.reason.includes("no transport")), true);
  });

  test("identifiers reject shapes that would break grouping or storage", () => {
    for (const good of ["a", "claude-main", "codex-reviewer-01", "buzz:room.1", "a".repeat(128)]) {
      assert.equal(isIdentifier(good), true, good);
    }
    for (const bad of ["", " ", "  spaced", "-leading", "with/slash", "with\nnewline", "a".repeat(129), null, 7]) {
      assert.equal(isIdentifier(bad), false, JSON.stringify(bad));
    }
  });
});
