import assert from "node:assert/strict";
import test from "node:test";

import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { primaryConstraint, renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";

const observations = (over = {}) =>
  METRIC_IDS.map((id) => {
    if (over.unobserved?.includes(id)) return observationOf({ metric_id: id, reason: "not observed" });
    const passing = over.passing?.[id] ?? 4;
    return observationOf({
      metric_id: id,
      verifier_id: "report.test",
      subchecks: METRICS[id].subchecks.map((subcheck, index) => ({ id: subcheck, pass: index < passing })),
      evidence_ids: ["event-1", "artifact-2"],
      reason: "fixture"
    });
  });

const resultOf = (over = {}, context = {}) => {
  const metrics = observations(over);
  return {
    ...scoreRun(metrics, context),
    run_id: "run-fixture",
    metrics,
    limitations: ["PROFILE-BOUND: this number describes the declared environment."]
  };
};

test("the report leads with what is wrong, not with the number", () => {
  // Failures sort to the top. A table that starts with what went right makes a reader hunt for the
  // one row that matters.
  const html = renderHtml(resultOf({ passing: { M12: 1, M05: 2 } }));
  const order = ["M12", "M05"].map((id) => html.indexOf(`>${id}<`));
  assert.equal(order.every((index) => index > 0), true);
  assert.equal(order[0] < order[1], true, "the worse metric came second");
  assert.equal(html.indexOf(">M12<") < html.indexOf(">M01<"), true, "a passing metric outranked a failure");
});

test("the primary constraint is the worst metric, broken by weight", () => {
  // Two metrics equally bad: the one in the quarter of the scale that is verification outranks the
  // one in a fifteenth.
  const tie = primaryConstraint(resultOf({ passing: { M14: 1, M01: 1 } }));
  assert.equal(tie.metric_id, "M14", "the heavier dimension should be named first");

  const clear = primaryConstraint(resultOf({ passing: { M12: 0 } }));
  assert.equal(clear.metric_id, "M12");
  assert.equal(clear.failed.length, 4);
  assert.match(clear.lever, /M12 Intervention Quality/);
});

test("something nobody observed is never the thing to fix first", () => {
  // `null < 1` is true in JavaScript, so an unobserved metric sorts below every failure and would
  // be named as the worst one. "We did not look" is not the operator's most urgent problem.
  const result = resultOf({ unobserved: ["M11", "M12", "M13"], passing: { M05: 1 } });
  const constraint = primaryConstraint(result);
  assert.equal(constraint.metric_id, "M05");
  assert.equal(["M11", "M12", "M13"].includes(constraint.metric_id), false);
  assert.equal(renderHtml(result).includes("Fix this first</h2><p><strong>M11"), false);
});

test("a run with nothing wrong names no constraint", () => {
  assert.equal(primaryConstraint(resultOf()), null);
  assert.equal(primaryConstraint({ metrics: [] }), null);
});

test("a withheld score says so and says what it would have been", () => {
  const result = resultOf({ unobserved: ["M11", "M12", "M13"] });
  const html = renderHtml(result);
  assert.match(html, /Score withheld/);
  assert.match(html, /provisional 85/);
  assert.match(html, /Why there is no score/);
  assert.match(html, /COVERAGE/);
  assert.equal(html.includes(">85<"), false, "the provisional number was shown as the score");
});

test("a ceiling says what it cost and why", () => {
  const capped = resultOf({}, { safetyState: "S2" });
  const html = renderHtml(capped);
  assert.match(html, /Ceilings/);
  assert.match(html, /CRITICAL_SAFETY/);
  assert.match(html, /capped from 100/);
});

test("every metric opens to its four subchecks and its verifier", () => {
  // A number whose author cannot be named cannot be checked, and the reader has to be able to see
  // which of the four questions was answered no.
  const html = renderHtml(resultOf({ passing: { M19: 2 } }));
  assert.match(html, /<details>/);
  assert.match(html, /no-secret-leak/);
  assert.match(html, /report\.test/);
  assert.match(html, /2 of four failed/);
});

test("state is spelled out, never carried by colour alone", () => {
  // Colour is not a way to tell a reader that something failed.
  const html = renderHtml(resultOf({ passing: { M12: 0 } }));
  assert.match(html, /<td>FAIL<\/td>/);
  assert.match(html, /FAIL — /, "a failing subcheck should say so in words");
  assert.match(html, /<td>NOT_OBSERVED<\/td>|NOT_OBSERVED/);
});

test("the page asks for nothing from anywhere", () => {
  // A report that fetched anything would report the fact that it had been opened, and this is a
  // local artifact about the operator's own work.
  const html = renderHtml(resultOf());
  assert.equal(/<script/i.test(html), false);
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/@import|url\(/i.test(html), false);
  assert.equal(/<iframe|<img/i.test(html), false);
});

test("the palette is tokens, and the dark and light values are both declared", () => {
  const html = renderHtml(resultOf());
  for (const token of ["--bg", "--surface", "--border", "--text", "--muted", "--accent", "--good", "--warn", "--bad", "--radius"]) {
    assert.equal(html.includes(token), true, token);
  }
  assert.match(html, /prefers-color-scheme:dark/);
});

test("it is readable on a phone, on paper, and by a screen reader", () => {
  const html = renderHtml(resultOf());
  assert.match(html, /@media print/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /scope="col"/);
  assert.match(html, /scope="row"/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<html lang="en">/);
});

test("the boundary travels with the number", () => {
  for (const render of [renderHtml, renderMarkdown]) {
    const output = render(resultOf());
    assert.match(output, /PROFILE-BOUND/);
    assert.match(output, /different measurements/);
  }
});

test("markdown carries the same content as the page", () => {
  const result = resultOf({ passing: { M12: 1 } });
  const markdown = renderMarkdown(result);
  assert.match(markdown, /## Fix this first/);
  assert.match(markdown, /M12/);
  assert.match(markdown, /## Dimensions/);
  assert.match(markdown, /## Metrics/);
  assert.match(markdown, /## Limitations/);
  // Every metric appears, including the ones nobody observed.
  for (const id of METRIC_IDS) assert.match(markdown, new RegExp(`\\| ${id} \\|`), id);
});

test("a result carrying no metrics still renders", () => {
  // Recovery re-renders whatever is on disk, and a half-written result must not take the page down.
  const bare = { run_id: "r", status: "INCOMPLETE", score: null, provisional_raw: 0, dimensions: {}, coverage: { observed: 0, total: 20 }, caps: [], blockers: [] };
  assert.doesNotThrow(() => renderHtml(bare));
  assert.doesNotThrow(() => renderMarkdown(bare));
});
