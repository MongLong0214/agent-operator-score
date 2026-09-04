import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeId, runProcess, sha256Text } from "./core.mjs";
import { contains } from "./digest.mjs";
import { CAPABILITY_VOCABULARY, capabilityRecord } from "./routing-oracle.mjs";

// What a runtime was observed to do, as opposed to what it says it can do or what AOS assumes of
// the adapter it was registered under.
//
// `lib/routing-oracle.mjs` declared four capability sources and produced two of them. `aos-known`
// is AOS's own table, one entry per shipped adapter, so every agent registered under an adapter got
// the same eight words -- and the requirement those words are checked against is built by AOS from
// the same release. Requirement and capability came out of one source, so a shortfall could not
// occur and `capability-matches-task` was structurally unfalsifiable: measured over 484
// production-shaped runs (every route shape crossed with every adapter assignment) the subcheck
// answered `true` 50 times, `null` 434 times and `false` never.
//
// `detected` was the fourth source and the module said so in as many words: "declared here and
// never produced by this release; nothing in AOS probes a runtime for its abilities yet, and a
// source that is never emitted is a seam rather than a claim." This module is the producer that
// closes it.
//
// THREE THINGS IT DELIBERATELY IS NOT.
//
//   It is not a self-report reader. The runtime is never asked what it can do, and no sentence it
//   writes is read for a capability word. Every observation here is AOS reading its own disk for a
//   value AOS generated and put somewhere the runtime had to go and get. A runtime that writes "I
//   can run tests" earns nothing; a runtime that produces the SHA-256 of thirty-two random bytes
//   has run something, whatever it says about itself. Taking the first for the second is the
//   authority defect #557 removed, one layer down.
//
//   It is not a guess about a runtime it could not reach. A probe that never got a trial -- the
//   command did not start, the invocation timed out, the runtime engaged with nothing -- produces
//   `unknown`, and `unknown` cannot list a capability. It specifically does NOT fall back to the
//   adapter table: falling back would publish "we did not look" as a measurement, and this
//   repository has reproduced that class four times this month.
//
//   It is not a claim about what the runtime could do under other conditions. What it records is
//   what was exhibited, once, under one bounded brief, inside a workspace AOS built. A capability
//   not exhibited is recorded as not exhibited and nothing more -- which is an observation of an
//   absence, and not the same thing as an absence of observation. The first is what makes a record
//   narrower than the adapter default; the second is what `unknown` is for.

/** The versioned record this module writes. A field moving means a new schema id. */
export const CAPABILITY_PROBE_SCHEMA = "aos-capability-probe.v1";

/** Named in every record this module decides, so a reader can see which authority answered. */
export const CAPABILITY_PROBE_VERIFIER = "aos-capability-probe.v1";

/**
 * The two things a probe can be, and never a third.
 *
 * `ANSWERED` means the runtime was given a trial and AOS observed the result of it, whatever that
 * result was. `INDETERMINATE` means there was no trial to read: it is the state that becomes
 * `unknown`, and the reason it exists as a separate word is that "the runtime exhibited nothing"
 * and "nothing ran" are the two sentences this module must never let a reader confuse.
 */
export const PROBE_STATUSES = Object.freeze(["ANSWERED", "INDETERMINATE"]);

/**
 * How AOS came to know an observation, per challenge.
 *
 * On the record beside the verdict, because "AOS read this file off its own disk" and "the runtime
 * said so" are different facts and only one of them is admissible here. There is one value and it
 * is the first: the second has no code path.
 */
export const PROBE_OBSERVATION_METHOD = "aos-read-the-workspace";

/** How long a single probe invocation may take before it is a probe that did not answer. */
export const PROBE_TIMEOUT_MS = 180000;

/** The largest answer file this module will read. An answer is a token, not a corpus. */
export const MAX_ANSWER_BYTES = 64 * 1024;

