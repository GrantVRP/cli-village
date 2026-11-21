# Releasing CLI Village

How a version gets from this repository to people's computers, and what only the owner can
do. The automation is in [.github/workflows/release.yml](../.github/workflows/release.yml); it
never publishes anything without the owner's review.

What a release contains:
- **Desktop installers** on GitHub Releases: Windows (one-click, per-user installer and a zip),
  macOS (dmg and zip, Apple silicon and Intel), Linux (AppImage and deb).
- **`SHA256SUMS`**, **`sbom.cdx.json`** (every package inside, CycloneDX) and a
  **build-provenance attestation** for each file (`gh attestation verify`).
- **The npm package** (`cli-village`, the command line only), published by the workflow with
  npm trusted publishing: no npm token is stored anywhere, and npm adds provenance.

## Once: before the first release

Do these in order. They're settings on GitHub and npm that only the owner can change. Menu
names were checked in November 2026 and may move a little.

### 1. Keep your email address private

Every commit so far records your personal email address. When the repository becomes
public, anyone can read it in the history.

1. GitHub › **Settings › Emails**: turn on **Keep my email addresses private** and
   **Block command line pushes that expose my email**.
2. Copy the `…@users.noreply.github.com` address shown there, then:
   `git config --global user.email "<that address>"`
3. **Decide about the commits already made** (71 so far). Either:
   - accept that the address becomes public with them (simplest; it's already in every
     commit GitHub has stored), or
   - publish a fresh public repository whose history is rewritten or squashed, and keep this
     one private. Rewriting this repository isn't enough on its own: the old commits stay
     reachable through its merged pull requests.

### 2. Look over what becomes public

- `CLAUDE.md` (your first name and notes on how you like to work), `docs/screenshots/` and
  `PROMPT.md`.
- The pull request descriptions and the old Actions logs.
- The secret scan of the whole history: `infisical scan --log-opts="--all" --redact`. It finds
  three test strings (in `src/lib/redact.ts` and `test/events.test.mjs`) that only *look*
  like keys: they're made-up values the privacy tests feed to the redactor. Check you agree.

### 3. Make the repository public

**Settings › General › Danger Zone › Change visibility.** On GitHub's free plan, attestations
and npm provenance only work for public repositories, and Actions minutes are free for them.

### 4. Repository settings

- **Settings › Advanced Security:** turn on secret scanning with **push protection**,
  **Private vulnerability reporting** (SECURITY.md sends reporters there), **Dependabot
  alerts** and **Dependabot security updates**, and **CodeQL** (default setup).
- **Settings › Actions › General › Workflow permissions:** **Read repository contents**, and
  leave "Allow GitHub Actions to create and approve pull requests" off. (Each workflow asks
  for more only where it needs it.)
- **Settings › Rules › Rulesets**, two rulesets:
  - **`main`**: require a pull request, require the CI checks to pass, block force pushes and
    deletion.
  - **Tags `v*`**: only you may create them; block updates and deletion. A version tag is
    what starts a release.

### 5. The `npm` environment

**Settings › Environments › New environment**, named exactly `npm`:
- **Required reviewers:** you. The publish job waits for your approval.
- **Deployment branches and tags:** selected tags only, pattern `v*`.

Create it before the first tag: if a workflow names an environment that doesn't exist yet,
GitHub creates it with no protection.

### 6. An npm account

- Sign up at npmjs.com with an email address you don't mind being public (npm shows
  maintainers' addresses). An alias is a good idea.
- Turn on two-factor authentication with a security key or passkey.

## Every release

1. **Choose the version** (yours to decide: `0.1.0` as it is, or `1.0.0` for "ready"). Set it
   in `package.json` (`npm version <version> --no-git-tag-version`), move the CHANGELOG's
   "not released yet" heading to that version, and merge the pull request into `main`.
2. **Tag that commit on `main`**, and push the tag:
   ```sh
   git switch main && git pull
   git tag v0.1.0        # the same version as package.json, with a v
   git push origin v0.1.0
   ```
   The release workflow starts. It stops early if the tag and `package.json` disagree.
3. **Check the draft release** (Releases on GitHub, after about 15 minutes): it should list
   the installers, `SHA256SUMS` and `sbom.cdx.json`. Download the installer for your computer,
   check it (`gh attestation verify <file> -R GrantVRP/cli-village`), install it and open it.
   If it's good, **Publish release**. If not, delete the draft and the tag, fix, and start again.
4. **Approve npm.** The workflow's "Publish to npm" job waits for you (the run's page shows
   **Review deployments**). Approve it once the release is published.

### The first release only

npm can only trust the workflow once the package exists, so the very first publish is by
hand. In step 4, choose **Reject** instead, then:

1. In a fresh copy of the repository at the tag:
   ```sh
   git clone https://github.com/GrantVRP/cli-village.git && cd cli-village
   git switch --detach v0.1.0
   npm ci --ignore-scripts
   npm test
   npm publish        # builds first (prepack); npm asks for your second factor
   ```
2. On npmjs.com, the package's **Settings › Trusted Publisher**: choose **GitHub Actions**,
   owner `GrantVRP`, repository `cli-village`, workflow `release.yml`, environment `npm`.
3. Same page, **Publishing access**: **Require two-factor authentication and disallow
   tokens**. From now on, only the workflow (with your approval) or you (with your second
   factor) can publish.

From the second release on, step 4 is just **Approve**.

## Signing, later

The installers aren't code-signed, so Windows SmartScreen and macOS Gatekeeper warn on the
first start (the README says what to click). Signing would remove that:
- **macOS:** an Apple Developer account (paid yearly), then electron-builder's `mac.identity`
  and notarization, with the certificate kept as a secret of a protected environment (like
  `npm`), so only an approved release job can use it.
- **Windows:** a code-signing certificate, or a signing service such as Azure Trusted Signing.

With signing in place, automatic updates (electron-updater) become safe to add.

## Building the installers yourself

`npm run dist` builds the installers for the computer you're on into `release/`;
`npm run dist:dir` builds only the app folder (`release/win-unpacked`, for example), which
`test/app/installed.test.mjs` can open:

```sh
npm run dist:dir
CLI_VILLAGE_TEST_INSTALLED_APP="$PWD/release/win-unpacked/CLI Village.exe" node --test test/app/installed.test.mjs
```

The configuration is [electron-builder.yml](../electron-builder.yml); the app icon is
[desktop/icon.svg](../desktop/icon.svg) (`npx electron scripts/make-icon.cjs` remakes the PNG).
