<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
# 실행 상태

```text
Status       READY — Batch 0
Blocked by   없음
Blocks       #556 #574 #562 #578
Owner        Adapter Environment Policy / Process Injection Boundary
PR target    dev
```

# 목표

`BEST_EFFORT_CLI`와 `STRICT` child environment를 ambient parent environment에서 만들지 않고, adapter가 선언한 최소 allowlist와 검증된 runtime auth만으로 구성한다.

```text
ambient env pass-through
→ 0
```

# Final child environment

정확히 다음 합집합만 허용한다.

```text
AOS structural env
+ adapter-declared config env
+ #554 verified runtime auth env
+ separately approved transport env
+ AOS_* run metadata
```

# Structural allowlist

기본:

```text
PATH — verified/minimized
LANG / required LC_*
TERM
TZ
HOME — AOS temp HOME
TMPDIR — AOS temp dir
```

`SHELL` 등은 runtime이 실제 요구할 때만 adapter policy에 명시한다.

# Adapter policy

```json
{
  "schema_id": "aos-adapter-env-policy.v1",
  "adapter_id": "claude-code.v1",
  "policy_version": 1,
  "structural_env": [],
  "config_env": [],
  "runtime_auth_env": [],
  "transport_env": [],
  "hard_forbidden_env": [],
  "policy_digest": "sha256:..."
}
```

Codex, Claude, generic adapter policy를 별도로 둔다.

# Hard-forbidden classes

Official mode에서 explicit flag로도 해제할 수 없다.

```text
LD_PRELOAD / DYLD_INSERT_LIBRARIES / loader override
BASH_ENV / ENV / shell startup hook
NODE_OPTIONS / NODE_PATH / PYTHONPATH / language preload path
GIT_SSH_COMMAND / Git executable/config override
package-manager script/runtime injection override
```

# Transport env

Proxy/custom CA는 hard-forbidden과 구분한다.

```text
adapter가 필요성을 선언
+ operator가 별도 profile에서 명시 승인
+ name/source만 provenance
+ profile digest 변경
```

Transport integrity를 증명하지 못하면 official claim은 withheld한다. 일반 `--allow-env`가 hard-forbidden class를 풀 수 없다.

# Generic adapter

Unknown/generic command:

```text
minimum structural env only
auto credential env 0
transport/preload env 0
```

# Runtime auth integration

#554 identity gate를 통과한 값만 `runtime_auth_env`에 추가한다.

```text
--allow-env
≠
credential resolver bypass
```

# Provenance

값 없이 저장:

```json
{
  "adapter_id": "...",
  "policy_digest": "sha256:...",
  "allowed_env_names": [],
  "runtime_auth_env_names": [],
  "transport_env_names": [],
  "explicit_env_names": [],
  "blocked_env_classes": []
}
```

# Doctor

Provider call 없이:

```text
required config env readiness
credential resolver readiness
current dangerous ambient env names
execution-time carried/removed name list
profile digest impact
```

를 값 없이 출력한다.

# Error contract

```text
AOS_ENV_REQUIRED_MISSING
AOS_ENV_EXPLICIT_APPROVAL_REQUIRED
AOS_ENV_HARD_FORBIDDEN
AOS_ENV_TRANSPORT_UNVERIFIED
AOS_ENV_POLICY_MISMATCH
```

# Test matrix

기본 차단:

```text
HTTPS_PROXY / HTTP_PROXY — unless approved transport profile
NODE_EXTRA_CA_CERTS / SSL_CERT_FILE — unless approved transport profile
DYLD_INSERT_LIBRARIES / LD_PRELOAD
NODE_OPTIONS / NODE_PATH / PYTHONPATH
BASH_ENV / ENV
GIT_SSH_COMMAND / GIT_CONFIG_GLOBAL
```

기본 허용:

```text
minimal PATH
LANG/LC_*
TERM/TZ
AOS-managed HOME/TMPDIR/AOS_*
```

Actual adapter smoke:

```text
Codex login/runtime
Claude login/runtime
--no-auto-auth
generic minimal-env fixture
```

# Mutation guards

```text
allowlist-only builder
hard-forbidden class guard
transport approval/profile binding
generic minimum env
policy digest/profile binding
secret/value zero-output
```

# 금지 구현

- denylist만 늘리고 `...process.env` 유지
- generic adapter ambient env
- raw value provenance/log
- hard-forbidden override escape hatch
- transport env 자동 전달
- profile digest에서 policy 누락
- #554 identity gate 우회

# 검증

```bash
npm ci
npm test
npm run verify:mvp
npm run test:mutation
npm run smoke:package
```

# 완료 조건

- [ ] Ambient pass-through가 0건이다.
- [ ] Hard-forbidden process injection env가 official child에 0건이다.
- [ ] Generic adapter가 minimal structural env만 받는다.
- [ ] Proxy/CA는 별도 approved profile에서만 전달된다.
- [ ] Runtime auth는 #554 gate를 통과한다.
- [ ] Env/credential values가 모든 output에 0건이다.
- [ ] Codex/Claude/generic smoke가 PASS 또는 exact named blocker다.
- [ ] Profile digest가 policy/approval drift에 반응한다.
- [ ] mutation tests가 load-bearing하다.

# 완료 보고

```text
Issue: #555
Final SHA:
PR:
CI run IDs:

Adapter policies:
Structural/hard-forbidden/transport classes:
Carried/removed env-name matrix:
Doctor contract:
Profile digest behavior:
Codex/Claude/generic smoke:
Value-leak scan:
Mutation:

Final verdict:
PASS | HOLD
```
