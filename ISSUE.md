<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
# 실행 상태

```text
Status       READY — Batch 0
Blocked by   없음
Blocks       #564 #562 #571 #578
Owner        Raw-byte Evidence / Canonical Tree Identity
PR target    dev
```

# 목표

Exact artifact·handoff·workspace tree evidence의 authority를 UTF-8 decode/CRLF normalization hash에서 **raw bytes SHA-256**으로 전환한다.

```text
exact identity
→ sha256(raw bytes)
```

# Digest types

## Byte digest — authority

사용:

```text
artifact identity
handoff
workspace/tree snapshot
scope diff
verifier input/result binding
result evidence
release asset/package
```

## Text digest — optional projection

UTF-8 text로 안전하게 판별된 경우에만:

```text
CRLF → LF normalized text digest
```

Semantic/document projection 비교에만 사용한다. Exact identity authority가 아니다.

# File evidence schema

```json
{
  "schema_id": "aos-file-evidence.v2",
  "path": "relative/path",
  "type": "file",
  "mode": "100644",
  "size_bytes": 123,
  "byte_digest": "sha256:...",
  "text_digest": "sha256:... or null",
  "media": "text|binary|unknown",
  "refused": null
}
```

# Tree canonicalization

Tree digest는 canonical entry tuple의 digest다.

```text
relative path bytes
entry type
mode where relevant
size
raw byte digest
refusal/symlink/special-file marker
```

Rules:

```text
canonical byte-wise relative-path ordering
absolute root/path excluded
relative path identity included
symlink = explicit link evidence or refusal
special file = refusal evidence
same bytes/different relative path → tree digest differs
same relative tree/different absolute root → tree digest same
```

# API

```text
sha256Bytes(Buffer)
fileByteDigest(path)
optionalFileTextDigest(path)
canonicalTreeManifest(root, policy)
canonicalTreeDigest(manifest)
```

기존 `fileDigest` 의미가 모호하면 deprecated wrapper로 남기고 explicit APIs로 migration한다.

# Binary / invalid UTF-8

- crash/drop하지 않는다.
- Raw-byte evidence를 항상 생성한다.
- Text digest는 null일 수 있다.
- File/total-size limit은 유지하고 초과는 named refusal로 기록한다.

# Handoff / Git provenance

Handoff producer/consumer는 raw byte/tree digest만 authority로 사용한다.

```text
Git head/tree provenance
AOS SHA-256 byte tree digest
```

둘은 별도이며 서로 대체하지 않는다.

# Compatibility

```text
old normalized-only evidence
→ historical/provisional
→ new handoff/Cycle aggregate 금지
```

Old normalized hash를 raw-byte digest로 재명명하지 않는다. Evidence schema를 bump하고 #562 exact contract에 포함한다.

# Test matrix

```text
LF vs CRLF
→ byte digest different / optional text digest same

binary 1-byte change
→ file/tree digest different

invalid UTF-8
→ no crash / exact byte digest

same bytes, different absolute root + same relative tree
→ same tree digest

same bytes, different relative path
→ different tree digest

mode/type/refusal/symlink change
→ tree digest changes

handoff mismatch
→ consumer refusal

large file limit
→ named refusal, no silent drop

old schema
→ explicit historical behavior
```

# 금지 구현

- UTF-8 decoded text를 exact authority로 유지
- byte digest에 CRLF normalization
- binary/invalid UTF-8 skip
- path/type/mode/refusal을 tree digest에서 누락
- old schema silent upgrade
- UI prefix만 저장하고 full digest 유실

# Mutation guards

```text
raw Buffer authority
binary handling
canonical path/type/mode tuple
refusal/symlink marker
handoff exact compare
legacy separation
```

# 검증

```bash
npm ci
npm test
npm run verify:mvp
npm run test:mutation
npm run smoke:package
```

# 완료 조건

- [ ] Exact evidence authority가 raw bytes다.
- [ ] Binary/invalid UTF-8를 지원한다.
- [ ] Optional normalized text digest가 분리된다.
- [ ] Tree canonicalization이 명시·테스트된다.
- [ ] Handoff mismatch가 fail-closed한다.
- [ ] Old/new evidence schema가 섞이지 않는다.
- [ ] #562/#571이 재사용할 API와 digest가 존재한다.
- [ ] mutation tests가 byte authority를 증명한다.

# 완료 보고

```text
Issue: #567
Final SHA:
PR:
CI run IDs:

Schema/API:
Tree canonical tuple:
LF/CRLF matrix:
Binary/invalid UTF-8:
Path/mode/type/symlink matrix:
Handoff/legacy behavior:
Contract digest inputs:
Mutation:

Final verdict:
PASS | HOLD
```
