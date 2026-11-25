# Changelog

What changed in CLI Village, newest first. Each step was built and merged as its own pull request.

## Unreleased

- **Step 27:** village life ([docs/RENDERING.md](docs/RENDERING.md#village-life-lifets-reactionsts)):
  - robots react: a wave for a job done, a cheer for a fix or a push (the robots resting at home join in, one after another), a slump while their task has failed; robots resting at home chat in pairs;
  - birds circling over the rooftops (until nearly dark), butterflies on the wildflowers on spring and summer days, fireflies on warm evenings (now one kind: the old green ones that blinked all together are gone);
  - a drake, a hen and three ducklings on the river, a ginger cat that naps on a bench and wanders to a sunny spot, two villagers at the well and the flowers (with lanterns at dusk), and a fisherman who lets his rowboat drift down the far bank while he fishes, then rows back up (it's tied up for the night). Everyone goes home at night and in the rain;
  - a windmill on the far bank; one wind for the trees, the flags, the smoke and the windmill, stronger in a storm; more chimney smoke on cold evenings;
  - still mode holds it all in one pose. Low and Medium draw fewer birds, butterflies and fireflies;
  - a finishing pass: real low-poly flowers (daisies, cosmos, poppies, tulips and lavender) in soil beds kept off the paths, in the window boxes and in the meadows, over by winter; a cat with a pose of its own for sitting, walking, sunbathing and sleeping curled up, which walks round its bench and the flower beds, not through them; ducks that keep their distance instead of swimming into each other at the turns; a well with water inside it; the lab's flasks standing on its steps; windows on every wall of the cottages; straight edges to the sandy river banks.
- **Step 26:** weather and seasons ([docs/RENDERING.md](docs/RENDERING.md#weather-and-seasons-weatherts-weatheringts-precipitationts)):
  - the work brings the weather: cloud and rain while there's an unfixed problem, a storm when the gate stops a secret; otherwise clouds come and go over minutes, now and then a light shower;
  - the season from this computer's calendar (the time zone says which half of the world): blossom in spring, gold, orange and red trees and falling leaves in autumn, snow on roofs and fields in winter, trodden off the plaza and paths;
  - grey, soft light under cloud, drifting cloud shadows, wet ground and puddles in rain, rain and snow falling (nothing falls with reduced motion); the robots stay as they are;
  - `w` in the village, or View › Weather and Seasons in the desktop app, turns it all off (the app remembers it): then the village looks as before. `?weather=` and `?season=` pin them.
- **Step 25:** nature details ([docs/RENDERING.md](docs/RENDERING.md#nature-details-naturets)): grass across the meadows and along the paths and buildings (three times as thick on Medium and High), with dark roots and light tips, wildflowers in soft colours, mossy boulders with pebbles, reeds and cattails along both river banks, and low wooden fences round the cottage gardens (open at the front, where the robots walk). The rest of the village is exactly as before.
- **Step 24:** a new night, designed from how film, painting and games show moonlight ([docs/RENDERING.md](docs/RENDERING.md#the-night)):
  - a slate-blue moonlit night instead of a dark green one: night vision fades dim colours toward slate blue while the lamps stay warm;
  - shadows that keep their shape (moonlight to fill about 4:1 instead of 9:1), never black;
  - a night sky with a thin glow along the horizon, round stars of different brightness and colour down to the horizon, and a faint Milky Way;
  - the moon behind the river, glittering on the water from the usual view;
  - day and the dusk default look the same as before.
- Security: the installer build tool (electron-builder) no longer uses a minimatch version with a denial-of-service bug (GHSA-g3hv-75wg-m249). It was only used on build machines, on our own file patterns; the installers contain exactly the same files.

## 0.1.0 (22 November 2026)

The first release: desktop installers for Windows, macOS and Linux on GitHub Releases. The command line comes inside the desktop app (its terminal has `cli-village`), or from source; it isn't on npm yet.

### Public (November 2026)

- **Step 23:** the repository is public, with GitHub's security checks on: secret scanning with push protection, Dependabot alerts and security fixes, CodeQL code scanning and private vulnerability reporting. `main` changes only through a pull request whose checks pass, only the owner makes version tags, the npm publish waits for the owner's approval, and only GitHub's own Actions may run.
- Found by CodeQL: on Windows, an Infisical installed as a `.cmd` script in a folder whose path has `%` or a quote is now refused instead of run, because cmd.exe would expand it.

### Ready to install (November 2026)

- **Step 22:** everything a first release needs. Publishing it is the owner's step (see [docs/RELEASING.md](docs/RELEASING.md)).
  - The npm package is only the command line: 43 packages, no native code, no install scripts. `cli-village app` from npm says where to download the desktop app.
  - Desktop installers, built by electron-builder: Windows (installs for you only, no administrator rights), macOS (Apple silicon and Intel) and Linux (AppImage and deb). Electron's fuses switch off NODE_OPTIONS, `--inspect` and file:// privileges, and the app only runs its own, hash-checked code.
  - The installed app opens in your home folder when started from a shortcut, and its Guide asks you to open a project. Its terminal has its own `cli-village`.
  - An app icon in the village's colours.
  - A release workflow: on a version tag it builds and tests the installers, then drafts a GitHub release with SHA-256 checksums, an SBOM and a build-provenance attestation, and, after the owner approves, publishes to npm with trusted publishing (no stored token). On pull requests it builds the installers so a broken one shows up early.
  - Every GitHub Action is pinned to a commit, and Dependabot proposes updates after a week's cooldown.
  - Fixes found by testing the packaged app on all three systems: commands run by the app's own Electron read their arguments wrongly; the app's crash-reporter pipe made Electron programs in its terminal print an error; on macOS the terminal couldn't start a shell (a helper program lost its executable bit).
  - A computer that can't draw 3D (WebGL 2) now says so plainly, instead of waiting forever for the village. Everything else still works.

### Look (November 2026)

- **Step 21:** calmer colours with a clear order, in the desktop app, the browser page and the terminal view.
  - One set of colours for all three (`src/views/colors.ts`): by day stone and wood, at night a slate blue that matches the village's sky. The indigo and Infisical's lime are gone.
  - The work area (the village, logs, Welcome, the terminal) is lifted above the frame and side bars, and menus and dialogs float above it.
  - One gold accent, only for focus, selection and the next thing to do: in the Guide and on Welcome, only the next step is gold.
  - Every text colour passes WCAG AA on every surface at day, dusk and night, and a test checks it (`test/colors.test.mjs`). Keyboard focus shows a gold ring.
  - "Working" is a quiet slate blue; warnings are clay, so they never look like a selection. The terminal's colours are muted to match.

### Graphics (November 2026)

- **Step 20:** a new renderer for the 3D village, same village and colours. See [docs/RENDERING.md](docs/RENDERING.md).
  - Soft shadows that sharpen where things touch the ground (PCSS), and shading in corners and creases (ambient occlusion, top quality only).
  - One table drives the light over the day: the sun's height and colour, the sky, the haze, the exposure and the lamps.
  - A sky with clouds and stars; haze in the distance and mist low over the ground.
  - A real depth of field focused on what the camera looks at (it replaces the old blur bands).
  - A river with waves, sun glints and foam along its banks; trees and bushes that sway in the wind; lamplight on the ground after dark.
  - A film-style finish: colour grade, a soft vignette and fine grain.
  - Graphics quality fits the computer (Low, Medium, High) and steps down if the picture gets slow. Choose it yourself in View › Graphics Quality, or with `&quality=` in the page's address.
  - Tests: the renderer's logic is tested without a graphics card, and the app test draws every quality tier.
  - The look is kept: dusk stays cool and dim, and the cyan rails and the green column glow as brightly as before. Before-and-after pictures are in docs/RENDERING.md.

### Checked and tested (November 2026)

- **Step 18:** `npm run test:app` opens the real desktop app and uses it with real clicks and typing. It runs on Windows in CI. On CI's small screen it found two bugs, now fixed:
  - in a narrow window, the search box covered the Help menu;
  - in a busy village, a click on a tab, or on a button in a building's log, could do nothing.
- **Step 17:** checked against the real Infisical CLI (0.45.13). Every flag exists and the secret scan answers as expected. The test stand-in now writes its reports the way the real one does, with the secret inside, so the tests prove the secret is never shown.
- **Step 16:**
  - A commit refused for lack of a scanner shows at the harbor.
  - The demo's pretend robots are marked "demo" in a live village.
  - The village stops drawing behind other tabs.
  - `cli-village app` hides a harmless Windows error when it closes.
- **Step 15:** fixes from testing the desktop app by hand:
  - menu items work with the mouse;
  - the app's keys work after you click the village;
  - the terminal keeps working after Terminal › New;
  - Clear really clears on Windows;
  - smaller fixes.

### The desktop app (November 2026)

- **Step 14:** a VS Code-style title bar and menus, village colours that follow the light, a Welcome page and a Guide.
- **Step 13:** the desktop app (`cli-village app`): the village, a real terminal and the tools in one window.
- **Step 12:** a web page in Infisical's style, laid out like the terminal view.
- **Step 11:** 3D village polish.

### The command line and the village (October 2026)

- **Step 10:** both views follow real work at the harbor.
- **Step 9:** tests, with GitHub Actions on Linux, macOS and Windows.
- **Step 8:** the Library, and `cli-village emit`, so AI agents and your own scripts appear as robots.
- **Step 7:** the GitHub Harbor. `commit` and `push` scan for secrets first.
- **Step 6:** plain-English explanations for beginners, and `--compact`, `--quiet` and `--json` for experts.
- **Step 5:** the Vault, using the real Infisical CLI: `secrets fetch`, `secrets diff`, `secrets export` and `run`.
- **Step 4:** the 3D village in your browser (`cli-village open`).
- **Step 3:** the live terminal view.
- **Step 2:** the event bus, the privacy guard and `--demo`.
- **Step 1:** the project, with `doctor`, the README and the MIT license.
