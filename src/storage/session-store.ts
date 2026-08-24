import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, type JsonValue } from "../core/canonical-json.ts";
import { sha256Text } from "../core/digest.ts";
import { appendNdjsonLine, writeFileAtomic } from "./atomic-file.ts";
import { isTerminal, type RunState } from "./run-state.ts";

/**
 * On-disk layout for one multi-agent session.
 *
 * Two rules shape everything here.
 *
 * Each producer appends only to its own file. Several processes appending to one file interleave
 * partial writes under load, and a torn line is indistinguishable from a producer that stopped
 * mid-record — so the canonical trace is merged at finish time from files nobody shared.
 *
 * `terminal.json` is written exactly once and binds the result digest. A second terminal write is
 * refused rather than overwritten, because a recovery pass that relabels a finished session is the
 * only way this product could issue a score for a run it already refused.
 */

export interface SessionPaths {
  readonly root: string;
  readonly manifest: string;
  readonly producers: string;
  readonly canonicalTrace: string;
  readonly result: string;
  readonly terminal: string;
}

export const sessionPaths = (aosRoot: string, sessionId: string): SessionPaths => {
  const root = join(aosRoot, "sessions", sessionId);
  return {
    root,
    manifest: join(root, "manifest.json"),
    producers: join(root, "producers"),
    canonicalTrace: join(root, "canonical-trace.json"),
    result: join(root, "result.json"),
    terminal: join(root, "terminal.json")
  };
};

export interface ProducerCursor {
  readonly producer_id: string;
  /** Highest producer_seq durably appended. Resume asks for the next one after this. */
  readonly last_seq: number;
}

export const createSession = (aosRoot: string, sessionId: string, manifest: JsonValue): SessionPaths => {
  const paths = sessionPaths(aosRoot, sessionId);
  mkdirSync(paths.producers, { recursive: true });
  writeFileAtomic(paths.manifest, canonicalJson(manifest));
  return paths;
};

const producerDir = (paths: SessionPaths, producerId: string): string => join(paths.producers, producerId);

export const appendProducerEvent = (paths: SessionPaths, producerId: string, event: JsonValue): void => {
  const directory = producerDir(paths, producerId);
  mkdirSync(directory, { recursive: true });
  appendNdjsonLine(join(directory, "events.ndjson"), canonicalJson(event));
};

export const writeCursor = (paths: SessionPaths, cursor: ProducerCursor): void => {
  const directory = producerDir(paths, cursor.producer_id);
  mkdirSync(directory, { recursive: true });
  writeFileAtomic(join(directory, "cursor.json"), canonicalJson(cursor as unknown as JsonValue));
};

export const readCursor = (paths: SessionPaths, producerId: string): ProducerCursor | null => {
  const file = join(producerDir(paths, producerId), "cursor.json");
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const cursor = parsed as ProducerCursor;
    if (typeof cursor.producer_id !== "string" || !Number.isInteger(cursor.last_seq)) return null;
    return cursor;
  } catch {
    // A cursor that cannot be read is not a cursor at zero. Resuming from zero would replay the
    // whole producer, and every replayed event would be deduplicated only if it were byte-identical
    // -- which it will not be if anything about the environment moved.
    return null;
  }
};

export interface ReadProducer {
  readonly producer_id: string;
  readonly lines: readonly string[];
  /** A trailing torn line, recovered by truncation. Reported so the caller records the recovery. */
  readonly truncated: boolean;
}

/**
 * Reads one producer's events, tolerating exactly one torn trailing line.
 *
 * A crash during append leaves a partial final record, and that is the only position a partial
 * record can appear at: every earlier line was fsynced whole. So truncating the tail is a targeted
 * repair rather than a guess, and a torn line anywhere else stays a problem for the reader.
 */
