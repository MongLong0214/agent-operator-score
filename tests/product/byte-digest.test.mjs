import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FILE_EVIDENCE_SCHEMA,
  TREE_MANIFEST_SCHEMA,
  artifactByteDigest,
  canonicalTreeDigest,
  canonicalTreeManifest,
  fileByteDigest,
  handoffDigestsSameMultiset,
  isByteDigest,
  optionalFileTextDigest,
  sha256Bytes,
  treeByteDigest
} from "../../lib/digest.mjs";
import { runProcess } from "../../lib/core.mjs";
import { acceptanceOf, emptyLedger, judge, loadLedger, recordSession } from "../../lib/holdout.mjs";
import { DIRECTORY, safeWalk } from "../../lib/safe-fs.mjs";
import { run } from "./helpers.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-byte-digest-"));

const withScratch = (body) => {
  const root = scratch();
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Two files, one digest each, and whether the instrument can tell them apart. */
const twoFiles = (root, left, right) => {
  writeFileSync(join(root, "left"), left);
  writeFileSync(join(root, "right"), right);
  return [fileByteDigest(join(root, "left")), fileByteDigest(join(root, "right"))];
};

const treeOf = (root, policy) => canonicalTreeDigest(canonicalTreeManifest(root, policy));

// --- the primitive ---------------------------------------------------------------------------

test("sha256Bytes digests the buffer it is given and refuses anything that is not one", () => {
  // The empty digest, from the specification, so a wrong algorithm or a stray encoding step is
  // visible against a value nobody here computed.
  assert.equal(
    sha256Bytes(Buffer.alloc(0)),
    "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256Bytes(Buffer.from("abc", "utf8")),
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  // A string would be decoded by the hash function, which is the whole defect this replaces. The
  // authority takes bytes or it takes nothing.
  assert.throws(() => sha256Bytes("abc"), /AOS_DIGEST_NOT_BYTES/);
  assert.throws(() => sha256Bytes(null), /AOS_DIGEST_NOT_BYTES/);
});

// --- files a text digest cannot tell apart ---------------------------------------------------

test("the same characters in UTF-8 and UTF-16LE are two different files", () => {
  withScratch((root) => {
    const [utf8, utf16] = twoFiles(root, Buffer.from("hello", "utf8"), Buffer.from("hello", "utf16le"));
    assert.notEqual(utf8, utf16);
  });
});

test("a byte-order mark is part of the file", () => {
  withScratch((root) => {
    const bare = Buffer.from("hello", "utf8");
    const [plain, marked] = twoFiles(root, bare, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bare]));
    assert.notEqual(plain, marked);
    // The optional projection is a projection of the text, and the mark is text. Stripping it there
    // would give the projection a normalisation the specification does not name.
    assert.notEqual(
      optionalFileTextDigest(join(root, "left")),
      optionalFileTextDigest(join(root, "right"))
    );
  });
});

test("LF and CRLF are two different files, and the optional text projection says they are the same document", () => {
  withScratch((root) => {
    const [lf, crlf] = twoFiles(root, Buffer.from("a\nb\n", "utf8"), Buffer.from("a\r\nb\r\n", "utf8"));
    assert.notEqual(lf, crlf, "a CRLF rewrite of every line was invisible to the byte digest");
    assert.equal(
      optionalFileTextDigest(join(root, "left")),
      optionalFileTextDigest(join(root, "right")),
      "the text projection is the one that is allowed to fold line endings"
    );
    // And the projection is not the file: for the CRLF one it is a digest of bytes that are not on
    // disk anywhere, which is exactly why it cannot stand as identity.
    assert.notEqual(crlf, optionalFileTextDigest(join(root, "right")));
  });
});

test("a file that decodes to a replacement character is not the byte that produced it", () => {
  withScratch((root) => {
    // U+FFFD written honestly, against a single invalid byte. `readFileSync(f, "utf8")` turns the
    // second into the first, so a text digest calls a 0xFF byte and a legitimate replacement
    // character the same file.
    const [replacement, invalid] = twoFiles(root, Buffer.from("�", "utf8"), Buffer.from([0xff]));
    assert.notEqual(replacement, invalid);
    // Invalid UTF-8 has no text projection, and producing one anyway is how the collision was made.
    assert.equal(optionalFileTextDigest(join(root, "right")), null);
    // It still has byte evidence. Refusing to digest a binary file would let an agent hide a change
    // by making the file undecodable.
    assert.match(fileByteDigest(join(root, "right")), /^sha256:[0-9a-f]{64}$/);
  });
});

test("two different invalid byte sequences are two different files", () => {
  withScratch((root) => {
    // Both decode to a single U+FFFD, so a text digest cannot separate them from each other either.
    const [first, second] = twoFiles(root, Buffer.from([0xff]), Buffer.from([0xfe]));
    assert.notEqual(first, second);
  });
});

test("a trailing newline is part of the file", () => {
  withScratch((root) => {
    const [without, withNewline] = twoFiles(root, Buffer.from("a", "utf8"), Buffer.from("a\n", "utf8"));
    assert.notEqual(without, withNewline);
  });
});

