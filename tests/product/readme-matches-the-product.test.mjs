// The README is a claim about this program, and every row of it was checked against the program
// rather than against the previous README. These are the three the check found, kept as tests so the
// next edit to either side has to keep them true.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RUNTIMES } from "../../lib/session.mjs";
import { SCORABLE_CAPABILITY_SOURCES } from "../../lib/routing-oracle.mjs";
import { fakeAgent, initBare, makePlan, newestRecord } from "./helpers.mjs";

const root = process.env.AOS_README_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const READMES = ["README.md", "README.ko.md", "README.ja.md", "README.zh-CN.md"];

// The default posture changed from an adapter-table answer to an honest withhold. These tokens are
// code identifiers rather than a translation's wording, so the four public pages stay bound to the
// same source policy even while each explains it naturally in its own language.
const CAPABILITY_POSTURE = Object.freeze({
  "README.md": [/`aos-known`/u, /`capability-matches-task`/u, /`simplest-adequate-route`/u, /C2\.RF\.01/u, /O4/u, /`aos assess --probe-capabilities`/u, /`detected`/u],
  "README.ko.md": [/`aos-known`/u, /`capability-matches-task`/u, /`simplest-adequate-route`/u, /C2\.RF\.01/u, /O4/u, /`aos assess --probe-capabilities`/u, /`detected`/u],
  "README.ja.md": [/`aos-known`/u, /`capability-matches-task`/u, /`simplest-adequate-route`/u, /C2\.RF\.01/u, /O4/u, /`aos assess --probe-capabilities`/u, /`detected`/u],
  "README.zh-CN.md": [/`aos-known`/u, /`capability-matches-task`/u, /`simplest-adequate-route`/u, /C2\.RF\.01/u, /O4/u, /`aos assess --probe-capabilities`/u, /`detected`/u]
});

// #575 owns automatic quickstart orchestration. These patterns name the particular unshipped
// promise that must never return; the behaviour below is checked from a persisted run instead of
// treating translated prose as evidence that a command did or did not execute.
const UN_SHIPPED_AUTOMATION = Object.freeze({
  "README.md": /the coding agent or quickstart detects this withheld state and runs the capability observation automatically/u,
  "README.ko.md": /코딩 에이전트나 quickstart가 이 보류 상태를 감지하고 capability 관측을 자동으로 실행합니다/u,
  "README.ja.md": /コーディングエージェントまたは quickstart がこの保留状態を検出し、capability 観測を自動で実行します/u,
  "README.zh-CN.md": /编码 Agent 或 quickstart 会检测到这一保留状态并自动运行 capability 观测/u
});

// The normal quickstart is zero-config. A provider-backed probe is a real, billable recovery
// action, so the primary recovery explanation may name the current CLI but cannot make the
// operator type it to recover. Advanced/manual documentation may do that; the default-recovery
// block cannot. Keep the previously shipped wording here as the negative control: if it returns,
// this test must fail for the same reason a reader would be sent to a terminal.
const PRIMARY_RECOVERY = Object.freeze({
  "README.md": {
    starts: "Off by default",
    advanced: /advanced\/manual/u,
    previous: "Run `aos assess --probe-capabilities` when you need those answers: it observes the runtime and produces `detected` evidence."
  },
  "README.ko.md": {
    starts: "기본값은 꺼짐",
    advanced: /고급\/수동/u,
    previous: "그 답이 필요하면 `aos assess --probe-capabilities`를 실행하세요. 런타임을 관측해 `detected` 증거를 만듭니다."
  },
  "README.ja.md": {
    starts: "既定では無効",
    advanced: /高度\/手動/u,
    previous: "その答えが必要な場合は `aos assess --probe-capabilities` を実行してください。ランタイムを観測して `detected` の証拠を生成します。"
  },
  "README.zh-CN.md": {
    starts: "默认关闭",
    advanced: /高级\/手动/u,
    previous: "需要这些答案时，请运行 `aos assess --probe-capabilities`：它会观测运行时并生成 `detected` 证据。"
  }
});