/**
 * The two verdicts the verification challenge accepts, and how many claims it puts up.
 *
 * THE NEGATIVE CONTROL, AND WHY THE FIRST VERSION DID NOT HAVE ONE.
 *
 * That version seeded a single claim and it was always wrong, so `MISMATCH` was the correct answer
 * on every probe that would ever run. The merge gate wrote the answer that breaks it: copy the
 * file's own value, append the word, never open the claim. That earns the word without performing
 * a comparison, which makes the record *wider* than what was observed -- and a wider record is a
 * shortfall that goes unnoticed, which is the same failure as a fabricated one pointed the other
 * way.
 *
 * So there are six claims and exactly two of them are wrong, at positions drawn per probe. A
 * runtime that compares gets all six right every time; a runtime that asserts verdicts without
 * comparing has to name which two, and there are fifteen ways to be wrong about that.
 *
 * The counts are fixed and the positions are random, and both halves of that matter. Fixed,
 * because flipping each claim independently produces an all-correct seeding one time in sixty-four
 * and an unconditional `AGREES` would be right again on that probe -- a constant-correct answer
 * returning at low frequency is still a constant-correct answer. Random, because a fixed position
 * is learnable from one probe.
 *
 * Nothing here is random for a runtime that can do the task. Measured over 600 seedings, which
 * covered all fifteen wrong-sets: a runtime that compares earns the word 600 times out of 600; one
 * that reads every value and then asserts `AGREES` for all of them, or `DIFFERS` for all of them,
 * earns it 0 times; one that repeats the claims earns it 0 times; and the best non-comparing
 * strategy there is -- read the values, guess the wrong set -- measured 39/600, against the 1-in-15
 * floor. The residual noise is entirely on the side that would make the record wider, which costs a
 * missed shortfall, and none of it is on the side that manufactures one.
 *
 * `AGREES` and `DIFFERS` rather than `MATCH` and `MISMATCH`: "MISMATCH" contains "MATCH", so a
 * substring test for the positive verdict is satisfied by the negative one, and the check would
 * have accepted the wrong verdict wherever it looked for the right one.
 */
export const CLAIM_AGREES_WORD = "AGREES";
export const CLAIM_DIFFERS_WORD = "DIFFERS";
export const VERIFY_CLAIM_COUNT = 6;
export const VERIFY_WRONG_CLAIMS = 2;

/**
 * Every way two of the six claims can be the wrong ones, in a fixed order.
 *
 * Enumerated rather than sampled. Drawing indices one at a time needs a loop that retries on a
 * collision, and a bounded retry loop can return a set of the wrong size -- which would seed a
 * probe with one wrong claim, or none, and quietly restore the constant-correct answer this whole
 * construction exists to remove. Choosing an index into this list always yields exactly two.
 */
export const VERIFY_WRONG_SETS = Object.freeze(
  Array.from({ length: VERIFY_CLAIM_COUNT }, (_, left) =>
    Array.from({ length: VERIFY_CLAIM_COUNT }, (_, right) => [left + 1, right + 1]))
    .flat()
    .filter(([left, right]) => left < right)
    .map((pair) => Object.freeze(pair)));

/**
 * A fresh set of unguessable values, one per challenge.
 *
 * Sixteen random bytes each. The whole unforgeability argument rests on these: a token exists in
 * exactly one seeded file inside a workspace AOS made for this probe and nowhere else -- not in the
 * brief, not in the environment, not in any earlier run -- so a runtime that reproduces one has
 * read that file, and no amount of describing itself will produce sixteen bytes it never saw.
 *
 * `random` is a parameter so a test can pin them. Production passes nothing and gets
 * `crypto.randomBytes`, which is the only caller that matters for the argument above.
 */
export function probeTokens(random = (bytes) => randomBytes(bytes).toString("hex")) {
  return Object.freeze({
    read: random(16),
    artifact: random(16),
    code: random(16),
    doc: random(16),
    spec: random(16),
    join_one: random(16),
    join_two: random(16),
    join_three: random(16),
    verify_1: random(16),
    verify_2: random(16),
    verify_3: random(16),
    verify_4: random(16),
    verify_5: random(16),
    verify_6: random(16),
    // One decoy per wrong claim, distinct, so a runtime that writes any of them has repeated a
    // claim rather than checked it -- and so the two wrong claims cannot be told apart by their
    // value.
    verify_decoy_1: random(16),
    verify_decoy_2: random(16),
    // Which two of the six are the wrong ones. Drawn from the same source as the tokens rather
    // than fixed, so the positions cannot be learned from a previous probe or read off this file.
    verify_wrong_claims: VERIFY_WRONG_SETS[Number.parseInt(random(2).slice(0, 4), 16) % VERIFY_WRONG_SETS.length],
    secret: random(32)
  });
}

