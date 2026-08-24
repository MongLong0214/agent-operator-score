import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_NESTING,
  MAX_VALUES,
  PAYLOAD_ALLOWLIST,
  looksSecret,
  projectPayload,
  refusalReason
} from "../src/trace/privacy-projection.ts";

// The contract declares the canary value; guessing its shape is how a detector misses it.
const CANARY = "AOS_SECRET_CANARY";

describe("privacy projection: default deny", () => {
  test("an event type with no allowlist keeps nothing", () => {
    // New event types must be silent by default. Permissive-by-default is how a field nobody
    // reviewed starts being written to disk.
    const projected = projectPayload("some.new.event", { anything: "at all" });
    assert.equal(projected.payload, null);
    assert.equal(projected.redaction, "dropped");
  });

  test("only allowlisted fields survive, and the rest are reported as removed", () => {
    const projected = projectPayload("tool.call", {
      tool_name: "write_file",
      target_path: "src/a.ts",
      argument_count: 2,
      input_digest: "a".repeat(64),
      raw_arguments: "the actual prompt text",
      stdout: "output"
    });
    assert.deepEqual(Object.keys(projected.payload ?? {}).sort(), [
      "argument_count",
      "input_digest",
      "target_path",
      "tool_name"
    ]);
    assert.equal(projected.redaction, "redacted");
    assert.deepEqual(projected.removed, ["raw_arguments", "stdout"]);
  });

  test("no allowlist admits a raw-content field", () => {
    // The primary control is that raw text is never storable. If any allowlist ever names a field
    // that carries content rather than a measurement or a digest, this fails.
    const RAW = /^(raw|text|body|content|prompt|stdout|stderr|message|arguments|output)$/;
    for (const [event, fields] of Object.entries(PAYLOAD_ALLOWLIST)) {
      for (const field of fields) {
        assert.equal(RAW.test(field), false, `${event} allowlists a raw-content field: ${field}`);
      }
    }
  });
});

describe("privacy projection: keys are a channel too", () => {
  test("a secret in a key drops the field, not just a secret in a value", () => {
    const inValue = projectPayload("tool.call", { tool_name: `sk-${"a".repeat(20)}` });
    assert.equal(inValue.payload, null);

    const inKey = projectPayload("tool.call", {
      target_path: { [`sk-${"b".repeat(20)}`]: "x" }
    });
    assert.equal(inKey.payload, null, "a secret smuggled in an object key survived projection");
  });

  test("a secret nested inside an allowlisted value is caught", () => {
    const projected = projectPayload("context.selected", {
      item_count: 2,
      digests: ["a".repeat(64), `Bearer ${"c".repeat(32)}`]
    });
    assert.equal(projected.removed.includes("digests"), true);
    assert.deepEqual(Object.keys(projected.payload ?? {}), ["item_count"]);
  });
});

describe("privacy projection: detector floor", () => {
  test("the named detector families all match", () => {
    for (const [label, sample] of [
      ["OpenAI-style", `sk-${"a".repeat(32)}`],
      ["Anthropic-style", `sk-ant-${"b".repeat(32)}`],
      ["GitHub token", `ghp_${"C".repeat(36)}`],
      ["AWS access key", "AKIAIOSFODNN7EXAMPLE"],
      ["bearer token", `Bearer ${"d".repeat(40)}`],
      ["private key header", "-----BEGIN RSA PRIVATE KEY-----"],
      ["generic assignment", "SERVICE_TOKEN=abcdef123456"],
      ["database URL credential", "postgres://user:hunter2@db.example.com/app"],
      ["fixed canary", CANARY],
      ["hidden reasoning marker", "<thinking>internal</thinking>"]
    ] as [string, string][]) {
      assert.equal(looksSecret(sample), true, `${label} is not detected`);
    }
  });

  test("the canary the contract declares is the canary the detector looks for", async () => {
    const contract = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(new URL("../specs/events.v0.json", import.meta.url), "utf8"))
    ) as { secret_canary: string };
    assert.equal(CANARY, contract.secret_canary);
    assert.equal(looksSecret(contract.secret_canary), true, "the declared canary is not detected");
  });

  test("ordinary content is not swept up", () => {
    for (const benign of ["src/index.ts", "write_file", "a".repeat(64), "count=12", "https://example.com/docs"]) {
      assert.equal(looksSecret(benign), false, `${benign} was treated as a secret`);
    }
  });

  test("passing the detectors does not earn raw storage", () => {
    // A field that no detector matches is still dropped when it is not allowlisted. This is the
    // property that keeps the detectors secondary rather than load-bearing.
    const projected = projectPayload("tool.result", { success: true, raw_output: "perfectly ordinary text" });
    assert.deepEqual(Object.keys(projected.payload ?? {}), ["success"]);
    assert.equal(projected.removed.includes("raw_output"), true);
  });
});

describe("privacy projection: bounded and inert inspection", () => {
  test("a getter is never executed", () => {
    let called = false;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "target_path", {
      enumerable: true,
      get() {
        called = true;
        return "src/a.ts";
      }
    });
    const projected = projectPayload("tool.call", hostile);
    assert.equal(called, false, "projection executed a getter the payload controls");
    assert.equal(projected.payload, null);
  });

  test("a custom toJSON or toString drops the payload", () => {
    const withToJson = { tool_name: "x", toJSON: () => ({ tool_name: "y" }) };
    assert.equal(projectPayload("tool.call", withToJson).payload, null);
  });

  test("a cycle is refused as a cycle, not by running out of depth", () => {
    // PRD 16.4 names accessor refusal and cycle detection as separate controls. Both used to be
    // masked -- an accessor carries no `value`, and a cycle hits MAX_NESTING first -- so deleting
    // either changed no outcome and no test could tell. The reason is asserted, not just the drop.
    const cyclic: Record<string, unknown> = { tool_name: "x" };
    cyclic.self = cyclic;
    assert.equal(projectPayload("tool.call", cyclic).payload, null);
    assert.equal(refusalReason(cyclic), "cycle");
  });

  test("an accessor is refused as an accessor", () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "target_path", { enumerable: true, get: () => "src/a.ts" });
    assert.equal(refusalReason(hostile), "accessor");
  });

  test("nesting past the limit is refused", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_NESTING + 2; i += 1) deep = { nested: deep };
    assert.equal(projectPayload("tool.call", { target_path: deep }).payload, null);
  });

  test("a payload past the value budget is refused", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_VALUES + 10; i += 1) wide[`k${i}`] = i;
    assert.equal(projectPayload("tool.call", { target_path: wide }).payload, null);
  });

  test("a non-object payload is dropped, and an absent one is not an error", () => {
    assert.equal(projectPayload("tool.call", "raw string").payload, null);
    assert.equal(projectPayload("tool.call", ["array"]).payload, null);
    const absent = projectPayload("tool.call", null);
    assert.equal(absent.payload, null);
    assert.equal(absent.redaction, "none", "an absent payload is not a redaction");
  });
});
