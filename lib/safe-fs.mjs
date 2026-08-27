import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { sha256Text } from "./core.mjs";

// Every traversal of a workspace an agent could write to goes through here.
//
// The agent controls the contents of that directory, so a plain readdir walk reads whatever it is
// pointed at: a symlink to ~/.ssh/id_ed25519 is followed and its bytes end up in a snapshot digest
// and, through a diff, in a report. A named pipe blocks the walk forever. A generated 4 GiB file
// exhausts memory before anything is graded. None of those are exotic; they are the obvious moves
// against a grader that trusts its own filesystem.

export const LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxEntries: 4096,
  maxDepth: 32
};

// A refused entry still has to appear in the snapshot. Dropping it silently would let an agent
// hide a change by making it unreadable, and a scope check that never sees the entry reports a
// clean workspace.
export const REFUSED = "refused:";

const refusalDigest = (reason) => `${REFUSED}${reason}`;

/**
 * Walks a workspace and digests every regular file, refusing anything that is not one.
 *
 * Returns { files, refusals }. `files` maps a workspace-relative path to a digest or to a
 * `refused:<reason>` marker, so a caller diffing two snapshots sees a refusal as a change rather
 * than as an absence.
 */
export function safeWalk(root, limits = LIMITS) {
  const base = realpathSync(resolve(root));
  const files = {};
  const refusals = [];
  let totalBytes = 0;
  let entries = 0;

  const note = (relative, reason) => {
    files[relative] = refusalDigest(reason);
    refusals.push({ path: relative, reason });
  };

  const walk = (directory, depth) => {
    if (depth > limits.maxDepth) {
      note(directory.slice(base.length + 1), "max-depth");
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(directory, entry.name);
      const relative = full.slice(base.length + 1);
      if (entries >= limits.maxEntries) {
        note(relative, "max-entries");
        return;
      }
      entries += 1;

      // lstat, never stat: stat follows the link and reports the target, which is precisely the
      // question being asked here.
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        note(relative, "symlink");
        continue;
      }
      if (stats.isDirectory()) {
        // A directory reached through a path that resolves outside the workspace is refused even
        // when no single component was a symlink, because a bind mount reaches the same place.
        if (!contains(base, realpathSync(full))) {
          note(relative, "outside-workspace");
          continue;
        }
        walk(full, depth + 1);
        continue;
      }
      if (!stats.isFile()) {
        // A FIFO blocks the reader forever; a device or a socket is not evidence about the task.
        note(relative, "not-a-regular-file");
        continue;
      }
      if (stats.size > limits.maxFileBytes) {
        note(relative, "file-too-large");
        continue;
      }
      if (totalBytes + stats.size > limits.maxTotalBytes) {
        note(relative, "workspace-too-large");
        continue;
      }
      totalBytes += stats.size;
      files[relative] = sha256Text(readFileSync(full, "utf8").replace(/\r\n/g, "\n"));
    }
  };

  walk(base, 0);
  return { files, refusals };
}

export function contains(base, target) {
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/**
 * Resolves a file that must be a regular file inside the workspace.
 *
 * Returns null rather than throwing, because every caller is grading and a refusal is an outcome
 * to record, not an error to crash on.
 */
export function safeResolveFile(root, relative) {
  let base;
  try {
    base = realpathSync(resolve(root));
  } catch {
    return null;
  }
  const full = resolve(base, relative);
  if (!contains(base, full)) return null;
  let stats;
  try {
    stats = lstatSync(full);
  } catch {
    return null;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return null;
  if (stats.size > LIMITS.maxFileBytes) return null;
  try {
    return contains(base, realpathSync(full)) ? full : null;
  } catch {
    return null;
  }
}
