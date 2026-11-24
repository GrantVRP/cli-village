# Security

CLI Village works next to your secrets, so security problems matter most here. Thank you for reporting one.

## Reporting a problem

**Please don't open a public issue for a security problem.** Report it privately instead:

1. Open this repository on GitHub and go to the **Security** tab.
2. Choose **Report a vulnerability**.
3. Say what you found, how to make it happen, and which version or commit you used.

Never include a real secret in a report. A made-up value that shows the problem is enough.

This is a small open-source project run by one person, so there's no fixed response time. You'll get an answer as soon as possible, and a fix comes first, before any announcement.

## What counts

Anything that breaks one of the promises in the README's **Privacy promises** section. For example:

- **A secret value shows up** somewhere it shouldn't: a view, the village, an event, a log, a file, or `--json` output.
- **A secret gets past the gate:** `commit` or `push` sends one without stopping, unless you added `--skip-scan`.
- **Someone else can reach your village:**
  - another program or website gets into the village server or the local socket;
  - a page gets in without the session key;
  - a remote computer gets in.
- **The desktop app's window does more than it should:** it can reach Node.js, open other sites, or run commands it shouldn't.

## Supported versions

Only the newest release, and the newest code on the `main` branch, get fixes.

## Checking what you downloaded

Releases are built only by this repository's release workflow on GitHub Actions, from a tagged commit, and each comes with a build-provenance attestation, SHA-256 checksums and an SBOM. CLI Village isn't on npm yet, so a `cli-village` package on npm isn't ours; when it is, the same workflow will publish it, with provenance. The README's **Check a download** section shows how to verify them. A file that doesn't verify didn't come from here: please don't run it, and tell us where you found it.

The desktop installers aren't code-signed yet, so Windows SmartScreen and macOS Gatekeeper warn on the first start. That warning is expected for these files only: never turn off those protections for your whole computer.
