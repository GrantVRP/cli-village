#!/usr/bin/env node
// CLI Village entry point: reads the command you typed and runs it.

import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { runDemoCommand } from "./commands/demo.js";
import { runDoctor } from "./commands/doctor.js";
import { runOpenCommand } from "./commands/open.js";
import { runWithSecrets } from "./commands/run.js";
import { runSecretsDiff, runSecretsExport, runSecretsFetch } from "./commands/secrets.js";

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

const program = new Command();

program
  .name("cli-village")
  .description("Watch your agents work in a tiny village. A friendly wrapper around the Infisical CLI.")
  .version(pkg.version, "-v, --version", "show the CLI Village version")
  // Options for the main command go before any subcommand, so `doctor --json` stays doctor's own flag.
  .enablePositionalOptions()
  .option("--demo", "watch pretend robots work (nothing real runs)")
  .option("--once", "with --demo: play one round, then stop")
  .option("--speed <n>", "with --demo: play faster or slower (2 = twice as fast)", parseSpeed)
  .option("--json", "print events as JSON lines instead of text (for scripts)")
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
  cli-village run -- npm start       run your app with its secrets`,
  )
  .action(async (options: { demo?: boolean; once?: boolean; speed?: number; json?: boolean }) => {
    if (options.demo) {
      process.exitCode = await runDemoCommand(options);
      return;
    }
    // The live terminal view arrives in a later step. Until then, show help.
    program.outputHelp();
  });

program
  .command("doctor")
  .description("check that Node.js, git and the Infisical CLI are installed and ready")
  .option("--json", "print the results as JSON (for scripts)")
  .action(async (options: { json?: boolean }) => {
    process.exitCode = await runDoctor({ json: options.json === true });
  });

program
  .command("open")
  .description("open the 3D village in your browser (it only works on this computer)")
  .option("--demo", "show pretend robots (nothing real runs)")
  .option("--speed <n>", "with --demo: play faster or slower (2 = twice as fast)", parseSpeed)
  .option("--port <n>", "use this port instead of a random free one", parsePort)
  .option("--no-open", "don't open a browser, just print the address")
  .action(async (options: { demo?: boolean; speed?: number; port?: number; open: boolean }) => {
    process.exitCode = await runOpenCommand({ ...options, version: pkg.version });
  });

// Options that pick which secrets. Infisical decides the defaults (e.g. the
// environment in .infisical.json), so nothing is passed unless you set it.
const withScope = (cmd: Command, env = true) => {
  if (env) cmd.option("-e, --env <name>", "environment, like dev or prod (default: your project's default)");
  return cmd
    .option("--path <folder>", "a folder inside the environment, like /payments (default: /)")
    .option("--project-id <id>", "use this Infisical project instead of the one linked to this folder");
};

const secrets = program
  .command("secrets")
  .description("look at your Infisical secrets: key names and counts only, values stay hidden");

withScope(
  secrets
    .command("fetch")
    .description("load secrets and list their names (values stay in memory, hidden)")
    .option("--json", "print the result as JSON (for scripts)"),
).action(async (options: { env?: string; path?: string; projectId?: string; json?: boolean }) => {
  process.exitCode = await runSecretsFetch(options);
});

withScope(
  secrets
    .command("diff")
    .description("compare two environments by name: what's missing and what's different")
    .argument("<envA>", "first environment, like dev")
    .argument("<envB>", "second environment, like prod")
    .option("--json", "print the result as JSON (for scripts)"),
  false,
).action(async (envA: string, envB: string, options: { path?: string; projectId?: string; json?: boolean }) => {
  process.exitCode = await runSecretsDiff(envA, envB, options);
});

withScope(
  secrets
    .command("export")
    .description("write secrets to a file, only when you ask (it must be in .gitignore)")
    .option("-o, --out <file>", "where to write them, like .env")
    .option("-f, --format <format>", "dotenv, dotenv-export, json, csv or yaml", "dotenv")
    .option("--force", "replace the file if it already exists")
    .option("--json", "print the result as JSON (for scripts)"),
).action(async (options: { env?: string; path?: string; projectId?: string; out?: string; format?: string; force?: boolean; json?: boolean }) => {
  process.exitCode = await runSecretsExport(options);
});

withScope(
  program
    .command("run")
    .description("run a command with your secrets (Infisical passes them in as environment variables)")
    .argument("<command...>", "what to run, after --, like: -- npm start")
    .passThroughOptions()
    .addHelpText(
      "after",
      `
Examples:
  cli-village run -- npm start
  cli-village run --env prod -- node server.js --port 8080`,
    ),
).action(async (command: string[], options: { env?: string; path?: string; projectId?: string }) => {
  process.exitCode = await runWithSecrets(command, options);
});

await program.parseAsync();
