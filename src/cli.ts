#!/usr/bin/env node
// CLI Village entry point: reads the command you typed and runs it.

import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { runDemoCommand } from "./commands/demo.js";
import { runDoctor } from "./commands/doctor.js";

// If whatever reads our output stops early (e.g. `cli-village --demo --json | head`),
// exit quietly instead of crashing with a "broken pipe" error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

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
  cli-village --demo          watch pretend robots act out a workday
  cli-village --demo --once   play the demo once, then stop
  cli-village doctor          check that your tools are ready`,
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

await program.parseAsync();