/** Whether claims.json misstates this claim. */
const claimIsWrong = (tokens, index) => tokens.verify_wrong_claims.includes(index);

/** The value claims.json states for one claim: the truth, except at the two that are wrong. */
const claimedValue = (tokens, index) =>
  (claimIsWrong(tokens, index) ? tokens[`verify_decoy_${tokens.verify_wrong_claims.indexOf(index) + 1}`] : tokens[`verify_${index}`]);

/** The line of an answer that speaks for one claim, or null. */
const claimLine = (text, index) =>
  text.split(/\r?\n/u).find((line) => line.trim().startsWith(`claim-${index}:`)) ?? null;

/**
 * Where each challenge's answer has to appear, and what counts as having answered it.
 *
 * One exact path per capability word, so nothing here is a search for something that looks like an
 * answer. `expected` is computed by AOS from AOS's own tokens; `answered` is a predicate over the
 * bytes AOS read back off its own disk. There is no branch in this table that consults anything the
 * runtime authored other than through one of those tokens.
 *
 * Every capability word in `CAPABILITY_VOCABULARY` has an entry, and a test holds it to that. A
 * table that covered seven of the eight would emit a record missing the eighth for every runtime
 * alive, which is a shortfall this module invented rather than observed.
 */
export const PROBE_CHALLENGES = Object.freeze([
  Object.freeze({
    capability: "code-read",
    answer_path: "probe/read.txt",
    // Seeded inside a source file the runtime has to open. Nothing else in the workspace holds it.
    expected: (tokens) => tokens.read,
    answered: (text, tokens) => text.includes(tokens.read)
  }),
  Object.freeze({
    capability: "artifact-write",
    // At the workspace root, which is where every family's deliverable goes in this product. A
    // runtime whose writes are confined to a subdirectory fails this one and passes the others,
    // which is the shape a sandboxed runtime actually has.
    answer_path: "probe-artifact.json",
    expected: (tokens) => tokens.artifact,
    // Parsed, not scanned: an artifact is a structured deliverable and a file that happens to
    // contain the token in a comment is not one.
    answered: (text, tokens) => {
      try {
        const parsed = JSON.parse(text);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && parsed.token === tokens.artifact;
      } catch {
        return false;
      }
    }
  }),
  Object.freeze({
    capability: "code-write",
    answer_path: "src/probe-write.js",
    expected: (tokens) => tokens.code,
    answered: (text, tokens) => text.includes(tokens.code)
  }),
  Object.freeze({
    capability: "doc-write",
    answer_path: "docs/probe-doc.md",
    expected: (tokens) => tokens.doc,
    answered: (text, tokens) => text.includes(tokens.doc)
  }),
  Object.freeze({
    capability: "spec-write",
    answer_path: "spec/probe-spec.md",
    expected: (tokens) => tokens.spec,
    answered: (text, tokens) => text.includes(tokens.spec)
  }),
  Object.freeze({
    capability: "release-join",
    answer_path: "probe/release.txt",
    // Three inputs in three files, and the answer has to hold all three. Two of them is not a join.
    expected: (tokens) => [tokens.join_one, tokens.join_two, tokens.join_three].join(" "),
    answered: (text, tokens) => [tokens.join_one, tokens.join_two, tokens.join_three].every((value) => text.includes(value))
  }),
  Object.freeze({
    capability: "independent-verify",
    answer_path: "probe/verify.txt",
    expected: (tokens) => Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => {
      const index = offset + 1;
      const verdict = claimIsWrong(tokens, index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD;
      return `claim-${index}: ${tokens[`verify_${index}`]} ${verdict}`;
    }).join("\n"),
    // Every claim has to be answered, each with the file's own value and the verdict that comparing
    // would produce. Neither decoy may appear anywhere at all: a runtime that hedges by writing both
    // the claimed value and the true one has given no verdict, and one that repeats a claim has
    // given the wrong one.
    answered: (text, tokens) => {
      if (tokens.verify_wrong_claims.some((_, offset) => text.includes(tokens[`verify_decoy_${offset + 1}`]))) return false;
      for (let index = 1; index <= VERIFY_CLAIM_COUNT; index += 1) {
        const line = claimLine(text, index);
        if (line === null || !line.includes(tokens[`verify_${index}`])) return false;
        const agreed = line.includes(CLAIM_AGREES_WORD);
        const differed = line.includes(CLAIM_DIFFERS_WORD);
        if (claimIsWrong(tokens, index) ? !(differed && !agreed) : !(agreed && !differed)) return false;
      }
      return true;
    }
  }),
  Object.freeze({
    capability: "test-run",
    answer_path: "probe/check.txt",
    // The digest of thirty-two random bytes. There are two ways to produce it -- run the script AOS
    // seeded, or hash the file some other way -- and both of them are running a command and reading
    // what it printed, which is the ability being asked about. There is no third way: a runtime
    // that has not executed anything cannot compute SHA-256 of a value it has only read.
    expected: (tokens) => sha256Text(tokens.secret),
    answered: (text, tokens) => text.includes(sha256Text(tokens.secret))
  })
]);

