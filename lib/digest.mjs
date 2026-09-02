import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

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

/** The envelope an artifact digest is taken over. v3 carries the artifact's own type and mode. */
export const ARTIFACT_SCHEMA = "aos-artifact.v3";

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

// A path is bytes here, never a string, for the same reason a file's contents are.
//
// `readdirSync` and `readlinkSync` decode by default, and neither a filename nor a link target is
// text: on Linux every byte but `/` and NUL is legal in both. Two files named after the single
// bytes FF and FE decoded to the same U+FFFD; the walk then looked for the re-encoded name, failed
// to find either, and recorded one identical `unreadable-entry` row for both -- two different trees
// with one identity. A link to FF and a link to FE were hashed as the same U+FFFD, which
// contradicts the whole claim that a link is evidence about its own bytes.
//
// So every name arrives as a Buffer and stays one, and the canonical row carries the hex of exactly
// the bytes the kernel handed over.
const SEPARATOR = Buffer.from(sep, "utf8");
const SLASH = 0x2f;
const DOT = 0x2e;

const joinBytes = (directory, name) =>
  directory.length === 0
    ? name
    : Buffer.concat([directory, directory.at(-1) === SLASH ? Buffer.alloc(0) : SEPARATOR, name]);

const containsBytes = (base, target) => {
  if (base.equals(target)) return true;
  const prefix = base.at(-1) === SLASH ? base : Buffer.concat([base, SEPARATOR]);
  return target.length >= prefix.length && target.subarray(0, prefix.length).equals(prefix);
};

const segmentsOf = (path) => {
  const parts = [];
  let start = 0;
  for (let at = 0; at <= path.length; at += 1) {
    if (at === path.length || path[at] === SLASH) {
      if (at > start) parts.push(path.subarray(start, at));
      start = at + 1;
    }
  }
  return parts;
};

const isDot = (segment) => segment.length === 1 && segment[0] === DOT;
const isDotDot = (segment) => segment.length === 2 && segment[0] === DOT && segment[1] === DOT;

/** `target` resolved against the absolute `directory`, with `.` and `..` folded, in bytes. */
const resolveBytes = (directory, target) => {
  const absolute = target.length > 0 && target[0] === SLASH;
  const segments = absolute ? segmentsOf(target) : [...segmentsOf(directory), ...segmentsOf(target)];
  const kept = [];
  for (const segment of segments) {
    if (isDot(segment)) continue;
    if (isDotDot(segment)) {
      kept.pop();
      continue;
    }
    kept.push(segment);
  }
  return kept.length === 0 ? Buffer.from(sep, "utf8") : Buffer.concat(kept.flatMap((segment) => [SEPARATOR, segment]));
};

const parentOf = (path) => {
  const at = path.lastIndexOf(SLASH);
  return at <= 0 ? Buffer.from(sep, "utf8") : path.subarray(0, at);
};

// The permission bits and nothing else. mtime is not evidence about content: a digest that moved
// with it would report every `touch` as a change and bury a real one among them. The mode is
// evidence -- making a file executable changes what the tree does without changing a byte of it.
const modeOf = (stats) => (stats.mode & 0o7777).toString(8).padStart(4, "0");

// Symlinks are recorded as links and never followed.
//
// The alternative -- follow the link and digest what it points at -- makes the tree digest a
// statement about files that are not in the tree, and a link to ~/.ssh/id_ed25519 puts the
// operator's private key into a digest and, through a diff, into a report. So the link is evidence
// about itself: its type is `symlink` and its digest is over its own bytes, which are the target
// name. That is what makes replacing a file with a link to a file of the same content a visible
// change rather than an invisible one.
//
// A link whose target resolves outside the tree carries the same evidence and is marked refused, so
// the reason travels with the entry and a reader knows not to resolve it. It keeps its own bytes:
// dropping them made `link -> ../outside-a` and `link -> ../outside-b` the identical row, which is
// a collision inside the refusal rather than a protection. Nothing outside the tree is read either
// way -- the target *name* is not the target's contents, and the digest of a name discloses
// neither.
const SYMLINK_ESCAPES = "symlink-escapes-tree";

// A chain longer than this is a loop or an attempt to exhaust the walk, and either way there is no
// honest link at the end of it. The number is the conventional SYMLOOP_MAX; what matters is that
// running out is a refusal rather than a hang.
const MAX_LINK_HOPS = 40;

