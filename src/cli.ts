#!/usr/bin/env node
// CLI Village entry point: reads the command you typed and runs it.

import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError, Option } from "commander";
import { runDemoCommand } from "./commands/demo.js";
import { runDoctor } from "./commands/doctor.js";
import { runCommit, runPush, runStatus } from "./commands/git.js";
import { runOpenCommand } from "./commands/open.js";
import { runAppCommand } from "./commands/app.js";
import { runWithSecrets } from "./commands/run.js";
import { runSecretsDiff, runSecretsExport, runSecretsFetch } from "./commands/secrets.js";
import { runTests } from "./commands/test.js";
import { runWatch } from "./commands/watch.js";
import { runEmit } from "./commands/emit.js";
import { hubAddress } from "./hub/address.js";
import { canUseTerminalView } from "./views/terminal/index.js";
import { flushForwarders } from "./hub/client.js";
import { makeUi, type Ui, type UiFlags } from "./lib/ui.js";

// In the desktop app's terminal, `cli-village` runs on the app's own Electron, told by
// ELECTRON_RUN_AS_NODE to behave as plain Node.js. It's read at startup, so drop it here:
// programs we start (git, infisical, your tests) must not inherit it.
delete process.env.ELECTRON_RUN_AS_NODE;

// If whatever reads our output stops early (e.g. `cli-village --demo --json | head`),
// exit quietly instead of crashing with a "broken pipe" error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

/** Where the local socket is, for emit --help. (On Windows its name changes each time a village opens.) */
function socketHelp(): string {
  const address = hubAddress();
  if (address.path) return address.path;
  return address.registry ? `a pipe named in ${address.registry} (while a village is open)` : "(none)";
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new InvalidArgumentError("Port must be a whole number from 1024 to 65535.");
  }
  return port;
}

function parseSpeed(value: string): number {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 50) {
    throw new InvalidArgumentError("Speed must be a number from 0.1 to 50 (2 = twice as fast).");
  }
  return speed;
}

// --- The expert flags -------------------------------------------------------------------
// Every command accepts them, before or after its name:
//   cli-village --compact secrets fetch   and   cli-village secrets fetch --compact

const OUTPUT_GROUP = "Output options (for experts):";

function withOutputFlags(cmd: Command): Command {
  const flag = (flags: string, description: string) => new Option(flags, description).helpGroup(OUTPUT_GROUP);
  return cmd
    .addOption(flag("--compact", "fewer lines, without the beginner explanations"))
    .addOption(flag("-q, --quiet", "only results and problems (problems go to stderr)"))
    .addOption(flag("--json", "machine-readable JSON output, for scripts"))
    .addOption(flag("--no-animation", "nothing moves: plain lines instead of the live screen, and a still 3D village"));
}

/** Collect the expert flags from this command and the ones above it (e.g. `cli-village --quiet secrets fetch`). */
function uiOf(cmd: Command): Ui {
  const all: UiFlags[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) all.push(c.opts<UiFlags>());
  return makeUi({
    json: all.some((o) => o.json === true),
    quiet: all.some((o) => o.quiet === true),
    compact: all.some((o) => o.compact === true),
    // --no-animation sets animation to false. (Commands that weren't given it say true.)
    animation: !all.some((o) => o.animation === false),
  });
}

// --- Commands ----------------------------------------------------------------------------

const program = new Command();

program
  .name("cli-village")
  .description("Watch your agents work in a tiny village. A friendly wrapper around the Infisical CLI.")
  .version(pkg.version, "-v, --version", "show the CLI Village version")
  // Options for the main command go before any subcommand, so `doctor --json` stays doctor's own flag.
  .enablePositionalOptions()
  .option("--demo", "watch pretend robots work (nothing real runs)")
  .option("--once", "with --demo: play one round, then stop")
  .option("--speed <n>", "with --demo: play faster or slower (2 = twice as fast)", parseSpeed);
