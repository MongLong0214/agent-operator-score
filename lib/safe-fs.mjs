import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { contains, sha256Bytes } from "./digest.mjs";

// Every traversal of a workspace an agent could write to goes through here.
//
// The agent controls the contents of that directory, so a plain readdir walk reads whatever it is
// pointed at: a symlink to ~/.ssh/id_ed25519 is followed and its bytes end up in a snapshot digest
// and, through a diff, in a report. A named pipe blocks the walk forever. A generated 4 GiB file
// exhausts memory before anything is graded. None of those are exotic; they are the obvious moves
// against a grader that trusts its own filesystem.

// The walk stays here rather than delegating to `canonicalTreeManifest`, and the two are not the
// same contract. This one is for a directory an assessed agent can write to, so every entry that is
// not a plain file is refused outright -- a symlink is refused whether or not it points inside.
// The tree walk records an in-tree link as link evidence instead, which is right for an artifact
// and wrong here, because an agent that replaces a file with a link to another file in the same
// workspace has still made the workspace unreadable as evidence. Only the digest is shared, and
// that is the part this issue is about.

// A repository's object database is bookkeeping, not work. Walking it reported every loose object
// as a change the agent made outside its scope, which turned "commit your work" -- something a
// scenario now asks for -- into a scope violation. Nothing in .git is evidence about what the
// operator did that the commit itself does not say better.
const SKIP_DIRECTORIES = new Set([".git"]);

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
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
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
      // The raw bytes, never the decoded text. `readFileSync(full, "utf8")` replaced every
      // undecodable byte with U+FFFD and folded CRLF to LF, so an agent could rewrite a file's line
      // endings, or flip a byte inside a binary, and this snapshot would compare equal to the
      // baseline -- a changed workspace reported as an untouched one, which is the one thing a scope
      // check exists to catch.
      files[relative] = sha256Bytes(readFileSync(full));
    }
  };

  walk(base, 0);
  return { files, refusals };
}

// Re-exported from where the tree walk needs it, so the callers that always imported it from here
// still can.
export { contains };

