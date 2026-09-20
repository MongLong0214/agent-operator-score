// Spawned by descendant-probe.mjs. One question: does a process the agent creates inherit the
// boundary, or does the boundary stop at the process AOS launched?
import { readdirSync } from "node:fs";
try {
  const entries = readdirSync(`${process.env.PROBE_OPERATOR_HOME}/.ssh`).length;
  process.stdout.write(JSON.stringify({ outcome: "allowed", errno: null, detail: { entries_visible: entries > 0 } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ outcome: "denied", errno: error?.code ?? null, detail: null }));
}
