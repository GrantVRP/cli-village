# CLI Village

> Watch your agents work in a tiny low-poly village.

CLI Village is a friendly, open-source wrapper around the [Infisical CLI](https://infisical.com/docs/cli/overview). It keeps everything Infisical does, including its privacy guarantees, and lets you *see* the work happening. Each agent is a little robot, each building is a type of task, and commits get carried down to the GitHub Harbor.

It's made for beginners (every action is explained in plain English, next to the real command) and stays out of the way for experts.

**Status:** early days, step 2 of 9. You can check your setup with `doctor` and watch a demo with `--demo`.

## What you need

- Node.js 22 or newer
- git
- The Infisical CLI (`cli-village doctor` tells you how to install it)

## Try it (from source)

```bash
git clone https://github.com/GrantVRP/cli-village.git
cd cli-village
npm install      # download the packages CLI Village uses
npm run build    # turn the TypeScript in src/ into JavaScript in dist/
npm run doctor   # check your setup
npm run demo     # watch pretend robots work (Ctrl+C to stop)
```

Want to type `cli-village` from any folder? Run `npm link` once inside the project folder.

## Commands

| Command | What it does |
|---|---|
| `cli-village doctor` | Checks Node.js, git, the Infisical CLI, your Infisical login and your project link. Add `--json` for scripts. |
| `cli-village --demo` | Pretend robots act out a workday (nothing real runs). Add `--once` to play one round, `--speed 2` to go faster, or `--json` for one JSON event per line. |

## How it works

Everything that happens is an **event**: `start`, `move`, `progress`, `done`, `fail`, `commit` or `push`. Workers, the demo and (later) outside AI agents send events into one stream, and every view listens to that same stream.

Before any view sees an event, a privacy guard checks it. The guard keeps only known fields, strips terminal control codes, and hides anything that looks like a secret: values Infisical gave us, `KEY=value` text, passwords and tokens. Secret lists may only contain key **names**.

## Privacy promises

- Secret **values** never appear in any view, event or log. Only key names and counts.
- Logging in is handled by Infisical itself (`infisical login` or `INFISICAL_TOKEN`). CLI Village never stores tokens.
- The village server (coming soon) only listens on your own computer (`127.0.0.1`) and needs a random key for each session.
- Secrets are never written to disk unless you ask for it (`--out .env`).

## Roadmap

- [x] 1. Scaffold + `doctor`
- [x] 2. Event bus + `--demo` mode
- [ ] 3. Terminal view
- [ ] 4. 3D village
- [ ] 5. Vault (real Infisical commands)
- [ ] 6. Beginner explainer + expert flags
- [ ] 7. GitHub Harbor with the secret-scan checkpoint
- [ ] 8. Library + external-agent event API
- [ ] 9. Tests + CI

## License

[MIT](LICENSE)
