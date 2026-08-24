# G4 publication gate verdict — E14-003

The G4 gate accepts a signed environment and toolchain manifest and output
digests from an independent run, compares those digests to the G0 pin for the
public schema, fixture, and scorer bytes, runs the live G0–G4 blockers, and
emits PASS or FAIL.

This document is the tree-resident record the live executable reads. The
`Live reproduction` block is the well-known independent-run slot. A CLI-path
JSON file is the same slot: both require `kind` to be
`independent-reproduction`. A file that parses but lacks that kind is not a
reproduction.

The `Trusted principals` block is the out-of-band allowlist of named hosts
that may attest. A principal is the pair `(id, public_key)`. Both must match
the signed `environment.id` and `public_key`. A public key that lives only
inside a signed body is not a principal. A matching key with a different
`environment.id` is `UNTRUSTED_PRINCIPAL`. Caller-supplied publication
arrays, G1–G3 maps, and G0 stubs cannot mint a pass.
MIT is the outbound copyright grant. It is not contributor terms, and it is not a publication clearance.
Contributor terms and formal publication review remain unresolved.
No public package has been approved.

The root package.json does not own a `verify:release` script. The executable
surface is:

```bash
node scripts/verify-release.mjs
node scripts/verify-release.mjs <reproduction-manifest.json>
node --test conformance/external/external-reproduction.test.ts
```

## How a verdict is derived

The live run fails closed when any of these is true: the tree-resident or
CLI-path reproduction is missing or not `kind: independent-reproduction`,
self-attested, unsigned, signed by a named host and key that are not together
in Trusted principals, recorded against a digest other than the G0 pin, or
recorded against a stale head; G0 fixture truth fails; G1 is not the E12
token `PASS_TO_CONTINUE` in `docs/decisions/FEASIBILITY-VERDICT.md`; G2 or G3
is still open (they are deferred calibration studies; the n=20 feasibility
record cannot close them, and this repository carries no such study); or any
requirement in the E14 ledger in `docs/decisions/PUBLICATION-CLEARANCE.md`
is not RESOLVED, a required floor id is missing from that ledger, or the
ledger's `Derived verdict` disagrees with the derivation from those rows
(`verdict`, `blocked_by`, and every `permits_*` flag). The six floor
ids cannot be deleted to open the gate. Disagreement fails closed: open
rows next to a derived pass would publish on a false document, and
all-RESOLVED rows next to a derived block would publish against the
document that governs them. A derived pass that withholds any `permits_*`
flag is still disagreement. Extra or duplicate digest paths fail. An
unreadable gated file is `UNREADABLE` or G0 `STALE_DIGEST`, not an
exception. The only passing
verdict token is `G4_PASS`. The live tree does not emit it. E12 is contracted
to emit exactly `PASS_TO_CONTINUE`, `INCONCLUSIVE`, or `PIVOT_REQUIRED`;
`INCONCLUSIVE`, `PIVOT_REQUIRED`, and the G4-local token `RESOLVED` do not
close G1. No E12 token closes G2 or G3. Because those studies are absent, G4
cannot pass.

`independent: true` means the named allowlisted principal signed a manifest
whose `environment.id` matches their allowlist id, whose recorded
`output_digests` equal the G0 pin, and whose `head_sha` is the current head.
The byte comparator is `claimed === pin`. It does not mean files were hashed
on another machine. An allowlisted principal can copy the pin out of
`scripts/verify-g0.mjs`, put those hex strings in the manifest, sign it, and
satisfy every reproduction flag. That is inherent to signature-based
attestation: the gate reduces to trusting the signer. This record does not
add a second-machine hash witness, and `independent: true` must not be read
as machine-checked reproduction.

## Live reproduction

