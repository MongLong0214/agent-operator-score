# Minimum Name Clearance

Point-in-time factual checks performed on 2026-08-06. An `UNRESOLVED` status permits the private unpublished root package identifier, but blocks public canonical-brand adoption, public publication, and D0 exit. A `CONFLICT` requires identity correction.

These records do not establish legal or trademark clearance and do not decide LICENSE, contribution acceptance, redistribution, or publication. Those decisions remain separate E14/G4 gates.

## GitHub

```json
{
  "source": "GitHub Search REST API (GET https://api.github.com/search/repositories)",
  "query": "agent-operator-score in:name",
  "searched_at": "2026-08-06T07:58:22Z",
  "result": "total_count=1; the only returned repository was MongLong0214/agent-operator-score",
  "limits": "Public and GitHub-indexed repository names only; includes the current repository; point-in-time result; no organization, trademark, or legal conclusion.",
  "status": "CLEAR"
}
```

## npm

```json
{
  "source": "npm registry package endpoint (GET https://registry.npmjs.org/agent-operator-score)",
  "query": "agent-operator-score",
  "searched_at": "2026-08-06T07:58:23Z",
  "result": "HTTP 404 with body {\"error\":\"Not found\"}",
  "limits": "Exact unscoped package only; scoped packages, similar names, future registration, policy, and publication eligibility were not checked.",
  "status": "CLEAR"
}
```

## Domain

```json
{
  "source": "Verisign .com RDAP (GET https://rdap.verisign.com/com/v1/domain/agentoperatorscore.com)",
  "query": "agentoperatorscore.com",
  "searched_at": "2026-08-06T07:58:22Z",
  "result": "HTTP 404 Not Found",
  "limits": "Exact unhyphenated .com domain only; other spellings, subdomains, TLDs, registrars, future registration, and use rights were not checked.",
  "status": "CLEAR"
}
```

## Basic trademark

```json
{
  "source": "USPTO Trademark Search public web interface (https://tmsearch.uspto.gov/search/search-results)",
  "query": "Agent Operator Score",
  "searched_at": "2026-08-06T07:58:22Z",
  "result": "UNRESOLVED: the public endpoint returned only the client application shell, so no verifiable search result set was obtained.",
  "limits": "No federal live/dead result set was verified; state, common-law, international, confusing-similarity, class, goods/services, and professional legal review were not checked.",
  "status": "UNRESOLVED"
}
```
