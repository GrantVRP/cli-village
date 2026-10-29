# Sending events to CLI Village

Any program on your computer, like an AI coding agent or a script, can show its work in the village. It sends **events**: small JSON objects that say what it started, how it's going, and how it ended. Each agent becomes a robot that walks to the building for its kind of work.

```bash
cli-village                # 1. open the village (or: cli-village open, for the 3D one)

# 2. from your agent or script:
cli-village emit '{"type":"start","agent":"my-agent","task":"r1","kind":"research","title":"Reading the Stripe docs"}'
cli-village emit '{"type":"done","agent":"my-agent","task":"r1","message":"Found the retry rules","sources":["https://docs.stripe.com/api/idempotent_requests"]}'
```

## Three ways to send

| How | When to use it |
|---|---|
| `cli-village emit '<json>'` | One event. Prints what happened, or a plain explanation if the event is wrong. |
| `my-agent \| cli-village emit -` | Many events: one JSON object per line on stdin. Each line is sent as soon as it arrives. |
| The local socket | Programs that keep a connection open: write one JSON object per line, read one answer per line. |

`cli-village emit` checks every event first, so mistakes are explained even when no village is open. If no village is open, or it closes (or stops answering for 5 seconds) while you send, it says so and exits with 0, so your agent isn't stopped by it. Add `--json` for a machine-readable answer (`{"ok":true,"delivered":true}`; with `-`, also how many were `sent`, `lost` because the village closed, and `refused`), or `-q` to say nothing unless something is wrong. Bad events exit with 1.

### The local socket

- **macOS and Linux:** `$XDG_RUNTIME_DIR/cli-village/village.sock`, or `~/.cli-village/village.sock`. The folder is only open to you (0700), and so is the socket (0600).
- **Windows:** a named pipe with a random name, `\\.\pipe\cli-village-<32 random letters and digits>`. The name is kept in `%LOCALAPPDATA%\cli-village\pipe-name`, a file only you can read (CLI Village makes it the first time it runs). Only your account can write to the pipe, and nobody else can guess its name and take it first.
- `cli-village emit --help` prints the exact path on your computer. Set `CLI_VILLAGE_SOCKET` to use another one (on Windows, a pipe name). On macOS and Linux its folder must be one only you can open (`chmod 700`): the village won't change a folder you picked, it just refuses an open one.

For every line you send, you get one line back: `{"ok":true,"seq":12}` or `{"ok":false,"error":"…"}`. The error says what to fix.

```js
// Node.js
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
const { LOCALAPPDATA, XDG_RUNTIME_DIR } = process.env;
const path =
  process.platform === "win32" ? `\\\\.\\pipe\\${fs.readFileSync(`${LOCALAPPDATA}\\cli-village\\pipe-name`, "utf8").trim()}`
  : XDG_RUNTIME_DIR ? `${XDG_RUNTIME_DIR}/cli-village/village.sock`
  : `${os.homedir()}/.cli-village/village.sock`;
const socket = net.createConnection(path);
socket.write(JSON.stringify({ type: "start", agent: "my-agent", task: "t1", kind: "code", title: "Adding retries" }) + "\n");
socket.on("data", (answer) => console.log(answer.toString()));
```

```python
# Python (macOS and Linux)
import json, os, socket
s = socket.socket(socket.AF_UNIX)
runtime = os.environ.get("XDG_RUNTIME_DIR")
s.connect(f"{runtime}/cli-village/village.sock" if runtime else os.path.expanduser("~/.cli-village/village.sock"))
s.sendall((json.dumps({"type": "done", "agent": "my-agent", "task": "t1"}) + "\n").encode())
print(s.recv(1024).decode())
```

## Events

Every event has a `type` and an `agent` (a short name: letters, numbers, spaces, `. _ -`, up to 32 characters). Each agent gets its own robot.

| `type` | Fields | What happens in the village |
|---|---|---|
| `start` | `task`, `kind`, `title`, optional `command` | The robot walks to the building for `kind` and starts. `title` is the plain-English line; `command` is the real command behind it, if there is one. |
| `progress` | `task`, optional `percent` (0–100), `message` | The robot's speech bubble and the log update. |
| `done` | `task`, optional `message`, `count`, `keys`, `sources` | Finished. A success also clears an earlier problem at that building. |
| `fail` | `task`, `message` | A problem: the building glows red and the key message says what went wrong. |
| `move` | `to`, optional `from` | The robot walks somewhere (a building, or `home`). |
| `commit` | `message`, optional `sha`, `files` | A snapshot was saved: a crate appears at the GITHUB HARBOR. |
| `push` | optional `remote`, `branch`, `commits` | The snapshots went to GitHub: the boat sails. |

`task` is an id you make up, like `"r1"` or `"tests-3"` (letters, numbers, `. _ : # -`). Use the same one for a task's `start`, `progress` and `done` or `fail`.

### Kinds of work and their buildings

| `kind` | Building | For |
|---|---|---|
| `research` | LIBRARY | Reading docs, searching the web |
| `code` | WORKSHOP | Writing or changing code |
| `test` | LAB | Running tests |
| `git` | GITHUB HARBOR | Commits, pushes, pull requests |
| `scan` | GITHUB HARBOR (the gate) | Secret scans before sharing |
| `secrets` | VAULT | Working with secrets (names only) |
| `coordinate` | TOWN HALL | Planning and handing out work |

### Research sources (the LIBRARY)

A `done` event can list up to 10 `sources`: the web pages the research came from. Each is cut down to the site and path before anyone sees it. The `?query`, `#fragment` and any `user:password@` part are dropped, because those can hold tokens. A path part that looks like a token becomes `[hidden]`.

```json
{"type":"done","agent":"my-agent","task":"r1","message":"Read 3 pages","sources":["https://docs.stripe.com/api/idempotent_requests?lang=node"]}
```

…shows up as `my-agent done: Read 3 pages (from docs.stripe.com)`.

## A whole task, start to finish

```bash
emit() { cli-village emit -q "$1"; }
emit '{"type":"start","agent":"my-agent","task":"c1","kind":"code","title":"Adding payment retries"}'
emit '{"type":"progress","agent":"my-agent","task":"c1","percent":60,"message":"Edited 2 files"}'
emit '{"type":"done","agent":"my-agent","task":"c1","message":"Retries added","count":2}'
emit '{"type":"start","agent":"my-agent","task":"t1","kind":"test","title":"Running the tests","command":"npm test"}'
emit '{"type":"fail","agent":"my-agent","task":"t1","message":"2 tests failed in payments.test.ts"}'
```

CLI Village's own commands (`status`, `test`, `commit`, `push`, `secrets`, `run`) also show up in an open village, as the robot called `you`.

## Privacy rules

- **Never put secret values in events.** Send key **names** in `keys` (like `"DATABASE_URL"`), never values.
- Every event is checked before any view sees it. Unknown fields are dropped. Text is cut at 200 characters, and terminal control codes are removed. Anything that looks like a secret (`KEY=value`, `password: …`, tokens, values Infisical gave CLI Village) is shown as `[hidden]`. The guard is a safety net, not permission to send secrets.
- The village never sends events anywhere else. The 3D page only works on your computer, with a new random key each session.

## Limits

- Text fields: 200 characters. `keys`: 100 names. `sources`: 10 addresses.
- One line: 64 KB. Speed: about 100 events a second per connection (short bursts of up to 200 are fine).
- The village keeps the last 500 events, so a view opened later can catch up.