withOutputFlags(program)
  .addHelpText(
    "after",
    `
Examples:
  cli-village                        the live village: your commands and agents
  cli-village --demo                 watch pretend robots act out a workday
  cli-village --demo --once          play the demo once, then stop
  cli-village open --demo            the demo in the 3D village, in your browser
  cli-village app                    village, terminal and tools in one window
  cli-village doctor                 check that your tools are ready
  cli-village secrets fetch          your secrets' names (values stay hidden)
  cli-village secrets diff dev prod  compare two environments by key name
  cli-village run -- npm start       run your app with its secrets
  cli-village status                 what changed since your last snapshot
  cli-village commit -m "Fix login"  save a snapshot (after a secret scan)
  cli-village push                   send your work to GitHub (after a scan)
  cli-village test                   run your project's tests

For experts:
  cli-village --demo --compact       the same, in fewer lines
  cli-village secrets fetch -q       just the key names, one per line
  cli-village doctor --json          a report for scripts
  cli-village open --no-animation    a still 3D village (nothing moves)`,
  )
  .action(async (options: { demo?: boolean; once?: boolean; speed?: number }, cmd: Command) => {
    if (options.demo) {
      process.exitCode = await runDemoCommand(options, uiOf(cmd));
      return;
    }
    // In a terminal, plain `cli-village` opens the live village. In a pipe or script, it shows this help.
    if (canUseTerminalView()) process.exitCode = await runWatch(uiOf(cmd));
    else program.outputHelp();
  });

withOutputFlags(program.command("doctor").description("check that Node.js, git and the Infisical CLI are installed and ready")).action(
  async (_options: object, cmd: Command) => {
    process.exitCode = await runDoctor(uiOf(cmd));
  },
);

withOutputFlags(
  program
    .command("open")
    .description("open the 3D village in your browser (it only works on this computer)")
    .option("--demo", "show pretend robots (nothing real runs)")
    .option("--speed <n>", "with --demo: play faster or slower (2 = twice as fast)", parseSpeed)
    .option("--port <n>", "use this port instead of a random free one", parsePort)
    .option("--no-open", "don't open a browser, just print the address"),
).action(async (options: { demo?: boolean; speed?: number; port?: number; open: boolean }, cmd: Command) => {
  process.exitCode = await runOpenCommand({ ...options, version: pkg.version }, uiOf(cmd));
});

withOutputFlags(
  program
    .command("app")
    .description("open the desktop app: the 3D village, a terminal and the tools in one window")
    .option("--demo", "show pretend robots (nothing real runs)")
    .option("--once", "with --demo: play one round, then stop")
    .option("--speed <n>", "with --demo: play faster or slower (2 = twice as fast)", parseSpeed),
).action(async (options: { demo?: boolean; once?: boolean; speed?: number }, cmd: Command) => {
  process.exitCode = await runAppCommand({ ...options, version: pkg.version }, uiOf(cmd));
});

// Options that pick which secrets. Infisical decides the defaults (e.g. the
// environment in .infisical.json), so nothing is passed unless you set it.
const withScope = (cmd: Command, env = true) => {
  if (env) cmd.option("-e, --env <name>", "environment, like dev or prod (default: your project's default)");
  return cmd
    .option("--path <folder>", "a folder inside the environment, like /payments (default: /)")
    .option("--project-id <id>", "use this Infisical project instead of the one linked to this folder");
};

type ScopeFlags = { env?: string; path?: string; projectId?: string };

const secrets = program
  .command("secrets")
  .description("look at your Infisical secrets: key names and counts only, values stay hidden");

withOutputFlags(
  withScope(secrets.command("fetch").description("load secrets and list their names (values stay in memory, hidden)")),
).action(async (options: ScopeFlags, cmd: Command) => {
  process.exitCode = await runSecretsFetch(options, uiOf(cmd));
});

withOutputFlags(
  withScope(
    secrets
      .command("diff")
      .description("compare two environments by name: what's missing and what's different")
      .argument("<envA>", "first environment, like dev")
      .argument("<envB>", "second environment, like prod")
      .addHelpText("after", "\nWith --quiet, each line is: - only in envA, + only in envB, ~ different, ? can't compare."),
    false,
  ),
).action(async (envA: string, envB: string, options: ScopeFlags, cmd: Command) => {
  process.exitCode = await runSecretsDiff(envA, envB, options, uiOf(cmd));
});

withOutputFlags(
  withScope(
    secrets
      .command("export")
      .description("write secrets to a file, only when you ask (it must be in .gitignore)")
      .option("-o, --out <file>", "where to write them, like .env")
      .option("-f, --format <format>", "dotenv, dotenv-export, json, csv or yaml", "dotenv")
      .option("--force", "replace the file if it already exists"),
  ),
).action(async (options: ScopeFlags & { out?: string; format?: string; force?: boolean }, cmd: Command) => {
  process.exitCode = await runSecretsExport(options, uiOf(cmd));
});

