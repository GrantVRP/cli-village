#!/usr/bin/env node
// CLI Village entry point: reads the command you typed and runs it.

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

const program = new Command();

program
  .name("cli-village")
  .description("Watch your agents work in a tiny village. A friendly wrapper around the Infisical CLI.")
  .version(pkg.version, "-v, --version", "show the CLI Village version");

program
  .command("doctor")
  .description("check that Node.js, git and the Infisical CLI are installed and ready")
  .option("--json", "print the results as JSON (for scripts)")
  .action(async (options: { json?: boolean }) => {
    process.exitCode = await runDoctor({ json: options.json === true });
  });

await program.parseAsync();
