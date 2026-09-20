import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, [`${process.env.PROBE_RUNTIME}/child-probe.mjs`], { encoding: "utf8" });
const child = r.stdout ? JSON.parse(r.stdout) : { outcome: "inconclusive", errno: r.error?.code ?? null, detail: null };
process.stdout.write(JSON.stringify({ act_outside_boundary_from_descendant: child, child_exit_status: r.status }, null, 2));
