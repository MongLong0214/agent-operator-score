import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NON_SCORING_OBSERVATIONS,
  SCHEMA_ID,
  SCHEMA_VERSION,
  profileDigestOf,
  validateProfile,
  type AgentPoolOpportunityProfile,
  type AgentProfile
} from "../src/schema/agent-pool-profile.ts";

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  agent_profile_id: "claude-main",
  display_name: "Claude Code (main)",
  vendor: "anthropic",
  runtime_name: "claude-code",
  runtime_version: "1.0.0",
  model_id: "opus",
  model_revision: null,
  harness_name: null,
  harness_version: null,
  transport: "process",
  adapter_id: "claude-code",
  adapter_version: "0.1.0",
  capabilities: { tool_calls: { state: "NATIVE", source: "adapter" } },
  available: true,
  ...over
});

const build = (over: Partial<AgentPoolOpportunityProfile> = {}): AgentPoolOpportunityProfile => {
  const base = {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    profile_id: "pool-1",
    instrument: "AOS-Coding P0",
    suite_id: "coding-core-v0",
    suite_version: "0.1.0",
    form: "A",
    language: "en",
    operator_policy: { intervention_policy: "unrestricted", allowed_manual_actions: [] },
    global_budget: { wall_time_ms: 3_600_000, token_budget: null, tool_call_budget: null, cost_budget: null },
    agents: [agent()],
    collaboration_surfaces: [],
    profile_digest: "",
    ...over
  } as AgentPoolOpportunityProfile;
  return { ...base, profile_digest: profileDigestOf(base) };
};

