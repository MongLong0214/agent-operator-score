# Production contract

AOS v0.1.0 is production-ready as local CLI software when all of the following hold on the exact release commit:

- Node.js 22.18 and 24 pass on native Linux;
- Node.js 22.18 passes on macOS;
- syntax/type checks pass;
- every product regression passes;
- build and self-verification pass;
- the npm tarball contains only the declared runtime surface;
- a clean consumer project installs the tarball and runs `aos --version` and `aos verify --json`;
- production dependency audit reports no high or critical vulnerability.

This software-readiness claim does not elevate the experimental measurement construct into a certification or scientifically validated universal ability score.

## Runtime boundaries

- Supported: macOS/Linux, x64/arm64, Node >=22.18 <25.
- Unsupported: Windows, WSL, arbitrary hostile-code isolation.
- No server, account, telemetry, or external database is required.
- Agent credentials remain owned by the agent CLI and are not stored by AOS.

## Release evidence

The release tag and GitHub Release must target the same commit that passed CI. Release notes must include the exact commit SHA and installation command.
