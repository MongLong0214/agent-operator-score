// One probe, one process, no authority.
//
// This file is never executed from disk. The controller reads its bytes once, before it has spawned
// anything and therefore before any assessed code has run, and hands that string to
// `node --input-type=module -e`. That is not a stylistic choice: the assessed module runs with
// AOS's own filesystem permissions and can overwrite files in the AOS installation, so a runner
// spawned by path would be the attacker's runner from the second probe onwards. A module that did
// this reported six perfect observations while its ratio() was wrong for five of them. Nothing this
// process executes is read from disk after the module has had a turn.
//
// For the same reason there are no repository imports here. A relative import is a disk read at
// child startup, so `fam5-probes.mjs` and `fam5-result.mjs` would be exactly the same hole one
// level down. The probe arrives on the argument vector and the result line is four concatenations.
//
// What this process is trusted with is one raw observation about one call. It is not trusted with
// the verdict: that is computed by the controller, in a process the assessed module never enters,
// against expectations this process never sees.
//
// The references below are captured before the dynamic import at the bottom, so a module that
// replaces `fs.writeSync`, `Number.prototype.toString` or the error constructors afterwards is not
// replacing anything this file calls. Capturing is what keeps the observation honest against a
// module that patches; it is not what keeps it honest against a module that writes its own line.
// Nothing in a single process can do that -- see the note on the result token below.

import { readFileSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RESULT_FD = 3;

const write = writeSync;
const applyTo = Reflect.apply;
const prototypeOf = Object.getPrototypeOf;
const box = Object;
const parseJson = JSON.parse;
const numberToString = Number.prototype.toString;

// Compared by identity against the prototype chain rather than with `instanceof`. `instanceof`
// consults RangeError[Symbol.hasInstance], and the assessed module holds a reference to the very
// same RangeError this file captured, so it could install one that answers true to anything.
const ERROR_NAMES = ["RangeError", "TypeError", "SyntaxError", "ReferenceError", "Error"];
const ERROR_PROTOTYPES = [
  RangeError.prototype,
  TypeError.prototype,
  SyntaxError.prototype,
  ReferenceError.prototype,
  Error.prototype
];

// The token arrives on stdin and is consumed there, so it is in no environment and no argument
// vector. It is not, however, a secret from the assessed module: a heap snapshot taken from inside
// this process recovers closure strings, and `node:inspector` reaches further still. Verified.
//
// So the token is a cost, not a guarantee. It defeats a module that writes a line without looking
// for it -- which is every module that has not been written against this specific design -- and it
// binds a result to the spawn that asked for it, so a line written for one probe cannot answer
// another. What it does not do is make the observation trustworthy, because nothing in a process
// can distinguish code the module wrote from code this file wrote. That residual is bounded by
// what a subject can reach at all, which is #556's surface, and it is stated in the verdict rather
// than argued away: see `observation_trust` in the controller.
const token = (() => {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
})();

// Executed through `-e`, so argv holds only what the controller passed: no script path.
const assessedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const probeId = process.argv[2] ?? "";
const args = (() => {
  try {
    const parsed = parseJson(process.argv[3] ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

// The module can read both and learns nothing from either that the call arguments do not already
// tell it. They are cleared so the next reader does not mistake them for a channel.
process.argv = process.argv.slice(0, 1);

/** Which error class the thrown value really is, by walking its prototype chain. */
const errorName = (value) => {
  let node;
  try {
    node = prototypeOf(box(value));
  } catch {
    return "other";
  }
  while (node !== null && node !== undefined) {
    for (let index = 0; index < ERROR_PROTOTYPES.length; index += 1) {
      if (node === ERROR_PROTOTYPES[index]) return ERROR_NAMES[index];
    }
    try {
      node = prototypeOf(node);
    } catch {
      return "other";
    }
  }
  return "other";
};

const numberText = (value) => {
  try {
    const text = applyTo(numberToString, value, [10]);
    return typeof text === "string" && text.length > 0 ? text : "unprintable";
  } catch {
    return "unprintable";
  }
};

// Four concatenations of strings, and no serialiser. The format is duplicated from
// fam5-result.mjs rather than imported, because importing it would be a disk read at startup --
// the hole this file exists to close. A test asserts the two spellings still agree.
const report = (kind, detail) => {
  try {
    write(RESULT_FD, "AOS_OBS " + token + " " + probeId + " " + kind + " " + detail + "\n");
  } catch {
    // The controller reads a probe that reported nothing as a refusal, which is the correct reading
    // of a subject whose result channel was closed under it.
  }
};

const main = async () => {
  if (probeId.length === 0 || assessedUrl.length === 0) {
    report("internal", "unknown-probe");
    return;
  }
  let module;
  try {
    module = await import(assessedUrl);
  } catch (error) {
    report("import-failed", errorName(error));
    return;
  }
  if (typeof module.ratio !== "function") {
    report("no-export", "ratio");
    return;
  }
  let value;
  try {
    value = applyTo(module.ratio, undefined, args);
  } catch (error) {
    report("threw", errorName(error));
    return;
  }
  if (typeof value !== "number") {
    report("returned-other", typeof value);
    return;
  }
  report("returned", numberText(value));
};

// Exit status is not how this process reports its finding, but a non-zero exit is still a refusal
// at the controller, so a subject that fell over must not exit as though it had not.
main().then(
  () => {
    process.exitCode = 0;
  },
  () => {
    process.exitCode = 1;
  }
);