export const readProducerEvents = (paths: SessionPaths, producerId: string): ReadProducer => {
  const file = join(producerDir(paths, producerId), "events.ndjson");
  if (!existsSync(file)) return { producer_id: producerId, lines: Object.freeze([]), truncated: false };
  const text = readFileSync(file, "utf8");
  const raw = text.split("\n");
  const complete: string[] = [];
  let truncated = false;

  raw.forEach((line, index) => {
    if (line.length === 0) return;
    try {
      JSON.parse(line);
      complete.push(line);
    } catch {
      if (index === raw.length - 1 || (index === raw.length - 2 && raw[raw.length - 1] === "")) {
        truncated = true;
        return;
      }
      // An unparseable line that is not the last one means damage this repair does not cover.
      throw new Error(`AOS_RUN_CORRUPTED ${producerId} events.ndjson line ${index + 1} is not a complete record`);
    }
  });

  return { producer_id: producerId, lines: Object.freeze(complete), truncated };
};

export const listProducers = (paths: SessionPaths): readonly string[] => {
  if (!existsSync(paths.producers)) return Object.freeze([]);
  return Object.freeze(
    readdirSync(paths.producers, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  );
};

export interface Terminal {
  readonly session_id: string;
  readonly state: RunState;
  /** Binds the result this terminal refers to. A terminal without it names no particular outcome. */
  readonly result_digest: string | null;
  readonly workspaces_retained: boolean;
}

export type TerminalWrite =
  | { readonly ok: true; readonly terminal: Terminal }
  | { readonly ok: false; readonly reason: string; readonly existing: Terminal };

export const readTerminal = (paths: SessionPaths): Terminal | null => {
  if (!existsSync(paths.terminal)) return null;
  try {
    return JSON.parse(readFileSync(paths.terminal, "utf8")) as Terminal;
  } catch {
    return null;
  }
};

/**
 * Commits the terminal state once.
 *
 * An identical re-commit is accepted so a recovery pass that repeats the last step is not an error;
 * a *different* one is refused, because that is a second answer to a question already answered.
 */
export const commitTerminal = (paths: SessionPaths, terminal: Terminal): TerminalWrite => {
  if (!isTerminal(terminal.state)) {
    return {
      ok: false,
      reason: `${terminal.state} is not a terminal state`,
      existing: terminal
    };
  }
  const existing = readTerminal(paths);
  if (existing !== null) {
    const same = canonicalJson(existing as unknown as JsonValue) === canonicalJson(terminal as unknown as JsonValue);
    if (same) return { ok: true, terminal: existing };
    return {
      ok: false,
      reason: "a different terminal state is already committed for this session",
      existing
    };
  }
  writeFileAtomic(paths.terminal, canonicalJson(terminal as unknown as JsonValue));
  return { ok: true, terminal };
};

export const resultDigestOf = (result: JsonValue): string => sha256Text(canonicalJson(result));

export type RecoveryDecision =
  | "ABORTED"
  | "RESUME_INGESTION"
  | "SCORE_ONCE"
  | "COMMIT_TERMINAL_ONCE"
  | "NO_RESCORE"
  | "INVALID";

export interface RecoveryInput {
  readonly hasActiveProducer: boolean;
  readonly hasFinalSeal: boolean;
  readonly hasValidCursor: boolean;
  readonly hasResult: boolean;
  readonly hasTerminal: boolean;
  readonly resultDigestMatchesTerminal: boolean;
}

/**
 * PRD 12.5, in the order the table gives, because the order is the meaning: a committed terminal
 * outranks everything, and a conflict outranks the absence of anything.
 */
export const decideRecovery = (input: RecoveryInput): RecoveryDecision => {
  if (input.hasTerminal) {
    // Already answered. Rescoring here is exactly how a refused session becomes a scored one.
    return input.hasResult && !input.resultDigestMatchesTerminal ? "INVALID" : "NO_RESCORE";
  }
  if (input.hasResult) return "COMMIT_TERMINAL_ONCE";
  if (input.hasFinalSeal) return "SCORE_ONCE";
  if (input.hasActiveProducer && input.hasValidCursor) return "RESUME_INGESTION";
  if (!input.hasActiveProducer) return "ABORTED";
  return "INVALID";
};