```json
{
  "kind": "clean-checkout-reproduction",
  "recorded_at": "2026-08-24T00:00:00Z",
  "environment": {
    "id": "clean-checkout:Isaacui-Macmini.local",
    "note": "Same operator and machine as the tree. This record claims determinism, not independence."
  },
  "toolchain": {
    "node": "v22.23.2",
    "engines": ">=22.18 <25"
  },
  "head_sha": "b9ea2eb46030fd55f3eb556257f463f31335c9d9",
  "method": "git clone of this repository into a scratch directory, checkout of head_sha, then node scripts/verify-g0.mjs",
  "output_digests": [
    {
      "path": "specs/aos-result.schema.json",
      "bytes_sha256": "905553924eddced6a2038d604447bad761becdea9a1f79b4eaf0d1a0deeec70d"
    },
    {
      "path": "specs/aos-trace.schema.json",
      "bytes_sha256": "1bd8ab335e68ec7aad39887661531a2b818cef401bef80bafb70bbb574c3a98e"
    },
    {
      "path": "specs/events.v0.json",
      "bytes_sha256": "af671c135903ff11c3f743119cf7ff8052dfa657fee2b760b10710d8dde13e44"
    },
    {
      "path": "specs/opportunity-profile.schema.json",
      "bytes_sha256": "ee7a6ce0a1b5aec0975810176fe3fc11a93c5403e7cdab7e34618af252069913"
    },
    {
      "path": "specs/scoring.v0.json",
      "bytes_sha256": "2a4169c4175fa59c8bd895ae6c1341e5f117ff33e44f9190cb271615e7c1f5bd"
    },
    {
      "path": "specs/issuance.v0.json",
      "bytes_sha256": "a99959bb0667af38647fee95f9c04c4c5ca594a0bbbbff6dc9d8fcca86b8eeb3"
    },
    {
      "path": "src/reporter/diagnosis/select-lever.ts",
      "bytes_sha256": "dbb1a7fa388ba4483732fa265a7e3ac1792b38b52576091a3ddf4e20b10af645"
    },
    {
      "path": "src/scorer/eligibility.ts",
      "bytes_sha256": "b21dbd6bb6c7223c6affcffe8f30f717a8b5f0987170ccc940ea40650fd1f4f8"
    },
    {
      "path": "src/scorer/graders/context.ts",
      "bytes_sha256": "3905231b0cfc5c75523a988af5dc9728ec01700852c6657b02442e86a2d7a3a5"
    },
    {
      "path": "src/scorer/graders/graph.ts",
      "bytes_sha256": "293cf17af4c143ef982256b135b98260ce943823c2649fa49df7f4a043fdbd3c"
    },
    {
      "path": "src/scorer/graders/intent.ts",
      "bytes_sha256": "d0d8937756e557d58fa0057cc3cdee0cd484ba8e6bec87465331ece01e676598"
    },
    {
      "path": "src/scorer/issuance.ts",
      "bytes_sha256": "fada45bf5be4c55e5d0999dbb8dd7d3aac517875a9a9e9da7ff45df8d302d78e"
    },
    {
      "path": "src/scorer/safety.ts",
      "bytes_sha256": "4f5f76266de00dd250735f0d84e78ec00039210b601538ecedd34bc07386a61d"
    },
    {
      "path": "src/scorer/score.ts",
      "bytes_sha256": "8b06f970bc481ee4c87fa8e1de7fc95dcf09417a6d0c8443094ea5ebb9fa8966"
    },
    {
      "path": "src/_deferred/opportunity-audit.ts",
      "bytes_sha256": "c8a8685f7e94ceb0368158a7222503b8feba3a600db0d6ff2578498932c00edd"
    },
    {
      "path": "src/_deferred/pack-budget.ts",
      "bytes_sha256": "ced578b4e577770aa132af8eb48272b83de0c5588ad47bacb9fa6710563ccc11"
    },
    {
      "path": "fixtures/reference-pass/corpus/manifest.json",
      "bytes_sha256": "03ba91981a863fc85090fd3fbbf88f52753ebc55b16fc9f32f8ac3f261dba6fa"
    },
    {
      "path": "fixtures/reference-pass/corpus/input.json",
      "bytes_sha256": "0b92a238660875c6766b40e7078c16edcc4a059b1667efdc6c016594c52a42ea"
    },
    {
      "path": "fixtures/reference-pass/corpus/expected.json",
      "bytes_sha256": "e7fda02b53e51fd379e32b163c64b5c6d0a3ee16fb71760f59c08bf926177d1c"
    },
    {
      "path": "fixtures/reference-pass/corpus/mutation.json",
      "bytes_sha256": "12b268529854f4dd6cf1945fd5833422088cc0bdf825274446a22c6692773b2f"
    },
    {
      "path": "fixtures/reference-fail/corpus/manifest.json",
      "bytes_sha256": "982719c6182919b0f37c1f24a8fa5a8122cea6c4e3174f6644e4adadb9c90b2e"
    },
    {
      "path": "fixtures/reference-fail/corpus/input.json",
      "bytes_sha256": "be61de4c369f64fd092c4c3faa08bcb4335424b453e5c652f24951d074fa497e"
    },
    {
      "path": "fixtures/reference-fail/corpus/expected.json",
      "bytes_sha256": "a3b937bdb2e9f9f5c0207153c62224cb99e9fde924a60a599dbccd18d8d139cc"
    },
    {
      "path": "fixtures/reference-fail/corpus/mutation.json",
      "bytes_sha256": "1f921b28347294623c7dae70fac5f84ac34ce59594c3558b5ae853c2fcdaa5da"
    },
    {
      "path": "fixtures/false-completion/corpus/manifest.json",
      "bytes_sha256": "a17b9f06c10c4ccd9e62ee32b884aca5622b0900bfcfa62d44112306233fd4b1"
    },
    {
      "path": "fixtures/false-completion/corpus/input.json",
      "bytes_sha256": "f4107e9d8de2b96628742d21b99dbf906b40f56db4475c98d01c7e5950704d72"
    },
    {
      "path": "fixtures/false-completion/corpus/expected.json",
      "bytes_sha256": "01d15368f9c0565aa97ae7f457cfdf2901fdfa8bc2b3265171c0ea443c2c70fa"
    },
    {
      "path": "fixtures/false-completion/corpus/mutation.json",
      "bytes_sha256": "03e3679695ddce13aacc944ee6c51d549371d9a4de49981e2a851ea4d9921895"
    },
    {
      "path": "fixtures/stale-evidence/corpus/manifest.json",
      "bytes_sha256": "7a37aca30db2a79f63ee1e0fece622058b078a4c60ce96d579bdd2c5d471ed38"
    },
    {
      "path": "fixtures/stale-evidence/corpus/input.json",
      "bytes_sha256": "4b7c6dedf1c2534ab1358202c21fbf945fc46ad20dd7174d0e13a6a1b8e9ebe0"
    },
    {
      "path": "fixtures/stale-evidence/corpus/expected.json",
      "bytes_sha256": "382d33db100f5c31635626337ace06ba91fb96658f025a0b479e5792b0912eb0"
    },
    {
      "path": "fixtures/stale-evidence/corpus/mutation.json",
      "bytes_sha256": "46c878b3612462222f8738095ac06177487d5cdf260ac645f64086023079acb1"
    },
    {
      "path": "fixtures/duplicate-run/corpus/manifest.json",
      "bytes_sha256": "484986b86a93d0bcdc2655f10a39786b4aae3d086eb743fbee6275def8fbfc5f"
    },
    {
      "path": "fixtures/duplicate-run/corpus/input.json",
      "bytes_sha256": "db95ce5134f96a064f322716e1bb8656b93a658814cd88f47141c18d0e9582bb"
    },
    {
      "path": "fixtures/duplicate-run/corpus/expected.json",
      "bytes_sha256": "638e35fad9eb670bcefeb7af4ddda4dd7d733d57a87d11ee34d088c8a96d4229"
    },
    {
      "path": "fixtures/duplicate-run/corpus/mutation.json",
      "bytes_sha256": "fc67c4341a2cc991c79276b48e58bc1647c6b0480ff16166ccfb07c33e783428"
    },
    {
      "path": "fixtures/unsafe-action/corpus/manifest.json",
      "bytes_sha256": "606d594e2fc09cd88d81aade3c9d45ed111b02487a6207f122ad799ef02258a9"
    },
    {
      "path": "fixtures/unsafe-action/corpus/input.json",
      "bytes_sha256": "9175f37f571cabb23136042a456626db61cdf6715564b65206783ab87623b488"
    },
    {
      "path": "fixtures/unsafe-action/corpus/expected.json",
      "bytes_sha256": "283f086c083ad428f40cf62dbaba38a466fe64fe8c33df638d0de8ac790e227c"
    },
    {
      "path": "fixtures/unsafe-action/corpus/mutation.json",
      "bytes_sha256": "2f1baef66d127ca78fd6da78820424bf9c78d3c9425d6f50ffaddbd9e72c9df5"
    },
    {
      "path": "fixtures/insufficient-evidence/corpus/manifest.json",
      "bytes_sha256": "e0e1ca600aaa132b906de665689e943d36e154dc94a2353e71ad4ea2b0010bc8"
    },
    {
      "path": "fixtures/insufficient-evidence/corpus/input.json",
      "bytes_sha256": "cb1603514a5d77b20074d56b6aae62036bf2de71de46a729e5e4684b5f3b066f"
    },
    {
      "path": "fixtures/insufficient-evidence/corpus/expected.json",
      "bytes_sha256": "601ce25c6b939da9fbc2710f973581a65dc9430d858a54de5ddafef775e6b9a1"
    },
    {
      "path": "fixtures/insufficient-evidence/corpus/mutation.json",
      "bytes_sha256": "1fe8e2c3eade9ac1bfaf7e3b861a6fadfaadf67f40b24aa87ead4a7d366f3c3a"
    },
    {
      "path": "fixtures/manual-takeover/corpus/manifest.json",
      "bytes_sha256": "ef4573d4a7dbd6200fd66965c7089629370b174ac459b44b9ca6f54f7fcd8928"
    },
    {
      "path": "fixtures/manual-takeover/corpus/input.json",
      "bytes_sha256": "2751a9c48ac9b4d03df99eaa3f9571f143cebe9b9c7f385417695b30b2be2e77"
    },
    {
      "path": "fixtures/manual-takeover/corpus/expected.json",
      "bytes_sha256": "43bc58e0a725db4fdd7531c1375ae7eebab324c8a2521401964f0fa960e55460"
    },
    {
      "path": "fixtures/manual-takeover/corpus/mutation.json",
      "bytes_sha256": "d61da5f7469159c12afcf8839ce6b5ebabd756c14d1a4f8e825818600d3aa5c7"
    },
    {
      "path": "fixtures/prescription/corpus/manifest.json",
      "bytes_sha256": "ddb887cd8bc243e9c1e56dc141ea774ca9364dc2d6402c416b0675ed83ce252f"
    },
    {
      "path": "fixtures/prescription/corpus/input.json",
      "bytes_sha256": "eef5432087f2702b906f7cc844b9a6f89962ea95efd5fb64951d485b9ad1c368"
    },
    {
      "path": "fixtures/prescription/corpus/expected.json",
      "bytes_sha256": "a9d3baff719ccfec6ecc5f1fa9a1120dac2afc9185c0d3151017eb7d264945f0"
    },
    {
      "path": "fixtures/prescription/corpus/mutation.json",
      "bytes_sha256": "ac4cacec13cd896e963a54d4da64a13d8560318e08fe9de0d5b3bd1c23d9d7c6"
    },
    {
      "path": "fixtures/scoring/vectors.json",
      "bytes_sha256": "cde6ac59b25ea68ec9e769da84441f63fbeb4eea5dade7ac7dfd87c891da299e"
    }
  ]
}
```

