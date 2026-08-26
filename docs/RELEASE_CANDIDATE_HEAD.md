# Exact release-head verification

The GitHub checks attached to this commit are the authority for the AOS `0.1.0` release candidate.

The candidate may be promoted only when the exact commit passes:

- `planning-contract (22)`
- `planning-contract (24)`
- `integration / macos / node-22`
- `package / clean-install`

This document does not assert that the checks passed; it exists to bind the cross-platform run to an immutable user-authored Git commit rather than to a workflow-authored intermediate commit.
