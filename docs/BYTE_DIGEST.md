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
                                                            throws AOS_TREE_MANIFEST_ENTRY
treeByteDigest(root, policy)          -> "sha256:<hex>"     the two above in one call
artifactByteDigest(path, relative)    -> "sha256:<hex>"     a file or a directory, under a name
isByteDigest(value)                   -> boolean
handoffDigestsMatch(produced, received) -> boolean          exact, ordered, byte digests only
handoffDigestsSameMultiset(a, b)      -> boolean            for naming the refusal, never for accepting
contains(base, target)                -> boolean
```

Constants: `DIGEST_ALGORITHM`, `FILE_EVIDENCE_SCHEMA` (`aos-file-evidence.v2`),
`TREE_MANIFEST_SCHEMA` (`aos-tree-manifest.v1`), `ARTIFACT_SCHEMA` (`aos-artifact.v3`),
`TREE_LIMITS`, `TREE_SKIP_DIRECTORIES`.

`policy` accepts `maxFileBytes`, `maxTotalBytes`, `maxEntries`, `maxDepth` and `skipDirectories`, and
defaults to `TREE_LIMITS` with `.git` skipped.

### File evidence

Each entry of a manifest is one `aos-file-evidence.v2` record:

```json
{
  "schema_id": "aos-file-evidence.v2",
  "path": "relative/path",
  "path_bytes": "72656c61746976652f70617468",
  "type": "file | dir | symlink | refused",
  "mode": "0644",
  "size_bytes": 123,
  "byte_digest": "sha256:…",
  "text_digest": "sha256:… or null",
  "media": "text | binary | unknown",
  "refused": null
}
```

`path_bytes` is the identity and `path` is for a reader. A filename is not text — on Linux every
byte but `/` and NUL is legal in one — so `readdirSync` is read with `encoding: "buffer"` and the
name never passes through a decode. Two files named after the raw bytes `FF` and `FE` used to decode
to the same U+FFFD, the walk then failed to find either under the re-encoded name, and both trees
recorded one identical `unreadable-entry` row. `path` still holds the decoded name, U+FFFD and all,
which is why it is not what the digest is taken over: two entries can share it.

`mode` is the permission bits only. mtime is not evidence about content: a digest that moved with it
would report every `touch` as a change and bury a real one among them. A symlink carries `mode: null`
because its permission bits differ between macOS and Linux and neither enforces them.

### The text digest is a projection, never identity

`optionalFileTextDigest` decodes strictly (`fatal: true`, `ignoreBOM: true`) and folds CRLF to LF. It
is `null` for anything that is not valid UTF-8. Two files sharing it are the same *document*, which
is a weaker claim than being the same file. It must never be compared against, or substituted for, a
byte digest.

## Tree canonicalization

A tree digest is the digest of one row per entry. Siblings are ordered over the raw bytes of their
names — not `localeCompare`, which would make the digest a property of the machine's locale — and a
directory is recorded before the entries under it, so the order is a depth-first walk with
byte-sorted siblings rather than a global sort of the relative paths.

```
row = type \t mode \t size \t byte_digest \t refusal \t hex(relative path bytes)
digest = sha256("aos-tree-manifest.v1\n" + rows.join("\n") + "\n")
```

The path is hex-encoded because a newline and a tab are both legal in a filename on macOS and Linux,
so a literal path could split one row into two. The schema line is domain separation: a tree digest
can never equal a file digest by accident, and a future encoding is a different digest rather than a
silently compatible one.

Every other field comes from a fixed alphabet — and `canonicalTreeDigest` checks that rather than
assuming it, because the function is exported and will be handed manifests the walk did not build.
Given an entry whose `type` was `dir\t0755\t-\t-\t-\t61\nfile`, the join produced exactly the
two rows of a different tree and the two digested the same. A manifest whose `type`, `mode`,
`size_bytes`, `byte_digest`, `refused`, `path_bytes` or `schema_id` is outside its alphabet is
refused with `AOS_TREE_MANIFEST_ENTRY` rather than hashed.

## Artifact identity

```
digest = sha256("aos-artifact.v3\n" + type + "\n" + mode + "\n" + hex(name) + "\n" + inner + "\n")
```

where `inner` is the file's byte digest or the directory's canonical tree digest.

The type is in the envelope because without it a regular file and a directory could be handed on
under one identity: a file whose contents are exactly `aos-tree-manifest.v1\n\n` has the byte
digest of the empty tree, so that file named `bundle` and an empty directory named `bundle`
produced the same artifact digest. The mode is in the envelope because a `run.sh` handed on
identically at 0644 and 0755, and a root directory identically at 0755 and 0700 — an artifact digest
that cannot see the executable bit cannot see the difference between an artifact the receiver can
run and one it cannot. The name is hex for the same reason a row's path is: it is the one field an
agent chooses.

The envelope is `v3` rather than `v2` because it is a different encoding, and this module's rule is
that a later encoding is a different digest rather than a silently compatible one. Nothing has
shipped under `v2`; artifact digests recorded on this branch before the change do not carry over.

Consequences, each covered by a named test in `tests/product/byte-digest.test.mjs`:

- the same relative tree at two different absolute roots digests the same
- the same bytes at a different relative path digests differently
- adding, removing, renaming or editing a file changes it; an empty directory counts as an entry
- a mode change changes it and an mtime change does not
- an empty file and an absent file are different, in a file and in a tree
- two filenames differing only in an undecodable byte are two trees (Linux; APFS refuses such a name)
- a skipped directory such as `.git` is still an entry, so an empty tree and one holding an empty
  `.git/` are different — the skip is about bookkeeping *contents*, never about whether the
  directory is there

## Symlinks

**Recorded as links, never followed.** A link's entry has `type: "symlink"` and a digest over its own
bytes, which are the target name. Following it would make the tree digest a statement about files the
tree does not contain, and a link to `~/.ssh/id_ed25519` would put a private key into a digest and,
through a diff, into a report.

**A link whose target resolves outside the tree is marked `refused: "symlink-escapes-tree"`** and
keeps its own bytes. Discarding them made `link -> ../outside-a` and `link -> ../outside-b` the
identical row, which is a collision inside the refusal rather than a protection against one. Nothing
outside the tree is read either way: the name a link carries is not what it points at, and a digest
of that name discloses neither.

`realpathSync` answers the containment question for a resolvable chain. A **dangling** link has no
real path, and the lexical fallback follows the chain by hand rather than checking one hop: with
`inner -> ../outside/missing` and `outer -> inner`, checking one hop said `outer` points at
`root/inner`, which is inside, and let it through although following it leaves the tree. A chain
longer than 40 hops is a loop or an attempt to exhaust the walk and is refused.

A directory whose `realpath` lands outside the root is refused as `outside-tree`. That is defence in
depth against a path that stopped meaning what was checked — an ancestor replaced by a symlink
mid-walk, a filesystem that links directories. **It is not a bind-mount check**: `realpath` of a
bind mount returns the in-tree mountpoint, not the source it was mounted from, so a bind mount is
invisible to it. The claim that it caught one was wrong and is withdrawn.

A file is read with `O_NOFOLLOW`, so the entry cannot be swapped for a symlink between the `lstat`
that called it a regular file and the open that reads it; that race turns into `ELOOP` and therefore
into an `unreadable-entry` refusal.

A refused entry is still an entry, and its reason is part of the digest. Dropping it would let an
agent hide a change by making a file unreadable: the tree would digest as though the entry had never
existed and a scope check would report a clean workspace.

`artifactByteDigest` is stricter at its top level: a symlink handed on as an artifact is
`AOS_SYMLINK_ARTIFACT` and a special file is `AOS_UNSUPPORTED_ARTIFACT`. A handoff names something the
receiver is expected to read, and a link is not that.

## Limits

`file-too-large`, `tree-too-large`, `max-entries`, `max-depth`, `not-a-regular-file`,
`unreadable-entry`, `unreadable-directory`, `outside-tree`, `skipped-directory` and
`symlink-escapes-tree` are all named refusals recorded as entries. Nothing is ever silently dropped.

A refusal keeps the path, the type, the mode, the size and the reason — so a file that grew past the
limit, one whose mode changed, and one refused for a different reason are all still different trees.
**It cannot keep the contents.** Two files of the same size, refused for the same reason, are one
row: the bytes were not read, and reading a file the policy has just refused to read is the thing
the limit exists to prevent. An earlier version of this document claimed that two different
oversized files are still two different trees; that is true only of files of different sizes, and
the sentence is corrected here rather than left standing. A refusal identifies the entry it refused,
never its contents.

## Compatibility

`sha256Text`, `sha256Value` and `fileDigest` in `lib/core.mjs` are unchanged and remain what they
were. `fileDigest` is deprecated: a value it produced is a historical, normalised **text** digest and
must never be compared against or migrated into a `sha256:` byte digest. The two answer different
questions and the old one cannot be recomputed from the new.

`aos handoff create` and `aos handoff consume` accept `sha256:`-prefixed digests only. A bare 64-hex
digest is refused with `AOS_INVALID_ARTIFACT_DIGEST`, and a consume whose digests are not exactly and
in order what the matching create recorded is refused with `AOS_HANDOFF_DIGEST_MISMATCH`.

The comparison is ordered rather than a multiset, deliberately. The producer is
`outputArtifactDigests`, which emits in ascending order of the artifact name, so the order is
reproducible rather than incidental and a list in another order is not the list that was handed on.
Where only the order differs the refusal says so, because a refusal an operator cannot tell apart
from a wrong-artifact one gets worked around instead of corrected.

## The session ledger

`sessionDigestOf` takes the **bytes** of a session file, not its decoded text, and returns a
`sha256:`-prefixed byte digest. Read as UTF-8, two session files differing only by a byte `FF`
against a byte `FE` inside a string decoded to the same U+FFFD and received the same ledger identity,
so a verdict recorded about one was recorded about the other. `recordSession` requires a byte digest
and refuses the bare 64-character hex it used to require — which was the legacy normalised identity,
making the ledger the last place still enforcing the contract this replaced. Rows written before the
change stay readable and stay visibly legacy: a bare hex digest can never be produced again, so an
old row can never be silently matched by a new one.

## The workspace snapshot

`safeWalk` in `lib/safe-fs.mjs` is a different contract from the tree manifest: it walks a directory
an assessed agent can write to, and every entry that is not a plain file is refused outright. It now
records a directory as `dir:`. An absent directory and an empty one produced identical snapshots, so
`mkdir` outside the allowed set was the one change to a workspace a scope check could not see.
`.git` is still not recorded there, unlike in the tree manifest: a scenario asks the agent to commit
its work, and recording `.git` would turn `git init` into a scope violation.

## Known limitations

- A refusal cannot distinguish two refused entries that agree on path, type, mode, size and reason.
  Distinguishing them means reading bytes the policy refused to read.
- `O_NOFOLLOW` closes the race on the entry itself, not on an ancestor directory. Closing that needs
  `openat` walked component by component, which Node does not expose.
- The lexical fallback's containment check compares bytes, so on a case-insensitive filesystem an
  in-tree dangling target written in another case is refused rather than recorded. That is the
  fail-closed direction and the refusal is still an entry in the digest; making the comparison
  case-insensitive would instead falsely accept on a case-sensitive filesystem, where two
  directories differing only in case are two directories.
- `safeWalk` keys its snapshot by decoded path, so two undecodable names collide in that map. It
  fails closed for scope — such a name is never in an allowed set, so it registers as a change
  either way — but it does not enumerate them apart. Fixing it means changing the snapshot's shape,
  which the grading in `lib/suite.mjs` reads.
- A bind mount inside the tree is walked as though it were an ordinary directory.

Git head and tree provenance and the AOS byte tree digest are separate facts. Neither substitutes for
the other.
