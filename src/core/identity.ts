/**
 * The identities a multi-agent session is measured in.
 *
 * The unit of assessment is one human operator running one declared agent pool — never a vendor,
 * a model or a runtime. That is why none of these carries a vendor enum: the moment the code holds
 * a closed list of agent names, adding a runtime becomes a code change, and a session that used an
 * unlisted agent becomes unrepresentable rather than merely unfamiliar. Vendor and product names
 * travel as free-form metadata on the profile.
 *
 * The distinctions that matter and are easy to collapse:
 *
 *   profile   what was available and how it was configured. The same Claude Code with a different
 *             model, permission set or MCP surface is a different profile, because the operator was
 *             working with a different instrument.
 *   instance  one actual run of a profile. Running the same profile twice is two instances, and
 *             merging them would hide a retry.
 *   producer  an independent source of events. One instance can have several — a process wrapper,
 *             a workspace observer, a relay bridge — and each carries its own sequence, because
 *             they cannot share a counter without coordinating.
 */

export type AssessmentSessionId = string;
export type AgentProfileId = string;
export type AgentInstanceId = string;
export type ProducerId = string;
export type WorkstreamId = string;
export type HandoffId = string;
export type CollaborationSurfaceId = string;

/**
 * How a producer's events reach AOS. Open-ended by intent: `opaque` is what an operator declares
 * when an agent was used but produced nothing observable, and recording that honestly is what keeps
 * the pool profile a description of the session rather than of the tooling that happened to fit.
 */
export const TRANSPORTS = Object.freeze([
  "process",
  "acp",
  "aos-event-bridge",
  "buzz",
  "native",
  "import",
  "opaque"
] as const);

export type Transport = (typeof TRANSPORTS)[number];

export const isTransport = (value: unknown): value is Transport =>
  typeof value === "string" && (TRANSPORTS as readonly string[]).includes(value);

/**
 * Identifiers are opaque strings, but not any string: a blank or whitespace-only id would compare
 * equal to nothing and group with everything, and an id carrying a path separator or newline would
 * break every place these are written into a filename or an NDJSON line.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && ID_SHAPE.test(value);

export interface AgentProfile {
  readonly profile_id: AgentProfileId;
  /** Free-form. "claude-code", "codex", "grok", or something that does not exist yet. */
  readonly vendor: string;
  /** Free-form. The model, harness or product variant, as the operator declared it. */
  readonly product: string | null;
  readonly transports: readonly Transport[];
  /**
   * Whether this profile was available to the operator, independent of whether they used it.
   * The pool describes opportunity, so an unused profile is still part of the environment the
   * session was run in — dropping it would flatter every operator who ignored a better tool.
   */
  readonly available: boolean;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface AgentInstance {
  readonly instance_id: AgentInstanceId;
  readonly profile_id: AgentProfileId;
}

export interface EvidenceProducer {
  readonly producer_id: ProducerId;
  /** Null when the producer observes the session rather than one agent: a git or workspace watcher. */
  readonly instance_id: AgentInstanceId | null;
  readonly transport: Transport;
}

export type IdentityProblem = { readonly field: string; readonly reason: string };

export interface AgentPool {
  readonly session_id: AssessmentSessionId;
  readonly profiles: readonly AgentProfile[];
  readonly instances: readonly AgentInstance[];
  readonly producers: readonly EvidenceProducer[];
}

/**
 * Structural validation of a pool. Referential integrity is checked here rather than trusted,
 * because an instance naming a profile that does not exist would silently drop out of every
 * per-profile grouping while still contributing events to the totals.
 */
export const validatePool = (pool: AgentPool): readonly IdentityProblem[] => {
  const problems: IdentityProblem[] = [];
  const push = (field: string, reason: string): void => {
    problems.push({ field, reason });
  };

  if (!isIdentifier(pool.session_id)) push("session_id", "is not a usable identifier");

  const profileIds = new Set<string>();
  for (const profile of pool.profiles) {
    if (!isIdentifier(profile.profile_id)) {
      push("profiles", `profile id ${String(profile.profile_id)} is not a usable identifier`);
      continue;
    }
    if (profileIds.has(profile.profile_id)) {
      push("profiles", `profile ${profile.profile_id} is declared more than once`);
      continue;
    }
    profileIds.add(profile.profile_id);
    if (typeof profile.vendor !== "string" || profile.vendor.length === 0) {
      push("profiles", `profile ${profile.profile_id} declares no vendor`);
    }
    if (profile.transports.length === 0) {
      push("profiles", `profile ${profile.profile_id} declares no transport`);
    }
    for (const transport of profile.transports) {
      if (!isTransport(transport)) {
        push("profiles", `profile ${profile.profile_id} declares unknown transport ${String(transport)}`);
      }
    }
  }

  const instanceIds = new Set<string>();
  for (const instance of pool.instances) {
    if (!isIdentifier(instance.instance_id)) {
      push("instances", `instance id ${String(instance.instance_id)} is not a usable identifier`);
      continue;
    }
    if (instanceIds.has(instance.instance_id)) {
      push("instances", `instance ${instance.instance_id} is declared more than once`);
      continue;
    }
    instanceIds.add(instance.instance_id);
    if (!profileIds.has(instance.profile_id)) {
      push("instances", `instance ${instance.instance_id} names unknown profile ${String(instance.profile_id)}`);
    }
  }

  const producerIds = new Set<string>();
  for (const producer of pool.producers) {
    if (!isIdentifier(producer.producer_id)) {
      push("producers", `producer id ${String(producer.producer_id)} is not a usable identifier`);
      continue;
    }
    if (producerIds.has(producer.producer_id)) {
      push("producers", `producer ${producer.producer_id} is declared more than once`);
      continue;
    }
    producerIds.add(producer.producer_id);
    if (!isTransport(producer.transport)) {
      push("producers", `producer ${producer.producer_id} declares unknown transport ${String(producer.transport)}`);
    }
    if (producer.instance_id !== null && !instanceIds.has(producer.instance_id)) {
      push("producers", `producer ${producer.producer_id} names unknown instance ${String(producer.instance_id)}`);
    }
  }

  return Object.freeze(problems);
};
