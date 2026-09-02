import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";
import { fileByteDigest, sha256Bytes } from "./digest.mjs";
import { validateAgainstSchema } from "./json-schema.mjs";

// Who is entitled to say that an operator did something.
//
// The defect this file exists for, stated plainly: a perfect agent artifact is not an operator
// action. Three lines of an agent's stdout -- `checkpoint.raised`, `user.instruction`,
// `operator.decision` -- reached the store under `producer_id: "agent-evil"`, `lib/checkpoint.mjs`
// matched them on event type alone, and `lib/observe.mjs` turned them into M11 = M12 = 1, which the
// #582 contract issues as the operator_process cells C3.ER.01 and C4.IQ.01. Every write path was
// open: agent stdout through `AOS_EVENT`, plugin output through the same route, and `aos import` /
// `aos bridge`, which take the producer id from the command line.
//
// Three designs were considered and two are rejected here.
//
// A producer id is not evidence. `--producer operator` is one flag away, so a rule that reads the
// name a caller chose is a rule that grades the caller's honesty. That is the same mistake as an
// adapter string standing in for a verified executable.
//
// A field inside the event is not evidence either. Anything the record carries about its own
// authority arrived with the record, and the record arrived from the thing being checked.
//
// And a channel is not a person, but the absence of one is decisive. `--checkpoints` was read as
// proof that somebody was at the keyboard, so a controller that piped four answers had AOS sign
// them DIRECT_LOCAL/HIGH. A terminal does not prove a person -- `expect` holds a pty and a person
// can walk away from one -- but a stream that is not a terminal proves there is somebody in
// between, and the source for that is the owner-relay protocol #576 owns.
//
// So authority is decided by three facts the event cannot contain. The first is the *source*, which
// is declared by the call site rather than by the payload: `appendEvent` takes it as an argument
// and never reads it off the event, so the import path can spell it only as what it is. The second
// is the *channel* the answer arrived on, read from the descriptor rather than from a flag. The
// third is a session binding -- an HMAC over the event's own fields, keyed by a per-run secret that
// exists only in the memory of the process that mints and checks it. A record whose binding does
// not verify was not minted by this instrument for this run, whatever it says about itself.
//
// The secret is never written down. The first version kept it at `<run>/operator.key` at 0600, and
// the agent runs in `<run>/workspaces/<family>` as the same user -- so `$AOS_WORKSPACE/../../
// operator.key` was the whole capability, and a review read it, minted three correctly bound
// records and had all three accepted. Placement could not have fixed that: everything under the
// operator's home is same-user readable and the run id is in the workspace path. What fixes it is
// that there is nothing on disk to read.
//
// What that buys, stated: the binding proves a record was produced by the AOS process that created
// this run's secret, and it is checked inside that process. It is not a signature over anybody's
// identity and does not survive the process. That is exactly the question the defect turned on --
// the assessed agent is a different process.

export const OPERATOR_EVENT_SCHEMA_ID = "aos-operator-event.v2";
export const OPERATOR_EVENT_SCHEMA_URL = new URL("../schemas/aos-operator-event.v2.schema.json", import.meta.url);

export const loadOperatorEventSchema = () => JSON.parse(readFileSync(OPERATOR_EVENT_SCHEMA_URL, "utf8"));

/**
 * The digest a result quotes for the schema these events were minted under.
 *
 * Over the file's bytes. A schema whose whitespace moved is a different file, and the point of
 * quoting a digest is to let a reader hold the artifact this build shipped rather than the one that
 * happens to be on disk when they look.
 */
export const operatorEventSchemaDigest = () => fileByteDigest(OPERATOR_EVENT_SCHEMA_URL);

/** The one producer id an operator act is recorded under. Necessary, never sufficient. */
export const OPERATOR_PRODUCER = "operator";