/**
 * Whether following the link at `full` stays inside `base`.
 *
 * `realpathSync` first, because it resolves a whole chain in one call. It fails for a dangling
 * link, and a dangling link is still a link worth recording, so the chain is then followed by hand:
 * checking only the first hop said that `outer -> inner`, with `inner -> ../outside/missing`, points
 * at `root/inner` and let it through, even though following it leaves the tree. Every hop has to
 * land inside, not just the first.
 */
const linkTargetInside = (base, directory, full, target) => {
  try {
    return containsBytes(base, realpathSync(full, { encoding: "buffer" }));
  } catch {
    let current = resolveBytes(directory, target);
    for (let hop = 0; hop < MAX_LINK_HOPS; hop += 1) {
      if (!containsBytes(base, current)) return false;
      let next;
      try {
        next = readlinkSync(current, { encoding: "buffer" });
      } catch {
        // Not a link, or not there. The chain ends here, and it ends inside the tree.
        return true;
      }
      current = resolveBytes(parentOf(current), next);
    }
    return false;
  }
};

// `O_NOFOLLOW`, so the read cannot be pointed somewhere else after the check.
//
// Between the lstat that said this entry was a regular file and the open that reads it, the entry
// can be replaced by a symlink pointing out of the tree, and a plain `readFileSync` follows it --
// bytes from outside the tree, under an in-tree path, in the digest. Opening the final component
// with `O_NOFOLLOW` turns that race into an `ELOOP` and therefore into a refusal.
//
// The window on an ancestor *directory* stays open: closing it needs `openat` walked component by
// component, which Node does not expose. That residual is documented rather than implied.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

const readEntryBytes = (file) => {
  const fd = openSync(file, constants.O_RDONLY | O_NOFOLLOW);
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
};

