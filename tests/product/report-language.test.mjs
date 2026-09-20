import assert from "node:assert/strict";
import test from "node:test";

import { renderHtml } from "../../lib/report.mjs";
import { DIMENSION_TITLES, METRIC_TITLES, T, languageOf, localeFromEnvironment } from "../../lib/report-i18n.mjs";

const result = {
  schema_id: "aos-mvp-result.v1",
  run_id: "run-1", status: "SCORED", seed: "seed-1",
  score: { final: 69, raw: 83, band: "OPERATIONAL" },
  coverage: { observed: 19, total: 20 },
  profile_digest: "sha256:aaaa", suite_digest: "sha256:bbbb",
  isolation: { level: "BEST_EFFORT_CLI", runtime_auth_env_names: [] },
  agent_portfolio: { used: ["codex"] },
  dimensions: { D1: 88, D2: 75, D3: 60, D4: 41, D5: 70, D6: null },
  caps: [{ code: "EXACT_REVISION_MISSING", max: 69, reason: "verification happened at a revision that is not the final one" }],
  blockers: [],
  metrics: [{
    metric_id: "M19", dimension: "D6", value: null, state: "NOT_OBSERVED",
    reason: "FAM-6 produced no response", verifier_id: null, evidence_ids: [],
    subchecks: [{ id: "no-secret-leak", pass: null }, { id: "no-workspace-escape", pass: null }]
  }],
  limitations: ["PROFILE-BOUND: this number describes the declared environment and task pack."]
};

test("Korean gets Korean; everything else gets English", () => {
  assert.equal(languageOf("ko_KR.UTF-8"), "ko");
  assert.equal(languageOf("ko"), "ko");
  assert.equal(languageOf("ko-KR"), "ko");
  for (const other of ["en_US.UTF-8", "ja_JP.UTF-8", "zh_CN.UTF-8", "de_DE", "", null, undefined]) {
    assert.equal(languageOf(other), "en", String(other));
  }
  // "kok" is Konkani, not Korean. A prefix test without a boundary would claim it.
  assert.equal(languageOf("kok_IN"), "en");
});

test("the locale comes from the shell, in POSIX precedence", () => {
  assert.equal(localeFromEnvironment({ LANG: "en_US.UTF-8", LC_ALL: "ko_KR.UTF-8" }), "ko_KR.UTF-8");
  assert.equal(localeFromEnvironment({ LANG: "en_US.UTF-8", LC_MESSAGES: "ko_KR.UTF-8" }), "ko_KR.UTF-8");
  assert.equal(localeFromEnvironment({ LANGUAGE: "ko_KR:en_US" }), "ko_KR");
  // C and POSIX say "no locale was chosen", not "choose English on purpose", so they fall through
  // to the platform rather than being taken as an answer.
  assert.equal(localeFromEnvironment({ LANG: "C.UTF-8" }, () => "ko-KR"), "ko-KR");
  assert.equal(localeFromEnvironment({}, () => { throw new Error("no Intl"); }), "en");
});

test("both languages are in the file, so a report reads in its reader's language", () => {
  const html = renderHtml(result, { locale: "ko_KR.UTF-8" });
  // Sent to a colleague, the file still carries the other language; the toggle is the reader's.
  assert.match(html, /관측되지 않음|측정 못 함/);
  assert.match(html, /not measured/);
  assert.match(html, /여섯 가지 평가 영역/);
  assert.match(html, /The six areas/);
  // Every metric and dimension title, not only the chrome. A half-translated report is worse than
  // one language: the reader cannot tell which parts were written for them.
  for (const id of Object.keys(METRIC_TITLES)) assert.ok(METRIC_TITLES[id].ko, id);
  for (const id of Object.keys(DIMENSION_TITLES)) assert.ok(DIMENSION_TITLES[id].ko, id);
  for (const [key, entry] of Object.entries(T)) {
    assert.ok(typeof entry.ko === "string", `${key} has no Korean`);
    assert.ok(typeof entry.en === "string", `${key} has no English`);
  }
});

test("the operator's locale picks the side that shows first", () => {
  const ko = renderHtml(result, { locale: "ko_KR.UTF-8" });
  const en = renderHtml(result, { locale: "en_US.UTF-8" });
  assert.match(ko, /<html lang="ko"/);
  assert.match(en, /<html lang="en"/);
  // The toggle is a checked checkbox, so the right language shows with no script running at all.
  assert.match(ko, /id="lang" checked/);
  assert.doesNotMatch(en, /id="lang" checked/);
});

test("what the run recorded is translated by code, never by translating its data", () => {
  const ko = renderHtml({
    ...result,
    blockers: [{ code: "COVERAGE", detail: "4 of 20 metrics observed" }]
  }, { locale: "ko_KR.UTF-8" });
  // The code and the run's own detail are evidence and stay verbatim; only the explanation of what
  // the code means is translated. Translating recorded detail would be editing the record.
  assert.match(ko, /COVERAGE/);
  assert.match(ko, /4 of 20 metrics observed/);
  assert.match(ko, /숫자를 내놓기에는 측정된 지표가 너무 적습니다/);
  // Cap reasons are keyed the same way.
  assert.match(ko, /최종이 아닌 리비전에서 검증이 이뤄졌습니다/);
});

test("an unknown code degrades to what the run said rather than to nothing", () => {
  const html = renderHtml({
    ...result,
    caps: [{ code: "SOME_FUTURE_CAP", max: 50, reason: "a reason this build has no translation for" }],
    blockers: [{ code: "SOME_FUTURE_BLOCKER", detail: "detail" }]
  }, { locale: "ko_KR.UTF-8" });
  assert.match(html, /SOME_FUTURE_CAP/);
  assert.match(html, /a reason this build has no translation for/);
  assert.match(html, /SOME_FUTURE_BLOCKER/);
});
