// Talks to the Infisical CLI. CLI Village never calls Infisical's servers
// itself and never sees your login: it runs the `infisical` program, which
// uses your own `infisical login` or INFISICAL_TOKEN.
//
// Secret values stay in memory only. They're handed to the privacy guard (so
// they're hidden if they ever show up in text) and never printed or logged.

import { secretGuard } from "../events/guard.js";
import { findExecutable, run } from "../lib/exec.js";

/** Which secrets to work with. Leave `env` out to use the project's default environment. */
export interface SecretScope {
  env?: string;
  /** Folder inside the environment, e.g. "/" or "/payments". */
  path?: string;
  projectId?: string;
  cwd?: string;
}

export const EXPORT_FORMATS = ["dotenv", "dotenv-export", "json", "csv", "yaml"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface InfisicalError {
  ok: false;
  /** Plain-English explanation. */
  error: string;
  /** A command that might fix it. */
  hint?: string;
  /** What Infisical said, cleaned. Printed in your terminal only, never put in an event. */
  details?: string;
}

export interface SecretSet {
  ok: true;
  /** Key name → value. In memory only. */
  values: Map<string, string>;
  /** Keys you may see but not read (Infisical hides their values from you). */
  unreadable: Set<string>;
}

const ENV_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FOLDER_PATH = /^\/[A-Za-z0-9_\-./]*$/;
const PROJECT_ID = /^[A-Za-z0-9-]{1,64}$/;
const EXPORT_TIMEOUT_MS = 60_000;
const MAX_EXPORT_OUTPUT = 16 * 1024 * 1024;

/** Check names before they go anywhere near a command line. Returns a friendly error, or null. */
export function checkScope(scope: SecretScope): string | null {
  if (scope.env !== undefined && !ENV_NAME.test(scope.env)) {
    return `"${secretGuard.clean(scope.env).slice(0, 40)}" isn't an environment name. Use the short name from Infisical, like dev, staging or prod.`;
  }
  if (scope.path !== undefined && (!FOLDER_PATH.test(scope.path) || scope.path.split("/").includes(".."))) {
    return "A secrets folder path starts with / and uses letters, numbers, - _ . and /, e.g. /payments.";
  }
  if (scope.projectId !== undefined && !PROJECT_ID.test(scope.projectId)) {
    return "A project ID uses only letters, numbers and dashes. You can copy it from the project settings in Infisical.";
  }
  return null;
}

/** The flags that pick which secrets, e.g. ["--env=dev", "--path=/api"]. One argument each, so a value can never turn into a flag. */
export function scopeArgs(scope: SecretScope): string[] {
  const args: string[] = [];
  if (scope.env) args.push(`--env=${scope.env}`);
  if (scope.path && scope.path !== "/") args.push(`--path=${scope.path}`);
  if (scope.projectId) args.push(`--projectId=${scope.projectId}`);
  return args;
}

/** How to show a command to people: `infisical export --env=dev --format=json`. */
export function showCommand(args: string[]): string {
  return ["infisical", ...args].map((a) => (/^[\w.\-=/:@]+$/.test(a) ? a : JSON.stringify(a))).join(" ");
}

/** "dev secrets" or "secrets from your default environment". */
export function describeScope(scope: SecretScope): string {
  const where = scope.path && scope.path !== "/" ? ` in ${scope.path}` : "";
  return scope.env ? `${scope.env} secrets${where}` : `secrets${where} (default environment)`;
}

export function findInfisical(): string | InfisicalError {
  return (
    findExecutable("infisical") ?? {
      ok: false,
      error: "The Infisical CLI isn't installed (or isn't on your PATH).",
      hint: "cli-village doctor",
    }
  );
}

/** Turn whatever Infisical printed on failure into something a beginner can act on. */
export function explainFailure(stderr: string, scope: SecretScope): InfisicalError {
  const text = secretGuard.clean(stderr);
  if (/not logged in|login|log in|unauthori[sz]ed|unauthenticated|\b401\b|expired/i.test(text)) {
    return { ok: false, error: "Infisical says you're not logged in, or your login has expired.", hint: "infisical login" };
  }
  if (/\.infisical\.(json|yaml)|workspace|not connected|infisical init|project.*not found/i.test(text)) {
    return {
      ok: false,
      error: "This folder isn't linked to an Infisical project yet.",
      hint: "infisical init",
    };
  }
  if (/environment/i.test(text) && /not found|does not exist|invalid|unknown/i.test(text)) {
    return {
      ok: false,
      error: `Infisical doesn't have an environment called "${scope.env ?? "(default)"}" in this project. Check the name in Infisical (often dev, staging or prod).`,
    };
  }
  if (/folder|path/i.test(text) && /not found|does not exist/i.test(text)) {
    return { ok: false, error: `Infisical can't find the folder ${scope.path ?? "/"} in that environment.` };
  }
  if (/dial tcp|no such host|timeout|timed out|connection refused|network/i.test(text)) {
    return { ok: false, error: "Couldn't reach Infisical. Check your internet connection and try again." };
  }
  // Its own words stay in your terminal (details), out of the village's events.
  const firstLine = text.split(/(?<=[.!])\s/)[0]?.slice(0, 200);
  return { ok: false, error: "Infisical reported a problem.", details: firstLine || undefined };
}

/** Parse `infisical export --format=json`: a list of { key, value, ... }. */
export function parseExport(stdout: string): Omit<SecretSet, "ok"> | null {
  const start = stdout.indexOf("[");
  if (start < 0) return stdout.trim() === "" || stdout.trim() === "null" ? { values: new Map(), unreadable: new Set() } : null;
  let data: unknown;
  try {
    data = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const values = new Map<string, string>();
  const unreadable = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const { key, value, secretValueHidden } = item as { key?: unknown; value?: unknown; secretValueHidden?: unknown };
    if (typeof key !== "string" || key === "") continue;
    if (secretValueHidden === true) unreadable.add(key);
    // Personal overrides come after shared values, so the last one wins (like Infisical's own --secret-overriding).
    values.set(key, typeof value === "string" ? value : "");
  }
  return { values, unreadable };
}

/** Get secrets into memory. Values are remembered by the privacy guard and never printed. */
export async function fetchSecrets(scope: SecretScope): Promise<SecretSet | InfisicalError> {
  const problem = checkScope(scope);
  if (problem) return { ok: false, error: problem };
  const bin = findInfisical();
  if (typeof bin !== "string") return bin;

  const result = await run(bin, ["export", ...scopeArgs(scope), "--format=json"], {
    cwd: scope.cwd,
    timeoutMs: EXPORT_TIMEOUT_MS,
    maxOutput: MAX_EXPORT_OUTPUT,
  });
  if (result.timedOut) return { ok: false, error: "Infisical took too long to answer (over a minute). Try again in a moment." };
  if (result.code !== 0) return explainFailure(result.stderr || result.stdout, scope);
  if (result.stdout.length >= MAX_EXPORT_OUTPUT) return { ok: false, error: "Infisical sent back more than 16 MB. That's too big to handle safely." };

  const parsed = parseExport(result.stdout);
  if (!parsed) return { ok: false, error: "Infisical's answer wasn't the list of secrets we expected. Is your Infisical CLI up to date?" };
  secretGuard.remember(parsed.values.values());
  return { ok: true, ...parsed };
}

/** Let Infisical itself write secrets to a file (only when you ask for it with --out). */
export async function writeSecretsFile(
  scope: SecretScope,
  format: ExportFormat,
  file: string,
): Promise<{ ok: true } | InfisicalError> {
  const bin = findInfisical();
  if (typeof bin !== "string") return bin;
  const result = await run(bin, ["export", ...scopeArgs(scope), `--format=${format}`, `--output-file=${file}`], {
    cwd: scope.cwd,
    timeoutMs: EXPORT_TIMEOUT_MS,
  });
  if (result.timedOut) return { ok: false, error: "Infisical took too long to answer (over a minute). Try again in a moment." };
  if (result.code !== 0) return explainFailure(result.stderr || result.stdout, scope);
  return { ok: true };
}
