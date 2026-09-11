// Administering the produced reliance questions inside the run that owns them.
//
// The two halves this joins were built to be separable: `lib/relay-producer.mjs` decides what to
// ask and how to grade it, `lib/relay.mjs` owns the user-turn boundary and the initial -> reveal ->
// final order. Neither can run a question on its own.
//
// Why this lives inside the assessing process rather than behind `aos relay respond`.
//
// The operator and instrument capabilities are minted once, in memory, by the process that creates
// the run, and `lib/store.mjs` returns null to anybody else -- deliberately: a second process that
// could mint them could turn its own account of a user turn into a valid operator event. So a
// later shell running `aos relay respond` cannot commit a response, and the sequencing has to
// happen here. The command remains the read side and the in-process host's entry point; it is not
// the path a person's answer travels.
//
// What travels instead is a file. AOS writes the challenge where the coding agent can read it and
// waits for a response file to appear. The agent never receives the operator's text as an argument
// -- #576 forbids raw text in argv, and a file that must be 0600 inside a 0700 directory is also
// the only form `readRestrictedRelayResponseFile` accepts.
//
// The wait is not a terminal prompt. Nothing here reads stdin: a run whose operator never answers
// expires its challenge and records no episode, which leaves the floor unmet and the profile
// withheld. That is the honest outcome and the reason this must never fall back to asking on the
// terminal -- an answer typed into the process that is grading it has no separate observer.

import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { createFileRelayCheckpoint, readRestrictedRelayResponseFile } from "./checkpoint.mjs";
import { writeJson } from "./core.mjs";
import { createAgentRelayProtocol } from "./relay.mjs";
import { gradeRelianceOutcome, preparedOpportunity } from "./relay-producer.mjs";

/** How often the inbox is checked. Short enough to feel immediate, long enough to cost nothing. */
const POLL_MS = 250;

// Deliberately not unref'd. A wait is the only pending work while a question is outstanding, and an
// unref'd timer lets the process exit out from under it -- the run would end mid-question and report
// an unanswered episode as if nobody had been asked.
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Where a run keeps its relay state.
 *
 * `responses/` is the protocol's own evidence store and is never written from outside: those bytes
 * are what `verify` re-derives a receipt from. `inbox/` is the only path a coding agent writes, so
 * a malformed or hostile file there can fail one response without touching evidence already
 * committed.
 */
export const relayPaths = (runRoot) => Object.freeze({
  root: join(runRoot, "agent-relay"),
  state_file: join(runRoot, "agent-relay", "checkpoint.json"),
  response_dir: join(runRoot, "agent-relay", "responses"),
  inbox: join(runRoot, "agent-relay", "inbox"),
  challenge_file: join(runRoot, "agent-relay", "challenge.json")
});

const restrictedDirectory = (path) => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
};

/**
 * One run's reliance administration.
 *
 * `produced` is the full set from `relianceOpportunities`; `administer(family)` runs the ones bound
 * to that form, in catalogue order, so the questions arrive beside the work they are about.
 */