test("an empty file and an absent file are not the same thing", () => {
  withScratch((root) => {
    writeFileSync(join(root, "empty"), Buffer.alloc(0));
    assert.equal(
      fileByteDigest(join(root, "empty")),
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // Not the empty digest, and not null either: a caller that reads a digest out of a missing file
    // has been told the file exists and is empty, which is a different claim about the workspace.
    assert.throws(() => fileByteDigest(join(root, "absent")), /AOS_DIGEST_UNREADABLE/);
    assert.throws(() => optionalFileTextDigest(join(root, "absent")), /AOS_DIGEST_UNREADABLE/);

    // The same distinction has to survive into a tree, where it is the one an agent would exploit:
    // deleting a file and truncating it must not produce the same evidence.
    const emptied = scratch();
    const deleted = scratch();
    try {
      writeFileSync(join(emptied, "a"), Buffer.alloc(0));
      writeFileSync(join(emptied, "b"), Buffer.from("kept", "utf8"));
      writeFileSync(join(deleted, "b"), Buffer.from("kept", "utf8"));
      assert.notEqual(treeOf(emptied), treeOf(deleted));
    } finally {
      rmSync(emptied, { recursive: true, force: true });
      rmSync(deleted, { recursive: true, force: true });
    }
  });
});

test("a text projection is offered only for bytes that are valid UTF-8", () => {
  withScratch((root) => {
    writeFileSync(join(root, "text"), Buffer.from("plain\n", "utf8"));
    writeFileSync(join(root, "binary"), Buffer.from([0x00, 0x01, 0xff, 0xfe]));
    // A lone surrogate half is well-formed UTF-16 and is not valid UTF-8; a decoder that is not
    // strict accepts it and produces a digest of something the file does not contain.
    writeFileSync(join(root, "surrogate"), Buffer.from([0xed, 0xa0, 0x80]));
    assert.match(optionalFileTextDigest(join(root, "text")), /^sha256:[0-9a-f]{64}$/);
    assert.equal(optionalFileTextDigest(join(root, "binary")), null);
    assert.equal(optionalFileTextDigest(join(root, "surrogate")), null);
  });
});

// --- file evidence ----------------------------------------------------------------------------

test("file evidence carries the byte digest, the size and the media, and never only a prefix", () => {
  withScratch((root) => {
    writeFileSync(join(root, "a.txt"), Buffer.from("hello\r\n", "utf8"));
    writeFileSync(join(root, "b.bin"), Buffer.from([0xff, 0x00]));
    const manifest = canonicalTreeManifest(root);
    const byPath = Object.fromEntries(manifest.entries.map((entry) => [entry.path, entry]));

    // v3, not the v2 the issue names: this record carries `path_bytes`, records `mode` as the
    // permission bits alone, and is refused by `canonicalTreeDigest` in the old shape. An
    // identifier that stayed put over a redefinition is the silent schema upgrade the contract
    // forbids.
    assert.equal(byPath["a.txt"].schema_id, "aos-file-evidence.v3");
    assert.equal(byPath["a.txt"].path_bytes, Buffer.from("a.txt", "utf8").toString("hex"));
    assert.equal(byPath["a.txt"].type, "file");
    assert.equal(byPath["a.txt"].size_bytes, 7);
    assert.equal(byPath["a.txt"].media, "text");
    assert.equal(byPath["a.txt"].byte_digest, fileByteDigest(join(root, "a.txt")));
    assert.equal(byPath["a.txt"].text_digest, optionalFileTextDigest(join(root, "a.txt")));
    assert.equal(byPath["a.txt"].refused, null);
    // The whole digest, so a later reader can verify it. A truncated one is a label.
    assert.match(byPath["a.txt"].byte_digest, /^sha256:[0-9a-f]{64}$/);

    assert.equal(byPath["b.bin"].media, "binary");
    assert.equal(byPath["b.bin"].text_digest, null);
    assert.match(byPath["b.bin"].byte_digest, /^sha256:[0-9a-f]{64}$/);
  });
});

// --- tree identity ------------------------------------------------------------------------------

test("a tree digest changes when a file is added, removed, renamed, or its contents change", () => {
  withScratch((root) => {
    writeFileSync(join(root, "a"), Buffer.from("one", "utf8"));
    const base = treeOf(root);

    writeFileSync(join(root, "b"), Buffer.from("two", "utf8"));
    const added = treeOf(root);
    assert.notEqual(added, base, "an added file left the tree digest unchanged");

    rmSync(join(root, "b"));
    assert.equal(treeOf(root), base, "removing what was added did not return the tree to itself");

    // A rename moves the same bytes to a different relative path, which the specification requires
    // to be a different tree: the path is part of the identity, not a label on it.
    writeFileSync(join(root, "renamed"), Buffer.from("one", "utf8"));
    rmSync(join(root, "a"));
    assert.notEqual(treeOf(root), base, "a rename of the only file left the tree digest unchanged");

    // One byte.
    writeFileSync(join(root, "renamed"), Buffer.from("onf", "utf8"));
    const edited = treeOf(root);
    writeFileSync(join(root, "renamed"), Buffer.from("one", "utf8"));
    assert.notEqual(edited, treeOf(root));
  });
});

test("a tree digest changes when a mode changes and not when only an mtime does", () => {
  withScratch((root) => {
    const file = join(root, "script.sh");
    writeFileSync(file, Buffer.from("#!/bin/sh\n", "utf8"), { mode: 0o644 });
    const before = treeOf(root);

    // mtime is not evidence about content. A tree digest that moved with it would report every
    // `touch` as a change and make a real one impossible to see among them.
    utimesSync(file, new Date(0), new Date(0));
    assert.equal(treeOf(root), before, "an mtime change moved the tree digest");

    chmodSync(file, 0o755);
    assert.notEqual(treeOf(root), before, "making a file executable left the tree digest unchanged");
  });
});

test("a tree digest is about the relative tree, not about where it sits", () => {
  withScratch((left) => {
    withScratch((right) => {
      for (const root of [left, right]) {
        mkdirSync(join(root, "sub"));
        writeFileSync(join(root, "sub", "a"), Buffer.from("same", "utf8"));
        writeFileSync(join(root, "top"), Buffer.from("same", "utf8"));
      }
      assert.equal(treeOf(left), treeOf(right), "the absolute root leaked into the tree digest");

      // Same bytes, different relative path.
      rmSync(join(right, "sub", "a"));
      writeFileSync(join(right, "sub", "renamed"), Buffer.from("same", "utf8"));
      assert.notEqual(treeOf(left), treeOf(right));
    });
  });
});

test("a tree digest changes when an entry type changes", () => {
  withScratch((root) => {
    writeFileSync(join(root, "target"), Buffer.from("x", "utf8"));
    writeFileSync(join(root, "thing"), Buffer.from("target", "utf8"));
    const asFile = treeOf(root);
    rmSync(join(root, "thing"));
    symlinkSync("target", join(root, "thing"));
    // The link's own bytes are its target name, so a digest over content alone would call a file
    // holding the text "target" and a symlink pointing at `target` the same entry.
    assert.notEqual(treeOf(root), asFile, "a file replaced by a symlink read as an unchanged tree");
  });
});

test("an empty directory is part of the tree", () => {
  withScratch((root) => {
    writeFileSync(join(root, "a"), Buffer.from("one", "utf8"));
    const before = treeOf(root);
    mkdirSync(join(root, "empty"));
    assert.notEqual(treeOf(root), before, "an added directory left the tree digest unchanged");
  });
});

// --- symlinks and escape ------------------------------------------------------------------------

test("a symlink is recorded as a link and never followed", () => {
  withScratch((root) => {
    writeFileSync(join(root, "target"), Buffer.from("real bytes", "utf8"));
    symlinkSync("target", join(root, "link"));
    const manifest = canonicalTreeManifest(root);
    const link = manifest.entries.find((entry) => entry.path === "link");
    assert.equal(link.type, "symlink");
    assert.equal(link.refused, null);
    // The digest is over the link's own bytes -- the target name -- not over the target's contents.
    assert.equal(link.byte_digest, sha256Bytes(Buffer.from("target", "utf8")));
    assert.notEqual(link.byte_digest, fileByteDigest(join(root, "target")));
  });
});

test("a symlink out of the tree is refused rather than digested", () => {
  const outside = scratch();
  withScratch((root) => {
    try {
      writeFileSync(join(outside, "private"), Buffer.from("a secret this walk must never digest", "utf8"));
      symlinkSync(join(outside, "private"), join(root, "escape"));
      symlinkSync("../..", join(root, "up"));
      const manifest = canonicalTreeManifest(root);
      const byPath = Object.fromEntries(manifest.entries.map((entry) => [entry.path, entry]));

      for (const name of ["escape", "up"]) {
        assert.equal(byPath[name].type, "symlink", `${name} was not recorded as a link`);
        assert.equal(byPath[name].refused, "symlink-escapes-tree");
        // The link's own bytes, and never the target's. Recording the digest of a name is not
        // reading what the name points at, which is what the refusal is about.
        assert.notEqual(
          byPath.escape.byte_digest,
          fileByteDigest(join(outside, "private")),
          "the walk digested the file the link points at"
        );
        assert.equal(
          manifest.refusals.some((entry) => entry.path === name && entry.reason === "symlink-escapes-tree"),
          true,
          `${name} was not reported as a refusal`
        );
      }
      assert.equal(byPath.escape.byte_digest, sha256Bytes(Buffer.from(join(outside, "private"), "utf8")));
      // A refusal is an entry, not an absence: an omitted one reads as a tree that never held it.
      assert.equal(
        JSON.stringify(manifest.entries.map((entry) => entry.path)),
        JSON.stringify(["escape", "up"])
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a refusal is part of the tree digest", () => {
  const outside = scratch();
  withScratch((root) => {
    try {
      writeFileSync(join(root, "a"), Buffer.from("one", "utf8"));
      const before = treeOf(root);
      symlinkSync(join(outside, "private"), join(root, "escape"));
      // Refusing the entry must not read as a clean tree, or making a file unreadable becomes the
      // way to edit it invisibly.
      assert.notEqual(treeOf(root), before);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a directory reached through a link out of the tree is refused without being walked", () => {
  const outside = scratch();
  withScratch((root) => {
    try {
      mkdirSync(join(outside, "secrets"));
      writeFileSync(join(outside, "secrets", "key"), Buffer.from("private", "utf8"));
      symlinkSync(join(outside, "secrets"), join(root, "sub"));
      const manifest = canonicalTreeManifest(root);
      assert.equal(manifest.entries.length, 1);
      assert.equal(manifest.entries[0].path, "sub");
      assert.equal(manifest.entries[0].refused, "symlink-escapes-tree");
      assert.equal(
        manifest.entries.some((entry) => entry.path.includes("key")),
        false,
        "the walk went through the link and digested a file outside the tree"
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// --- limits, refused loudly ---------------------------------------------------------------------

test("a file over the limit is a named refusal, never a silent drop", () => {
  withScratch((root) => {
    writeFileSync(join(root, "huge"), Buffer.alloc(4096, 0x41));
    writeFileSync(join(root, "small"), Buffer.from("ok", "utf8"));
    const manifest = canonicalTreeManifest(root, { maxFileBytes: 1024 });
    const huge = manifest.entries.find((entry) => entry.path === "huge");
    assert.equal(huge.refused, "file-too-large");
    assert.equal(huge.byte_digest, null);
    // The size is still evidence, and it is what says the refusal was about this file.
    assert.equal(huge.size_bytes, 4096);
    assert.equal(manifest.refusals.some((entry) => entry.reason === "file-too-large"), true);
    // The refusal and a file of a different size are different trees, so growing past the limit is
    // not a way to freeze the evidence.
    writeFileSync(join(root, "huge"), Buffer.alloc(8192, 0x41));
    assert.notEqual(
      canonicalTreeDigest(canonicalTreeManifest(root, { maxFileBytes: 1024 })),
      canonicalTreeDigest(manifest)
    );
  });
});

test("a special file is refused rather than read", () => {
  withScratch((root) => {
    // A FIFO blocks a reader forever, which is the cheapest way to stop an assessment. Skipped
    // rather than failed where mkfifo is unavailable: the guard is about the walk, not about the
    // machine it runs on.
    const fifo = join(root, "pipe");
    if (spawnSync("mkfifo", [fifo], { stdio: "ignore" }).status !== 0) return;
    const entry = canonicalTreeManifest(root).entries.find((row) => row.path === "pipe");
    assert.equal(entry.type, "refused");
    assert.equal(entry.refused, "not-a-regular-file");
    assert.equal(entry.byte_digest, null);
  });
});

// --- the tuple is unambiguous ---------------------------------------------------------------------

test("a path cannot be forged out of another path and a digest", () => {
  withScratch((left) => {
    withScratch((right) => {
      // Two trees whose canonical rows would collide if the encoding joined fields with a separator
      // a path is allowed to contain. A newline in a filename is legal on both supported platforms.
      writeFileSync(join(left, "a\nb"), Buffer.from("x", "utf8"));
      writeFileSync(join(right, "a"), Buffer.from("x", "utf8"));
      writeFileSync(join(right, "b"), Buffer.from("x", "utf8"));
      assert.notEqual(treeOf(left), treeOf(right));
    });
  });
});

test("a tree digest is stable across two reads of the same tree", () => {
  withScratch((root) => {
    mkdirSync(join(root, "z"));
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "z", "1"), Buffer.from("one", "utf8"));
    writeFileSync(join(root, "a", "2"), Buffer.from("two", "utf8"));
    assert.equal(treeOf(root), treeOf(root));
    // Ordering is over the path bytes, so it does not move with the ambient locale.
    assert.deepEqual(
      canonicalTreeManifest(root).entries.map((entry) => entry.path),
      ["a", "a/2", "z", "z/1"]
    );
  });
});

// --- the call sites that used to fold the bytes -------------------------------------------------

test("a workspace snapshot sees a line-ending rewrite and a one-byte binary edit", () => {
  withScratch((root) => {
    writeFileSync(join(root, "source.txt"), Buffer.from("a\nb\n", "utf8"));
    writeFileSync(join(root, "blob.bin"), Buffer.from([0x00, 0xff, 0x10]));
    const before = safeWalk(root).files;

    // Both of these compared equal to the baseline before this change, so an agent could rewrite
    // every line of a file, or flip one byte inside a binary, and the scope check would report a
    // workspace it had not touched.
    writeFileSync(join(root, "source.txt"), Buffer.from("a\r\nb\r\n", "utf8"));
    writeFileSync(join(root, "blob.bin"), Buffer.from([0x00, 0xfe, 0x10]));
    const after = safeWalk(root).files;

    assert.notEqual(after["source.txt"], before["source.txt"], "a CRLF rewrite read as an unchanged file");
    assert.notEqual(after["blob.bin"], before["blob.bin"], "a one-byte binary edit read as an unchanged file");
    assert.match(after["source.txt"], /^sha256:[0-9a-f]{64}$/);
  });
});

test("a snapshot digest is the file's bytes and nothing else", () => {
  withScratch((root) => {
    writeFileSync(join(root, "f"), Buffer.from([0xff, 0x00, 0x41]));
    assert.equal(safeWalk(root).files.f, fileByteDigest(join(root, "f")));
  });
});

// --- artifact identity ----------------------------------------------------------------------------

// The mode is not in this test's name because it is not in this test: it has one of its own,
// "an artifact digest changes when the artifact's own mode changes". A name that lists a third
// thing the assertions never touch is a claim of coverage that does not exist.
test("an artifact digest moves with the bytes and the name it was handed under", () => {
  withScratch((root) => {
    const file = join(root, "report.md");
    writeFileSync(file, Buffer.from("line\n", "utf8"), { mode: 0o644 });
    const base = artifactByteDigest(file, "report.md");
    assert.match(base, /^sha256:[0-9a-f]{64}$/);

    // Each of these handed on unchanged before: the line-ending rewrite and the undecodable byte
    // were folded away by the UTF-8 decode, and the name was hashed into a digest of decoded text.
    writeFileSync(file, Buffer.from("line\r\n", "utf8"));
    assert.notEqual(artifactByteDigest(file, "report.md"), base);
    writeFileSync(file, Buffer.from([0xff]));
    const invalid = artifactByteDigest(file, "report.md");
    writeFileSync(file, Buffer.from([0xfe]));
    assert.notEqual(artifactByteDigest(file, "report.md"), invalid);

    // The name it was handed under is part of what was handed.
    writeFileSync(file, Buffer.from("line\n", "utf8"));
    assert.notEqual(artifactByteDigest(file, "renamed.md"), base);
  });
});

test("a directory artifact digest sees a mode change and a file replaced by a link", () => {
  withScratch((root) => {
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    writeFileSync(join(bundle, "run.sh"), Buffer.from("#!/bin/sh\n", "utf8"), { mode: 0o644 });
    writeFileSync(join(bundle, "payload.txt"), Buffer.from("payload", "utf8"));
    writeFileSync(join(bundle, "data"), Buffer.from("payload", "utf8"));
    const base = artifactByteDigest(bundle, "bundle");

    chmodSync(join(bundle, "run.sh"), 0o755);
    assert.notEqual(artifactByteDigest(bundle, "bundle"), base, "an artifact made executable handed on unchanged");
    chmodSync(join(bundle, "run.sh"), 0o644);
    assert.equal(artifactByteDigest(bundle, "bundle"), base);

    // Same content reachable at the same path, through a link rather than as a file -- and nothing
    // else changed. `payload.txt` is in the tree the baseline was taken over, so replacing `data`
    // is the only difference between the two digests. It used to be added at the same moment, which
    // left the assertion unable to say which of the two changes the digest had responded to.
    rmSync(join(bundle, "data"));
    symlinkSync("payload.txt", join(bundle, "data"));
    assert.notEqual(artifactByteDigest(bundle, "bundle"), base);
  });
});

test("a symlink handed as an artifact is refused, and so is a special file", () => {
  withScratch((root) => {
    writeFileSync(join(root, "real"), Buffer.from("x", "utf8"));
    symlinkSync("real", join(root, "link"));
    assert.throws(() => artifactByteDigest(join(root, "link"), "link"), /AOS_SYMLINK_ARTIFACT/);
    // The refusal is made by the open itself, so there is no window in which the target could be
    // read instead: the target is a perfectly ordinary readable file and its digest is not what
    // comes back under the link's name.
    assert.match(artifactByteDigest(join(root, "real"), "link"), /^sha256:[0-9a-f]{64}$/);
    // And a directory reached through a link is refused the same way, not walked.
    mkdirSync(join(root, "bundle"));
    writeFileSync(join(root, "bundle", "a"), Buffer.from("y", "utf8"));
    symlinkSync("bundle", join(root, "linked-bundle"));
    assert.throws(() => artifactByteDigest(join(root, "linked-bundle"), "linked-bundle"), /AOS_SYMLINK_ARTIFACT/);
    const fifo = join(root, "pipe");
    if (spawnSync("mkfifo", [fifo], { stdio: "ignore" }).status === 0) {
      assert.throws(() => artifactByteDigest(fifo, "pipe"), /AOS_UNSUPPORTED_ARTIFACT/);
    }
  });
});

test("an artifact digest and a bare tree digest are not the same value", () => {
  withScratch((root) => {
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    writeFileSync(join(bundle, "a"), Buffer.from("x", "utf8"));
    // Domain separation, so a value read out of one context cannot be presented as the other.
    assert.notEqual(artifactByteDigest(bundle, "bundle"), treeOf(bundle));
  });
});

test("two refusals of the same entry for different reasons are two different trees", () => {
  withScratch((root) => {
    writeFileSync(join(root, "big"), Buffer.alloc(4096, 0x41));
    // The same path, the same type, the same mode and the same size, refused for two different
    // reasons. Only the reason separates them, so this is what says the reason is in the digest
    // rather than merely in the manifest a reader might not compare.
    const perFile = treeOf(root, { maxFileBytes: 1024 });
    const perTree = treeOf(root, { maxFileBytes: 8192, maxTotalBytes: 1024 });
    const reasonOf = (policy) => canonicalTreeManifest(root, policy).entries[0].refused;
    assert.equal(reasonOf({ maxFileBytes: 1024 }), "file-too-large");
    assert.equal(reasonOf({ maxFileBytes: 8192, maxTotalBytes: 1024 }), "tree-too-large");
    assert.notEqual(perFile, perTree);
  });
});

test("a tree digest does not depend on the platform's symlink permission bits", () => {
  withScratch((root) => {
    writeFileSync(join(root, "target"), Buffer.from("x", "utf8"));
    symlinkSync("target", join(root, "link"));
    // Linux reports 0777 for a symlink and macOS 0755, and neither enforces them. Carrying the bits
    // would make the same tree digest differently on a developer's machine and in CI.
    assert.equal(canonicalTreeManifest(root).entries.find((entry) => entry.path === "link").mode, null);
  });
});

test("a captured stream digest is over the bytes the agent produced", async () => {
  const workspace = scratch();
  try {
    // Two different byte sequences that both decode to a single U+FFFD. Digesting the decoded text
    // gave them the same value, and the failure signature an operator is shown is built from it.
    const digestOf = async (byte) => {
      const result = await runProcess(
        {
          command: process.execPath,
          args: ["-e", `process.stdout.write(Buffer.from([${byte}]));process.stderr.write(Buffer.from([${byte}]))`]
        },
        { prompt: "", workspace, session: "s", family: "FAM-1", timeoutMs: 30000, isolation: "BEST_EFFORT_CLI" }
      );
      return result;
    };
    const first = await digestOf(0xff);
    const second = await digestOf(0xfe);
    assert.match(first.stdout_digest, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(first.stdout_digest, second.stdout_digest, "two different agent outputs carried the same evidence digest");
    assert.equal(first.stdout_digest, sha256Bytes(Buffer.from([0xff])));
    // Both streams, which "the bytes the agent produced" has always claimed. An agent that says
    // nothing on stdout and everything on stderr is the ordinary shape of a failing one, and a
    // decode there would give two different failures the same signature.
    assert.match(first.stderr_digest, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(first.stderr_digest, second.stderr_digest, "two different agent error streams carried the same evidence digest");
    assert.equal(first.stderr_digest, sha256Bytes(Buffer.from([0xff])));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unreadable directory is a refusal, not the end of the walk", () => {
  withScratch((root) => {
    // `chmod 000` is something an assessed agent can do to its own workspace. Letting the exception
    // out would report nothing at all about the tree rather than reporting the entry that failed.
    mkdirSync(join(root, "closed"));
    writeFileSync(join(root, "closed", "inside"), Buffer.from("x", "utf8"));
    writeFileSync(join(root, "open.txt"), Buffer.from("y", "utf8"));
    chmodSync(join(root, "closed"), 0o000);
    try {
      const manifest = canonicalTreeManifest(root);
      const byPath = Object.fromEntries(manifest.entries.map((entry) => [entry.path, entry]));
      assert.equal(byPath.closed.refused, "unreadable-directory");
      assert.equal(byPath.closed.byte_digest, null);
      // The rest of the tree is still evidence.
      assert.match(byPath["open.txt"].byte_digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(manifest.refusals.some((entry) => entry.reason === "unreadable-directory"), true);
    } finally {
      chmodSync(join(root, "closed"), 0o755);
    }
  });
});

test("an unreadable file is a refusal that keeps its size and its mode", () => {
  withScratch((root) => {
    // Its own test rather than a conditional half of the directory one: an assertion that runs only
    // when a mode happens to be enforced is not what a name promising "or file" claims. Mode 0000
    // does not stop root, so this returns rather than asserting there -- the same shape as the
    // tests that need `mkfifo`, and for the same reason.
    if (process.getuid?.() === 0) return;
    writeFileSync(join(root, "shut.txt"), Buffer.alloc(11, 0x41), { mode: 0o644 });
    chmodSync(join(root, "shut.txt"), 0o000);
    try {
      const entry = canonicalTreeManifest(root).entries[0];
      assert.equal(entry.path, "shut.txt");
      assert.equal(entry.refused, "unreadable-entry");
      assert.equal(entry.byte_digest, null);
      // Present, sized, and not readable -- an omitted entry would read as a file that was never
      // there, which is what an agent would want it to read as.
      assert.equal(entry.size_bytes, 11);
      assert.equal(entry.mode, "0000");
    } finally {
      chmodSync(join(root, "shut.txt"), 0o644);
    }
  });
});

test("a refused entry appears exactly once, and a max-depth refusal names the directory", () => {
  withScratch((root) => {
    mkdirSync(join(root, "closed"));
    chmodSync(join(root, "closed"), 0o000);
    try {
      const paths = canonicalTreeManifest(root).entries.map((entry) => entry.path);
      // Not once as a directory and again as a refusal: a consumer keyed by path would see the
      // second and a digest would carry a row for a listing that never happened.
      assert.deepEqual(paths, ["closed"]);
    } finally {
      chmodSync(join(root, "closed"), 0o755);
    }

    // And the second half of the name, which used to have no assertion under it: the refusal is
    // recorded at the directory that exceeded the depth, named as that directory, exactly once.
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    const deep = canonicalTreeManifest(root, { maxDepth: 2 });
    const depths = deep.entries.filter((entry) => entry.refused === "max-depth");
    assert.deepEqual(depths.map((entry) => entry.path), ["a/b/c"]);
    assert.deepEqual(deep.refusals.filter((entry) => entry.reason === "max-depth").map((entry) => entry.path), ["a/b/c"]);
  });
});

test("a tree deeper than the policy allows is refused at the directory that exceeds it", () => {
  withScratch((root) => {
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", "deep.txt"), Buffer.from("x", "utf8"));
    const manifest = canonicalTreeManifest(root, { maxDepth: 2 });
    const byPath = Object.fromEntries(manifest.entries.map((entry) => [entry.path, entry]));
    assert.equal(byPath["a/b/c"].refused, "max-depth");
    // And nothing below it was read.
    assert.equal(Object.hasOwn(byPath, "a/b/c/deep.txt"), false);
  });
});

// --- what the row has to be able to tell apart --------------------------------------------------
//
// Each of these was a pair of different trees, or a pair of different artifacts, that the digest
// gave one identity to. They are here rather than folded into the tests above because a collision
// is only evidence of anything when the two things being collided are stated.

test("a file artifact and a directory artifact are different even where their contents digest the same", () => {
  withScratch((root) => {
    // A file whose contents are exactly the bytes an empty canonical tree digests over. The
    // artifact envelope wrapped only the name and the inner digest, so this file named `bundle` and
    // an empty directory named `bundle` handed on under one artifact digest -- the domain
    // separation was claimed for directories and never existed for files.
    const asFile = join(root, "as-file");
    mkdirSync(asFile);
    writeFileSync(join(asFile, "bundle"), Buffer.from(`${TREE_MANIFEST_SCHEMA}\n\n`, "utf8"));
    chmodSync(join(asFile, "bundle"), 0o755);
    const asDirectory = join(root, "as-directory");
    mkdirSync(asDirectory);
    mkdirSync(join(asDirectory, "bundle"));
    chmodSync(join(asDirectory, "bundle"), 0o755);

    // The collision the type is guarding against, still constructible. Without this the test could
    // pass because the two inner digests drifted apart rather than because the type separates them,
    // and the same mode on both leaves the type as the only difference.
    assert.equal(fileByteDigest(join(asFile, "bundle")), treeOf(join(asDirectory, "bundle")));
    assert.notEqual(
      artifactByteDigest(join(asFile, "bundle"), "bundle"),
      artifactByteDigest(join(asDirectory, "bundle"), "bundle"),
      "a regular file and a directory were handed on under one artifact identity"
    );
  });
});

test("an artifact digest changes when the artifact's own mode changes", () => {
  withScratch((root) => {
    // `artifactByteDigest` was already calling `lstatSync` and neither branch used what it
    // returned, so a script handed on identically whether or not the receiver could run it.
    const file = join(root, "run.sh");
    writeFileSync(file, Buffer.from("#!/bin/sh\n", "utf8"), { mode: 0o644 });
    const readable = artifactByteDigest(file, "run.sh");
    chmodSync(file, 0o755);
    assert.notEqual(artifactByteDigest(file, "run.sh"), readable, "an artifact made executable handed on unchanged");
    chmodSync(file, 0o644);
    assert.equal(artifactByteDigest(file, "run.sh"), readable);

    // And the same question about the top of a directory artifact, which the tree inside it cannot
    // answer: the root's own mode is not one of its entries.
    const bundle = join(root, "bundle");
    mkdirSync(bundle, { mode: 0o755 });
    writeFileSync(join(bundle, "a"), Buffer.from("x", "utf8"));
    const open = artifactByteDigest(bundle, "bundle");
    chmodSync(bundle, 0o700);
    assert.notEqual(artifactByteDigest(bundle, "bundle"), open, "the artifact root's own mode was invisible");
  });
});

test("a refusal keeps the path, type, mode and size of what it refused", () => {
  withScratch((root) => {
    const refused = (name, size, byte, mode) => {
      const directory = join(root, name);
      mkdirSync(directory);
      writeFileSync(join(directory, "huge"), Buffer.alloc(size, byte), { mode });
      return directory;
    };
    const policy = { maxFileBytes: 1024 };
    const base = refused("base", 4096, 0x41, 0o644);
    assert.notEqual(treeOf(base, policy), treeOf(refused("bigger", 8192, 0x41, 0o644), policy), "the size left the refusal");
    assert.notEqual(treeOf(base, policy), treeOf(refused("executable", 4096, 0x41, 0o755), policy), "the mode left the refusal");

    const entry = canonicalTreeManifest(base, policy).entries[0];
    assert.equal(entry.type, "refused");
    assert.equal(entry.refused, "file-too-large");
    assert.equal(entry.mode, "0644");
    assert.equal(entry.size_bytes, 4096);
    assert.equal(entry.byte_digest, null);

    // And what a refusal cannot do, asserted rather than left for a reader to assume. The bytes
    // were not read, so two files of the same size refused for the same reason are one row: a
    // refusal identifies the entry it refused, never its contents. Documented in
    // docs/BYTE_DIGEST.md as a limit of the limits, because the alternative -- reading a file the
    // policy just refused to read -- is the thing the limit exists to prevent.
    assert.equal(treeOf(base, policy), treeOf(refused("other", 4096, 0x42, 0o644), policy));
  });
});

test("two links that escape the tree to different places are two different trees", () => {
  withScratch((root) => {
    const escaping = (name, target) => {
      const directory = join(root, name);
      mkdirSync(directory);
      symlinkSync(target, join(directory, "link"));
      return directory;
    };
    // The same name, the same refusal, a different target. Discarding the target bytes on refusal
    // made these one row -- a collision inside the refusal rather than a protection against one.
    // Nothing outside the tree is read either way: the name a link carries is not what it points at.
    assert.notEqual(treeOf(escaping("a", "../../outside-a")), treeOf(escaping("b", "../../outside-b")));
  });
});

test("a link target's raw bytes are the link's identity", () => {
  withScratch((root) => {
    const linked = (name, byte) => {
      const directory = join(root, name);
      mkdirSync(directory);
      symlinkSync(Buffer.from([byte]), join(directory, "link"));
      return directory;
    };
    // `readlinkSync` decodes by default, and both of these decoded to U+FFFD. Two links pointing at
    // two different names were hashed as the same link, which is the opposite of "the link's own
    // bytes".
    assert.notEqual(treeOf(linked("ff", 0xff)), treeOf(linked("fe", 0xfe)));
    const entry = canonicalTreeManifest(join(root, "ff")).entries[0];
    assert.equal(entry.type, "symlink");
    assert.equal(entry.size_bytes, 1);
    assert.equal(entry.byte_digest, sha256Bytes(Buffer.from([0xff])));
  });
});

test("a filename's raw bytes are its identity in the tree", () => {
  withScratch((root) => {
    const named = (directoryName, byte) => {
      const directory = join(root, directoryName);
      mkdirSync(directory);
      const path = Buffer.concat([Buffer.from(`${directory}/`, "utf8"), Buffer.from([byte])]);
      try {
        writeFileSync(path, Buffer.from("the same contents", "utf8"));
      } catch (error) {
        // APFS refuses a filename that is not valid UTF-8 with EILSEQ, so the case cannot be built
        // on macOS at all. It can be on Linux, where every byte but `/` and NUL is a legal name and
        // where CI runs the mutation this test is named by. Only EILSEQ is skipped: catching every
        // error would turn a genuine failure to write into a silent pass.
        if (error.code !== "EILSEQ") throw error;
        return null;
      }
      return directory;
    };
    const ff = named("ff", 0xff);
    if (ff === null) return;
    assert.notEqual(treeOf(ff), treeOf(named("fe", 0xfe)), "two names differing by one byte were one tree");

    const entry = canonicalTreeManifest(ff).entries[0];
    // Both halves: the name reached the row as the bytes the kernel gave, and the walk could still
    // find the file under it. Decoding produced U+FFFD, the lookup of the re-encoded name failed,
    // and both trees recorded one identical `unreadable-entry` row.
    assert.equal(entry.path_bytes, "ff");
    assert.equal(entry.refused, null);
    assert.equal(entry.byte_digest, sha256Bytes(Buffer.from("the same contents", "utf8")));
  });
});

test("a chain of dangling links that leaves the tree is refused", () => {
  const outside = scratch();
  withScratch((root) => {
    try {
      // `inner` dangles, so `realpath` cannot answer for either link and the lexical fallback is
      // what decides. Checking only the first hop said `outer` points at `root/inner`, which is
      // inside, and let it through -- although following it leaves the tree.
      symlinkSync(join(outside, "missing"), join(root, "inner"));
      symlinkSync("inner", join(root, "outer"));
      const byPath = Object.fromEntries(canonicalTreeManifest(root).entries.map((entry) => [entry.path, entry]));
      assert.equal(byPath.inner.refused, "symlink-escapes-tree");
      assert.equal(byPath.outer.refused, "symlink-escapes-tree", "a chain that escapes was accepted at its first hop");

      // A chain that stays inside is still a link and not a refusal, so this is not a check that
      // refuses everything it cannot resolve.
      writeFileSync(join(root, "real"), Buffer.from("x", "utf8"));
      symlinkSync("real", join(root, "near"));
      symlinkSync("near", join(root, "far"));
      const resolved = Object.fromEntries(canonicalTreeManifest(root).entries.map((entry) => [entry.path, entry]));
      assert.equal(resolved.far.refused, null);
      assert.equal(resolved.near.refused, null);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a skipped directory is an entry even though its contents are not walked", () => {
  withScratch((root) => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    const repository = join(root, "repository");
    mkdirSync(join(repository, ".git", "objects"), { recursive: true });
    writeFileSync(join(repository, ".git", "objects", "loose"), Buffer.from("bookkeeping", "utf8"));
    // The skip is a statement about bookkeeping contents, never about whether the directory is
    // there. Dropping its own entry too made an empty artifact and one holding a `.git/` the same
    // artifact.
    assert.notEqual(treeOf(empty), treeOf(repository));

    const entries = canonicalTreeManifest(repository).entries;
    assert.deepEqual(entries.map((entry) => entry.path), [".git"]);
    assert.equal(entries[0].type, "dir");
    assert.equal(entries[0].refused, "skipped-directory");
    // And nothing under it was read, which is what the skip is for: walking a repository's object
    // database reported every loose object as work the agent did.
    assert.equal(entries.some((entry) => entry.path.includes("loose")), false);
  });
});

test("a manifest whose fields could forge a row boundary is refused rather than hashed", () => {
  withScratch((root) => {
    const entry = (over) => ({
      schema_id: FILE_EVIDENCE_SCHEMA,
      path: "b",
      path_bytes: "62",
      type: "file",
      mode: "0644",
      size_bytes: 1,
      byte_digest: null,
      text_digest: null,
      media: "unknown",
      refused: null,
      ...over
    });
    const manifest = (entries) => ({ schema_id: TREE_MANIFEST_SCHEMA, entries, refusals: [], totals: { entries: entries.length, bytes: 0 } });

    // A row is its fields joined by a tab, and the walk's own fields come from alphabets that
    // cannot hold one. `canonicalTreeDigest` is exported, though, and took any object: a `type` of
    // `dir\t0755\t-\t-\t-\t61\nfile` joined into exactly the two rows of a different tree and
    // the two digested the same. The alphabet is checked where the boundary is.
    for (const forged of [
      { type: "dir\t0755\t-\t-\t-\t61\nfile" },
      { mode: "0755\t-\t-\t-\t61\nfile\t0644" },
      { refused: "escapes\t-\t61\nfile" },
      { path_bytes: "6\t2" },
      { byte_digest: `83d544cc${"0".repeat(56)}` },
      { size_bytes: "1\t-" },
      { schema_id: "aos-file-evidence.v1" }
    ]) {
      assert.throws(() => canonicalTreeDigest(manifest([entry(forged)])), /AOS_TREE_MANIFEST_ENTRY/, JSON.stringify(forged));
    }

    // A manifest the walk produced still hashes, so this is a check and not a refusal of everything.
    writeFileSync(join(root, "a"), Buffer.from("x", "utf8"));
    assert.match(treeOf(root), /^sha256:[0-9a-f]{64}$/);
  });
});

test("a workspace snapshot records a directory, so an added empty one is a change", () => {
  withScratch((root) => {
    writeFileSync(join(root, "f"), Buffer.from("x", "utf8"));
    const before = safeWalk(root).files;
    mkdirSync(join(root, "made"));
    const after = safeWalk(root).files;
    // An absent directory and an empty one produced identical snapshots, so `mkdir` outside the
    // allowed set was the one change to a workspace a scope check could not see.
    assert.equal(Object.hasOwn(before, "made"), false);
    assert.equal(after.made, DIRECTORY);
    assert.notDeepEqual(before, after, "an added empty directory read as an untouched workspace");
  });
});

test("a recorded session's ledger identity is its bytes", () => {
  const cwd = scratch();
  try {
    run(cwd, ["init"]);
    // Two sessions differing by one undecodable byte inside a string. Read as UTF-8 both became
    // U+FFFD, so both were recorded under one ledger identity and a verdict about one was
    // recorded as a verdict about the other.
    const rows = [
      { type: "user", timestamp: "2026-08-20T10:00:00Z", cwd: "/repo", message: { content: [{ type: "text", text: "Zfix the parser" }] } },
      { type: "assistant", timestamp: "2026-08-20T10:00:10Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
      { type: "user", timestamp: "2026-08-20T10:00:20Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "ok" }] } },
      { type: "assistant", timestamp: "2026-08-20T10:00:30Z", message: { content: [{ type: "text", text: "All tests pass, ready to merge." }] } }
    ];
    const written = (name, byte) => {
      const file = join(cwd, name);
      const bytes = Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
      bytes[bytes.indexOf(0x5a)] = byte;
      writeFileSync(file, bytes);
      return file;
    };
    run(cwd, ["holdout", "--session", written("one.jsonl", 0xff), "--use", "holdout"]);
    run(cwd, ["holdout", "--session", written("two.jsonl", 0xfe), "--use", "holdout"]);

    const ledger = loadLedger(join(cwd, ".aos"));
    assert.equal(ledger.sessions.length, 2, "two different sessions were recorded under one identity");
    assert.equal(ledger.sessions.every((entry) => isByteDigest(entry.digest)), true, "the ledger still holds a legacy bare-hex identity");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// --- what a digest must refuse to answer ---------------------------------------------------------
//
// The round above was about two different things sharing one identity. These are the other shape of
// the same mistake: a value handed back as exact identity when the thing it identifies was never
// fully seen, and a manifest accepted as canonical when no walk would have produced it.

test("an artifact whose tree carries a refusal is refused rather than identified", () => {
  withScratch((root) => {
    const bundle = join(root, "bundle");
    mkdirSync(bundle);
    writeFileSync(join(bundle, "a"), Buffer.from("x", "utf8"));
    const whole = artifactByteDigest(bundle, "bundle");

    // A refused entry keeps its path, type, mode, size and reason, and by construction not its
    // bytes -- so two artifacts differing only inside a refused entry are one digest. That is a
    // tolerable evidence manifest and an intolerable artifact identity, and the two were the same
    // value.
    mkdirSync(join(bundle, ".git"));
    writeFileSync(join(bundle, ".git", "loose"), Buffer.from("bookkeeping", "utf8"));
    assert.throws(() => artifactByteDigest(bundle, "bundle"), /AOS_ARTIFACT_INCOMPLETE .*skipped-directory/);
    // The reason travels with the refusal rather than being reduced to "no".
    rmSync(join(bundle, ".git"), { recursive: true, force: true });
    symlinkSync("../../outside", join(bundle, "escape"));
    assert.throws(() => artifactByteDigest(bundle, "bundle"), /AOS_ARTIFACT_INCOMPLETE .*symlink-escapes-tree/);

    // And the separation this rests on: the tree digest is still available for the caller that
    // wants an evidence manifest, and it is not the same question.
    assert.match(treeByteDigest(bundle), /^sha256:[0-9a-f]{64}$/);
    rmSync(join(bundle, "escape"));
    assert.equal(artifactByteDigest(bundle, "bundle"), whole);
  });
});

test("an artifact name's raw bytes are its identity", () => {
  withScratch((root) => {
    const file = join(root, "artifact");
    writeFileSync(file, Buffer.from("the same contents", "utf8"));
    // The name is the only thing separating two artifacts of identical content, and a caller that
    // enumerated its outputs with a plain `readdirSync` hands over a decoded one: the raw bytes FF
    // and FE both arrive as U+FFFD and two different artifacts are handed on under one digest.
    assert.notEqual(
      artifactByteDigest(file, Buffer.from([0xff])),
      artifactByteDigest(file, Buffer.from([0xfe])),
      "two artifact names differing by one byte produced one artifact digest"
    );
    // A string name and the same bytes are the same artifact, so this is a widening and not a
    // second encoding.
    assert.equal(artifactByteDigest(file, "report.md"), artifactByteDigest(file, Buffer.from("report.md", "utf8")));
  });
});

test("a link through a symlinked directory out of the tree is refused", () => {
  const outside = scratch();
  withScratch((root) => {
    try {
      // Every component, not only the last one. `outer` names `linkdir/missing`, which reads as
      // inside the tree as a string; `linkdir` is a link out of it, so following `outer` leaves the
      // tree. Resolving the target as one lexical path accepted this.
      symlinkSync(outside, join(root, "linkdir"));
      symlinkSync("linkdir/missing", join(root, "outer"));
      const byPath = Object.fromEntries(canonicalTreeManifest(root).entries.map((entry) => [entry.path, entry]));
      assert.equal(byPath.linkdir.refused, "symlink-escapes-tree");
      assert.equal(byPath.outer.refused, "symlink-escapes-tree", "a link through a symlinked ancestor was accepted");

      // A link through an in-tree directory is still a link, so this is not a refusal of everything
      // with more than one component in its target.
      mkdirSync(join(root, "real"));
      writeFileSync(join(root, "real", "file"), Buffer.from("x", "utf8"));
      symlinkSync("real/file", join(root, "near"));
      assert.equal(canonicalTreeManifest(root).entries.find((entry) => entry.path === "near").refused, null);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("an entry that claims to be a file must carry the digest that identifies it", () => {
  const entry = (over) => ({
    schema_id: FILE_EVIDENCE_SCHEMA,
    path: "a",
    path_bytes: "61",
    type: "file",
    mode: "0644",
    size_bytes: 1,
    byte_digest: sha256Bytes(Buffer.from("A", "utf8")),
    text_digest: null,
    media: "text",
    refused: null,
    ...over
  });
  const manifest = (entries) => ({ schema_id: TREE_MANIFEST_SCHEMA, entries, refusals: [], totals: { entries: entries.length, bytes: 0 } });

  // Every field was drawn from its own alphabet and the combination was one no walk produces: an
  // unrefused regular file with no byte digest. Two of those, differing only in the text projection
  // the row deliberately ignores, digested the same -- a row that claims to identify a file and
  // carries nothing that does.
  const noIdentity = (text) => entry({ byte_digest: null, text_digest: text });
  assert.throws(
    () => canonicalTreeDigest(manifest([noIdentity(sha256Bytes(Buffer.from("A", "utf8")))])),
    /AOS_TREE_MANIFEST_ENTRY/
  );
  assert.throws(
    () => canonicalTreeDigest(manifest([noIdentity(sha256Bytes(Buffer.from("B", "utf8")))])),
    /AOS_TREE_MANIFEST_ENTRY/
  );

  for (const incoherent of [
    { type: "file", refused: "file-too-large" },
    { type: "file", size_bytes: null },
    { type: "file", mode: null },
    { type: "dir", byte_digest: sha256Bytes(Buffer.alloc(0)) },
    { type: "dir", size_bytes: 0, byte_digest: null, mode: "0755" },
    { type: "symlink", mode: "0777", byte_digest: sha256Bytes(Buffer.from("t", "utf8")) },
    { type: "refused", refused: null, byte_digest: null },
    { type: "refused", refused: "file-too-large", byte_digest: sha256Bytes(Buffer.alloc(0)) }
  ]) {
    assert.throws(() => canonicalTreeDigest(manifest([entry(incoherent)])), /AOS_TREE_MANIFEST_ENTRY/, JSON.stringify(incoherent));
  }

  // The combinations the walk does produce still hash.
  assert.match(canonicalTreeDigest(manifest([entry({})])), /^sha256:[0-9a-f]{64}$/);
  assert.match(
    canonicalTreeDigest(manifest([entry({ type: "symlink", mode: null, byte_digest: sha256Bytes(Buffer.from("t", "utf8")), refused: "symlink-escapes-tree" })])),
    /^sha256:[0-9a-f]{64}$/
  );
});

test("a manifest that lists a path twice, or out of canonical order, is refused", () => {
  const at = (name) => ({
    schema_id: FILE_EVIDENCE_SCHEMA,
    path: name,
    path_bytes: Buffer.from(name, "utf8").toString("hex"),
    type: "file",
    mode: "0644",
    size_bytes: 1,
    byte_digest: sha256Bytes(Buffer.from("x", "utf8")),
    text_digest: null,
    media: "text",
    refused: null
  });
  const manifest = (names) => ({
    schema_id: TREE_MANIFEST_SCHEMA,
    entries: names.map(at),
    refusals: [],
    totals: { entries: names.length, bytes: 0 }
  });

  // One path listed twice is two rows for one entry, and a reader keyed by path sees whichever came
  // last while the digest carries both.
  assert.throws(() => canonicalTreeDigest(manifest(["a", "a"])), /AOS_TREE_MANIFEST_ORDER/);
  // And the order is part of the encoding, not an accident of who built the list: the same entries
  // in another order are a different digest, so a manifest in an order no walk emits is refused
  // rather than given a value nothing can reproduce.
  assert.throws(() => canonicalTreeDigest(manifest(["b", "a"])), /AOS_TREE_MANIFEST_ORDER/);
  assert.match(canonicalTreeDigest(manifest(["a", "b"])), /^sha256:[0-9a-f]{64}$/);
  // Segment by segment, a parent before its children: `a-b` sorts before `a/b` byte-wise, and the
  // walk emits `a`, `a/b`, `a-b`.
  assert.match(canonicalTreeDigest(manifest(["a", "a/b", "a-b"])), /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => canonicalTreeDigest(manifest(["a", "a-b", "a/b"])), /AOS_TREE_MANIFEST_ORDER/);
});

test("a session recorded under the legacy identity is not counted, and not hidden either", () => {
  const legacy = { digest: "a".repeat(64), use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE" };
  // `recordSession` refuses this shape now, so a legacy row can only arrive from a ledger written
  // before the migration. That is the case: the migration was enforced going forward and ignored
  // going backward, and one legacy holdout session with one true-positive judgement was accepted.
  const withLegacy = { ...emptyLedger(), sessions: [legacy] };
  const judged = judge(withLegacy, {
    session_digest: legacy.digest, finding_id: "f1", rule: "completion-claimed-without-verification",
    severity: "high", judgement: "true-positive"
  });
  const acceptance = acceptanceOf(judged);
  assert.equal(acceptance.accepted, false, "a legacy row carried a product acceptance decision");
  assert.equal(acceptance.precision.precision, null, "a legacy row was counted in the precision denominator");
  assert.equal(acceptance.holdout_sessions, 0);
  // Not silently dropped either: it is neither holdout nor tuning, and it is counted where an owner
  // can see that their holdout is smaller than the file suggests.
  assert.equal(acceptance.tuning_sessions, 0);
  assert.equal(acceptance.legacy_sessions, 1);

  // A row recorded under the byte identity still counts, so this is a check on the identity and not
  // a refusal of the ledger.
  const current = recordSession(emptyLedger(), {
    digest: sha256Bytes(Buffer.from("a session", "utf8")), use: "holdout",
    reported_status: "COMPLETE", actual_evidence: "COMPLETE"
  });
  assert.equal(acceptanceOf(current).holdout_sessions, 1);
  assert.equal(acceptanceOf(current).legacy_sessions, 0);
});

test("the reordering diagnostic is not a second way to compare digests", () => {
  const a = `sha256:${"1".repeat(64)}`;
  const b = `sha256:${"2".repeat(64)}`;
  assert.equal(handoffDigestsSameMultiset([a, b], [b, a]), true);
  assert.equal(handoffDigestsSameMultiset([a, a], [a, b]), false, "duplicate counts have to survive");
  // It says which of two mistakes was made and never accepts anything, so it has to refuse the
  // values the exact comparison refuses. Without the digest check `[undefined]` and `[null]` are
  // the same multiset, and "you had the right artifacts" about two lists holding no artifact at all
  // is worse than no diagnosis.
  assert.equal(handoffDigestsSameMultiset([undefined], [null]), false);
  assert.equal(handoffDigestsSameMultiset(["a".repeat(64)], ["a".repeat(64)]), false, "a legacy bare-hex digest is not a digest here");
});

// --- a workspace path is attacker-chosen, so the map that holds it must not be ----------------

test("a file or directory named __proto__ is a change like any other", () => {
  // A plain object inherits the `__proto__` setter. Assigning to it writes through to
  // Object.prototype instead of adding an own property, so `Object.keys` omitted the path, the
  // snapshot diff computed no change, and the scope gate stayed green over a workspace the agent
  // had modified. That is exactly the case a scope check exists to catch.
  for (const kind of ["file", "directory"]) {
    const root = mkdtempSync(join(tmpdir(), "aos-proto-"));
    try {
      const before = safeWalk(root);
      assert.deepEqual(Object.keys(before.files), []);

      if (kind === "file") writeFileSync(join(root, "__proto__"), "payload");
      else mkdirSync(join(root, "__proto__"));

      const after = safeWalk(root);
      assert.deepEqual(Object.keys(after.files), ["__proto__"], `an added ${kind} was invisible`);

      // The diff the scope gate actually computes.
      const changed = new Set(
        [...Object.keys(before.files), ...Object.keys(after.files)].filter((key) => before.files[key] !== after.files[key])
      );
      assert.deepEqual([...changed], ["__proto__"], `an added ${kind} produced no change`);

      // And nothing leaked onto the prototype.
      assert.equal({}.__proto__, Object.prototype);
      assert.equal(Object.getPrototypeOf(after.files), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
