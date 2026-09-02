import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// What a file is, said in bytes.
//
// Every exact-identity digest in this product used to be taken after the bytes had been decoded as
// UTF-8 and had their CRLF pairs folded to LF -- `sha256Text(readFileSync(file, "utf8").replace(...))`.
// Two things follow from that, and both of them are ways for an agent to change a file and have the
// evidence say it did not:
//
//   A CRLF rewrite of every line in a file produced the same digest as the original.
//
//   `readFileSync(file, "utf8")` replaces every byte sequence that is not valid UTF-8 with U+FFFD.
//   So a file holding the single byte 0xFF, a file holding 0xFE, and a file holding an honest
//   U+FFFD all decoded to the same string and carried the same digest. Measured on this repository
//   before the change: `fileDigest` returned 83d544cc... for all three.
//
// The same decode also called a UTF-16 encoding of a document a different file from its UTF-8
// encoding while calling those three the same, which is the wrong answer in both directions.
//
// So: identity is the digest of the raw bytes, and nothing else. A digest of decoded, normalised or
// re-serialised text is a *projection* -- useful for asking whether two files are the same document,
// never for asking whether they are the same file -- and it is offered here under a name that says
// so and returns null when it cannot honestly be computed.

/** Whether `target` is `base` or sits underneath it. Lives here because the tree walk is the thing
 * that has to answer it, and `lib/safe-fs.mjs` re-exports it for the callers that always had it. */
export function contains(base, target) {
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/** The algorithm label every digest here carries. */
export const DIGEST_ALGORITHM = "sha256";

/** The evidence schema these manifests are written against. */
export const FILE_EVIDENCE_SCHEMA = "aos-file-evidence.v2";
export const TREE_MANIFEST_SCHEMA = "aos-tree-manifest.v1";

// The digest strings are prefixed with their algorithm on purpose.
//
// The digests this replaces were bare 64-character hex, and a bare hex string cannot say what was
// hashed. Prefixing means a legacy normalised digest and a raw-byte digest are distinguishable by
// looking at them -- which is what keeps old evidence from being quietly read as new evidence, and
// what makes "do not rename the old hash as a byte digest" enforceable rather than a convention.
const digestOf = (bytes) => `${DIGEST_ALGORITHM}:${createHash(DIGEST_ALGORITHM).update(bytes).digest("hex")}`;

/**
 * The digest of exactly these bytes.
 *
 * A string is refused rather than accepted and encoded. `createHash().update("...")` would encode it
 * as UTF-8 and return a digest that looks identical to a real one, so accepting a string here would
 * reintroduce the decode this module exists to remove -- silently, at whichever call site got it
 * wrong.
 */
export function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !ArrayBuffer.isView(bytes)) throw new Error("AOS_DIGEST_NOT_BYTES");
  return digestOf(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

const readBytes = (file) => {
  try {
    return readFileSync(file);
  } catch (error) {
    // An absent file is not an empty one. Returning the empty digest, or null, for a file that is
    // not there would let "the agent deleted it" and "the agent truncated it" produce the same
    // evidence, and a caller that never checked would not know which it had.
    throw new Error(`AOS_DIGEST_UNREADABLE ${file}: ${error.code ?? error.message}`);
  }
};

/** The identity of the file at `path`: the digest of its bytes, as they are on disk. */
export function fileByteDigest(path) {
  return digestOf(readBytes(path));
}

// Strict, and with the byte-order mark left in place.
//
// `fatal: true` is what makes this a *decision* about the bytes rather than a decode that always
// succeeds: without it a lone surrogate half or a stray 0xFF becomes U+FFFD and the projection is a
// digest of something the file does not contain. `ignoreBOM: true` keeps a leading U+FEFF in the
// decoded text, because the only normalisation this projection is allowed to apply is the one the
// contract names -- CRLF to LF -- and a decoder that silently drops the mark applies a second one.
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const decodeUtf8 = (bytes) => {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
};

/**
 * A digest of the file read as a document, or null where it is not one.
 *
 * This is the only digest in the product that is allowed to fold line endings, and it is never
 * identity: two files with this digest in common are the same text, which is a weaker claim than
 * being the same file. Callers that need to know whether a file changed must use the byte digest.
 *
 * Null for bytes that are not valid UTF-8. A projection that cannot be computed is reported as
 * absent rather than approximated, because the approximation -- U+FFFD for every undecodable run --
 * is precisely the collision this module was written to remove.
 */
export function optionalFileTextDigest(path) {
  return textDigestOfBytes(readBytes(path));
}

const textDigestOfBytes = (bytes) => {
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  return digestOf(Buffer.from(text.replace(/\r\n/g, "\n"), "utf8"));
};

/** Whether the bytes are a document, a binary, or something that was never read. */
const mediaOf = (bytes) => (bytes === null ? "unknown" : decodeUtf8(bytes) === null ? "binary" : "text");

export const TREE_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxEntries: 4096,
  maxDepth: 32
};