const entryOf = ({ path, type, mode, size, bytes, refused }) => ({
  schema_id: FILE_EVIDENCE_SCHEMA,
  // `path` is for a reader and `path_bytes` is the identity. A name that is not valid UTF-8 decodes
  // to U+FFFD here, which is the collision the hex beside it removes: two such entries share this
  // field and differ in the one the digest is taken over.
  path: path.toString("utf8"),
  path_bytes: path.toString("hex"),
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
 * the same tree. Siblings are ordered over the raw bytes of their names rather than over
 * `localeCompare`, because a comparison that reads the ambient locale makes the digest a property of
 * the machine that computed it; a directory is recorded before the entries under it.
 *
 * A refused entry is still an entry. Dropping it would let an agent hide a change by making the file
 * unreadable -- the tree would digest as though the entry had never existed, and a scope check
 * would report a clean workspace.
 */
export function canonicalTreeManifest(root, policy = {}) {
  const limits = { ...TREE_LIMITS, ...policy };
  const skip = new Set(policy.skipDirectories ?? TREE_SKIP_DIRECTORIES);
  const base = realpathSync(resolve(root), { encoding: "buffer" });
  const entries = [];
  const refusals = [];
  let totalBytes = 0;
  let seen = 0;

  const record = (path, { type, mode = null, size = null, bytes = null, refused = null }) => {
    entries.push(entryOf({ path, type, mode, size, bytes, refused }));
    if (refused !== null) refusals.push({ path: path.toString("utf8"), reason: refused });
  };

  const refuse = (path, reason, { type = "refused", mode = null, size = null } = {}) =>
    record(path, { type, mode, size, bytes: null, refused: reason });

  // Read here rather than at the top of the walk, so a directory that cannot be listed is one
  // refused entry rather than a `dir` entry and a refusal at the same path. `chmod 000` on a
  // directory is something an assessed agent can do, and letting the exception out would report
  // nothing at all about the tree rather than reporting the entry that failed.
  const listing = (directory) => {
    try {
      return readdirSync(directory, { encoding: "buffer" }).sort(Buffer.compare);
    } catch {
      return null;
    }
  };

  const walk = (directory, relativeDirectory, depth, names) => {
    for (const name of names) {
      const full = joinBytes(directory, name);
      const relative = joinBytes(relativeDirectory, name);
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
        // The link's own bytes are the target name. Digesting the target's contents instead would
        // make two different entries -- a file and a link to it -- the same evidence.
        const target = readlinkSync(full, { encoding: "buffer" });
        const escapes = !linkTargetInside(base, directory, full, target);
        // No mode. A symlink's permission bits are not enforced on either supported platform and
        // they differ between them -- 0777 on Linux, 0755 on macOS -- so recording them would make
        // the digest of any tree containing a link a property of the machine that walked it.
        record(relative, {
          type: "symlink",
          mode: null,
          size: target.length,
          bytes: target,
          refused: escapes ? SYMLINK_ESCAPES : null
        });
        continue;
      }

      if (stats.isDirectory()) {
        if (skip.has(name.toString("utf8"))) {
          // The directory is recorded even though its contents are not walked. Dropping the entry
          // as well made an empty artifact and one holding an empty `.git/` the same artifact --
          // the skip is a statement about bookkeeping *contents*, never about whether the directory
          // is there.
          refuse(relative, "skipped-directory", { type: "dir", mode: modeOf(stats) });
          continue;
        }
        if (depth + 1 > limits.maxDepth) {
          refuse(relative, "max-depth", { mode: modeOf(stats) });
          continue;
        }
        // Defence in depth against a path that stopped meaning what the walk checked: an ancestor
        // replaced by a symlink mid-walk, or a filesystem that links directories. It is not a
        // bind-mount check -- `realpath` of a bind mount returns the in-tree mountpoint, not the
        // source it was mounted from, so a bind mount is invisible here and is named as a limit in
        // docs/BYTE_DIGEST.md rather than claimed as covered.
        let inside = false;
        try { inside = containsBytes(base, realpathSync(full, { encoding: "buffer" })); } catch { inside = false; }
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
        record(relative, { type: "dir", mode: modeOf(stats) });
        walk(full, relative, depth + 1, children);
        continue;
      }

      if (!stats.isFile()) {
        // A FIFO blocks the reader forever; a device or a socket is not evidence about the task.
        refuse(relative, "not-a-regular-file", { mode: modeOf(stats) });
        continue;
      }
      if (stats.size > limits.maxFileBytes) {
        // The path, type, mode, size and reason are kept even though the bytes are not, so a
        // refusal is still evidence about *this* entry. What it cannot be is evidence about the
        // contents: two files of the same size refused for the same reason are one row, and that
        // limit is stated in docs/BYTE_DIGEST.md rather than papered over.
        refuse(relative, "file-too-large", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      if (totalBytes + stats.size > limits.maxTotalBytes) {
        refuse(relative, "tree-too-large", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      let bytes;
      try {
        bytes = readEntryBytes(full);
      } catch {
        // Present, sized, and not readable -- or swapped for a link after the lstat, which
        // `O_NOFOLLOW` turns into this same refusal. Recorded rather than dropped: an omitted entry
        // reads as a file that was never there, which is what an agent would want it to read as.
        refuse(relative, "unreadable-entry", { mode: modeOf(stats), size: stats.size });
        continue;
      }
      totalBytes += bytes.length;
      record(relative, { type: "file", mode: modeOf(stats), size: bytes.length, bytes });
    }
  };

  const rootNames = listing(base);
  if (rootNames === null) throw new Error(`AOS_DIGEST_UNREADABLE ${root}`);
  walk(base, Buffer.alloc(0), 0, rootNames);
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
  entry.path_bytes
].join("\t");

const ENTRY_TYPES = new Set(["file", "dir", "symlink", "refused"]);
const MODE_BITS = /^[0-7]{4}$/;
const REFUSAL_NAME = /^[a-z][a-z-]*$/;
const HEX_BYTES = /^([0-9a-f]{2})*$/;

/**
 * Whether an entry is one this encoding can write a row for.
 *
 * "Every field but the path comes from a fixed alphabet" is a property of the walk, not of the
 * function that hashes its output, and `canonicalTreeDigest` is exported. Given a hand-built
 * manifest whose `type` was `dir\t0755\t-\t-\t-\t61\nfile`, the join produced exactly the rows of a
 * different two-entry tree and the two digested the same. So the alphabet is checked here, where
 * the boundary actually is, and a manifest that could forge a row boundary is refused rather than
 * hashed.
 */
const wellFormedEntry = (entry) =>
  entry !== null && typeof entry === "object"
  && entry.schema_id === FILE_EVIDENCE_SCHEMA
  && ENTRY_TYPES.has(entry.type)
  && (entry.mode === null || (typeof entry.mode === "string" && MODE_BITS.test(entry.mode)))
  && (entry.size_bytes === null || (Number.isSafeInteger(entry.size_bytes) && entry.size_bytes >= 0))
  && (entry.byte_digest === null || isByteDigest(entry.byte_digest))
  && (entry.refused === null || (typeof entry.refused === "string" && REFUSAL_NAME.test(entry.refused)))
  && typeof entry.path_bytes === "string" && HEX_BYTES.test(entry.path_bytes);

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
  if (!Array.isArray(manifest.entries)) throw new Error("AOS_TREE_MANIFEST_SCHEMA");
  for (const entry of manifest.entries) {
    if (!wellFormedEntry(entry)) throw new Error(`AOS_TREE_MANIFEST_ENTRY ${entry?.path ?? "?"}`);
  }
  const rows = manifest.entries.map(rowOf);
  return digestOf(Buffer.from(`${TREE_MANIFEST_SCHEMA}\n${rows.join("\n")}\n`, "utf8"));
}

/** The tree at `root`, in one call, for callers that do not need the manifest. */
export function treeByteDigest(root, policy = {}) {
  return canonicalTreeDigest(canonicalTreeManifest(root, policy));
}

// What an artifact is, for a handoff: its type, its own mode, the name it was handed under, and the
// digest of what is inside it.
//
// The type is in the envelope because without it a regular file and a directory could be handed on
// under one identity. A file whose contents are exactly `aos-tree-manifest.v1\n\n` has the byte
// digest of the empty tree, so an empty directory named `bundle` and that file named `bundle`
// produced the same artifact digest -- the domain separation was claimed for directories and never
// existed for files.
//
// The mode is in the envelope because `lstatSync` was already being called and neither branch used
// it: `run.sh` handed on identically at 0644 and 0755, and a root directory handed on identically
// at 0755 and 0700. A digest that cannot see the executable bit cannot see the difference between
// an artifact the receiver can run and one it cannot.
//
// The name is hex for the same reason a canonical row's path is: it is the one field an agent
// chooses, and a newline in it would otherwise reach into the envelope's structure.
const artifactPreimage = (type, stats, relative, digest) =>
  Buffer.from(`${ARTIFACT_SCHEMA}\n${type}\n${modeOf(stats)}\n${Buffer.from(relative, "utf8").toString("hex")}\n${digest}\n`, "utf8");

/**
 * What an artifact is, for a handoff.
 *
 * The bytes, the type, the mode and the name it was handed under. This used to be
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
  if (stat.isFile()) return sha256Bytes(artifactPreimage("file", stat, relative, fileByteDigest(path)));
  if (!stat.isDirectory()) throw new Error(`AOS_UNSUPPORTED_ARTIFACT ${relative || path}`);
  return sha256Bytes(artifactPreimage("dir", stat, relative, canonicalTreeDigest(canonicalTreeManifest(path))));
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
 *
 * Ordered rather than a multiset, deliberately. The producer is `outputArtifactDigests`, which
 * emits in ascending order of the artifact name, so the order is reproducible rather than
 * incidental; a receiver that reports the same digests in another order did not read the list it
 * was handed. Loosening this to a multiset would trade a check that fails closed for one that
 * accepts a claim nobody made, and the cost of complying with it is to keep the order.
 */
export function handoffDigestsMatch(produced, received) {
  if (!Array.isArray(produced) || !Array.isArray(received)) return false;
  if (produced.length !== received.length) return false;
  if (!produced.every(isByteDigest) || !received.every(isByteDigest)) return false;
  return produced.every((digest, index) => digest === received[index]);
}

/**
 * Whether two handoff lists hold the same digests with the same multiplicities.
 *
 * Not a substitute for `handoffDigestsMatch` and never used to accept anything. It exists so the
 * refusal can say which of the two mistakes was made -- a receiver that read something else, or one
 * that read the right things and listed them in another order -- because a refusal an operator
 * cannot act on gets worked around rather than fixed.
 */
export function handoffDigestsSameMultiset(produced, received) {
  if (!Array.isArray(produced) || !Array.isArray(received)) return false;
  if (produced.length !== received.length) return false;
  return JSON.stringify([...produced].sort()) === JSON.stringify([...received].sort());
}