/**
 * The store event types that stand for an operator act, and therefore may not be written by
 * anything that is not one.
 *
 * `checkpoint.raised` is in the list even though AOS raises it. It is the claim that an operator was
 * shown something, and an opportunity nobody administered is the cheapest thing to forge:
 * `detectCheckpoints` returns the recorded checkpoints verbatim and `observeInterventions` scores
 * nothing without one, so a forged checkpoint is what makes a forged decision worth forging.
 *
 * What AOS did is a different record and carries no authority. `checkpoint.offered` says the
 * instrument stopped and asked, which is true whether anybody was there or not, and an unattended
 * run has that one and not this one.
 */
export const OPERATOR_AUTHORITY_EVENT_TYPES = Object.freeze([
  "checkpoint.raised",
  "user.instruction",
  "operator.decision",
  "session.cancelled"
]);

export const isOperatorAuthorityType = (type) => OPERATOR_AUTHORITY_EVENT_TYPES.includes(type);

export const OPERATOR_SOURCES = Object.freeze(["interactive-tty", "trusted-local-ui", "operator-file", "agent-relay"]);

/**
 * Sources that exist so that a refusal can name what was refused.
 *
 * A rejection reading "unknown source" tells an operator nothing about which part of their setup
 * tried to speak for them. Each of these is a real path in this product.
 */
export const NON_OPERATOR_SOURCES = Object.freeze([
  "agent-stdout",
  "plugin-stdout",
  "imported-trace",
  "bridged-trace",
  "aos-default",
  "aos-template"
]);

const NON_OPERATOR_REASON = new Map([
  ["agent-stdout", "agent stdout is not an operator source; an agent's account of what the operator did is the agent's account"],
  ["plugin-stdout", "plugin output is not an operator source; a plugin speaks for itself"],
  ["imported-trace", "an imported trace is not an operator source; the producer id on an import is chosen by whoever runs the command"],
  ["bridged-trace", "a bridged trace is not an operator source; the producer id on a bridge is chosen by whoever runs the command"],
  ["aos-default", "an AOS default is not an operator source; silence answered by a default is NOT_OBSERVED"],
  ["aos-template", "the shipped template is not an operator source; a form AOS filled in is not a form the operator filled in"]
]);

/**
 * Source to authority, provenance and confidence.
 *
 * The order is a total one and it is deliberate. A turn taken at this machine's own keyboard is
 * DIRECT and HIGH. A turn relayed by an agent on the owner's behalf is attested rather than
 * witnessed, so it is MEDIUM and its protocol belongs to #576. A turn read out of a file is the
 * weakest of the three: the file says what it says whenever it was written, so it is LOW and it may
 * not be admitted without an explicit provenance record and a binding to this session.
 */