/** Directories whose contents are bookkeeping rather than work. */
export const TREE_SKIP_DIRECTORIES = [".git"];

// Symlinks are recorded as links and never followed.
//
// The alternative -- follow the link and digest what it points at -- makes the tree digest a
// statement about files that are not in the tree, and a link to ~/.ssh/id_ed25519 puts the
// operator's private key into a digest and, through a diff, into a report. So the link is evidence
// about itself: its type is `symlink` and its digest is over its own bytes, which are the target
// name. That is what makes replacing a file with a link to a file of the same content a visible
// change rather than an invisible one.
//
// A link whose target resolves outside the tree is refused instead, with the reason named. Nothing
// is read either way, so the refusal is not about safety of reading; it is about the evidence. A
// recorded link that points out of the tree is an instruction to whoever resolves it later, and a
// tree digest that carried one would be a digest of something the tree does not contain.
const SYMLINK_ESCAPES = "symlink-escapes-tree";

/**
 * Where a link points, resolved, or null when that is outside `base`.
 *
 * `realpathSync` first, because it is the only thing that answers the question for a chain of links
 * and for a bind mount. A dangling link has no real path, and a dangling link is still a link worth
 * recording, so its target is resolved lexically against the containing directory -- which the walk
 * has already established is inside the tree.
 */
const linkTargetInside = (base, directory, full) => {
  try {
    return contains(base, realpathSync(full));
  } catch {
    const target = readlinkSync(full);
    return contains(base, resolve(directory, target));
  }
};

const entryOf = ({ path, type, mode, size, bytes, refused }) => ({
  schema_id: FILE_EVIDENCE_SCHEMA,
  path,
  type,
  mode,
  size_bytes: size,
  byte_digest: bytes === null ? null : digestOf(bytes),
  text_digest: bytes === null ? null : textDigestOfBytes(bytes),
  media: mediaOf(bytes),
  refused: refused ?? null
});

/**
 * Every entry under `root`, as file evidence, in canonical order.
 *
 * The absolute root is excluded and every path is relative to it, so the same tree in two places is
 * the same tree. Ordering is over the UTF-8 bytes of the relative path rather than over
 * `localeCompare`, because a comparison that reads the ambient locale makes the digest a property of
 * the machine that computed it.
 *
 * A refused entry is still an entry. Dropping it would let an agent hide a change by making the file
 * unreadable -- the tree would digest as though the entry had never existed, and a scope check
 * would report a clean workspace.
 */
