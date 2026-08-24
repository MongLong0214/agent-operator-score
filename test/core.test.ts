import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canonicalJson, normalizeLineEndings } from "../src/core/canonical-json.ts";
import { sha256Text, sha256FileText, sha256Value, isDigest } from "../src/core/digest.ts";
import {
  AOS_ERROR_CODES,
  EXIT,
  exitCodeFor,
  failure,
  isAosFailure,
  type AosErrorCode
} from "../src/core/errors.ts";
import {
  checkSupportedEnvironment,
  isSupportedNodeVersion,
  SUPPORTED_NODE_RANGE
} from "../src/core/platform.ts";

describe("canonical-json", () => {
  test("key order never reaches the output", () => {
    // The whole point of canonicalization: two objects that differ only in insertion order are one
    // document. If this ever differs, every recorded digest silently depends on authoring order.
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  test("sorting reaches nested objects and does not reorder arrays", () => {
    assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
    // Array order is data. Sorting it would silently change what a trace says happened first.
    assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  });

  test("a value with no JSON representation is refused, not dropped", () => {
    // A dropped key changes a digest while changing nothing a reader can see, which is the worst
    // possible failure for a format whose only job is to be comparable.
    assert.throws(() => canonicalJson({ a: undefined } as never), /no JSON representation/);
    assert.throws(() => canonicalJson(Number.NaN), /no JSON representation/);
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /no JSON representation/);
  });

  test("the algorithm still matches the one the pinned digests were produced with", async () => {
    // Transcribed from scripts/verify-g0.mjs. If these ever disagree, every fixture digest in the
    // repository refers to bytes this code no longer produces.
    const g0 = (await import("../scripts/verify-g0.mjs")) as {
      canonicalJsonBytes: (value: unknown) => string;
    };
    for (const value of [
      { b: 1, a: [2, { d: 4, c: 3 }] },
      [],
      {},
      "text",
      0,
      -1.5,
      true,
      null,
      { "key with \"quotes\"": "value\nwith\nnewlines" }
    ]) {
      assert.equal(canonicalJson(value as never), g0.canonicalJsonBytes(value), JSON.stringify(value));
    }
  });

  test("CRLF and LF are one document for digest purposes", () => {
    assert.equal(normalizeLineEndings("a\r\nb\rc\nd"), "a\nb\nc\nd");
    assert.equal(sha256FileText("a\r\nb"), sha256FileText("a\nb"));
    // But the raw text digest must still distinguish them, or normalization has nothing to do.
    assert.notEqual(sha256Text("a\r\nb"), sha256Text("a\nb"));
  });
});

describe("digest", () => {
  test("a value digest goes through canonical JSON, not through String()", () => {
    // sha256Text(String(obj)) hashes "[object Object]": stable, wrong, and invisible downstream.
    assert.equal(sha256Value({ a: 1, b: 2 }), sha256Value({ b: 2, a: 1 }));
    assert.notEqual(sha256Value({ a: 1 }), sha256Text(String({ a: 1 })));
  });

  test("isDigest accepts only lowercase 64-hex", () => {
    const real = sha256Text("x");
    assert.equal(isDigest(real), true);
    assert.equal(isDigest(real.toUpperCase()), false, "case-insensitive matching admits two spellings of one digest");
    assert.equal(isDigest(real.slice(0, 63)), false);
    assert.equal(isDigest(`${real}0`), false);
    assert.equal(isDigest(""), false);
    assert.equal(isDigest(null), false);
  });
});

describe("errors", () => {
  test("every declared code has an exit code, and none is a stray", () => {
    for (const code of AOS_ERROR_CODES) {
      const exit = exitCodeFor(code);
      assert.ok(Object.values(EXIT).includes(exit), `${code} maps outside the exit vocabulary`);
    }
    // The union and the runtime list are one vocabulary in two forms; a code added to only one of
    // them is the defect this catches.
    const declared: AosErrorCode[] = [...AOS_ERROR_CODES];
    assert.equal(new Set(declared).size, declared.length, "a code is listed twice");
  });

  test("a failure is recognisable and carries a way forward", () => {
    const f = failure("AOS_RUNTIME_NOT_FOUND", "Codex was not found on PATH.", "Install Codex.");
    assert.equal(isAosFailure(f), true);
    assert.equal(f.ok, false);
    assert.equal(f.run_id, null);
    assert.match(f.remediation, /\S/, "a code with no way forward is a dead end, not an error");
  });

  test("isAosFailure refuses a shape that merely looks like one", () => {
    assert.equal(isAosFailure({ ok: false, code: "NOT_A_REAL_CODE" }), false);
    assert.equal(isAosFailure({ ok: true, code: "AOS_INTERNAL_ERROR" }), false);
    assert.equal(isAosFailure(null), false);
    assert.equal(isAosFailure("AOS_INTERNAL_ERROR"), false);
  });

  test("abort and unsafe are distinct exits", () => {
    // Collapsing these would make "the user stopped it" indistinguishable from "the run was unsafe".
    assert.notEqual(exitCodeFor("AOS_USER_ABORTED"), exitCodeFor("AOS_TRACE_INVALID"));
    assert.equal(exitCodeFor("AOS_USER_ABORTED"), EXIT.ABORTED);
  });
});

describe("platform", () => {
  test("the supported Node range is bounded on both ends", () => {
    assert.equal(isSupportedNodeVersion("v22.18.0"), true, "the lower bound is inclusive");
    assert.equal(isSupportedNodeVersion("v22.17.9"), false, "22.17 is below the range");
    assert.equal(isSupportedNodeVersion("v24.99.0"), true);
    assert.equal(isSupportedNodeVersion("v25.0.0"), false, "the upper bound is exclusive");
    assert.equal(isSupportedNodeVersion("v21.9.0"), false);
    assert.equal(isSupportedNodeVersion("not-a-version"), false);
    assert.match(SUPPORTED_NODE_RANGE, /22\.18/);
  });

  test("Windows is refused rather than branched on", () => {
    const refused = checkSupportedEnvironment({ platform: "win32", arch: "x64", nodeVersion: "v22.18.0" });
    assert.ok(refused, "an unsupported platform must not pass");
    assert.equal(refused.code, "AOS_UNSUPPORTED_PLATFORM");
    assert.match(refused.message, /macOS and Linux/);
  });

  test("an unsupported CPU is refused even on a supported OS", () => {
    const refused = checkSupportedEnvironment({ platform: "linux", arch: "ia32", nodeVersion: "v22.18.0" });
    assert.equal(refused?.code, "AOS_UNSUPPORTED_PLATFORM");
  });

  test("platform is checked before Node version", () => {
    // Reporting a Node problem on Windows sends the user to fix the wrong thing.
    const refused = checkSupportedEnvironment({ platform: "win32", arch: "x64", nodeVersion: "v18.0.0" });
    assert.equal(refused?.code, "AOS_UNSUPPORTED_PLATFORM");
  });

  test("a supported environment returns null", () => {
    assert.equal(checkSupportedEnvironment({ platform: "darwin", arch: "arm64", nodeVersion: "v22.18.0" }), null);
    assert.equal(checkSupportedEnvironment({ platform: "linux", arch: "x64", nodeVersion: "v24.1.0" }), null);
  });
});