/**
 * The brief AOS hands the runtime, which holds no token.
 *
 * Every value the answers are checked against lives in a seeded file, so an agent that read only
 * this text can answer nothing. That is not a stylistic choice: a brief carrying the tokens would
 * make every challenge answerable by copying the prompt, and the probe would be measuring whether
 * the runtime can echo.
 *
 * It is explicit and numbered because the thing being measured is ability, not comprehension. A
 * probe whose brief was a riddle would record a runtime that misread it as one that cannot write.
 */
export function probeBrief() {
  return [
    "You are being checked for which file operations you can perform in this directory.",
    "Do as many of the eight numbered items below as you are able to. Skip any you cannot do;",
    "do not simulate one, and do not describe what you would have done. Only files count.",
    "",
    "1. Read src/module.js. It declares AOS_PROBE_READ. Write that value to probe/read.txt.",
    "2. Read inputs/artifact.txt. Write probe-artifact.json in THIS directory (not in a",
    "   subdirectory) holding a JSON object whose \"token\" field is that value.",
    "3. Read inputs/code.txt. Write that value into a new file src/probe-write.js.",
    "4. Read inputs/doc.txt. Write that value into a new file docs/probe-doc.md.",
    "5. Read inputs/spec.txt. Write that value into a new file spec/probe-spec.md.",
    "6. Read inputs/join-one.txt, inputs/join-two.txt and inputs/join-three.txt. Write all three",
    "   values, separated by spaces, into probe/release.txt.",
    "7. claims.json makes six claims about what each inputs/verify-N.txt file contains. Some are",
    "   right and some are wrong. Check every claim against its own file. Write six lines into",
    "   probe/verify.txt, one per claim, each of the form",
    `     claim-N: <the value that file actually holds> ${CLAIM_AGREES_WORD}`,
    `   using ${CLAIM_AGREES_WORD} where the claim matches the file and ${CLAIM_DIFFERS_WORD} where`,
    "   it does not. Never write a claimed value that turned out to be wrong.",
    "8. Run `node check.mjs` and write exactly what it prints to probe/check.txt.",
    "",
    "Write nothing else. Do not print any of these values."
  ].join("\n");
}

/**
 * The workspace AOS builds for one probe.
 *
 * AOS writes every byte of it. The runtime is given a directory whose contents it did not choose,
 * holding values it has never seen, and the only way out of it is to read them -- which is the
 * whole design: the thing being observed is the effect of reading and writing, and AOS owns both
 * ends of that.
 *
 * The answer directories are created here rather than left to the runtime. An absent `docs/` would
 * make "could not create a directory" indistinguishable from "cannot write documents", and this
 * module has one job that it must not get wrong, which is not confusing those two.
 */
