// `cli-village run [--env prod] -- <command>`: run your app with secrets.
// Infisical starts the program with your secrets as environment variables
// (`infisical run`). The values never pass through CLI Village, and your
// program's own output goes straight to the terminal (it's never put in events).

import { EventBus } from "../events/bus.js";
import { secretGuard } from "../events/guard.js";
import { checkScope, describeScope, findInfisical, scopeArgs, showCommand } from "../infisical/client.js";
import { runInherit } from "../lib/exec.js";
import { cyan, dim, red, symbols } from "../lib/style.js";
import { attachTaskView } from "../views/task.js";
import { VaultJob, type ScopeOptions } from "./secrets.js";

// Our own messages go to stderr, so your program's output (stdout) stays clean for pipes.
const say = (line = "") => process.stderr.write(`${line}\n`);

export async function runWithSecrets(command: string[], options: Omit<ScopeOptions, "json">): Promise<number> {
  if (command.length === 0) {
    say(`${red(symbols.fail)} Tell me what to run after --, for example:`);
    say(`  ${cyan("cli-village run --env dev -- npm start")}`);
    return 1;
  }
  const scope = { env: options.env, path: options.path, projectId: options.projectId };
  const bad = checkScope(scope);
  if (bad) {
    say(`${red(symbols.fail)} ${bad}`);
    return 1;
  }
  const bin = findInfisical();
  if (typeof bin !== "string") {
    say(`${red(symbols.fail)} ${bin.error}`);
    if (bin.hint) say(`  ${dim("Try:")} ${cyan(bin.hint)}`);
    return 1;
  }

  const args = ["run", ...scopeArgs(scope), "--", ...command];
  // Hide anything secret-looking someone typed into the command itself (e.g. API_KEY=...).
  const shown = secretGuard.clean(command.join(" ")).slice(0, 80);
  const bus = new EventBus();
  const stop = attachTaskView(bus, say);
  const job = new VaultJob(bus, `Running ${shown} with ${describeScope(scope)}`, showCommand(args));
  say(dim("  (Its output follows. Infisical passes the secrets straight to it.)"));
  say("");

  const result = await runInherit(bin, args);
  say("");
  if (result.error) {
    job.fail(`Couldn't start Infisical: ${secretGuard.clean(result.error)}`);
  } else if (result.code === 0) {
    job.done(`${shown} finished`);
  } else {
    job.fail(`${shown} stopped with exit code ${result.code ?? "unknown"}`);
    if (result.code === 1) say(dim(`  If Infisical printed a login or project error above, try ${cyan("cli-village doctor")}.`));
  }
  stop();
  return result.code ?? 1;
}
