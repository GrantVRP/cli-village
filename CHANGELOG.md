# Changelog

What changed in CLI Village, newest first. Each step was built and merged as its own pull request.

## 0.1.0 (not released yet)

Nothing is on npm yet: install it from a copy of this repository (see the README).

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
