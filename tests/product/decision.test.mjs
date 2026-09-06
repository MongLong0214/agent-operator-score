import assert from "node:assert/strict";
import test from "node:test";

import { allRequired, decisionOutcome, isEstablished } from "../../lib/decision.mjs";

test("the shared decision representation preserves established, contradicted, and withheld", () => {
  assert.equal(isEstablished(true), true);
  assert.equal(isEstablished(false), false);
  assert.equal(isEstablished(null), false);
  assert.equal(allRequired([true, true]), true);
  assert.equal(allRequired([true, false, null]), false, "a contradiction outranks a withholding");
  assert.equal(allRequired([true, null]), null);
  assert.equal(allRequired([null, null]), null);
  assert.equal(allRequired([]), null);
  assert.equal(allRequired(undefined), null);
  assert.equal(allRequired([true, "not-checked"]), null, "a domain status is not a confirmed decision");
});

test("success and exit status are derived only by the shared decision projection", () => {
  assert.deepEqual(decisionOutcome(true), { decision: true, ok: true, exit_code: 0 });
  assert.deepEqual(decisionOutcome(false), { decision: false, ok: false, exit_code: 5 });
  assert.deepEqual(decisionOutcome(null), { decision: null, ok: false, exit_code: 4 });
  assert.deepEqual(decisionOutcome(undefined, { established: 0, contradicted: 31, withheld: 32 }), { decision: null, ok: false, exit_code: 32 });
});
