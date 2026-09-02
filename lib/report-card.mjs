// The run, as one picture.
//
// The report answers "why"; this answers "what happened" before anyone scrolls. It is a single SVG
// with no external reference of any kind -- no font file, no image, no script -- so it survives being
// dragged into Slack, committed to a repository, or pasted into a pull request, which is the only
// sharing mechanism a local-only tool can honestly offer.
//
// 1200x630 because that is what every preview surface crops to. The six dimensions are the six cells
// the eye lands on, the way a player card puts six attributes under one number.
//
// The hard rule this file exists under: a card is a bragging object, and this product refuses to
// issue numbers that were not earned. So a withheld run does not get a number in the big slot -- it
// gets NO SCORE and the reason. `provisional_raw` is a debugging aid and never appears here, because
// a picture detaches from its page the moment it is shared and would carry that number as a score.
// For the same reason the conditions are on the face rather than in a caption: a shared card that
// does not say what it is bound to is exactly the misreading this repository documents.

import { htmlEscape } from "./core.mjs";
import { DIMENSIONS } from "./metrics.mjs";
import { BAND_NAMES, DIMENSION_TITLES, METRIC_TITLES, languageOf, localeFromEnvironment, pick } from "./report-i18n.mjs";

const W = 1200;
const H = 630;

/**
 * One palette per band, plus the withheld state.
 *
 * The colour is the first thing read and the last thing remembered, so it carries the verdict on its
 * own: a reader who takes nothing else from the card should still not mistake FRAGILE for ADVANCED.
 * Withheld is deliberately not red -- "we could not measure this" is not "you did badly", and the
 * whole product rests on that distinction.
 */
const BANDS = {
  HIGH_RELIABILITY: { ink: "#34d399", glow: "#065f46", rail: "#10b981" },
  ADVANCED: { ink: "#60a5fa", glow: "#1e3a8a", rail: "#3b82f6" },
  OPERATIONAL: { ink: "#fbbf24", glow: "#78350f", rail: "#f59e0b" },
  DEVELOPING: { ink: "#fb923c", glow: "#7c2d12", rail: "#f97316" },
  FRAGILE: { ink: "#f87171", glow: "#7f1d1d", rail: "#ef4444" },
  WITHHELD: { ink: "#a1a1aa", glow: "#27272a", rail: "#71717a" }
};

const FONT = "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue','Noto Sans KR',Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const short = (value, n = 12) => (typeof value === "string" ? value.replace(/^sha256:/, "").slice(0, n) : "");

/** Text that is safe inside an SVG text node and never longer than the space it was given. */
const clip = (value, max) => {
  const text = String(value ?? "");
  return htmlEscape(text.length > max ? `${text.slice(0, max - 1)}…` : text);
};

/**
 * Wrapped lines, because SVG text does not wrap and the sentences that matter most here are the ones
 * that explain a ceiling -- exactly the field a single clipped line turns into "the recovery route
 * was a blind retry of the rou...", which tells the reader nothing they could act on.
 */
const wrap = (value, perLine, maxLines) => {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (`${line} ${word}`.length <= perLine) line = `${line} ${word}`;
    else { lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const last = lines.length - 1;
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[last] = `${lines[last].slice(0, perLine - 1)}…`;
  }
  return lines;
};

/**
 * The six cells.
 *
 * A dimension with no observed metric is not a zero-length bar, which would read as "scored nothing"
 * next to five real bars. It gets a dashed rail and the words for "not measured", because the
 * difference between a low score and an unmeasured one is the difference this card is most likely to
 * be asked to carry.
 */
const cells = (result, language, palette) => {
  const dimensions = result.dimensions ?? {};
  const x0 = 492;
  const columnWidth = 348;
  const rowHeight = 104;

  return Object.keys(DIMENSIONS).map((id, index) => {
    const value = dimensions[id];
    const measured = isNumber(value);
    const x = x0 + (index % 2) * columnWidth;
    const y = 196 + Math.floor(index / 2) * rowHeight;
    const title = pick(DIMENSION_TITLES[id], language);
    const width = 292;
    // The number is right-anchored in the same row, so a long title and a three-digit score met in
    // the middle. "Guardrails, Recovery & Cost" beside 100 is the worst pair and the one that decides
    // this: the title gives up the characters the number needs, never the other way round.
    const room = measured ? 30 - String(Math.round(value)).length * 2 : 30;
    const filled = measured ? Math.max(2, Math.round((width * Math.min(100, Math.max(0, value))) / 100)) : 0;

    return `<g>
      <text x="${x}" y="${y}" font-family="${FONT}" font-size="18.5" font-weight="600" fill="#e4e4e7">${clip(title, room)}</text>
      <text x="${x + width}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="24" font-weight="700" fill="${measured ? palette.ink : "#52525b"}">${measured ? Math.round(value) : "\u2013"}</text>
      <rect x="${x}" y="${y + 13}" width="${width}" height="7" rx="3.5" fill="#27272a"${measured ? "" : ' stroke="#3f3f46" stroke-width="1" stroke-dasharray="5 4"'}/>
      ${measured ? `<rect x="${x}" y="${y + 13}" width="${filled}" height="7" rx="3.5" fill="${palette.rail}"/>` : ""}
      <text x="${x}" y="${y + 41}" font-family="${MONO}" font-size="12" fill="#71717a">${htmlEscape(id)}${measured ? "" : ` \u00b7 ${language === "ko" ? "측정 못 함" : "not measured"}`}</text>
    </g>`;
  }).join("");
};

