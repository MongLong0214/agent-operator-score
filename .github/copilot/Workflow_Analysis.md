# Workflow Analysis

`dev` is the default integration branch and `main` is release-only. Atomic issue branches follow `feat-issue-<id>` or `bug-issue-<id>`. Every implementation uses exact-base RED → minimum GREEN → focused/full/build/manual → review → exact-head CI. A head change invalidates affected evidence.

