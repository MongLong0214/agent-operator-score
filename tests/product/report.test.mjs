import assert from "node:assert/strict";
import test from "node:test";

import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { primaryConstraint, renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { CAPS, MINIMUM_OBSERVED, REQUIRED_METRICS, bandOf, scoreRun } from "../../lib/scorer-v1.mjs";

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
  // The wording is plainer than it was; what has to hold is that the page says there is no score,
  // says what it would have been, and says why.
  assert.match(html, /No score for this run/);
  assert.match(html, /it would have scored<\/span>.{0,80}85/s);
  assert.match(html, /Why there is no score/);
  assert.match(html, /COVERAGE/);
  assert.equal(html.includes(">85<"), false, "the provisional number was shown as the score");
});

test("a ceiling says what it cost and why", () => {
  const capped = resultOf({}, { safetyState: "S2" });
  const html = renderHtml(capped);
  assert.match(html, /What is holding this score down/);
  assert.match(html, /CRITICAL_SAFETY/);
  assert.match(html, /held down from<\/span>.{0,60}100/s);
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
  // The state cell is a chip now. It still carries the word, in both languages, so the shading is
  // never the only thing that says a metric failed.
  assert.match(html, /class="chip c-FAIL"/);
  assert.match(html, /class="chip c-FAIL"><span class="en">fail<\/span><span class="ko">실패<\/span>/);
  assert.match(html, /FAIL — /, "a failing subcheck should say so in words");
  assert.match(html, /c-NOT_OBSERVED/);
});

test("the page asks for nothing from anywhere", () => {
  // A report that fetched anything would report the fact that it had been opened, and this is a
  // local artifact about the operator's own work.
  const html = renderHtml(resultOf());
  assert.equal(/<script/i.test(html), false);
  assert.equal(/@import/i.test(html), false);
  // `url(#id)` points at a gradient in this same document -- the scorecard defines two. Anything
  // else inside url() names somewhere to fetch from, which is what this test is about.
  assert.deepEqual((html.match(/url\((?!#)[^)]*\)/gi) ?? []), []);
  assert.equal(/<iframe|<img/i.test(html), false);
  // Nothing that names a place to fetch from. The scorecard is an inline SVG, so the one absolute URL
  // in the document is its namespace -- an identifier the browser never resolves, and the only string
  // this exemption covers. Everything else that could carry a request is checked by name rather than
  // by a blanket search for "http", which is what let the namespace fail this in the first place.
  assert.deepEqual(
    (html.match(/https?:\/\/[^"'\s>)]*/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
    []
  );
  assert.equal(/\ssrc=|\shref=|xlink:href/i.test(html), false);
});

test("the palette is tokens, and the dark and light values are both declared", () => {
  const html = renderHtml(resultOf());
  for (const token of ["--bg", "--surface", "--border", "--text", "--muted", "--accent", "--good", "--warn", "--bad", "--radius"]) {
    assert.equal(html.includes(token), true, token);
  }
  assert.match(html, /prefers-color-scheme:dark/);
});

test("it is readable on a phone, on paper, and by a screen reader", () => {
  // The locale is pinned rather than inherited. This test asserts `<html lang="en">`, and
  // `renderHtml` defaults to the locale the shell reports -- so on a machine with
  // `LANG=ko_KR.UTF-8` it failed, while the product was behaving exactly as designed. A test that
  // reads ambient environment measures the machine it ran on; `report-language.test.mjs` owns the
  // question of which locale produces which language, and passes both in explicitly.
  const html = renderHtml(resultOf(), { locale: "en_US.UTF-8" });
  assert.match(html, /@media print/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /scope="col"/);
  assert.match(html, /scope="row"/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<html lang="en"/);
  // The language toggle is a checkbox and a label, so switching needs no script at all -- which is
  // what lets the injection test look for `<script` and mean it.
  assert.match(html, /<label for="lang">/);
  assert.equal(/<script/i.test(html), false);
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

test("markup in a result never becomes markup in the page", () => {
  // A result is a file on disk in a directory an assessed agent runs beside, and this page is
  // opened in the operator's own browser through the dashboard. The fields the scorer produces as
  // numbers were interpolated raw, so a string where a number belongs was markup.
  const payload = '"><script>alert(1)</script>';
  const hostile = {
    run_id: payload,
    status: payload,
    score: { final: payload, raw: payload, band: payload },
    provisional_raw: payload,
    dimensions: { D1: payload, D2: null, D3: null, D4: null, D5: null, D6: null },
    coverage: { observed: payload, total: payload },
    caps: [{ code: payload, max: payload, reason: payload }],
    blockers: [{ code: payload, detail: payload }],
    metrics: [{
      metric_id: payload, dimension: payload, value: payload, state: payload,
      subchecks: [{ id: payload, pass: false }], evidence_ids: [payload],
      reason: payload, verifier_id: payload
    }],
    limitations: [payload]
  };
  const html = renderHtml(hostile);
  assert.equal(/<script>alert\(1\)<\/script>/.test(html), false, "injected markup survived");
  assert.equal(/<script/i.test(html), false);
  // It still renders rather than throwing: a damaged result must not take the page down.
  assert.match(html, /<!doctype html>/);
  assert.doesNotThrow(() => renderMarkdown(hostile));

  // A field that is not a number is shown as absent, not as its own text.
  assert.match(html, /—/);
});

test("the published diagram draws the ceilings the scorer actually applies", () => {
  // The README's diagram states four numbers and the band each of them lands in. A diagram that
  // drifts from the code is worse than no diagram: it is a claim about the product that the
  // product does not make, on the page a stranger reads first.
  const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "assets", "aos-gates.svg"), "utf8");

  for (const [code, cap] of Object.entries(CAPS)) {
    assert.match(svg, new RegExp(`>${cap.max}<`), `${code}: the ceiling value is not drawn`);
    assert.match(svg, new RegExp(code), `${code}: the ceiling is not named`);
    // The band it lands in is drawn beside it, and it has to be the band the scorer would give.
    assert.match(svg, new RegExp(bandOf(cap.max)), `${code}: ${bandOf(cap.max)} is not drawn`);
  }

  // The bar widths are the values, to scale, on a 440-wide track.
  for (const cap of Object.values(CAPS)) {
    const width = Number((cap.max / 100 * 440).toFixed(1));
    assert.match(svg, new RegExp(`width="${width}"`), `the bar for ${cap.max} is not ${width} of 440`);
  }

  // And the gate's own numbers.
  assert.match(svg, new RegExp(`${MINIMUM_OBSERVED} of ${METRIC_IDS.length} metrics`));
  assert.match(svg, new RegExp(`${REQUIRED_METRICS[0]}–${REQUIRED_METRICS.at(-1)}`));
});