export const AUTHORITY_MATRIX = Object.freeze({
  "interactive-tty": Object.freeze({ authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" }),
  "trusted-local-ui": Object.freeze({ authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" }),
  "agent-relay": Object.freeze({ authority: "LOCAL_OWNER_RELAY", provenance: "RELAY_ATTESTED", confidence: "MEDIUM" }),
  "operator-file": Object.freeze({ authority: "ADVANCED_FILE", provenance: "FILE_ATTESTED", confidence: "LOW" })
});

/**
 * What a source is entitled to, or nothing.
 *
 * Nothing is the answer for every source that is not one of the four, including the ones this
 * module names -- a source it has never heard of is not a source it may guess about.
 */
export function authorityOf(source) {
  if (typeof source !== "string") return null;
  return Object.hasOwn(AUTHORITY_MATRIX, source) ? AUTHORITY_MATRIX[source] : null;
}

/** Why a source that is not an operator source is not one, in words an operator can act on. */
export function refusalForSource(source) {
  if (typeof source !== "string" || source.length === 0) return "no operator source was declared by the call site that recorded this event";
  const named = NON_OPERATOR_REASON.get(source);
  return named ?? `${source} is not a source this contract recognises, and an unrecognised source carries no authority`;
}

export const DECISION_TYPES = Object.freeze([
  "spec.goal",
  "constraint.add",
  "context.include",
  "context.exclude",
  "context.inspect",
  "context.request-metadata",
  "route.assign",
  "parallelism.choose",
  "verification.choose",
  "budget.set",
  "plan.approve",
  "plan.edit",
  // Two types the issue's own JSON does not list, and the reason they are here.
  //
  // The enum in the issue covers D1-D3 and the reliance pair. The two operator_process cells the
  // #582 contract already declares under the `operator-canonical-event` authority -- C3.ER.01 and
  // C4.IQ.01 -- are D4: the operator was shown a checkpoint, and the operator answered it. Those
  // turns are exactly the ones this repository was crediting to `producer_id: "agent-evil"`, so
  // leaving them without a canonical type would have left the reproduced defect open in the one
  // place it was measured. The relay protocol and the checkpoint vocabulary are #576's; this is the
  // authority proof attached to them, not a second checkpoint model.
  "checkpoint.observe",
  "intervention.decide",
  "initial.judgment",
  "advice.response"
]);

// --- the session binding -------------------------------------------------------------------------

/**
 * Every field of the event except the binding itself.
 *
 * Listed rather than derived from the object, because "hash whatever keys are present" is a binding
 * that a record can shrink its way out of: drop `opportunity_id` and the digest over the remainder
 * still verifies. A field this list does not name cannot be part of an operator event -- the schema
 * says `additionalProperties: false` and this list is checked against the schema's own properties by
 * `tests/product/operator-event-authority.test.mjs`, so the two cannot drift apart in silence.
 */
export const BOUND_FIELDS = Object.freeze([
  "schema_id",
  "event_id",
  "run_id",
  "producer",
  "source",
  "authority",
  "provenance",
  "confidence",
  "decision_type",
  "construct_cell_id",
  "opportunity_id",
  "challenge_digest",
  "value_digest",
  "named_evidence_ids",
  "reported_confidence",
  "state_revision",
  "created_at",
  "candidate_source",
  "proactive_delegation",
  "declared_route",
  "relay_attestation",
  "file_provenance"
]);

/**
 * The binding over one event, keyed by the run's local secret.
 *
 * `run_id` is inside the bound material, so an event lifted out of one run and dropped into another
 * fails here rather than being noticed by a separate cross-session rule that somebody could forget
 * to call. Over the canonical form's bytes, so key order cannot move it.
 */
export function sessionBindingOf(fields, secret) {
  if (typeof secret !== "string" || secret.length === 0) throw new Error("AOS_OPERATOR_KEY_MISSING a session binding cannot be computed without the run's operator key");
  const material = Object.create(null);
  for (const field of BOUND_FIELDS) if (fields[field] !== undefined) material[field] = fields[field];
  return `sha256:${createHmac("sha256", secret).update(Buffer.from(canonicalJson(material), "utf8")).digest("hex")}`;
}

const bindingMatches = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
};

// --- minting -------------------------------------------------------------------------------------

const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/u;

/**
 * The digest for one of the event's two content fields, decided by which field the caller supplied.
 *
 * Never by what the value looks like. The first version of this sniffed the string: a value that
 * happened to be sixty-four hex characters was taken for a digest somebody had already computed, so
 * a raw judgment of `0123456789abcdef` four times over was published as
 * `value_digest: "sha256:0123...cdef"` -- the secret itself, in the field whose whole purpose is to
 * stand in its place. #559 hit the same class and answered it the same way: the caller says which
 * kind of thing it is by choosing the field, and a shape test never gets a vote.
 *
 * Nothing is defaulted. An omitted challenge used to become the digest of `null`, which is a
 * perfectly well-formed record of nobody having been asked anything.
 */
const digestFor = (fields, name) => {
  const digestKey = `${name}_digest`;
  const digest = fields[digestKey];
  const raw = fields[name];
  const hasDigest = digest !== undefined && digest !== null;
  const hasRaw = raw !== undefined;
  if (hasDigest && hasRaw) {
    throw new Error(`AOS_INVALID_OPERATOR_EVENT ${name} and ${digestKey} were both supplied; one names a value to hash and the other names a digest already taken, and nothing here may choose between them`);
  }
  if (hasDigest) {
    if (typeof digest !== "string" || !DIGEST_SHAPE.test(digest)) {
      throw new Error(`AOS_INVALID_OPERATOR_EVENT ${digestKey} is a digest already taken and must read sha256:<64 hex>, not ${JSON.stringify(digest)}`);
    }
    return digest;
  }
  // Over the canonical form's bytes, like every other digest in this repository.
  if (hasRaw) return sha256Bytes(Buffer.from(canonicalJson(raw), "utf8"));
  throw new Error(`AOS_INVALID_OPERATOR_EVENT an operator event states its ${name}: supply ${name} to be hashed here, or ${digestKey} if it is already a digest`);
};

/**
 * One operator event, minted by the process that watched the operator act.
 *
 * The authority triple is written by this function from the source and never taken from the caller:
 * a caller that could hand in `authority: "DIRECT_LOCAL"` beside `source: "operator-file"` would be
 * choosing its own place in the matrix, which is the whole of what the matrix is for.
 *
 * Raw text does not enter. `value` and `challenge` are digested here, and what an operator typed
 * stays in the local restricted store the caller keeps it in.
 */
export function mintOperatorEvent(fields, { secret, now = new Date() } = {}) {
  const entitlement = authorityOf(fields?.source);
  if (entitlement === null) throw new Error(`AOS_NOT_OPERATOR_AUTHORITY mint: ${refusalForSource(fields?.source)}`);
  if (!DECISION_TYPES.includes(fields?.decision_type)) throw new Error(`AOS_UNKNOWN_DECISION_TYPE ${String(fields?.decision_type)}`);
  const event = {
    schema_id: OPERATOR_EVENT_SCHEMA_ID,
    event_id: fields.event_id ?? `operator-${randomUUID()}`,
    run_id: fields.run_id,
    producer: OPERATOR_PRODUCER,
    source: fields.source,
    authority: entitlement.authority,
    provenance: entitlement.provenance,
    confidence: entitlement.confidence,
    decision_type: fields.decision_type,
    construct_cell_id: fields.construct_cell_id,
    opportunity_id: fields.opportunity_id,
    challenge_digest: digestFor(fields, "challenge"),
    value_digest: digestFor(fields, "value"),
    named_evidence_ids: [...new Set(fields.named_evidence_ids ?? [])].sort(),
    reported_confidence: typeof fields.reported_confidence === "number" ? fields.reported_confidence : null,
    state_revision: fields.state_revision ?? 1,
    created_at: fields.created_at ?? `${now.toISOString().slice(0, 19)}Z`
  };
  for (const optional of ["candidate_source", "proactive_delegation", "declared_route", "relay_attestation", "file_provenance"]) {
    if (fields[optional] !== undefined && fields[optional] !== null) event[optional] = fields[optional];
  }
  const complete = { ...event, session_binding: sessionBindingOf(event, secret) };
  const report = validateAgainstSchema(complete, loadOperatorEventSchema());
  if (!report.ok) throw new Error(`AOS_INVALID_OPERATOR_EVENT ${report.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  return Object.freeze(complete);
}

// --- validation ----------------------------------------------------------------------------------

/**
 * Whether one record is an operator event of this run, and the named reason when it is not.
 *
 * Never throws for a bad record. A validator that throws makes a forged event indistinguishable
 * from a broken instrument at the call site, and the call sites here are the ones that have to
 * carry on after refusing.
 */
export function validateOperatorEvent(event, { run_id, secret, source = null, schema = loadOperatorEventSchema() } = {}) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return { accepted: false, reason: "no operator event was attached to this record" };
  }
  const report = validateAgainstSchema(event, schema);
  if (!report.ok) return { accepted: false, reason: `the operator event does not match ${OPERATOR_EVENT_SCHEMA_ID}: ${report.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}` };
  const entitlement = authorityOf(event.source);
  if (entitlement === null) return { accepted: false, reason: refusalForSource(event.source) };
  // The source the call site declared and the source the record claims have to be the same fact.
  // Without this, a record minted for a file could be handed to `appendEvent` by the import path
  // and arrive with the file's authority attached to a trace nobody attested.
  if (source !== null && source !== event.source) {
    return { accepted: false, reason: `this record was recorded by a ${source} call site and claims to be a ${event.source} event` };
  }
  if (event.authority !== entitlement.authority || event.provenance !== entitlement.provenance || event.confidence !== entitlement.confidence) {
    return { accepted: false, reason: `a ${event.source} event is ${entitlement.authority}/${entitlement.provenance}/${entitlement.confidence} and this one claims ${event.authority}/${event.provenance}/${event.confidence}` };
  }
  if (event.source === "operator-file" && (event.file_provenance === undefined || event.file_provenance === null)) {
    return { accepted: false, reason: "an operator-file event is admitted only with an explicit file provenance record naming the file it was read from" };
  }
  if (event.source === "agent-relay" && (event.relay_attestation === undefined || event.relay_attestation === null)) {
    return { accepted: false, reason: "an agent-relay event is admitted only with the relay attestation the owner-relay protocol issues; the protocol itself is #576" };
  }
  if (typeof run_id === "string" && event.run_id !== run_id) {
    return { accepted: false, reason: `this operator event was minted for ${event.run_id} and is being recorded against ${run_id}` };
  }
  let expected;
  try {
    expected = sessionBindingOf(event, secret);
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!bindingMatches(expected, event.session_binding)) {
    return { accepted: false, reason: "the session binding does not bind these fields to this run; the record was not minted by this instrument for this session, or it was edited afterwards" };
  }
  return { accepted: true, event, authority: { source: event.source, authority: event.authority, provenance: event.provenance, confidence: event.confidence } };
}

// --- the ledger ----------------------------------------------------------------------------------

/**
 * The run's operator events in the order they were admitted, and what was refused.
 *
 * Two rules live here rather than in `validateOperatorEvent`, because both are about a sequence
 * rather than about a record: an event id may be admitted once, and an opportunity's state revision
 * has to advance. The second is what stops a replayed decision from being re-counted under a new id
 * and what makes "the operator's original event is never overwritten" checkable -- a later record
 * for the same opportunity is a further revision of it, in order, and the first one stays first.
 */
export function createOperatorLedger({ run_id, secret } = {}) {
  const seen = new Set();
  const revisionOf = new Map();
  const accepted = [];
  const rejected = [];
  return {
    accept(event, { source = null } = {}) {
      const verdict = validateOperatorEvent(event, { run_id, secret, source });
      if (!verdict.accepted) {
        rejected.push({ event_id: event?.event_id ?? null, reason: verdict.reason });
        return verdict;
      }
      if (seen.has(event.event_id)) {
        const reason = `${event.event_id} has already been recorded in this run; an operator event is admitted once`;
        rejected.push({ event_id: event.event_id, reason });
        return { accepted: false, reason };
      }
      const previous = revisionOf.get(event.opportunity_id);
      if (previous !== undefined && event.state_revision <= previous) {
        const reason = `state revision ${event.state_revision} does not advance ${event.opportunity_id}, which is already at ${previous}`;
        rejected.push({ event_id: event.event_id, reason });
        return { accepted: false, reason };
      }
      seen.add(event.event_id);
      revisionOf.set(event.opportunity_id, event.state_revision);
      accepted.push(event);
      return verdict;
    },
    get accepted() { return [...accepted]; },
    get rejected() { return rejected.map((entry) => ({ ...entry })); }
  };
}

/**
 * One decision, for a call site that has no sequence to keep.
 *
 * `appendEvent` is this caller: it holds one record at a time and the run's own event files are the
 * sequence. Replay across a whole run is re-checked at the read, by `attestedOperatorTrace`.
 */
export function admitOperatorEvent({ event, run_id, secret, source }) {
  const entitlement = authorityOf(source);
  if (entitlement === null) return { accepted: false, reason: refusalForSource(source) };
  return validateOperatorEvent(event, { run_id, secret, source });
}

// --- reading a stored trace ----------------------------------------------------------------------

/**
 * The trace a scorer is allowed to read.
 *
 * The store refuses to write an unattested operator event, so in a run this instrument produced
 * there is nothing here to drop. This exists for the run this instrument did not produce: the event
 * files are ordinary files in the operator's home, a run recorded before this gate existed carries
 * no attestation at all, and both cases have to reach the scorer as what they are. An operator-typed
 * record whose attestation does not verify is not returned -- it is reported in `rejected`, because
 * a record that is silently dropped is a defect nobody can see.
 *
 * Everything that is not an operator-authority type passes through untouched. This function decides
 * who may speak for the operator; it does not decide what the run did.
 */
export function attestedOperatorTrace(events, { run_id, secret } = {}) {
  const ledger = createOperatorLedger({ run_id, secret });
  const trace = [];
  const refused = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!isOperatorAuthorityType(event?.event_type)) {
      trace.push(event);
      continue;
    }
    if (event.producer_id !== OPERATOR_PRODUCER) {
      refused.push({ event_id: event.event_id ?? null, reason: `${event.event_type} was recorded under producer ${String(event.producer_id)}, which is not the operator` });
      continue;
    }
    const verdict = ledger.accept(event.operator_event, { source: event.operator_authority?.source ?? null });
    if (verdict.accepted) trace.push(event);
  }
  return { trace, accepted: ledger.accepted, rejected: [...refused, ...ledger.rejected] };
}

// --- projection ----------------------------------------------------------------------------------

/**
 * What a public result may carry about an operator event.
 *
 * Structure and digests. The listed fields are the whole of it, so a field added to the schema
 * later is absent from the projection until somebody decides it belongs there -- the opposite
 * default from "copy the record and delete what looks sensitive", which publishes every field
 * nobody thought about.
 *
 * Nothing about how long the operator's text was, and nothing about how many turns they took.
 * Length and turn count are the two shortcuts this contract prohibits by name, and a projection
 * that carried them would put them in front of every consumer downstream.
 */
export const PROJECTED_FIELDS = Object.freeze([
  "schema_id",
  "event_id",
  "run_id",
  "producer",
  "source",
  "authority",
  "provenance",
  "confidence",
  "decision_type",
  "construct_cell_id",
  "opportunity_id",
  "challenge_digest",
  "value_digest",
  "reported_confidence",
  "state_revision",
  "session_binding",
  "created_at"
]);

/**
 * The fields a projection derives rather than copies, and the schema fields each one stands for.
 *
 * Round 1 published `named_evidence_ids` verbatim from a schema that allowed any 1-128 characters,
 * and `["secret:hunter2", "/Users/alice/.ssh/id_ed25519"]` came out of this function unchanged. The
 * schema now refuses both spellings at the mint, and this list is the second half of the same rule:
 * an evidence id is the operator's own name for something on their machine, so what is published is
 * its digest. #583 compares identities, and a digest is an identity.
 */
export const DERIVED_PROJECTION_FIELDS = Object.freeze([
  "named_evidence_ids",
  "candidate_source",
  "proactive_delegation",
  "declared_route",
  "relay_attestation",
  "file_provenance"
]);

export function projectOperatorEvent(event) {
  // Null-prototype, like every other map in this repository that is keyed by names from outside the
  // function: a field called `__proto__` in a stored record would otherwise assign through to
  // Object.prototype and vanish from the projection at the same time.
  const projected = Object.create(null);
  for (const field of PROJECTED_FIELDS) if (event?.[field] !== undefined) projected[field] = event[field];
  if (Array.isArray(event?.named_evidence_ids)) {
    projected.named_evidence_digests = event.named_evidence_ids.map((id) => sha256Bytes(Buffer.from(id, "utf8")));
  }
  if (event?.candidate_source) {
    // The structural facts the operator decided against, never the source's content and never its
    // path: a path is the operator's own filesystem and this record is published.
    projected.candidate_source = {
      source_digest: sha256Bytes(Buffer.from(event.candidate_source.source_id, "utf8")),
      authority_class: event.candidate_source.authority_class,
      version: event.candidate_source.version,
      untrusted_content: event.candidate_source.untrusted_content,
      size_bytes: event.candidate_source.size_bytes
    };
  }
  if (event?.proactive_delegation !== undefined) projected.proactive_delegation = event.proactive_delegation;
  if (Array.isArray(event?.declared_route)) projected.declared_route = [...event.declared_route];
  if (event?.file_provenance) {
    projected.file_provenance = {
      path_digest: event.file_provenance.path_digest,
      file_digest: event.file_provenance.file_digest,
      attested_by: event.file_provenance.attested_by,
      attested_at: event.file_provenance.attested_at
    };
  }
  if (event?.relay_attestation) {
    projected.relay_attestation = {
      relay_id: event.relay_attestation.relay_id,
      owner_challenge_digest: event.relay_attestation.owner_challenge_digest,
      attested_at: event.relay_attestation.attested_at
    };
  }
  return Object.freeze(projected);
}

// --- the reliance sequence -----------------------------------------------------------------------

export const RELIANCE_REJECTED = "AOS_RELIANCE_OPPORTUNITY_REJECTED reliance opportunity rejected";

/**
 * The interface #583 calls, and the one rule it needs this module to hold.
 *
 * SSOT section 21 fixes the order: an independent initial judgment, then its confidence and named
 * evidence, then the proactive delegation decision, and only then the advice. A judgment written
 * after the advice was seen is not an independent judgment, and the two are indistinguishable once
 * they arrive together -- so they may not arrive together. `commitInitialJudgment` writes one event
 * and refuses a payload that also carries the response; `revealAdvice` marks the opportunity; and a
 * judgment offered after that mark is refused by name rather than recorded with a caveat.
 *
 * No rate, no index and no error taxonomy is computed here. #583 owns every metric; this owns the
 * order the metrics are only meaningful in.
 */
export const RELIANCE_STAGES = Object.freeze(["initial-committed", "advice-revealed"]);

/**
 * A journal that outlives the trace object.
 *
 * The first version kept the reveal in an in-memory `Set`, so constructing a second trace for the
 * same run started from nothing and accepted another initial judgment for an opportunity whose
 * advice was already out. An ordering rule that a reconstruction resets is not an ordering rule --
 * and reconstruction is the normal case, because #583 reads a run that has already happened.
 *
 * Required, with no default. A default in-memory journal would be exactly the hole above, silently.
 */
const assertJournal = (journal) => {
  if (!journal || typeof journal.record !== "function" || typeof journal.read !== "function") {
    throw new Error("AOS_RELIANCE_JOURNAL_REQUIRED a reliance trace is built on a journal that outlives it: { record(opportunity_id, stage), read() }. Without one the reveal is forgotten every time the trace is rebuilt, which is the ordering rule failing open.");
  }
  return journal;
};

export function createRelianceTrace({ run_id, secret, journal } = {}) {
  assertJournal(journal);
  const ledger = createOperatorLedger({ run_id, secret });
  const initial = new Map();
  const responses = [];

  const staged = (opportunity_id, stage) => journal.read().some((entry) => entry.opportunity_id === opportunity_id && entry.stage === stage);
  const revealed = { has: (opportunity_id) => staged(opportunity_id, "advice-revealed") };
  const committed = (opportunity_id) => initial.has(opportunity_id) || staged(opportunity_id, "initial-committed");

  const refuse = (reason) => { throw new Error(`${RELIANCE_REJECTED}: ${reason}`); };

  return {
    /**
     * One atomic commit: the judgment, its confidence, its named evidence and the delegation
     * decision, in a single event, before any advice for this opportunity is revealed.
     */
    commitInitialJudgment(payload) {
      const opportunity = payload?.opportunity_id;
      if (Object.hasOwn(payload ?? {}, "advice_response") || Object.hasOwn(payload ?? {}, "post_advice")) {
        refuse("an initial judgment and a post-advice response arrived in one payload, so nothing here can say which was formed first");
      }
      if (revealed.has(opportunity)) refuse(`the advice for ${opportunity} was already revealed, so a judgment committed now is not an independent one`);
      if (committed(opportunity)) refuse(`${opportunity} already carries an initial judgment; a second one would replace evidence rather than add it`);
      if (typeof payload?.reported_confidence !== "number") refuse("an initial judgment is committed with the confidence the operator reported, and this payload states none");
      // Each of these was a default in the first version, so an empty payload minted a well-formed
      // record of nobody having been asked anything: the digest of `null`, the digest of `[]`, and
      // no delegation decision. Section 21's sequence starts with a judgment, its evidence and the
      // delegation choice, and an opportunity missing any of them is not one of its opportunities.
      if (!Array.isArray(payload.named_evidence_ids) || payload.named_evidence_ids.length === 0) {
        refuse(`${opportunity} names no evidence; an initial judgment with nothing behind it cannot be told from one nobody made`);
      }
      if (payload.proactive_delegation !== "DELEGATE" && payload.proactive_delegation !== "DECIDE_ALONE") {
        refuse(`${opportunity} states no proactive delegation decision, and whether the operator chose to delegate before seeing advice is half of what this opportunity observes`);
      }
      let event;
      try {
        event = mintOperatorEvent({
          run_id,
          source: payload.source,
          decision_type: "initial.judgment",
          construct_cell_id: payload.construct_cell_id,
          opportunity_id: opportunity,
          challenge: payload.challenge,
          challenge_digest: payload.challenge_digest,
          value: payload.judgment,
          value_digest: payload.value_digest,
          named_evidence_ids: payload.named_evidence_ids,
          reported_confidence: payload.reported_confidence,
          state_revision: 1,
          proactive_delegation: payload.proactive_delegation
        }, { secret });
      } catch (error) {
        refuse(error instanceof Error ? error.message : String(error));
      }
      const verdict = ledger.accept(event, { source: payload.source });
      if (!verdict.accepted) refuse(verdict.reason);
      initial.set(opportunity, event);
      journal.record(opportunity, "initial-committed");
      return event;
    },

    /** The moment the operator could first have seen the advice. Nothing before this is affected. */
    revealAdvice(opportunity_id) {
      if (!committed(opportunity_id)) refuse(`${opportunity_id} has no committed initial judgment, so revealing advice for it would leave nothing to compare against`);
      journal.record(opportunity_id, "advice-revealed");
      return { opportunity_id, revealed_after_event_id: initial.get(opportunity_id)?.event_id ?? null };
    },

    /** What the operator did with the advice, recorded only after the reveal it responds to. */
    recordAdviceResponse(payload) {
      const opportunity = payload?.opportunity_id;
      if (!revealed.has(opportunity)) refuse(`${opportunity} has no revealed advice, so a response to it is a response to nothing`);
      let event;
      try {
        event = mintOperatorEvent({
          run_id,
          source: payload.source,
          decision_type: "advice.response",
          construct_cell_id: payload.construct_cell_id,
          opportunity_id: opportunity,
          challenge: payload.challenge,
          challenge_digest: payload.challenge_digest,
          value: payload.response ?? payload.judgment,
          value_digest: payload.value_digest,
          named_evidence_ids: payload.named_evidence_ids,
          reported_confidence: typeof payload.reported_confidence === "number" ? payload.reported_confidence : null,
          state_revision: 2
        }, { secret });
      } catch (error) {
        refuse(error instanceof Error ? error.message : String(error));
      }
      const verdict = ledger.accept(event, { source: payload.source });
      if (!verdict.accepted) refuse(verdict.reason);
      responses.push(event);
      return event;
    },

    /**
     * The ordered evidence #583 reads. Counts, never rates: whether four of these make a metric is
     * a question about the whole cycle and section 21 answers it somewhere else.
     */
    opportunities() {
      return [...initial.keys()].sort().map((opportunity_id) => ({
        opportunity_id,
        initial_judgment: projectOperatorEvent(initial.get(opportunity_id)),
        advice_revealed: revealed.has(opportunity_id),
        advice_response: responses.filter((event) => event.opportunity_id === opportunity_id).map((event) => projectOperatorEvent(event))
      }));
    }
  };
}