const primaryRecoveryRequiresOperatorCli = (text, { starts, advanced }) => {
  const start = text.indexOf(starts);
  const end = start === -1 ? -1 : text.indexOf("\n## ", start);
  const recovery = start === -1 ? "" : text.slice(start, end === -1 ? undefined : end).replace(/\s+/gu, " ");
  const command = "`aos assess --probe-capabilities`";
  let at = recovery.indexOf(command);
  while (at !== -1) {
    // A sentence's qualifier can sit on the prior wrapped line, so inspect its local context
    // rather than a whole section that also contains an unrelated advanced/manual example.
    const context = recovery.slice(Math.max(0, at - 120), at + command.length + 80);
    if (!advanced.test(context)) return true;
    at = recovery.indexOf(command, at + command.length);
  }
  return false;
};

test("the capability-probe section in every README describes the shipped default posture", () => {
  assert.deepEqual(SCORABLE_CAPABILITY_SOURCES, ["detected"], "the README posture is written for a different scorable-source policy");
  for (const [file, phrases] of Object.entries(CAPABILITY_POSTURE)) {
    const text = readFileSync(join(root, file), "utf8");
    for (const phrase of phrases) assert.match(text, phrase, `${file} omits a consequence of the default capability posture`);
  }
});

test("the documented capability recovery is a deferred orchestration concern with a machine-readable current action", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-readme-capability-recovery-"));
  const home = join(cwd, ".aos");
  try {
    initBare(cwd);
    const added = aosIn(cwd, home, [
      "agent", "add", "alpha", "--command", process.execPath, "--arg", fakeAgent, "--adapter", "codex-cli.v1",
      "--allow-env", "FAKE_AGENT_PROFILE"
    ]);
    assert.equal(added.status, 0, added.stderr);
    const run = aosIn(cwd, home, ["assess", "--plan", makePlan(cwd, { default: "alpha" }), "--seed", "1"]);
    assert.equal(run.status, 3, run.stderr);

    // This is the current binary behaviour. No probe ran, and the two consumers that withhold
    // carry a stable reason, required action and disposition. A future #575 implementation may
    // change this test deliberately when it actually starts the observation.
    const record = newestRecord(cwd);
    assert.equal(record.capability_probes, null, "a default assess silently ran a provider-backed capability probe");
    const withheld = record.routing_oracle.observables
      .filter((entry) => ["capability-matches-task", "simplest-adequate-route"].includes(entry.observable_id));
    assert.equal(withheld.length, 2);
    for (const observable of withheld) {
      assert.equal(observable.pass, null, observable.observable_id);
      assert.equal(observable.reason_code, "AOS_ROUTING_CAPABILITY_NOT_OBSERVED", observable.observable_id);
      assert.equal(observable.required_action, "OBSERVE_CAPABILITIES", observable.observable_id);
      assert.deepEqual(
        {
          retryable: observable.retryable,
          blocker_class: observable.blocker_class,
          provider_blocker_class: observable.provider_blocker_class
        },
        { retryable: true, blocker_class: "NOT_OBSERVED", provider_blocker_class: "NOT_APPLICABLE" },
        observable.observable_id
      );
    }

    for (const [file, promise] of Object.entries(UN_SHIPPED_AUTOMATION)) {
      const text = readFileSync(join(root, file), "utf8");
      assert.doesNotMatch(text.replace(/\s+/gu, " "), promise, `${file} promises #575 behaviour that this binary does not ship`);
      assert.match(text, /#575/u, `${file} does not name the owner of automatic quickstart orchestration`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the primary zero-config recovery documentation never requires an operator recovery CLI", () => {
  for (const [file, rule] of Object.entries(PRIMARY_RECOVERY)) {
    const text = readFileSync(join(root, file), "utf8");
    assert.equal(primaryRecoveryRequiresOperatorCli(text, rule), false,
      `${file} makes primary zero-config recovery depend on an operator typing a provider-backed CLI command`);

    // A scratch copy with the exact prior wording must be classified as a failure. This prevents a
    // future test rewrite from merely requiring the current prose while losing item 14's property.
    const scratch = text.replace(rule.starts, `${rule.starts}. ${rule.previous}`);
    assert.equal(primaryRecoveryRequiresOperatorCli(scratch, rule), true,
      `${file} no longer detects the prior primary recovery command in a scratch copy`);
  }
});

// What each README has to say about a cycle's aggregate, in its own language: that a cycle of
// profile runs has none, that the median belongs to the legacy scorer, and never the flat promise
// the four of them used to carry.
// Phrases that promise what a run of the current instrument does not produce. Each is a sentence
// one of these files carried in its setup or its output section while a later section said the
// opposite; they are listed per language because the claim, not the wording, is what must not
// come back.
const PROMISES_A_RUN_DOES_NOT_KEEP = {
  "README.md": [
    [/To obtain an official score/u, "still tells the reader a run of this instrument issues one"],
    [/A score out of 100, or the exact reason no score was issued/u, "still describes the output as a score out of 100"],
    [/one image with the score, six dimensions/u, "still calls the card a picture of a score"]
  ],
  "README.ko.md": [
    [/공식 점수를 받으려면/u, "still tells the reader a run of this instrument issues one"],
    [/100점 만점 점수 또는 점수를 내지 않은 정확한 이유/u, "still describes the output as a score out of 100"],
    [/점수, 여섯 영역, 실행 조건/u, "still calls the card a picture of a score"]
  ],
  "README.ja.md": [
    [/公式スコアを得るには/u, "still tells the reader a run of this instrument issues one"],
    [/100 点満点のスコア、またはスコアを出さなかった正確な理由/u, "still describes the output as a score out of 100"],
    [/スコア、六つの領域、実行条件/u, "still calls the card a picture of a score"]
  ],
  "README.zh-CN.md": [
    [/要获得正式分数/u, "still tells the reader a run of this instrument issues one"],
    [/百分制分数，或未签发分数的准确原因/u, "still describes the output as a score out of 100"],
    [/在一张图中显示分数、六个维度/u, "still calls the card a picture of a score"]
  ]
};

const AGGREGATION = {
  "README.md": {
    withheld: /A cycle of profile runs has no single number/u,
    qualified: /Cycles of legacy results still report the median of all valid runs/u,
    unqualified: /The Operator Score is the median of all valid runs\./u
  },
  "README.ko.md": {
    withheld: /프로파일 실행으로 이루어진 사이클에는 하나의 숫자가 없고/u,
    qualified: /레거시 결과로 이루어진 사이클은 여전히 모든 유효한 실행의 \*\*중앙값\*\*/u,
    unqualified: /최종 Operator Score는 모든 유효한 실행의 \*\*중앙값\*\*입니다/u
  },
  "README.ja.md": {
    withheld: /プロファイル実行から成るサイクルに単一の数値はなく/u,
    qualified: /レガシー結果から成るサイクルは従来どおり ?すべての有効な実行の\*\*中央値\*\*を報告し/u,
    unqualified: /Operator Score は、すべての有効な実行の\*\*中央値\*\*です/u
  },
  "README.zh-CN.md": {
    withheld: /由 profile 运行组成的周期没有单一数值/u,
    qualified: /由旧结果组成的周期仍然报告所有有效运行的\*\*中位数\*\*/u,
    unqualified: /Operator Score 是所有有效运行的\*\*中位数\*\*。/u
  }
};

const aosIn = (cwd, home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

// Asking a command what it does must never be the command. `assess --help` fell through to `assess`:
// it wrote a plan into the operator's working directory and started a run that spends model quota,
// which is the most expensive way this CLI could answer a question about itself.
test("--help after a subcommand prints usage and runs nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-help-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-help-cwd-"));
  try {
    for (const command of [["assess"], ["review"], ["doctor"], ["cycle", "run"], ["agent", "list"]]) {
      for (const flag of ["--help", "-h"]) {
        const run = aosIn(cwd, home, [...command, flag]);
        assert.equal(run.status, 0, `${command.join(" ")} ${flag}`);
        assert.match(run.stdout, /^Agent Operator Score /, `${command.join(" ")} ${flag}`);
        assert.match(run.stdout, /Commands:/);
      }
    }
    // The point of the fix, not a side effect of it: nothing was created and no quota was spent.
    assert.deepEqual(readdirSync(cwd), [], "a request for help wrote a file into the working directory");

    // And a real flag is still a real flag -- the guard must not swallow arguments that are not help.
    assert.doesNotMatch(aosIn(cwd, home, ["review", "--list"]).stdout, /^Agent Operator Score /);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

test("verify exit states are documented in help and every README", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-verify-help-home-"));
  const expected = [
    /0\s+verified\s+every required claim was established/u,
    /4\s+unresolved\s+nothing was refuted, and at least one required claim could not be checked/u,
    /5\s+contradicted\s+at least one required claim was refuted by recomputation/u,
    /Exit code 4 is new and covers a state that previously exited 0/u,
    /!== 0/u,
    /=== 5/u
  ];
  try {
    const help = aosIn(home, home, ["verify", "--help"]);
    assert.equal(help.status, 0, help.stderr);
    for (const phrase of expected) assert.match(help.stdout, phrase, `verify --help omits ${phrase}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  for (const file of READMES) {
    const text = readFileSync(join(root, file), "utf8");
    assert.match(text, /`aos verify --run <id>`/u, `${file} does not name the command whose status it documents`);
    for (const state of ["verified", "unresolved", "contradicted"]) {
      assert.match(text, new RegExp(`\\|\\s*[045]\\s*\\|\\s*\`${state}\``, "u"), `${file} omits ${state}`);
    }
    assert.match(text, /!== 0/u, `${file} does not explain the nonzero-compatible consumer`);
    assert.match(text, /=== 5/u, `${file} does not explain the contradicted-only consumer`);
  }
});

