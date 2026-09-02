<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
# 실행 상태

```text
Status       READY — Batch 0
Blocked by   없음
Blocks       #556 #561 #574 #562 #578
Owner        Runtime Executable Identity / Credential Gate
PR target    dev
```

# 목표

Environment·Keychain·runtime config에서 자동 발견한 credential을 등록 시와 실행 시 identity가 일치하는 verified Codex/Claude executable에만 전달한다.

```text
auto credential
+ verified exact executable
→ adapter policy에 따라 전달 가능

auto credential
+ unknown/replaced/writable wrapper
→ 조회·전달 금지
```

# Identity record

```json
{
  "command_input": "claude",
  "resolved_realpath": "/verified/path/claude",
  "realpath_digest": "sha256:...",
  "file_fingerprint": "sha256:...",
  "owner_uid": 501,
  "mode": "0755",
  "parent_security": {
    "world_writable": false,
    "group_writable_untrusted": false
  },
  "platform_identity": {
    "macos_codesign_team": null,
    "macos_requirement_digest": null
  },
  "adapter_id": "claude-code.v1",
  "identity_status": "VERIFIED"
}
```

Credential 값은 저장하지 않는다.

# Registration-time verification

`aos init`, `aos agent add`, auto-discovery에서:

```text
PATH resolution
symlink realpath
regular executable
raw-byte SHA-256 fingerprint
owner/mode
parent directory writable risk
platform signing identity when available
adapter-resolver ownership
```

을 기록한다.

# Pre-spawn verification

**Credential resolver 호출 전에** 다음을 다시 확인한다.

```text
current realpath == registered realpath
current fingerprint == registered fingerprint
owner/mode/parent policy PASS
platform identity match when recorded
adapter owns credential resolver
```

하나라도 실패하면 credential 조회와 child spawn 모두 중단한다.

# Credential sources

```text
environment
Keychain
runtime config
explicit operator approval
```

어떤 source든 executable identity gate를 우회하지 못한다.

Operator environment에 token이 이미 있어도 arbitrary command에는 전달하지 않는다.

# Explicit wrapper policy

Unknown/custom wrapper는 auto-auth 기본 금지다.

명시적 advanced opt-in:

```text
--allow-runtime-auth <ENV_NAME>
```

이 경우에도:

```text
credential value 저장/출력 0
source = explicit
profile digest 변경
exact wrapper identity 기록
```

# Legacy migration

Identity record 없는 legacy agent:

```text
identity_status = MIGRATION_REQUIRED
auto credential 전달 금지
aos doctor에 safe remediation 표시
재등록 또는 explicit migration 필요
```

자동 verified 승격 금지.

# Provenance

값 없이 다음을 저장한다.

```text
runtime executable identity digest
realpath/fingerprint status
adapter/resolver ID/version
credential env name
credential source class
identity verification timestamp/evidence digest
```

#561 profile digest가 이 identity를 재사용한다. 별도 model/runtime identity 구현을 만들지 않는다.

# Errors

```text
AOS_RUNTIME_IDENTITY_MISSING
AOS_RUNTIME_IDENTITY_DRIFT
AOS_RUNTIME_IDENTITY_UNTRUSTED
AOS_RUNTIME_AUTH_REQUIRES_EXPLICIT_APPROVAL
AOS_RUNTIME_AUTH_WRONG_BINARY
AOS_RUNTIME_AUTH_RESOLVER_MISMATCH
```

Error/log/JSON/HTML에 credential value 또는 일부를 출력하지 않는다.

# Denied matrix

```text
/tmp/claude
world/group-writable parent
registered binary byte replacement
symlink target drift
owner/mode drift
wrong adapter + arbitrary binary
operator env token + unknown binary
PATH resolution drift
legacy config without identity
```

# Allowed matrix

```text
known verified runtime unchanged
explicit verified wrapper + explicit auth approval
no-auto-auth mode
generic fixture requiring no credential
```

# Actual canary

macOS에서 최소:

```text
wrong binary → Keychain resolver call count 0
actual runtime identity record 생성
unsigned/nonstandard installation 형태도 exact policy로 분류
```

Linux contract test도 실행한다.

# Mutation guards

```text
realpath compare
fingerprint compare
parent writable refusal
identity-before-resolver ordering
operator-env credential gate
resolver ownership
legacy migration guard
secret-value scan
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

- [ ] basename-only auto-auth 경로가 0건이다.
- [ ] Identity drift가 credential 조회 전에 차단된다.
- [ ] Unknown/wrapper가 explicit approval 없이 credential을 받지 못한다.
- [ ] Operator env credential도 동일 gate를 따른다.
- [ ] Legacy config가 자동 verified되지 않는다.
- [ ] Credential 값이 모든 output에 0건이다.
- [ ] macOS/Linux contract 및 actual canary가 PASS한다.
- [ ] Profile digest가 identity drift에 반응한다.
- [ ] mutation tests가 load-bearing하다.

# 완료 보고

```text
Issue: #554
Final SHA:
PR:
CI run IDs:

Identity schema:
Registration/pre-spawn verification:
Denied/allowed matrix:
Legacy migration:
macOS Keychain canary:
Profile digest behavior:
Credential leak scan:
Mutation:

Final verdict:
PASS | HOLD
```