describe("agent pool opportunity profile", () => {
  test("a well-formed profile validates", () => {
    assert.deepEqual(validateProfile(build()), []);
  });

  test("the pool records what was available, not only what was used", () => {
    // Dropping an unused profile would flatter every operator who reached for the wrong tool or
    // none at all, because the score is conditional on the environment they were working in.
    const profile = build({
      agents: [agent(), agent({ agent_profile_id: "codex-reviewer", runtime_name: "codex", available: true })]
    });
    assert.deepEqual(validateProfile(profile), []);
    assert.equal(profile.agents.length, 2);
    assert.equal(profile.agents.every((a) => a.available), true);
  });

  test("an unavailable agent is still a valid pool member", () => {
    const profile = build({ agents: [agent(), agent({ agent_profile_id: "grok", runtime_name: "grok", available: false })] });
    assert.deepEqual(validateProfile(profile), []);
  });

  test("a pool with no agent describes no opportunity", () => {
    const problems = validateProfile(build({ agents: [] }));
    assert.equal(problems.some((p) => p.field === "agents"), true);
  });

  test("mixed transports in one pool are accepted", () => {
    const profile = build({
      agents: [
        agent({ agent_profile_id: "local", transport: "process" }),
        agent({ agent_profile_id: "acp-agent", transport: "acp" }),
        agent({ agent_profile_id: "bridged", transport: "aos-event-bridge" }),
        agent({ agent_profile_id: "unobserved", transport: "opaque" })
      ]
    });
    assert.deepEqual(validateProfile(profile), []);
  });

  test("vendor may be unknown but the runtime may not", () => {
    // An operator can know what they ran without knowing who ships it. They cannot not know what
    // they ran.
    assert.deepEqual(validateProfile(build({ agents: [agent({ vendor: null })] })), []);
    const noRuntime = validateProfile(build({ agents: [agent({ runtime_name: "" })] }));
    assert.equal(noRuntime.some((p) => p.reason.includes("runtime_name")), true);
  });

  test("a capability claim must say where it came from, or why it is unavailable", () => {
    const sourceless = validateProfile(
      build({ agents: [agent({ capabilities: { tool_calls: { state: "NATIVE" } as never } })] })
    );
    assert.equal(sourceless.length > 0, true, "a capability claim with nothing behind it was accepted");

    const reasonless = validateProfile(
      build({ agents: [agent({ capabilities: { tool_calls: { state: "UNAVAILABLE" } as never } })] })
    );
    assert.equal(reasonless.length > 0, true);

    // UNAVAILABLE with a reason is valid and is not an operator failure.
    assert.deepEqual(
      validateProfile(
        build({ agents: [agent({ capabilities: { tool_calls: { state: "UNAVAILABLE", reason: "runtime does not report tool calls" } } })] })
      ),
      []
    );
  });

  test("a null budget means unbounded and is not the same as zero", () => {
    // Collapsing them would turn an unbounded budget into one that forbids the first token.
    assert.deepEqual(validateProfile(build()), []);
    const zero = build({ global_budget: { wall_time_ms: 1, token_budget: 0, tool_call_budget: 0, cost_budget: 0 } });
    assert.deepEqual(validateProfile(zero), [], "zero is a real budget and must validate");
    const negative = validateProfile(
      build({ global_budget: { wall_time_ms: 1, token_budget: -1, tool_call_budget: null, cost_budget: null } })
    );
    assert.equal(negative.some((p) => p.field.includes("token_budget")), true);
  });

  test("wall time must be positive", () => {
    for (const wall of [0, -1]) {
      const problems = validateProfile(build({ global_budget: { wall_time_ms: wall, token_budget: null, tool_call_budget: null, cost_budget: null } }));
      assert.equal(problems.some((p) => p.field.includes("wall_time_ms")), true, String(wall));
    }
    // NaN cannot travel through a profile at all: canonical JSON refuses it before a digest exists,
    // so it is refused one layer earlier than the validator rather than reported by it.
    const withNaN = {
      ...build(),
      global_budget: { wall_time_ms: Number.NaN, token_budget: null, tool_call_budget: null, cost_budget: null }
    };
    assert.throws(() => profileDigestOf(withNaN), /no JSON representation/);
    assert.equal(validateProfile(withNaN).some((p) => p.field.includes("wall_time_ms")), true);
  });

  test("duplicate agent or surface ids are refused", () => {
    const dupAgent = validateProfile(build({ agents: [agent(), agent()] }));
    assert.equal(dupAgent.some((p) => p.reason.includes("more than once")), true);
  });

  test("the digest covers the profile and excludes itself", () => {
    const profile = build();
    assert.equal(profile.profile_digest, profileDigestOf(profile));
    // Changing any field changes the digest, so a tampered profile cannot keep a valid one.
    const tampered = { ...profile, suite_version: "9.9.9" };
    assert.notEqual(profileDigestOf(tampered), profile.profile_digest);
    assert.equal(validateProfile(tampered).some((p) => p.field === "profile_digest"), true);
  });

  test("the digest does not depend on key order", () => {
    const profile = build();
    // Rebuild every object with its keys reversed. A replacer array cannot be used here: it filters
    // to the named keys and drops every nested one, which would compare two different documents.
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).reverse();
        return Object.fromEntries(entries.map(([k, v]) => [k, reverseKeys(v)]));
      }
      return value;
    };
    const reordered = reverseKeys(profile) as AgentPoolOpportunityProfile;
    assert.notDeepEqual(Object.keys(reordered), Object.keys(profile), "the reordering did nothing");
    assert.equal(profileDigestOf(reordered), profileDigestOf(profile));
  });

  test("Buzz is a collaboration surface, not an agent", () => {
    const profile = build({
      collaboration_surfaces: [
        {
          surface_id: "buzz-room-1",
          kind: "buzz",
          display_name: "Buzz",
          transport: "signed-events",
          identity_digest: null,
          capabilities: { messages: { state: "SIGNED", source: "buzz relay" } }
        }
      ]
    });
    assert.deepEqual(validateProfile(profile), []);
    assert.equal(profile.agents.some((a) => a.runtime_name === "buzz"), false);
  });

  test("the non-scoring list names what must never earn points", () => {
    // PRD 6. Recorded as data so the scorer can assert it reads none of them, rather than leaving
    // that to a reviewer noticing.
    for (const forbidden of ["agent_count", "provider_count", "token_usage", "parallel_process_count"]) {
      assert.equal(NON_SCORING_OBSERVATIONS.includes(forbidden), true, forbidden);
    }
    assert.equal(new Set(NON_SCORING_OBSERVATIONS).size, NON_SCORING_OBSERVATIONS.length);
  });
});
