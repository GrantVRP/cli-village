// `cli-village run [--env prod] -- <command>`: run your app with secrets.
// Infisical starts the program with your secrets as environment variables
// (`infisical run`). The values never pass through CLI Village, and your
// program's own output goes straight to the terminal (it's never put in events).

import { EventBus } from "../events/bus.js";
import { secretGuard } from "../events/guard.js";
import { checkScope, describeScope, findInfisical, scopeArgs, showCommand } from "../infisical/client.js";
import { runInherit } from "../lib/exec.js";
import { cyan, dim, red, symbols } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { attachLogView } from "../views/log.js";
import { attachTaskView } from "../views/task.js";
import { VaultJob, type ScopeOptions } from "./secrets.js";

// Our own messages go to stderr, so your program's output (stdout) stays clean for pipes.
const say = (line = "") => process.stderr.write(`${line}\n`);

export async function runWithSecrets(command: string[], options: ScopeOptions, ui: Ui): Promise<number> {
  // With --json, our part of the story is JSON lines (on stderr, like everything else we say).
  const problem = (message: string, hint?: string) => {
    if (ui.json) say(JSON.stringify({ ok: false, error: message, hint }));
    else {
      say(`${red(symbols.fail)} ${message}`);
      if (hint) say(`  ${dim("Try:")} ${cyan(hint)}`);
    }
    return 1;
  };

  if (command.length === 0) return problem("Tell me what to run after --.", "cli-village run --env dev -- npm start");
  const scope = { env: options.env, path: options.path, projectId: options.projectId };
  const bad = checkScope(scope);
  if (bad) return problem(bad);
  const bin = findInfisical();
  if (typeof bin !== "string") return problem(bin.error, bin.hint);

  const quiet = !ui.json && ui.detail === "quiet";
  const full = !ui.json && ui.detail === "full";
  // With --quiet or --json, Infisical skips its tips and info lines too ("Injecting 5 secrets…"),
  // so only your program's output (and real warnings or errors) remain. Both are Infisical's global flags.
  const hush = quiet || ui.json ? ["--silent", "--log-level=warn"] : [];
  const args = ["run", ...scopeArgs(scope), ...hush, "--", ...command];
  // Hide anything secret-looking someone typed into the command itself (e.g. API_KEY=...).
  const shown = secretGuard.clean(command.join(" ")).slice(0, 80);
  const bus = new EventBus();
  // --quiet says nothing at all unless Infisical can't start. Your program's exit code is passed on as it is.
  const stop = ui.json ? attachLogView(bus, { json: true, write: say }) : quiet ? () => {} : attachTaskView(bus, say, ui.detail);
  const job = new VaultJob(bus, `Running ${shown} with ${describeScope(scope)}`, showCommand(args));
  if (full) {
    say(dim("  (Its output follows. Infisical passes the secrets straight to it.)"));
    say("");
  }

  const result = await runInherit(bin, args);
  if (full) say("");
  if (result.error) {
    const message = `Couldn't start Infisical: ${secretGuard.clean(result.error)}`;
    job.fail(message);
    if (quiet) problem(message);
  } else if (result.code === 0) {
    job.done(`${shown} finished`);
  } else {
    job.fail(`${shown} stopped with exit code ${result.code ?? "unknown"}`);
    if (result.code === 1 && full) say(dim(`  If Infisical printed a login or project error above, try ${cyan("cli-village doctor")}.`));
  }
  stop();
  return result.code ?? 1;
}
