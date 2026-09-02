# Byte digests and tree identity

Exact evidence identity in AOS is the SHA-256 of the raw bytes. Nothing is decoded, normalised or
re-serialised before it is hashed.

## Why

Every exact-identity digest used to be taken after the bytes had been read as UTF-8 and had their
CRLF pairs folded to LF. Both steps lose information, and every loss is a way for an agent to change
a file and have the evidence say it did not. Measured on this repository before the change, the old
`fileDigest` returned:

| bytes on disk | old digest |
| --- | --- |
| `a\nb` | `7e18f737311b2dc3…` |
| `a\r\nb` | `7e18f737311b2dc3…` |
| `EF BB BF` + `hi` | different from `hi`, but only because the mark survives decoding |
| U+FFFD, written honestly | `83d544ccc223c057…` |
| the single byte `FF` | `83d544ccc223c057…` |
| the single byte `FE` | `83d544ccc223c057…` |

The last three are the serious one: `readFileSync(file, "utf8")` replaces every byte sequence that is
not valid UTF-8 with U+FFFD, so every binary file that differs only in undecodable bytes carried the
same digest. The same decode called a UTF-16 encoding of a document a different file from its UTF-8
encoding, which is the wrong answer in the other direction.

## The API

`lib/digest.mjs`. All digests are returned as `sha256:<64 lowercase hex>`; the prefix is what keeps a
legacy bare-hex normalised digest from being read as a byte digest.

```
sha256Bytes(bytes)                    -> "sha256:<hex>"     throws AOS_DIGEST_NOT_BYTES on a string
fileByteDigest(path)                  -> "sha256:<hex>"     throws AOS_DIGEST_UNREADABLE if absent
optionalFileTextDigest(path)          -> "sha256:<hex>" | null
canonicalTreeManifest(root, policy)   -> { schema_id, entries, refusals, totals }
canonicalTreeDigest(manifest)         -> "sha256:<hex>"     throws AOS_TREE_MANIFEST_SCHEMA
treeByteDigest(root, policy)          -> "sha256:<hex>"     the two above in one call
artifactByteDigest(path, relative)    -> "sha256:<hex>"     a file or a directory, under a name
isByteDigest(value)                   -> boolean
handoffDigestsMatch(produced, received) -> boolean          exact, ordered, byte digests only
contains(base, target)                -> boolean
```

Constants: `DIGEST_ALGORITHM`, `FILE_EVIDENCE_SCHEMA` (`aos-file-evidence.v2`),
`TREE_MANIFEST_SCHEMA` (`aos-tree-manifest.v1`), `TREE_LIMITS`, `TREE_SKIP_DIRECTORIES`.

`policy` accepts `maxFileBytes`, `maxTotalBytes`, `maxEntries`, `maxDepth` and `skipDirectories`, and
defaults to `TREE_LIMITS` with `.git` skipped.

### File evidence

Each entry of a manifest is one `aos-file-evidence.v2` record:

```json
{
  "schema_id": "aos-file-evidence.v2",
  "path": "relative/path",
  "type": "file | dir | symlink | refused",
  "mode": "0644",
  "size_bytes": 123,
  "byte_digest": "sha256:…",
  "text_digest": "sha256:… or null",
  "media": "text | binary | unknown",
  "refused": null
}
```

`mode` is the permission bits only. mtime is not evidence about content: a digest that moved with it
would report every `touch` as a change and bury a real one among them. A symlink carries `mode: null`
because its permission bits differ between macOS and Linux and neither enforces them.

### The text digest is a projection, never identity

`optionalFileTextDigest` decodes strictly (`fatal: true`, `ignoreBOM: true`) and folds CRLF to LF. It
is `null` for anything that is not valid UTF-8. Two files sharing it are the same *document*, which
is a weaker claim than being the same file. It must never be compared against, or substituted for, a
byte digest.

## Tree canonicalization

A tree digest is the digest of one row per entry, in ascending order of the UTF-8 bytes of the
relative path — not `localeCompare`, which would make the digest a property of the machine's locale.

```
row = type \t mode \t size \t byte_digest \t refusal \t hex(relative path bytes)
digest = sha256("aos-tree-manifest.v1\n" + rows.join("\n") + "\n")
```

The path is hex-encoded because a newline and a tab are both legal in a filename on macOS and Linux,
so a literal path could split one row into two. The schema line is domain separation: a tree digest
can never equal a file digest by accident, and a future encoding is a different digest rather than a
silently compatible one.

Consequences, each covered by a named test in `tests/product/byte-digest.test.mjs`:

- the same relative tree at two different absolute roots digests the same
- the same bytes at a different relative path digests differently
- adding, removing, renaming or editing a file changes it; an empty directory counts as an entry
- a mode change changes it and an mtime change does not
- an empty file and an absent file are different, in a file and in a tree

## Symlinks

**Recorded as links, never followed.** A link's entry has `type: "symlink"` and a digest over its own
bytes, which are the target name. Following it would make the tree digest a statement about files the
tree does not contain, and a link to `~/.ssh/id_ed25519` would put a private key into a digest and,
through a diff, into a report.

**A link whose target resolves outside the tree is refused**, with `refused: "symlink-escapes-tree"`,
and so is a directory reached through a path that resolves outside the root — a bind mount gets to
the same place without a symlink anywhere in the path.

A refused entry is still an entry, and its reason is part of the digest. Dropping it would let an
agent hide a change by making a file unreadable: the tree would digest as though the entry had never
existed and a scope check would report a clean workspace.

`artifactByteDigest` is stricter at its top level: a symlink handed on as an artifact is
`AOS_SYMLINK_ARTIFACT` and a special file is `AOS_UNSUPPORTED_ARTIFACT`. A handoff names something the
receiver is expected to read, and a link is not that.

## Limits

`file-too-large`, `tree-too-large`, `max-entries`, `max-depth`, `not-a-regular-file` and
`symlink-escapes-tree` are all named refusals recorded as entries. Nothing is ever silently dropped,
and a refused file keeps its size, so two different oversized files are still two different trees.

## Compatibility

`sha256Text`, `sha256Value` and `fileDigest` in `lib/core.mjs` are unchanged and remain what they
were. `fileDigest` is deprecated: a value it produced is a historical, normalised **text** digest and
must never be compared against or migrated into a `sha256:` byte digest. The two answer different
questions and the old one cannot be recomputed from the new.

`aos handoff create` and `aos handoff consume` accept `sha256:`-prefixed digests only. A bare 64-hex
digest is refused with `AOS_INVALID_ARTIFACT_DIGEST`, and a consume whose digests are not exactly and
in order what the matching create recorded is refused with `AOS_HANDOFF_DIGEST_MISMATCH`.

Git head and tree provenance and the AOS byte tree digest are separate facts. Neither substitutes for
the other.