A clean checkout of this repository at the commit above, cloned into a scratch
directory, produced byte-identical fixture digests. That is evidence of
determinism, and it is what the source-release gate asks for.

It is **not** evidence of independence: same operator, same machine, same
toolchain. No signed independent environment manifest is recorded against this
head, and a self-attested result is still refused for that purpose. The claim
set below continues to name `independent_reproduction` as unmet.

## Trusted principals

```json
{
  "principals": []
}
```

## Gate blockers

```json
{
  "G0": "RESOLVED",
  "G1": "UNRESOLVED",
  "G2": "UNRESOLVED",
  "G3": "UNRESOLVED",
  "claim_blockers": [
    "G1",
    "G2",
    "G3",
    "formal_publication_review",
    "independent_reproduction"
  ]
}
```

G0 fixture truth is a scorer-byte result. It does not authorize public
evaluation or a package release. G1 remains open because
`docs/decisions/FEASIBILITY-VERDICT.md` is absent; when that record exists,
G4 compares only G1 to `PASS_TO_CONTINUE` and maps a match onto this
document's `RESOLVED` blocker slot. G2 and G3 remain open because they
require deferred calibration studies; the n=20 feasibility alpha cannot
satisfy them, and this tree has no such study artifact. Publication
requirements are read from the E14 ledger, not from a caller-supplied array.

## Derived verdict

```json
{
  "verdict": "G4_SOURCE_PASS",
  "blocked_by": [],
  "claim_blockers": [
    "G1",
    "G2",
    "G3",
    "formal_publication_review",
    "independent_reproduction"
  ],
  "permits_source_publication": true,
  "permits_publication": true,
  "permits_npm_publication": false,
  "permits_claims": false
}
```
