# Security policy

## Reporting a vulnerability

Report privately through this repository's security advisories:
<https://github.com/MongLong0214/agent-operator-score/security/advisories/new>

Do not open a public issue for a suspected vulnerability.

Whether private vulnerability reporting is enabled on this repository is a platform setting and is not observable from the tree.
If that form is unavailable, contact the owner of `MongLong0214/agent-operator-score` through
their GitHub account and ask for a private channel before sending any detail.

Include the exact commit SHA, the command or input that reproduces the finding, the observed
behaviour, and the impact you believe it has. Do not include secret values, credentials, or
private project content in the report itself.

## What is in scope

- The control-plane scripts in `scripts/` and the contracts in `packages/`, `adapters/`, and
  `suites/`, at the commit you name.
- The governance and evidence records in `docs/`, where a defect would let an unverified change
  present itself as verified.

## What is out of scope

- Anything that depends on a published package or a public command-line interface. Neither
  exists; every workspace here is `private: true` and unpublished.
- Findings against a fork, a mirror, or a modified tree, unless they reproduce at a commit of
  this repository.
- Third-party services and GitHub platform features themselves. Report those to their owners.

## Response

Reports are acknowledged in the channel they arrive on. This project is pre-release and commits
to no fixed response or remediation window; a report will not be closed silently.

Coordinated disclosure is expected: do not publish detail before a fix or an agreed date.

## What this policy is not

This policy is not a security assurance, audit result, or certification.

No security audit, penetration test, or third-party review of this repository has been performed
or recorded. The publication clearance verdict in `docs/decisions/PUBLICATION-CLEARANCE.md`
states what has and has not been established.