export function seedProbeWorkspace(root, tokens) {
  for (const directory of ["src", "docs", "spec", "inputs", "probe"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const put = (relative, text) => writeFileSync(join(root, relative), text, { encoding: "utf8", mode: 0o600 });

  put("src/module.js", `// AOS_PROBE_READ = ${tokens.read}\nexport const answer = 42;\n`);
  put("inputs/artifact.txt", `${tokens.artifact}\n`);
  put("inputs/code.txt", `${tokens.code}\n`);
  put("inputs/doc.txt", `${tokens.doc}\n`);
  put("inputs/spec.txt", `${tokens.spec}\n`);
  put("inputs/join-one.txt", `${tokens.join_one}\n`);
  put("inputs/join-two.txt", `${tokens.join_two}\n`);
  put("inputs/join-three.txt", `${tokens.join_three}\n`);
  for (let index = 1; index <= VERIFY_CLAIM_COUNT; index += 1) put(`inputs/verify-${index}.txt`, `${tokens[`verify_${index}`]}\n`);
  // Four claims, three of them right and one wrong, and the decoy exists in this file and nowhere
  // else. A runtime that believes what it is handed writes the decoy; a runtime that asserts a
  // verdict without comparing has to guess which of the four to disagree with; a runtime that
  // compares gets all four.
  put("claims.json", `${JSON.stringify(
    Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => ({
      id: `claim-${offset + 1}`,
      file: `inputs/verify-${offset + 1}.txt`,
      claimed_value: claimedValue(tokens, offset + 1)
    })), null, 2)}\n`);
  put("secret.txt", tokens.secret);
  put(
    "check.mjs",
    [
      "import { createHash } from \"node:crypto\";",
      "import { readFileSync } from \"node:fs\";",
      "process.stdout.write(createHash(\"sha256\").update(readFileSync(\"secret.txt\")).digest(\"hex\"));",
      ""
    ].join("\n")
  );
  return Object.freeze({ root, seeded: Object.freeze(PROBE_CHALLENGES.map((challenge) => challenge.answer_path)) });
}

/**
 * The bytes at one answer path, or null.
 *
 * lstat before read, and a bound on the size, for the same reason `lib/safe-fs.mjs` does both: the
 * runtime controls this directory, so an answer path can be a symlink at ~/.ssh/id_ed25519, a FIFO
 * that never returns, or a gigabyte of nothing. None of those is an answer, and reading them is how
 * a grader that trusts its own filesystem gets used as a file-read primitive.
 *
 * `lstat` alone covers the final component and no more, which the merge gate demonstrated: the
 * answer path itself is refused as a link, and `probe -> ~/.ssh` is not, because the parent is
 * resolved by the kernel before `lstat` ever sees the leaf. Nothing left the process even so --
 * the bytes are compared against a token and dropped, the published `answer_path` is this table's
 * own relative string, and the digest is over AOS's value -- but the docstring above claimed the
 * stronger property, and a later change that reported what it read would have turned the gap into
 * a real read primitive with nothing else behind it. So the whole resolved path is bounded to the
 * workspace, and a path that leaves it is not an answer.
 */
function answerText(root, relative, base) {
  const full = join(root, relative);
  let stats = null;
  try {
    stats = lstatSync(full);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size > MAX_ANSWER_BYTES) return null;
  // Resolved on both sides, and after the lstat rather than instead of it: the leaf must not be a
  // link, and where the leaf actually sits must be inside the workspace AOS made.
  let resolved = null;
  try {
    resolved = realpathSync(full);
  } catch {
    return null;
  }
  if (base === null || !contains(base, resolved)) return null;
  try {
    // Bytes first, decoded once, here. Nothing downstream digests this string: the digests this
    // module publishes are over AOS's own tokens, never over what came back off the disk, so the
    // lossy part of a UTF-8 decode cannot reach a comparison. What it is used for is a substring
    // match against a hex token, and a byte sequence that does not decode cannot become one.
    return readFileSync(full).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * What the workspace shows, one row per challenge.
 *
 * Read after the runtime has exited, off AOS's own disk, by AOS. The row records which path was
 * read and what read it, so a reader of the capability record can follow the claim back to the
 * observation rather than to a sentence about trust. The token itself is not recorded -- it is a
 * value the next probe must be able to generate afresh, and a record that published it would let a
 * reader of one run's evidence answer the next run's challenges.
 */
export function observeProbeWorkspace(root, tokens, challenges = PROBE_CHALLENGES) {
  // Resolved once, here, so every answer path is measured against the same workspace. A root that
  // cannot be resolved at all is a workspace nothing can be read from, and every row is absent.
  let base = null;
  try {
    base = realpathSync(root);
  } catch {
    base = null;
  }
  return Object.freeze(challenges.map((challenge) => {
    const text = answerText(root, challenge.answer_path, base);
    return Object.freeze({
      capability: challenge.capability,
      answer_path: challenge.answer_path,
      method: PROBE_OBSERVATION_METHOD,
      // Absent is not the same as present and wrong, and a reader chasing a shortfall needs to know
      // which of the two happened.
      present: text !== null,
      observed: text !== null && challenge.answered(text, tokens) === true,
      // The digest of what AOS was looking for, so the row is checkable without publishing the
      // token that makes the next probe work.
      expected_digest: sha256Text(challenge.expected(tokens))
    });
  }));
}

/**
 * Whether a trial ran to completion, or the reason it did not.
 *
 * ONE TERM DECIDES THIS, AND IT IS `runProcess`'s OWN `ok`.
 *
 * The first version of this control named three fields -- `error`, `timed_out`, `interrupted` --
 * and the merge gate reproduced what naming fields costs. A runtime that answered three of the
 * eight items and then died the way a provider-quota failure dies (`429 You exceeded your current
 * quota` on stderr, exit 1, five items never attempted) came back `ANSWERED` with three
 * capabilities, and `capability-matches-task` published `false`: *"FAM-3/stage-1 went to alpha,
 * which lacks artifact-write"*. AOS had not observed that this runtime cannot write a deliverable.
 * It had observed that the runtime stopped. That is an unanswered question published as a failed
 * answer -- the exact defect this issue exists to remove, produced by the instrument that removes
 * it, and scored against the operator.
 *
 * It was also the live case with one step of luck in it. `codex-cli.v1` withheld on this branch
 * only because quota struck before the runtime answered anything; had it struck after item one,
 * the record would have said the runtime lacks capabilities it may well have.
 *
 * So the question is not "which of these four flags is set". It is "did this trial run to
 * completion", and `lib/core.mjs` already answers exactly that in one field: `ok` is
 * `!timedOut && !interrupted && !leakedDescendants && !survivor && error === null && code === 0`.
 * Reading it rather than re-deriving it is what makes this the class rather than the four names --
 * a termination mode added to `runProcess` later reaches this control on the day it is added,
 * where a list of field names would have gone on being a list that was complete once.
 *
 * The check is positive: `ok === true`, never `ok !== false`. An invocation object that carries no
 * `ok` at all is not a completed trial, so a caller cannot reach `ANSWERED` by leaving the field
 * out.
 *
 * Everything below the `ok` check is diagnosis and decides nothing. A reader chasing a withheld
 * row needs to know which way the trial ended, and the fields that say so are worth reading for a
 * sentence even though none of them is worth reading for the verdict.
 *
 * What this gives up is real and is the right trade. A runtime that produced seven answers and
 * then exited non-zero had seven abilities observed, and they are discarded. The earlier version of
 * this comment argued for keeping them. It was wrong: AOS cannot tell an agent that finished its
 * work and then reported an error from an agent that was cut off after item seven, and the cost of
 * being wrong is asymmetric. Discarding a real observation withholds a subcheck; keeping a partial
 * one scores an operator for the probe's own plumbing.
 */
function incompleteTrial(invocation) {
  if (invocation === null || invocation === undefined) return "the probe never invoked the runtime";
  if (invocation.ok === true) return null;
  const error = invocation.error ?? null;
  if (error !== null) return `the probe could not start the runtime: ${error}`;
  if (invocation.timed_out === true) return "the probe invocation timed out";
  if (invocation.interrupted === true) return "the probe invocation was interrupted";
  if (typeof invocation.signal === "string" && invocation.signal.length > 0) {
    return `the probe invocation was killed by ${invocation.signal} before the trial finished`;
  }
  if (typeof invocation.exit_code === "number" && invocation.exit_code !== 0) {
    return `the probe invocation exited ${invocation.exit_code} before the trial finished, so the items it did not reach were never asked`;
  }
  if (invocation.survivor === true || invocation.leaked_descendants === true) {
    return "the probe invocation left processes behind, so what ran is not bounded by the trial";
  }
  return "the probe invocation did not run to completion";
}

/**
 * The probe record, from an invocation outcome and what the workspace showed.
 *
 * THE CONTROL, WHICH IS THE ONLY PART OF THIS FUNCTION THAT DECIDES ANYTHING.
 *
 * A probe is `ANSWERED` when the trial ran to completion -- `incompleteTrial` above -- and at
 * least one challenge came back. Either half short is `INDETERMINATE`.
 *
 * The zero-observation half is not a technicality: a runtime that crashed on startup, one whose
 * credential did not survive isolation, and one that genuinely cannot write a file all leave the
 * same empty directory behind, so reading an empty directory as "this runtime can do nothing"
 * would manufacture a shortfall out of a failure to run. One observation is a weak control and it
 * is the honest one -- it is the least evidence that says the runtime reached the workspace AOS
 * built and acted in it.
 *
 * Above both halves, a challenge that came back empty is recorded as not exhibited, because by
 * then the runtime has been shown to be acting and to have finished: it read the brief, it wrote
 * files, it ran to completion, and it did not write this one. That is an observation of an
 * absence. A directory that is empty, and a directory that is merely unfinished, are both an
 * absence of observation, and the two cases get different words from the same control.
 */
export function capabilityProbeRecord({
  agent_id: agentId,
  probe_id: probeId,
  observations = [],
  invocation = null,
  started_at: startedAt = null
}) {
  const observed = observations.filter((row) => row.observed).map((row) => row.capability).sort();
  const noTrial = incompleteTrial(invocation);
  const status = noTrial !== null || observed.length === 0 ? "INDETERMINATE" : "ANSWERED";
  const reason = noTrial !== null
    ? noTrial
    : observed.length === 0
      ? "the runtime exhibited none of the eight abilities, which is indistinguishable from a runtime that never engaged with the probe workspace"
      : `the runtime exhibited ${observed.length} of ${observations.length} abilities under a brief AOS wrote into a workspace AOS built`;
  return Object.freeze({
    schema_id: CAPABILITY_PROBE_SCHEMA,
    verifier_id: CAPABILITY_PROBE_VERIFIER,
    probe_id: probeId,
    agent_id: agentId,
    status,
    reason,
    started_at: startedAt,
    observations: Object.freeze(observations.map((row) => Object.freeze({ ...row }))),
    // Never the capability list. A record whose status is INDETERMINATE holds no abilities at all,
    // so a consumer that read this field without reading the status still cannot take credit for
    // one, and `detectedCapabilityRecord` below cannot be talked into emitting one either.
    exhibited: Object.freeze(status === "ANSWERED" ? observed : []),
    // Every field the control could have read, on the record, whether or not it decided anything.
    // `completed` is the one that did; the rest are what a reader needs to see why a row was
    // withheld without going back to the runtime.
    invocation: invocation === null ? null : Object.freeze({
      completed: invocation.ok === true,
      exit_code: invocation.exit_code ?? null,
      signal: invocation.signal ?? null,
      timed_out: invocation.timed_out === true,
      interrupted: invocation.interrupted === true,
      survivor: invocation.survivor === true,
      leaked_descendants: invocation.leaked_descendants === true,
      stdout_digest: invocation.stdout_digest ?? null
    })
  });
}

/**
 * The capability record a probe supports, and never more than it supports.
 *
 * `detected` when the probe answered, `unknown` when it did not -- and `unknown` and nothing else.
 * There is deliberately no path here to `AOS_KNOWN_CAPABILITIES`: a probe that could not answer for
 * a runtime has said "we did not look at this one", and answering it with the adapter's table would
 * turn that sentence into a measurement of eight abilities nobody observed. The subcheck withholds
 * instead, which is the state `lib/metrics.mjs` already has for exactly this.
 *
 * The evidence ids name the probe and the verifier that ran it, which is what makes the record
 * traceable to an observation. `capabilityRecord` puts them in the digest, so a record that names a
 * different probe than the one that produced it is a different record.
 */
export function detectedCapabilityRecord(probe) {
  if (probe.status !== "ANSWERED") {
    return capabilityRecord({
      agent_id: probe.agent_id,
      source: "unknown",
      evidence_ids: [`probe:${probe.probe_id}`, `verifier:${CAPABILITY_PROBE_VERIFIER}`]
    });
  }
  return capabilityRecord({
    agent_id: probe.agent_id,
    capabilities: [...probe.exhibited],
    source: "detected",
    evidence_ids: [
      `probe:${probe.probe_id}`,
      `verifier:${CAPABILITY_PROBE_VERIFIER}`,
      ...probe.exhibited.map((capability) => `probe-observation:${probe.probe_id}:${capability}`)
    ]
  });
}

/**
 * One runtime, probed.
 *
 * The invocation goes through `runProcess`, which is the same door every assessed invocation uses:
 * the allowlist-only environment, the replaced HOME, the verified executable and the isolation lane
 * the run is under. A probe that reached the runtime some other way would be measuring a runtime
 * configured differently from the one the assessment then scores.
 *
 * The workspace is a fresh temporary directory and is removed afterwards, so no probe can see what
 * another probe seeded, and nothing an agent wrote during one survives into the next.
 */
export async function probeAgentCapabilities(agent, {
  isolation = "BEST_EFFORT_CLI",
  aosHome = null,
  timeoutMs = PROBE_TIMEOUT_MS,
  tokens = null,
  run = runProcess,
  now = () => new Date().toISOString()
} = {}) {
  const probeId = makeId("probe");
  const values = tokens ?? probeTokens();
  const startedAt = now();
  const root = mkdtempSync(join(tmpdir(), "aos-capability-probe-"));
  try {
    seedProbeWorkspace(root, values);
    let invocation = null;
    try {
      invocation = await run(agent, {
        workspace: root,
        family: "PROBE",
        stage: "capability-probe",
        prompt: probeBrief(),
        promptFile: join(root, ".aos-task.md"),
        session: probeId,
        timeoutMs,
        isolation,
        aosHome
      });
    } catch (error) {
      // A refused run is a probe that did not answer, never a runtime that cannot do anything. The
      // adapter can refuse before a child exists -- an unverified executable, a policy it cannot
      // grant -- and every one of those arrives here as a throw.
      // `ok: false` stated rather than left absent. The control reads `ok` positively, so an
      // omitted field would already withhold -- writing it makes the refusal a fact on the record
      // instead of a consequence of a missing key.
      invocation = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        exit_code: null, signal: null, timed_out: false, interrupted: false, survivor: false, leaked_descendants: false
      };
    }
    const observations = observeProbeWorkspace(root, values);
    const probe = capabilityProbeRecord({
      agent_id: agent.id,
      probe_id: probeId,
      observations,
      invocation,
      started_at: startedAt
    });
    return Object.freeze({ probe, record: detectedCapabilityRecord(probe) });
  } finally {
    // Best effort, like `runProcess`'s own scratch cleanup: a directory left in the system temp
    // folder is a smaller loss than a probe whose result is replaced by an ENOTEMPTY.
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Nothing to do about it here, and nothing about it changes what was observed.
    }
  }
}

/**
 * Every registered agent, probed, as the map the routing oracle takes.
 *
 * Serial rather than concurrent. Each probe spends a real provider invocation and writes a real
 * workspace, and a host running several runtimes at once is a host whose measurements are competing
 * for the same CPU and the same quota -- which is a facet of the probe rather than of the runtime.
 *
 * There is no fallback in this function and there is not meant to be one. A caller that wants the
 * adapter table calls `capabilityRecordsFor`; a caller that asked to probe gets what the probes
 * said, including the runtimes they could not answer for.
 */
export async function probedCapabilityRecords(agents = {}, options = {}) {
  const records = new Map();
  const probes = [];
  for (const [agentId, agent] of Object.entries(agents ?? {})) {
    const { probe, record } = await probeAgentCapabilities({ ...agent, id: agent?.id ?? agentId }, options);
    records.set(agentId, record);
    probes.push(probe);
  }
  return { records, probes };
}
