const REFUSED = "timeout/interruption can leave nonterminal state or active child.";

type Fail = { ok: false; reason: string };
type Process = { pid: number; groupId: string };
type Reconciled = { ok: true; reconciled: number; remaining: number };

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const processesOf = (value: unknown): Process[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const processes: Process[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry) || !Number.isSafeInteger(entry.pid) || entry.pid <= 0 || !isFilledString(entry.groupId)) return null;
    if (seen.has(entry.pid)) return null;
    seen.add(entry.pid);
    processes.push({ pid: entry.pid, groupId: entry.groupId });
  }
  return processes;
};

export const reconcileProcesses = (input: unknown): Reconciled | Fail => {
  if (!isPlainRecord(input) || !isFilledString(input.runGroupId) || typeof input.listProcesses !== "function" || typeof input.terminate !== "function") {
    return refuse();
  }
  const runGroupId = input.runGroupId;
  const listProcesses = input.listProcesses as () => unknown;
  const terminate = input.terminate as (pid: number) => unknown;
  let before: Process[] | null;
  try {
    before = processesOf(listProcesses());
  } catch {
    return refuse();
  }
  if (before === null) return refuse();

  const owned = before.filter((process) => process.groupId === runGroupId);
  try {
    // Selecting from the observed run group before any signal is sent prevents a terminal path
    // from treating unrelated processes as cleanup candidates.
    for (const process of owned) terminate(process.pid);
  } catch {
    return refuse();
  }

  let after: Process[] | null;
  try {
    after = processesOf(listProcesses());
  } catch {
    return refuse();
  }
  if (after === null) return refuse();
  const remaining = after.filter((process) => process.groupId === runGroupId).length;
  if (remaining > 0) return refuse();
  return { ok: true, reconciled: owned.length, remaining };
};
