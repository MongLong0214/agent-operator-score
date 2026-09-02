import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  artifactByteDigest,
  canonicalTreeDigest,
  canonicalTreeManifest,
  fileByteDigest,
  optionalFileTextDigest,
  sha256Bytes
} from "../../lib/digest.mjs";
import { runProcess } from "../../lib/core.mjs";
import { safeWalk } from "../../lib/safe-fs.mjs";

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

    assert.equal(byPath["a.txt"].schema_id, "aos-file-evidence.v2");
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
        assert.equal(byPath[name].type, "refused", `${name} was not refused`);
        assert.equal(byPath[name].refused, "symlink-escapes-tree");
        assert.equal(byPath[name].byte_digest, null, `${name} was digested`);
        assert.equal(
          manifest.refusals.some((entry) => entry.path === name && entry.reason === "symlink-escapes-tree"),
          true,
          `${name} was not reported as a refusal`
        );
      }
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

test("a directory that resolves outside the tree is refused without being walked", () => {
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

test("an artifact digest moves with the bytes, the name and the mode", () => {
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
    writeFileSync(join(bundle, "data"), Buffer.from("payload", "utf8"));
    const base = artifactByteDigest(bundle, "bundle");

    chmodSync(join(bundle, "run.sh"), 0o755);
    assert.notEqual(artifactByteDigest(bundle, "bundle"), base, "an artifact made executable handed on unchanged");
    chmodSync(join(bundle, "run.sh"), 0o644);
    assert.equal(artifactByteDigest(bundle, "bundle"), base);

    // Same content reachable at the same path, through a link rather than as a file.
    rmSync(join(bundle, "data"));
    writeFileSync(join(bundle, "payload.txt"), Buffer.from("payload", "utf8"));
    symlinkSync("payload.txt", join(bundle, "data"));
    assert.notEqual(artifactByteDigest(bundle, "bundle"), base);
  });
});

test("a symlink handed as an artifact is refused, and so is a special file", () => {
  withScratch((root) => {
    writeFileSync(join(root, "real"), Buffer.from("x", "utf8"));
    symlinkSync("real", join(root, "link"));
    assert.throws(() => artifactByteDigest(join(root, "link"), "link"), /AOS_SYMLINK_ARTIFACT/);
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
        { command: process.execPath, args: ["-e", `process.stdout.write(Buffer.from([${byte}]))`] },
        { prompt: "", workspace, session: "s", family: "FAM-1", timeoutMs: 30000, isolation: "BEST_EFFORT_CLI" }
      );
      return result.stdout_digest;
    };
    const first = await digestOf(0xff);
    const second = await digestOf(0xfe);
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(first, second, "two different agent outputs carried the same evidence digest");
    assert.equal(first, sha256Bytes(Buffer.from([0xff])));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unreadable directory or file is a refusal, not the end of the walk", () => {
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
