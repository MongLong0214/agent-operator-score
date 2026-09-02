- `outside/missing` absent

`realpath(root/outer)` fails because the final target is missing. The fallback sees lexical `root/linkdir/missing` inside `root`; `readlinkSync` follows `linkdir`, gets `ENOENT` on the final component, and [returns true](/private/tmp/rv-597b/lib/digest.mjs:237). Thus `linkdir` is refused but `outer.refused === null`, even though following `outer` leaves the tree.

The named test at [byte-digest.test.mjs:796](/private/tmp/rv-597b/tests/product/byte-digest.test.mjs:796) covers only a chain where every symlink is itself the final component. It misses symlinked ancestors.

4. The exported manifest validator prevents delimiter forgery but still accepts a file with no byte identity.

[wellFormedEntry](/private/tmp/rv-597b/lib/digest.mjs:474) validates each field independently. It accepts `type: "file"`, `refused: null`, and `byte_digest: null`.

Two accepted manifests with path `a`, mode `0644`, size `1`, and no byte digest—one carrying text digest of byte `A`, the other the text digest of byte `B`—both produce:

`sha256:b28f8c62d03042e037203960aad98d40c8fa6dbca7e414cc154eb0e03550edc5`

The respective text projections are `sha256:559aea…ffdffd` and `sha256:df7e70…20a5c`. Ignoring text projections is correct; accepting an unrefused regular file without its authoritative byte digest is not. The validator needs type/state coherence, uniqueness, and canonical ordering checks, not only field alphabets.

5. `O_NOFOLLOW` does not cover top-level artifacts.

Tree-entry reads use it at [digest.mjs:260](/private/tmp/rv-597b/lib/digest.mjs:260), closing the specific inner-file swap. But [artifactByteDigest](/private/tmp/rv-597b/lib/digest.mjs:542) performs `lstatSync`, then calls plain `fileByteDigest`, whose [readFileSync](/private/tmp/rv-597b/lib/digest.mjs:64) follows symlinks.

Concrete race: while `artifactByteDigest("bundle", "bundle")` is between lines 543 and 545, replace the checked regular file with a symlink to an outside file. The outside bytes are digested. Swapping a checked directory artifact for a symlink likewise gets followed when `canonicalTreeManifest` resolves its root. The documentation’s unqualified “A file is read with `O_NOFOLLOW`” at [BYTE_DIGEST.md:173](/private/tmp/rv-597b/docs/BYTE_DIGEST.md:173) overstates the implementation.

## Pushback judgments

Ordered handoff comparison is sound if the order recorded by `handoff.created` is declared normative. The diagnostic multiset comparison preserves duplicate counts and is not used to accept. However, the stated rationale is inaccurate: the public `handoff create` path accepts option order directly at [cli.mjs:1584](/private/tmp/rv-597b/lib/cli.mjs:1584); `outputArtifactDigests` is not the only producer. The defensible rule is “the created event’s list order is authoritative,” not “the producer always sorts by artifact name.” The exported `handoffDigestsSameMultiset` should also validate byte digests; as written, `[undefined]` and `[null]` compare equal, although validated CLI use is safe.

For equal-sized refusals, I agree with the narrow information-theoretic statement but not with treating it as a closed defect. A refusal can be an incomplete evidence-manifest digest; it cannot simultaneously be accepted as exact artifact identity. `artifactByteDigest` should throw or return a typed refusal when any descendant was not identified.

For case-insensitive filesystems, I agree. Refusing a case-mismatched dangling target is fail-closed, while globally folding case would falsely accept on case-sensitive filesystems.

The APFS/Linux split is acceptable. The raw-name state cannot be constructed on APFS, and both the ordinary Linux lanes and mutation job run on Ubuntu at [.github/workflows/ci.yml:75](/private/tmp/rv-597b/.github/workflows/ci.yml:75). The test should ideally skip only on `EILSEQ`, rather than catching every error at [byte-digest.test.mjs:772](/private/tmp/rv-597b/tests/product/byte-digest.test.mjs:772), but Linux CI is the correct authority for that state.

## Migration and tests

The documentation accurately states the `sessionDigestOf` byte contract, v3 artifact envelope, `path_bytes`, and the new `canonicalTreeDigest` exceptions. It is not a complete migration contract for the blocked consumers in [#553](https://github.com/MongLong0214/agent-operator-score/issues/553), [#562](https://github.com/MongLong0214/agent-operator-score/issues/562), [#564](https://github.com/MongLong0214/agent-operator-score/issues/564), and [#578](https://github.com/MongLong0214/agent-operator-score/issues/578):

- Existing `aos-event.v1` records retain the same schema at [store.mjs:253](/private/tmp/rv-597b/lib/store.mjs:253) while handoff and stdout/stderr digest semantics change.
- An old bare-digest holdout row is not merely historical: `acceptanceOf` still counts it. A ledger containing one legacy holdout session and one true-positive judgement returns `accepted: true`.
- The issue’s `aos-file-evidence.v2` example uses `mode: "100644"` and has no `path_bytes`; the implementation keeps the same v2 identifier but requires four-digit `0644` plus `path_bytes`, otherwise `canonicalTreeDigest` throws.
- There is no explicit downstream migration table covering artifact value changes, manifest construction requirements, legacy event handling, or the new throw conditions.

The individual round-one fixes for v3 type/mode, escaping-link target bytes, nested raw path bytes, `.git`, empty workspace directories, row-boundary alphabets, the direct dangling chain, the inner-file symlink swap, and session bytes are real. The failures above are the new or uncovered edges.

I found no current mutation `to` substitution that obviously survives its named assertion. Syntax checks, `git diff --check`, and the four static mutation-manifest tests pass. However, [REQUIRED_GUARDS](/private/tmp/rv-597b/tests/mutation/manifest.mjs:402) still lists only the older eleven guards, so all #567 guards could be deleted from `GUARDS` without the ordinary suite noticing. Missing guards include refused-tree rejection at the artifact boundary, top-level raw artifact names, intermediate-component link escape, top-level `O_NOFOLLOW`, and entry-state coherence.

Several names remain stronger than their assertions: the “directory resolves outside” test constructs a symlink; the unreadable-file half is conditional; “refused entry … and max-depth” contains no max-depth assertion; “captured stream” checks only stdout; and “artifact … bytes, name and mode” does not change mode in that test.

The full write-dependent product and mutation runs could not execute in this read-only sandbox because temporary-directory creation returned `EPERM`; that is an environment limitation, not a test failure.

**Not ready to merge.**

[exited with code 0]
