# Third-party notices

What this repository redistributes from third parties, and what it requires from third parties
without redistributing. Both lists are derived from this repository's own manifests, so they can
be re-derived rather than trusted: `tests/publication/clearance.test.mjs` rebuilds the package
enumeration from `package-lock.json` and fails when the two disagree.

## Redistributed third-party packages

```json
{
  "derived_from": "package-lock.json",
  "packages": []
}
```

`package-lock.json` declares thirteen entries: the root manifest, the six internal `@aos/*`
workspaces, and one link entry resolving to each of those workspaces. Every entry resolves to a
directory inside this repository. No external package is installed, vendored, or redistributed
here, so there is no inbound package license to reproduce in this file.

## External runtime requirements

```json
{
  "requirements": [
    {
      "component": "Node.js",
      "range": ">=22.18 <25",
      "redistributed": false,
      "source": "package.json engines.node"
    }
  ]
}
```

Node.js is required at runtime and is not vendored or redistributed by this repository; its own license terms are not restated here.

## Limits of this enumeration

- It covers declared package dependencies. Material pasted into a source file, or vendored into
  the tree without a manifest of its own, would not appear in `package-lock.json` and was not
  separately searched for.
- Continuous integration uses three third-party GitHub Actions — `actions/checkout@v5`,
  `actions/setup-node@v5`, and `actions/upload-artifact@v4`. They run in the CI environment and
  are neither vendored nor redistributed by this repository, so they are recorded here as a
  limit rather than as a redistributed component.
- This file states what is present. It is not an opinion on license compatibility, and it does
  not clear this repository for publication.
