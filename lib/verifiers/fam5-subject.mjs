// One probe, one process, no authority.
//
// The assessed module runs here, so this process is compromised by assumption. That is the design,
// not a concession: everything this process is trusted with is one raw observation about one call,
// and the controller that decides what the observation means is somewhere else, holding a nonce
// this process has never been given and writing to a stdout this process cannot reach.
//
// What remains is to keep the observation itself from being fabricated, and that is what the
// captures below are for. A module body runs during the dynamic import at the bottom of this file,
// which is after every reference on this page has already been taken. `RangeError` reassigned
// afterwards is a different object from the prototype captured here; `Number.prototype.toString`
// replaced afterwards is not the function `numberText` calls; `fs.writeSync` replaced afterwards is
// not the function `report` calls. The module can still return the wrong number -- and then the
// wrong number is what gets reported, which is the point.
//
// Nothing here reads process.env or keeps the arguments around. The token that binds this report to
// the spawn that asked for it arrives on stdin and is consumed there, so by the time the module
// loads the only copy is in a closure, which is the one place in a JavaScript process that other
// code in it cannot read.

import { readFileSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PROBES } from "./fam5-probes.mjs";
import { RESULT_FD, formatObservation } from "./fam5-result.mjs";

const write = writeSync;
const applyTo = Reflect.apply;
const prototypeOf = Object.getPrototypeOf;
const box = Object;
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

const token = (() => {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
})();

const assessedUrl = process.argv[2] ? pathToFileURL(process.argv[2]).href : "";
const probeId = process.argv[3] ?? "";
const probe = PROBES.find((entry) => entry.id === probeId) ?? null;
// A copy, taken now. PROBES is importable from inside the assessed module, and a module that could
// rewrite the arguments of the divide-by-zero probe would be answering a question nobody asked.
const args = probe === null ? [] : [...probe.call];

// The module can read both, and neither says anything the parent needs kept secret -- but leaving
// them in place invites the next reader to assume a channel exists here that does not.
process.argv = process.argv.slice(0, 2);

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

const report = (kind, detail) => {
  try {
    write(RESULT_FD, formatObservation(token, probeId, kind, detail));
  } catch {
    // The controller reads a probe that reported nothing as a refusal, which is the correct reading
    // of a subject whose result channel was closed under it.
  }
};

const main = async () => {
  if (probe === null) {
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
