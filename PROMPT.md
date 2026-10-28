# CLI Village

## About me (do this first)
My name is **Grant**. Start every response by greeting me by name (e.g. "Hey Grant —").
So you remember this in every future session, create a project notes file in the repo root as your very first action. Include this in it:
- My name is Grant. Greet me by name at the start of every response.
- I'm learning vibe coding and git/GitHub. Explain steps in plain language.
- The project spec lives in `PROMPT.md`; re-read it when you need the full context.

Commit it with the message "Add project notes", and explain to me what that file does.

## Project
You are building **CLI Village** (repo and npm package: `cli-village`, command: `cli-village`). It is an open-source (MIT) Node.js + TypeScript CLI that wraps the official Infisical CLI (https://infisical.com/docs/cli/overview). It keeps all of Infisical's components and privacy guarantees, and adds an animated, low-poly 3D village where you can watch agents work. Each agent is a small robot, each building is a type of task, and committing means carrying work to a "GitHub" area.

## Audience
- **Beginners** who are new to vibe coding, git and GitHub. The app teaches as it runs. Every action shows a one-line plain-English explanation plus the real command, e.g. "Saving a snapshot of your work → `git commit -m "..."`". Include a `?` help overlay that explains what each building means.
- **Experts:** provide `--compact`, `--quiet`, `--json` and `--no-animation`, with no forced tutorials.

## What the agents are
An agent is any worker that emits events.
- **Built-in workers:**
  - Infisical: `fetch`, `export`, `diff` between environments, `run` (inject secrets into a command)
  - git: status, commit, push
  - tests: run the project's test script
- **External agents:** an event API (`cli-village emit <json>` plus the local socket) lets external AI coding agents report their research, coding and test work so it shows up in the village.

## Two views, one event stream
Both views listen to the same events: `start`, `move`, `progress`, `done`, `fail`, `commit`, `push`.
1. **Terminal view** (default): Ink UI with agent status lines, a "what's happening" panel and key hints. It falls back to plain logs when there is no TTY, and restores the terminal on exit and Ctrl+C.
2. **3D village** (`cli-village open`): a local server (HTTP + `ws`) opens a browser page rendered with Three.js (built with Vite, bundled — no CDN).

## Buildings (task → place)
| Building | Look | Task |
|---|---|---|
| VAULT | squat stone building, round heavy door that glows when opened | Infisical secret operations |
| LIBRARY | tall building with an observatory dome / telescope | research gathered from the internet |
| WORKSHOP | cottage with an anvil and a smoking chimney | writing/editing code |
| LAB | cottage with bubbling flasks on the steps | running tests |
| TOWN HALL | largest building, flag on a tower | coordinator that assigns tasks |
| HOME | cottage | idle agents rest here |
| GITHUB HARBOR | wooden dock across the river, with a boat | commits and pushes |

**Commit flow:** a commit becomes a crate. An agent loads it onto a rail cart, and the cart rides the track to the harbor. Before the dock, a **checkpoint gate** runs a secret scan (use Infisical's scan command; check the docs). If the scan finds a leak, the cart stops with a red warning. On push, the boat sails away.

## Art direction (match closely)
- **Style:** low-poly, `flatShading`, no image textures. Detail comes from geometry and per-face/per-tile color jitter. Build every model from primitives in code.
- **Lighting:**
  - A warm directional sun at about 45°, with long, crisp, soft-edged shadows (PCFSoft, high-res shadow map). Every mesh casts and receives shadows.
  - A hemisphere fill light.
  - Tilt-shift blur or fog at the edges, so it looks like a tabletop diorama.
- **Palette:**
  - grass `#7DAA4F`/`#6E9A45`; plaza stone `#B8A98A` with grout `#8C7F66`
  - walls ochre `#D9A441` or warm grey `#C9C3B5`
  - roof tiles `#C8A85A` with variants `#A89C5A`/`#B7B06A`
  - shutters/doors purple `#6B4BA3` or teal `#2F6F73`; wood `#5A3E2B`
  - rails `#4B5070` with cyan glow `#6FE3FF`; river `#4E86A6`
- **Layout:**
  - A round cobblestone plaza in the center (concentric-ring stones, raised edge) with a rail track around it.
  - Buildings connect to the plaza by dirt paths with inlaid rails.
  - A river runs across the back with a tree line beyond it. Trees are clustered low-poly spheres; include one orange autumn tree.
  - Props: barrels, flowers, a bench, lamp posts with lanterns, a notice board and a well.
- **Centerpiece:** a glass column with a brass spiral coil, showing overall progress or health. The glow fills and shifts green `#7CF06A` → yellow `#F2E16B` → orange `#F5A25A` → red `#F05A5A`.
- **Cottages:** a two-storey body with a trim band and stone base. The gable roof is made of offset tile rows with color variation. Add a chimney, recessed windows with shutters, a door, stone steps, and a lantern on a bracket.
- **Agents:** small steampunk robots, about ⅓ the height of a door.
  - Body: a brass barrel body with a glowing cyan lantern head, a top hat or cap, and a crook staff with a hanging lantern.
  - Idle: a gentle bob. Walking: bob and sway along the paths, leaving a fading cyan trail.
- **Effects:**
  - Cyan rings rise from active buildings, and chimneys puff smoke.
  - Occasional white wind streaks drift across the scene.
  - Failures glow red. A stopped state darkens the plaza, and every agent walks home.
  - Optional day/night: at night the ambient light is `#3B3F66`, windows and lanterns glow `#FFD58A`, and fireflies appear.
- **Camera:** perspective with a FOV of about 35° from a high angle, with a slow auto-orbit. It eases toward the building where the most important event is happening, then back out. The user can drag to orbit, scroll to zoom, and click a building to focus it and see its log.
- **Overlay:**
  - Building labels: UPPERCASE, letter-spaced, cream `#EDE6D6` text on a translucent dark box `rgba(30,30,26,.8)` (CSS2DRenderer).
  - Agents get dark speech bubbles ("fetching dev secrets…").
  - One caption at a time: bold sans-serif on `#1F1D17` with a thin gold `#C9A25A` border.
- Reference stills may exist in `docs/reference/` (git-ignored). Treat them as inspiration only: don't copy another product's name, logo or exact models.

## Visual hierarchy (both views)
1. **One key message at a time:** what's happening now, or what needs attention. It gets the most weight: brightest, at the top or center, with camera focus in 3D.
2. **Three emphasis levels at most:** primary = bright/bold, secondary = normal, tertiary = dim/desaturated (idle buildings).
3. **Clear zones with dividers:** status bar on top, the main view in the center (largest), the explainer/log to the side or bottom, key hints at the bottom.
4. **Summarize, don't dump.** Details expand on keypress or click.
5. **Balance and whitespace** around the key message. Never rely on color alone (add icons/text), and respect `NO_COLOR` and reduced motion.

## Privacy and security (non-negotiable)
- Secret **values** never appear in any view, event, log or research request. Show key names and counts only.
- Auth is passed through to Infisical (e.g. `INFISICAL_TOKEN`). Never store tokens.
- The village server binds to `127.0.0.1` only and requires a random per-session token in the URL and on the WebSocket. It makes no external calls.
- Nothing secret is sent to the Library or to any external service. Secrets are never written to disk unless the user explicitly asks (`--out .env`).
- `.gitignore` covers `node_modules`, `dist`, `.env*` and `docs/reference/`.

## How to work with me
- I'm learning vibe coding and git/GitHub. Explain each step in plain language, especially git commands and why you're running them.
- Start by proposing a file structure and plan, and ask me questions before writing code.
- Work in small, runnable steps, with one commit per step and clear commit messages.
- Order:
  1. Scaffold + `doctor` (checks that Infisical is installed and logged in) + README/MIT license
  2. Event bus + `--demo` mode (a scripted fake event loop)
  3. Terminal view
  4. 3D village driven by demo events. Get the look right before wiring real work. Show me screenshots or tell me how to view it.
  5. Vault wired to real Infisical commands
  6. Beginner explainer + expert flags
  7. GitHub Harbor with the secret-scan checkpoint
  8. Library/research + the external-agent event API
  9. Tests, plus a GitHub Actions CI matrix (Ubuntu/macOS/Windows, Node 20/22)
- Never commit secrets. Justify every new dependency in one line.