withOutputFlags(
  withScope(
    program
      .command("run")
      .description("run a command with your secrets (Infisical passes them in as environment variables)")
      .argument("<command...>", "what to run, after --, like: -- npm start")
      .passThroughOptions()
      .addHelpText(
        "after",
        `
Your program's output is never changed. CLI Village's own messages go to stderr.

Examples:
  cli-village run -- npm start
  cli-village run --env prod -- node server.js --port 8080
  cli-village run --quiet -- npm test     (only your program's output)`,
      ),
  ),
).action(async (command: string[], options: ScopeFlags, cmd: Command) => {
  process.exitCode = await runWithSecrets(command, options, uiOf(cmd));
});

// --- The GITHUB HARBOR and the LAB --------------------------------------------------------

withOutputFlags(program.command("status").description("what changed since your last snapshot, and what to do next")).action(
  async (_options: object, cmd: Command) => {
    process.exitCode = await runStatus(uiOf(cmd));
  },
);

const SCAN_NOTE = `
Before anything is saved or sent, a checkpoint scans it for passwords and keys
(infisical scan, which runs on your computer). If it finds one, nothing is
saved or sent, and you see the file and line, never the secret itself.`;

withOutputFlags(
  program
    .command("commit")
    .description("save a snapshot of your work (a commit), after a secret scan")
    .option("-m, --message <text>", "a short note about what changed")
    .option("--push", "then send it to GitHub too (after another scan)")
    .option("--skip-scan", "don't scan for secrets (not recommended)")
    .addHelpText(
      "after",
      `
If you staged files (git add), only those are saved. Otherwise every change is.
Files like .env are never saved: keep secrets in Infisical.
${SCAN_NOTE}

Examples:
  cli-village commit -m "Fix the login button"
  cli-village commit -m "Add tests" --push
  cli-village commit -q -m "Tidy up"     (prints just the snapshot id)`,
    ),
).action(async (options: { message?: string; push?: boolean; skipScan?: boolean }, cmd: Command) => {
  process.exitCode = await runCommit(options, uiOf(cmd));
});

withOutputFlags(
  program
    .command("push")
    .description("send your snapshots to GitHub, after a secret scan")
    .option("--skip-scan", "don't scan for secrets (not recommended)")
    .addHelpText("after", `\nThe first push of a branch links it to GitHub (git push --set-upstream).\n${SCAN_NOTE}`),
).action(async (options: { skipScan?: boolean }, cmd: Command) => {
  process.exitCode = await runPush(options, uiOf(cmd));
});

withOutputFlags(
  program
    .command("test")
    .description("run your project's tests (npm/pnpm/yarn/bun test, cargo test, go test or pytest)")
    .argument("[command...]", "or your own test command, after --, like: -- npm run test:unit")
    .passThroughOptions()
    .addHelpText(
      "after",
      `
Your tests' output is never changed. CLI Village's own messages go to stderr.
With --json, the result is one JSON line on stdout, and the test output
moves to stderr.

Examples:
  cli-village test
  cli-village test -- node --test test/
  cli-village test --compact`,
    ),
).action(async (command: string[], _options: object, cmd: Command) => {
  process.exitCode = await runTests(command, uiOf(cmd));
});

// --- Watching, and events from AI agents -----------------------------------------------

withOutputFlags(
  program
    .command("watch")
    .description("the live village for real work (what plain cli-village does in a terminal)")
    .addHelpText(
      "after",
      `
Your commands (status, test, commit, push, secrets, run) and your AI agents
(cli-village emit) show up here. If a village is already open, this one
follows it. With --json, each event is a JSON line.`,
    ),
).action(async (_options: object, cmd: Command) => {
  process.exitCode = await runWatch(uiOf(cmd));
});

withOutputFlags(
  program
    .command("emit")
    .description("send an event to the open village (for AI agents and scripts)")
    .argument("[event]", "one event as JSON, or - to read one event per line from stdin")
    .addHelpText(
      "after",
      () => `
Events: start, progress, done, fail (with a task id), move, commit, push.
Full format and examples: docs/EVENTS.md

Examples:
  cli-village emit '{"type":"start","agent":"claude-code","task":"r1","kind":"research","title":"Reading the Stripe docs"}'
  cli-village emit '{"type":"done","agent":"claude-code","task":"r1","sources":["https://docs.stripe.com/api"]}'
  my-agent | cli-village emit -

Each event is checked first, so mistakes are explained even when no village
is open. Programs can also write the same JSON lines to the local socket:
  ${socketHelp()}`,
    ),
).action(async (event: string | undefined, _options: object, cmd: Command) => {
  process.exitCode = await runEmit(event, uiOf(cmd));
});

await program.parseAsync();
// Let any events still on their way to an open village arrive.
await flushForwarders();
