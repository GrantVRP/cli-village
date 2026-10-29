#!/usr/bin/env node
// CLI Village entry point: reads the command you typed and runs it.

import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError, Option } from "commander";
import { runDemoCommand } from "./commands/demo.js";
import { runDoctor } from "./commands/doctor.js";
import { runOpenCommand } from "./commands/open.js";
import { runWithSecrets } from "./commands/run.js";
import { runSecretsDiff, runSecretsExport, runSecretsFetch } from "./commands/secrets.js";
import { makeUi, type Ui, type UiFlags } from "./lib/ui.js";

// If whatever reads our output stops early (e.g. `cli-village --demo --json | head`),
// exit quietly instead of crashing with a "broken pipe" error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

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
  cli-village --demo                 watch pretend robots act out a workday
  cli-village --demo --once          play the demo once, then stop
  cli-village open --demo            watch the demo in the 3D village (in your browser)
  cli-village doctor                 check that your tools are ready
  cli-village secrets fetch          list your secrets' names (values stay hidden)
  cli-village secrets diff dev prod  what's missing or different between two environments
  cli-village run -- npm start       run your app with its secrets

For experts:
  cli-village --demo --compact       the same, in fewer lines
  cli-village secrets fetch -q       just the key names, one per line
  cli-village doctor --json          a report for scripts
  cli-village open --no-animation    a still village (no camera orbit, no walking)`,
  )
  .action(async (options: { demo?: boolean; once?: boolean; speed?: number }, cmd: Command) => {
    if (options.demo) {
      process.exitCode = await runDemoCommand(options, uiOf(cmd));
      return;
    }
    // The live terminal view arrives in a later step. Until then, show help.
    program.outputHelp();
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

await program.parseAsync();