/**
 * The strip along the bottom: what the number is bound to.
 *
 * On the card rather than beside it. A picture separates from its page the instant it is shared, and
 * a score with no environment on it is the reading this repository spends a document refusing.
 */
const conditions = (result, language) => {
  const isolation = result.isolation?.level ?? "—";
  const agents = (result.agent_portfolio?.used ?? []).join(", ") || "—";
  const coverage = result.coverage ?? {};
  const pairs = [
    [language === "ko" ? "에이전트" : "agents", agents],
    [language === "ko" ? "격리" : "isolation", isolation],
    [language === "ko" ? "측정" : "measured", `${coverage.observed ?? 0}/${coverage.total ?? 20}`],
    [language === "ko" ? "시드" : "seed", short(result.seed, 16)],
    [language === "ko" ? "환경" : "profile", short(result.profile_digest)],
    [language === "ko" ? "과제" : "suite", short(result.suite_digest)]
  ];

  return pairs.map(([label, value], index) => {
    const x = 64 + index * 180;
    return `<g>
      <text x="${x}" y="${H - 62}" font-family="${FONT}" font-size="12" font-weight="600" fill="#71717a" letter-spacing="0.7">${htmlEscape(String(label).toUpperCase())}</text>
      <text x="${x}" y="${H - 42}" font-family="${MONO}" font-size="14" fill="#a1a1aa">${clip(value, 17)}</text>
    </g>`;
  }).join("");
};

/**
 * The card.
 *
 * `result` is read defensively throughout: it is a file on disk in a directory an assessed agent runs
 * beside, so every field is checked for what it is rather than trusted to be it.
 */