export function createRelianceAdministration({
  run_id: runId,
  run_root: runRoot,
  produced,
  operator_secret: operatorSecret,
  instrument_secret: instrumentSecret,
  trace,
  announce = () => {},
  now = () => new Date(),
  poll_ms: pollMs = POLL_MS
} = {}) {
  if (typeof runId !== "string" || runId.length === 0) throw new Error("AOS_RELAY_ADMIN_RUN a reliance administration belongs to one run");
  if (typeof runRoot !== "string" || runRoot.length === 0) throw new Error("AOS_RELAY_ADMIN_ROOT a reliance administration needs the run directory");
  if (!Array.isArray(produced)) throw new Error("AOS_RELAY_ADMIN_OPPORTUNITIES a reliance administration needs its produced opportunities");
  if (typeof operatorSecret !== "string" || typeof instrumentSecret !== "string") {
    throw new Error("AOS_RELAY_ADMIN_CAPABILITY a reliance administration needs the live run capabilities; a later process holds none");
  }

  const paths = relayPaths(runRoot);
  restrictedDirectory(paths.root);
  restrictedDirectory(paths.inbox);
  const checkpoint = createFileRelayCheckpoint({
    session_id: runId,
    state_file: paths.state_file,
    response_dir: paths.response_dir
  });

  const administered = [];
  const abandoned = [];

  const protocol = () => createAgentRelayProtocol({
    session_id: runId, checkpoint, trace,
    operator_secret: operatorSecret, instrument_secret: instrumentSecret, now
  });

  // The challenge is published as a file rather than returned, because the process that must read
  // it is not this one. Written under the 0700 relay root and then narrowed: the question names the
  // options and the context summary, which are AOS's own words, but a later phase carries the
  // advice summary and that is grading material until the initial response has committed.
  const publish = (challenge) => {
    writeJson(paths.challenge_file, challenge);
    chmodSync(paths.challenge_file, 0o600);
    announce(challenge);
  };

  const inboxPath = (challengeId) => join(paths.inbox, `${challengeId}.json`);

  /**
   * Wait for the agent to deliver one response.
   *
   * Returns the bytes, or null when the challenge's own expiry passes first. Absence is never an
   * answer here: a null is carried up and abandons the episode rather than completing it.
   */
  const awaitResponse = async (challenge) => {
    const path = inboxPath(challenge.challenge_id);
    const expiry = new Date(challenge.expires_at).getTime();
    while (now().getTime() <= expiry) {
      if (existsSync(path)) return readRestrictedRelayResponseFile(path);
      await sleep(pollMs);
    }
    return existsSync(path) ? readRestrictedRelayResponseFile(path) : null;
  };

  /** Close a question nobody answered, so the next one can be prepared against a clear checkpoint. */
  const abandon = (one, reason) => {
    abandoned.push({ opportunity_id: one.reliance_opportunity_id, reason });
    try {
      protocol().cancel();
    } catch {
      // A cancel refused because the episode already holds a committed human turn is the protocol
      // protecting that turn, and is not an error here: the episode stays as the partial record it
      // is, and the coverage floor reports it.
    }
  };

  const administerOne = async (one) => {
    let initialChallenge;
    try {
      const live = protocol();
      live.prepare(preparedOpportunity(one));
      // `prepare` only writes the question down. Delivery is `next`, and it is delivery that moves
      // the checkpoint to DELIVERED -- without it `respond` refuses every answer as belonging to no
      // currently delivered challenge, which is the protocol correctly refusing an answer to a
      // question it had not yet asked.
      initialChallenge = live.next();
    } catch (error) {
      abandoned.push({ opportunity_id: one.reliance_opportunity_id, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    publish(initialChallenge);
    const initialBytes = await awaitResponse(initialChallenge);
    if (initialBytes === null) { abandon(one, "AOS_RELAY_NO_INITIAL_RESPONSE"); return; }

    let postAdvice;
    try {
      postAdvice = protocol().respond(initialBytes);
    } catch (error) {
      abandon(one, error instanceof Error ? error.message : String(error));
      return;
    }
    publish(postAdvice);
    const finalBytes = await awaitResponse(postAdvice);
    if (finalBytes === null) { abandon(one, "AOS_RELAY_NO_FINAL_RESPONSE"); return; }

    try {
      protocol().respond(finalBytes);
    } catch (error) {
      abandon(one, error instanceof Error ? error.message : String(error));
      return;
    }

    // The graded values are the ones the ordered operator events committed, read back from the
    // instrument-authenticated trace rather than recomputed here. `assertOutcome` compares them
    // against those same events, so a recomputed digest would be refused rather than believed.
    const entries = trace.entries().filter((entry) => entry.opportunity_id === one.reliance_opportunity_id);
    const initialEvent = entries.find((entry) => entry.kind === "initial");
    const finalEvent = entries.find((entry) => entry.kind === "final");
    if (initialEvent === undefined || finalEvent === undefined) { abandon(one, "AOS_RELAY_TRACE_INCOMPLETE"); return; }
    const selected = (bytes) => {
      try {
        const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
        return Array.isArray(parsed.selected_option_ids) ? parsed.selected_option_ids : [];
      } catch {
        return [];
      }
    };
    try {
      protocol().recordOutcome(gradeRelianceOutcome({
        opportunity: one,
        initial_selected_option_ids: selected(initialBytes),
        final_selected_option_ids: selected(finalBytes),
        initial_value_digest: initialEvent.payload.operator_event.value_digest,
        final_value_digest: finalEvent.payload.operator_event.value_digest
      }));
      administered.push(one.reliance_opportunity_id);
    } catch (error) {
      abandoned.push({ opportunity_id: one.reliance_opportunity_id, reason: error instanceof Error ? error.message : String(error) });
    }
  };

  return Object.freeze({
    paths,
    /** Every question bound to one form, in catalogue order. */
    administer: async (family) => {
      for (const one of produced.filter((entry) => entry.task_form_id === family)) {
        await administerOne(one);
      }
    },
    /** What was administered and what was not, for the run's own record. */
    summary: () => Object.freeze({
      administered: Object.freeze([...administered]),
      abandoned: Object.freeze(abandoned.map((entry) => Object.freeze({ ...entry }))),
      planned: produced.length
    })
  });
}
