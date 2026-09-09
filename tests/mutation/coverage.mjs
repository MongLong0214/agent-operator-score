export function mutationSummary(results) {
  for (const entry of results) {
    if (entry.file === "lib/form-class.mjs" && !entry.pending_issue && !entry.reachable_from) {
      throw new Error(`Unclassified scaffold guard: ${entry.guard}`);
    }
  }
  return [
    ["command-reachable", results.filter((entry) => !entry.pending_issue)],
    ["library-pending", results.filter((entry) => Boolean(entry.pending_issue))]
  ].map(([scope, entries]) => `${scope}: ${entries.filter((entry) => entry.outcome === "killed").length}/${entries.length} guards are load-bearing.`);
}
