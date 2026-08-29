import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds the package, installs it somewhere else, and uses it as an operator would.
//
// The suite runs against the source tree, so it cannot see the things that only go wrong at the
// package boundary: a manifest that forgot a translated README, a missing runtime file, or an entry
// point that imports correctly in the checkout but not after installation. This is the lane that
// has to catch those failures.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "aos-package-smoke-"));
const prefix = join(workspace, "prefix");
const home = join(workspace, "home");
const failures = [];

const say = (line) => process.stdout.write(`${line}\n`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const check = (name, run) => {
  try {
    run();
    say(`PASS\t${name}`);
  } catch (error) {
    failures.push(name);
    say(`FAIL\t${name}`);
    say(`    ${String(error.message).split("\n").slice(0, 6).join("\n    ")}`);
  }
};

let aos = null;
const cli = (args, options = {}) =>
  execFileSync(aos, args, {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, AOS_HOME: home, PATH: `${join(prefix, "bin")}:${process.env.PATH}` },
    ...options
  });

try {
  say(`package smoke in ${workspace}`);
  const packed = execFileSync(npm, ["pack", "--silent"], { cwd: root, encoding: "utf8", timeout: 300000 }).trim().split("\n").at(-1);
  say(`packed ${packed}`);
  execFileSync(npm, ["install", "--silent", "--global", "--prefix", prefix, join(root, packed)], {
    cwd: root,
    encoding: "utf8",
    timeout: 600000
  });
  rmSync(join(root, packed), { force: true });
  aos = join(prefix, "bin", "aos");
  const installedRoot = join(prefix, "lib", "node_modules", "agent-operator-score");

  check("all translated READMEs are packaged", () => {
    for (const file of ["README.md", "README.ko.md", "README.ja.md", "README.zh-CN.md"]) {
      if (!existsSync(join(installedRoot, file))) throw new Error(`${file} is missing from ${installedRoot}`);
    }
  });

  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  check("aos version", () => {
    const reported = cli(["version"]).trim();
    if (reported !== version) throw new Error(`reported ${reported}, manifest says ${version}`);
  });

  check("aos doctor", () => {
    const text = cli(["doctor"]);
    if (!/PASS\tplatform/.test(text)) throw new Error(text);
  });

  check("aos verify", () => {
    const text = cli(["verify"]);
    if (/FAIL/.test(text)) throw new Error(text);
  });

  // A whole assessment through the installed binary. The agent is one line of Node, so the run
  // scores badly on purpose -- what is being checked is that a report comes out the other end, not
  // what it says.
  check("a run produces a report", () => {
    cli(["init"]);
    cli(["agent", "add", "smoke", "--command", process.execPath, "--arg", "-e", "--arg", 'require("fs").writeFileSync("contract.json","{}")']);
    const planPath = join(workspace, "plan.json");
    cli(["assess", "--template", planPath]);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    plan.goal = "Smoke the installed package end to end.";
    plan.constraints = ["Runs offline", "Writes only inside the workspace"];
    plan.non_goals = ["Producing a meaningful score"];
    plan.clarification_policy = { facts: "read the workspace", human_decisions: "stop and ask" };
    plan.acceptance = [
      { criterion: "a report is written", evidence: "aos report" },
      { criterion: "the run terminates", evidence: "terminal record" },
      { criterion: "the scorer runs", evidence: "result.json" }
    ];
    for (const family of Object.values(plan.families)) {
      family.route = "smoke";
      family.stop_condition = "stop on repeat failure";
      family.idempotency_key = "smoke";
      if (Array.isArray(family.context) && family.context.length === 0) family.context = ["task.md"];
    }
    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // Exit 3 is the expected answer: nobody was watching, so D4 is unobserved and the score is
    // withheld. Insisting on 0 here would be asserting that an unattended run scores.
    let output = "";
    try {
      output = cli(["assess", "--plan", planPath, "--seed", "1", "--timeout-ms", "30000"]);
    } catch (error) {
      if (![3, 4].includes(error.status)) throw error;
      output = `${error.stdout ?? ""}`;
    }
    if (!/Report:/.test(output)) throw new Error(output.slice(0, 400));

    const runId = cli(["session", "list"]).trim().split("\n")[0].split(/\s+/)[0];
    const html = cli(["report", "--run", runId, "--format", "html"]);
    if (!html.startsWith("<!doctype html>")) throw new Error(html.slice(0, 200));
    if (!/PROFILE-BOUND/.test(html)) throw new Error("the boundary did not travel with the number");

    // The installed package deriving its own number again from its own record. This is the check
    // that a packaged suite and a packaged scorer still agree with what they wrote.
    const recomputed = cli(["verify", "--run", runId]);
    if (/FAIL/.test(recomputed)) throw new Error(recomputed);
  });
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

say("");
say(failures.length === 0 ? "package smoke passed" : `package smoke failed: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