export function canonicalTreeManifest(root, policy = {}) {
  const limits = { ...TREE_LIMITS, ...policy };
  const skip = new Set(policy.skipDirectories ?? TREE_SKIP_DIRECTORIES);
  const base = realpathSync(resolve(root));
  const entries = [];
  const refusals = [];
  let totalBytes = 0;
  let seen = 0;

  const refuse = (path, reason, { type = "refused", mode = null, size = null } = {}) => {
    entries.push(entryOf({ path, type, mode, size, bytes: null, refused: reason }));
    refusals.push({ path, reason });
  };

  // The permission bits and nothing else. mtime is not evidence about content: a digest that moved
  // with it would report every `touch` as a change and bury a real one among them. The mode is
  // evidence -- making a file executable changes what the tree does without changing a byte of it.
  const modeOf = (stats) => (stats.mode & 0o7777).toString(8).padStart(4, "0");

  // Read here rather than at the top of the walk, so a directory that cannot be listed is one
  // refused entry rather than a `dir` entry and a refusal at the same path. `chmod 000` on a
  // directory is something an assessed agent can do, and letting the exception out would report
  // nothing at all about the tree rather than reporting the entry that failed.
  const listing = (directory) => {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    } catch {
      return null;
    }
  };

  const walk = (directory, relativeDirectory, depth, names) => {
    for (const name of names) {
      const full = join(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (seen >= limits.maxEntries) {
        refuse(relative, "max-entries");
        return;
      }
      seen += 1;

      // lstat, never stat: stat follows the link and reports the target, which is exactly the
      // question being asked. An entry that disappeared between the listing and here is recorded as
      // one that could not be read, because it was in the tree when the walk began.
      let stats;
      try {
        stats = lstatSync(full);
      } catch {
        refuse(relative, "unreadable-entry");
        continue;
      }

      if (stats.isSymbolicLink()) {
        if (!linkTargetInside(base, directory, full)) {
          refuse(relative, SYMLINK_ESCAPES);
          continue;
        }
        // The link's own bytes are the target name. Digesting the target's contents instead would
        // make two different entries -- a file and a link to it -- the same evidence.
        const target = Buffer.from(readlinkSync(full), "utf8");
        // No mode. A symlink's permission bits are not enforced on either supported platform and
        // they differ between them -- 0777 on Linux, 0755 on macOS -- so recording them would make
        // the digest of any tree containing a link a property of the machine that walked it.
        entries.push(entryOf({ path: relative, type: "symlink", mode: null, size: target.length, bytes: target, refused: null }));
        continue;
      }

      if (stats.isDirectory()) {
        if (skip.has(name)) continue;
        if (depth + 1 > limits.maxDepth) {
          refuse(relative, "max-depth", { mode: modeOf(stats) });
          continue;
        }
        // A directory reached through a path that resolves outside the tree is refused even when no
        // single component was a symlink, because a bind mount reaches the same place.
        let inside = false;
        try { inside = contains(base, realpathSync(full)); } catch { inside = false; }
        if (!inside) {
          refuse(relative, "outside-tree", { mode: modeOf(stats) });
          continue;
        }
        const children = listing(full);
        if (children === null) {
          refuse(relative, "unreadable-directory", { mode: modeOf(stats) });
          continue;
        }
        // Recorded before its contents, so an added empty directory is a change to the tree.
        entries.push(entryOf({ path: relative, type: "dir", mode: modeOf(stats), size: null, bytes: null, refused: null }));
        walk(full, relative, depth + 1, children);
        continue;
      }

      if (!stats.isFile()) {
        // A FIFO blocks the reader forever; a device or a socket is not evidence about the task.
        refuse(relative, "not-a-regular-file", { mode: modeOf(stats) });
        continue;
      }
      if (stats.size > limits.maxFileBytes) {
        // The size is kept even though the bytes are not, so two different files over the limit are
        // still two different trees. A refusal that erased the size would freeze the evidence for
        // anything large enough to trip it.
        refuse(relative, "file-too-large", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      if (totalBytes + stats.size > limits.maxTotalBytes) {
        refuse(relative, "tree-too-large", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      let bytes;
      try {
        bytes = readBytes(full);
      } catch {
        // Present, sized, and not readable. Recorded rather than dropped: an omitted entry reads as
        // a file that was never there, which is what an agent would want it to read as.
        refuse(relative, "unreadable-entry", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      totalBytes += bytes.length;
      entries.push(entryOf({ path: relative, type: "file", mode: modeOf(stats), size: bytes.length, bytes, refused: null }));
    }
  };

  const rootNames = listing(base);
  if (rootNames === null) throw new Error(`AOS_DIGEST_UNREADABLE ${root}`);
  walk(base, "", 0, rootNames);
  return {
    schema_id: TREE_MANIFEST_SCHEMA,
    entries,
    refusals,
    totals: { entries: entries.length, bytes: totalBytes }
  };
}

// The canonical row, and why the path is hex.
//
// The fields are joined by a tab, and every field except the path comes from a fixed alphabet that
// cannot contain one. A path can: a newline and a tab are both legal in a filename on macOS and
// Linux, so a path written literally could be split into two rows, or two rows joined into one, by
// naming a file after them. Hex removes the question entirely -- at the cost of an unreadable row,
// which nobody reads, since what is read is the manifest.
const rowOf = (entry) => [
  entry.type,
  entry.mode ?? "-",
  entry.size_bytes === null ? "-" : String(entry.size_bytes),
  entry.byte_digest ?? "-",
  entry.refused === null ? "-" : `refused:${entry.refused}`,
  Buffer.from(entry.path, "utf8").toString("hex")
].join("\t");

/**
 * The one digest that changes when anything in the tree does.
 *
 * Domain-separated by the schema line, so a tree digest can never equal a file digest by accident,
 * and so a later version of this encoding is a different digest rather than a silently compatible
 * one. The text projections are deliberately not in the row: they are a projection, and a tree
 * whose identity moved with one would inherit the collisions this module removes.
 */
export function canonicalTreeDigest(manifest) {
  if (manifest?.schema_id !== TREE_MANIFEST_SCHEMA) throw new Error("AOS_TREE_MANIFEST_SCHEMA");
  const rows = manifest.entries.map(rowOf);
  return digestOf(Buffer.from(`${TREE_MANIFEST_SCHEMA}\n${rows.join("\n")}\n`, "utf8"));
}

/** The tree at `root`, in one call, for callers that do not need the manifest. */
export function treeByteDigest(root, policy = {}) {
  return canonicalTreeDigest(canonicalTreeManifest(root, policy));
}

/**
 * What an artifact is, for a handoff.
 *
 * The bytes and the name it was handed under, and nothing else. This used to be
 * `sha256Text(`${relative}\0${fileDigest(path)}`)`, and `fileDigest` decoded the file as UTF-8
 * first: an artifact whose line endings were rewritten, or whose binary content changed by one
 * undecodable byte, was handed on under the digest it had before. A receiver checking the digest it
 * was given would have confirmed an artifact that is not the one on disk.
 *
 * A directory artifact is the canonical tree, which carries each entry's relative path, type, mode
 * and byte digest. The old version folded a directory's entries by name only, so a file made
 * executable, or a file replaced by a symlink to the same content, handed on unchanged.
 *
 * A symlink at the top of an artifact is still refused outright rather than recorded: a handoff
 * names something the receiver is expected to read, and a link is not that.
 */
export function artifactByteDigest(path, relative = "") {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`AOS_SYMLINK_ARTIFACT ${relative || path}`);
  if (stat.isFile()) return sha256Bytes(Buffer.from(`aos-artifact.v2\n${relative}\n${fileByteDigest(path)}\n`, "utf8"));
  if (!stat.isDirectory()) throw new Error(`AOS_UNSUPPORTED_ARTIFACT ${relative || path}`);
  return sha256Bytes(Buffer.from(`aos-artifact.v2\n${relative}\n${canonicalTreeDigest(canonicalTreeManifest(path))}\n`, "utf8"));
}

/** Whether a string is one of this module's digests, rather than a legacy bare-hex one. */
export const isByteDigest = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);

/**
 * Whether what a receiver was handed is exactly what the sender produced.
 *
 * Exact and ordered, over the full digest strings. A handoff check that compared lengths, or sets of
 * prefixes, or "did the receiver get at least one of these", passes for a receiver that was handed
 * something else -- which is the whole of what a handoff digest is for. A legacy bare-hex digest on
 * either side is a mismatch rather than a match to be attempted: the two were computed over
 * different bytes and comparing them would be comparing answers to different questions.
 */
export function handoffDigestsMatch(produced, received) {
  if (!Array.isArray(produced) || !Array.isArray(received)) return false;
  if (produced.length !== received.length) return false;
  if (!produced.every(isByteDigest) || !received.every(isByteDigest)) return false;
  return produced.every((digest, index) => digest === received[index]);
}