export function renderCard(result, { locale = localeFromEnvironment(process.env), constraint = null } = {}) {
  const language = languageOf(locale);
  const score = result.score ?? {};
  const issued = isNumber(score.final);
  const band = issued ? score.band : "WITHHELD";
  const palette = BANDS[band] ?? BANDS.WITHHELD;

  const capped = issued && isNumber(score.raw) && score.raw > score.final;
  const ceiling = (result.caps ?? [])[0];
  const withheldReason = (result.blockers ?? [])[0];

  // The headline under the number. A ceiling is the one thing that makes every other number on the
  // card not mean what it looks like, so it outranks everything else for the space.
  const strap = issued
    ? (capped
        ? (language === "ko" ? `${pick(BAND_NAMES[band], language)} · 상한 적용` : `${pick(BAND_NAMES[band], language)} · capped`)
        : pick(BAND_NAMES[band], language))
    : (language === "ko" ? "점수를 내기에 관측이 부족합니다" : "not enough was measured to issue one");

  // The left column used to end at the band name and leave a third of the card empty. What belongs in
  // that space is the one thing a reader can act on: the ceiling that is holding the number down, or
  // failing that the metric to fix first. Both are already computed for the report; neither was on the
  // artifact people actually pass around.
  const detail = capped && ceiling
    ? {
        label: language === "ko" ? "점수를 눌러 놓은 것" : "WHAT IS HOLDING THIS DOWN",
        head: ceiling.code ?? "",
        body: wrap(ceiling.reason ?? "", 44, 3)
      }
    : !issued && withheldReason
      ? {
          label: language === "ko" ? "점수가 없는 이유" : "WHY THERE IS NO SCORE",
          head: withheldReason.code ?? "",
          body: wrap(withheldReason.detail ?? "", 44, 2)
        }
      : constraint
        ? {
            label: language === "ko" ? "여기부터 고치면 됩니다" : "FIX THIS FIRST",
            head: `${constraint.metric_id ?? ""} ${pick(METRIC_TITLES[constraint.metric_id], language)}`.trim(),
            body: wrap((constraint.failed ?? []).join(", "), 44, 2)
          }
        : null;

  const detailY = (issued ? 400 : 356) + (wrap(strap, 30, 2).length > 1 ? 24 : 0);
  const detailBlock = detail
    ? `<line x1="64" y1="${detailY - 30}" x2="404" y2="${detailY - 30}" stroke="#27272a" stroke-width="1"/>
<text x="64" y="${detailY}" font-family="${FONT}" font-size="12" font-weight="700" fill="#71717a" letter-spacing="1.6">${clip(detail.label, 34)}</text>
<text x="64" y="${detailY + 26}" font-family="${FONT}" font-size="16.5" font-weight="700" fill="#d4d4d8">${clip(detail.head, 36)}</text>
${detail.body.map((line, index) => `<text x="64" y="${detailY + 50 + index * 19}" font-family="${MONO}" font-size="12.5" fill="#8a8a95">${htmlEscape(line)}</text>`).join("")}`
    : "";

  const noScore = language === "ko" ? "점수 없음" : "NO SCORE";
  const outOf = language === "ko" ? "100점 만점" : "out of 100";
  // The claim stage this result reached, never the stronger of the two by default: a card whose
  // model or executable was never established says so on its face rather than carrying the
  // profile-bound sentence beside a withheld aggregate (#561).
  const profileBound = result.model_identity?.claim_stage === "PROFILE_BOUND";
  const bound = language === "ko"
    ? (profileBound
      ? "PROFILE-BOUND — 위 환경과 과제 묶음 안에서의 측정값입니다. 조건이 다르면 다른 측정입니다."
      : "RUN-DIAGNOSTIC — 이 실행 자체의 결과입니다. 모델 또는 실행 프로그램이 확정되지 않았습니다.")
    : (profileBound
      ? "PROFILE-BOUND — measured in the environment and task pack above. Different conditions, different measurement."
      : "RUN-DIAGNOSTIC — this run's own result. Its model or executable is not established.");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${clip(`AOS ${issued ? score.final : noScore} — ${strap}`, 120)}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0a0a0b"/><stop offset="1" stop-color="#141417"/>
  </linearGradient>
  <radialGradient id="halo" cx="0.19" cy="0.34" r="0.52">
    <stop offset="0" stop-color="${palette.glow}" stop-opacity="0.75"/>
    <stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#halo)"/>
<rect x="0" y="0" width="${W}" height="5" fill="${palette.rail}"/>

<text x="64" y="76" font-family="${FONT}" font-size="15" font-weight="700" fill="#e4e4e7" letter-spacing="3.4">AGENT OPERATOR SCORE</text>
<text x="${W - 64}" y="76" text-anchor="end" font-family="${MONO}" font-size="13" fill="#52525b">${clip(result.run_id ?? "", 42)}</text>
<line x1="64" y1="100" x2="${W - 64}" y2="100" stroke="#27272a" stroke-width="1"/>

${issued
  ? `<text x="64" y="272" font-family="${FONT}" font-size="168" font-weight="800" fill="${palette.ink}" letter-spacing="-6">${Math.round(score.final)}</text>
     <text x="64" y="308" font-family="${FONT}" font-size="15" fill="#71717a">${htmlEscape(outOf)}</text>`
  : `<text x="64" y="248" font-family="${FONT}" font-size="76" font-weight="800" fill="${palette.ink}" letter-spacing="-2">${htmlEscape(noScore)}</text>`}
${wrap(strap, 30, 2).map((line, index) => `<text x="64" y="${(issued ? 352 : 296) + index * 30}" font-family="${FONT}" font-size="23" font-weight="700" fill="${palette.ink}">${htmlEscape(line)}</text>`).join("")}
${detailBlock}

<line x1="452" y1="140" x2="452" y2="${H - 108}" stroke="#27272a" stroke-width="1"/>
<text x="492" y="164" font-family="${FONT}" font-size="13" font-weight="700" fill="#71717a" letter-spacing="2.4">${language === "ko" ? "여섯 가지 평가 영역" : "THE SIX AREAS"}</text>
${cells(result, language, palette)}

<line x1="64" y1="${H - 92}" x2="${W - 64}" y2="${H - 92}" stroke="#27272a" stroke-width="1"/>
${conditions(result, language)}
<text x="64" y="${H - 18}" font-family="${FONT}" font-size="12.5" fill="#6b6b76">${htmlEscape(bound)}</text>
</svg>`;
}