// The message listed two of the three roots `findSessions` walks, so an operator whose only
// transcripts were Grok's was told there was nothing to review -- by the command whose whole job is
// to find their transcripts.
test("the empty-session message names every runtime the finder actually walks", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-roots-"));
  try {
    const said = aosIn(home, home, ["review"]).stdout;
    for (const runtime of RUNTIMES) {
      const label = { "claude-code": "Claude Code", codex: "Codex", grok: "Grok" }[runtime] ?? runtime;
      assert.ok(said.includes(label), `${runtime} is walked but not named: ${said.trim()}`);
    }
    assert.equal(RUNTIMES.length, 3, "a runtime was added or removed; the message has to move with it");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Every README told the operator to run `cycle run --plan aos-plan.json` directly after `cycle
// start`, and nothing in that sequence creates the file. The plan is written only when no `--plan`
// is named, so following the documented steps on a fresh clone ended at ENOENT.
test("the cycle sequence every README documents runs on a fresh clone", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cycle-doc-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-doc-cwd-"));
  try {
    aosIn(cwd, home, ["agent", "add", "codex", "--command", "/bin/sh", "--arg", "-c", "--arg", "exit 0"]);
    assert.equal(aosIn(cwd, home, ["cycle", "start", "--runs", "3"]).status, 0);

    // A withheld score is a legitimate outcome and its own exit code, so what is asserted here is
    // that the sequence reaches the run at all rather than dying on a file no step created.
    const ran = aosIn(cwd, home, ["cycle", "run"]);
    const said = ran.stdout + ran.stderr;
    assert.doesNotMatch(said, /AOS_UNREADABLE|ENOENT/, said);
    assert.match(said, /metrics observed/, said);

    // The cycle's own aggregation, checked as semantics rather than as presence. Every README said
    // the Operator Score is the median of the valid runs; the shipped path writes profile results
    // and lib/cli.mjs withholds any aggregate over those, naming #563 as the owner of the question.
    // A README that still promises a number documents a command that no longer exists, and reading
    // for the word "median" alone would pass on either wording.
    const cliSource = readFileSync(join(root, "lib", "cli.mjs"), "utf8");
    assert.match(cliSource, /AOS_CYCLE_AGGREGATION_UNDEFINED/u, "the cycle stopped withholding; the READMEs have to move with it");

    for (const file of READMES) {
      const text = readFileSync(join(root, file), "utf8");
      assert.doesNotMatch(
        text, /cycle run --plan aos-plan\.json/,
        `${file} documents a plan path that no documented step creates`
      );

      // Wrapping is a layout decision and the claim is not, so the claim is read off one line.
      const said = text.replace(/\s+/gu, " ");
      const { withheld, qualified, unqualified } = AGGREGATION[file];
      assert.match(said, withheld, `${file} does not say a cycle of profile runs has no aggregate`);
      assert.match(said, /#563/u, `${file} withholds the aggregate without naming whose question it is`);
      assert.match(said, qualified, `${file} states the median without saying it is the legacy scorer's`);
      assert.doesNotMatch(said, unqualified, `${file} still promises a median Operator Score for every cycle`);
      // The same drift one section up: an 18-of-20 gate, the ceilings, the bands and
      // `provisional_raw` are the legacy scorer's rules for issuing one number, and the instrument
      // `aos assess` runs issues none. Naming the two result schemas is what makes the section
      // readable as being about a particular instrument rather than about the product.
      assert.match(said, /aos-result\.v2/u, `${file} describes score gates without saying which instrument they belong to`);
      assert.match(said, /aos-mvp-result\.v1/u, `${file} does not name the legacy result the gates and bands belong to`);
      // The sections a reader meets first -- what to run, and what comes out of it -- were still
      // promising one official score out of 100 and a card with a score on it, while the sections
      // further down said the current instrument issues neither. A README whose opening contradicts
      // its middle is read from the opening.
      for (const [phrase, why] of PROMISES_A_RUN_DOES_NOT_KEEP[file]) {
        assert.doesNotMatch(said, phrase, `${file} ${why}`);
      }
    }
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

// A rule that fires and is not written down is a finding the operator cannot look up. The table is
// the list of what `review` reports, so it has to hold every rule that reaches a finding.
test("every rule review can report is in every README's table", () => {
  const source = readFileSync(join(root, "lib", "review.mjs"), "utf8");
  // Every rule the file names, minus the one that marks a check as unobserved rather than reporting
  // it. Matching on `severity:` being the next line missed a rule whose fields are ordered
  // differently -- a shape detail, which is the wrong thing for this check to depend on.
  const reported = new Set(
    source.split("\n")
      .filter((line) => !line.includes("not_observed"))
      .flatMap((line) => [...line.matchAll(/rule:\s*"([a-z-]+)"/g)].map((match) => match[1]))
  );
  assert.ok(reported.size >= 8, `expected the finding rules, found ${[...reported].join(", ")}`);

  for (const file of READMES) {
    const text = readFileSync(join(root, file), "utf8");
    for (const rule of reported) {
      assert.ok(text.includes(`\`${rule}\``), `${file} does not document ${rule}`);
    }
  }
});

// CI runs one Ubuntu image at two Node versions; every README read "22" and "24" as Ubuntu releases
// and printed "macOS 24", which is not a macOS version at all.
test("what the READMEs say about CI is what the workflow does", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const images = new Set([...workflow.matchAll(/os:\s*([a-z-]+latest)/g)].map((match) => match[1]));
  assert.deepEqual([...images].sort(), ["macos-latest", "ubuntu-latest"]);

  for (const file of READMES) {
    const text = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(text, /Ubuntu 22|Ubuntu 24|macOS 24/, `${file} names Node versions as OS releases`);
  }
});

// Round 9 of the sweep spent a whole three-run cycle unattended and learned only afterwards that no
// score was possible. M11-M13 are observed from a real operator turn or not at all, so an unattended
// run tops out at 17 of 20 against a gate of 18 -- arithmetic known before any model is called, on a
// command that spends model quota and whose seeds are not refundable.
test("an unattended run says it cannot be scored before it spends anything", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-unattended-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-unattended-cwd-"));
  try {
    aosIn(cwd, home, ["agent", "add", "codex", "--command", "/bin/sh", "--arg", "-c", "--arg", "exit 0"]);
    const run = aosIn(cwd, home, ["assess"]);
    assert.match(run.stderr, /no --checkpoints/);
    assert.match(run.stderr, /17 of 20/);
    // The notice says what will be withheld and why, rather than naming provisional_raw -- a field
    // of the legacy record that the profile result this run writes does not carry.
    assert.match(run.stderr, /process index and the composite will be withheld/);
    assert.equal(run.stderr.includes("provisional_raw"), false);
    // Before the run, not in the summary after it: the notice is worth nothing once the quota is gone.
    assert.ok(
      run.stderr.indexOf("no --checkpoints") < (run.stdout.indexOf("metrics observed") + run.stderr.length),
      "the notice arrived after the run"
    );
    // stdout stays machine-readable -- this is the mistake the shipped-plan notice already made once.
    assert.doesNotMatch(aosIn(cwd, home, ["assess", "--json"]).stdout, /no --checkpoints/);
    JSON.parse(aosIn(cwd, home, ["assess", "--json"]).stdout);

    // And it is silent when the operator is there, so it never becomes noise to scroll past.
    assert.doesNotMatch(aosIn(cwd, home, ["assess", "--checkpoints"]).stderr, /no --checkpoints/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});
