// The secret-scan checkpoint: Infisical's own scanner (`infisical scan`) looks
// for passwords and keys in your changes before they're saved or sent.
// It runs on your computer and needs no Infisical login.
//
// We ask for a redacted JSON report in a private temporary folder, read only
// the safe fields from it (rule, file, line, commit, fingerprint), and delete
// it straight away. The secret itself is never read, shown or stored.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { secretGuard } from "../events/guard.js";
import { run } from "../lib/exec.js";
import { findInfisical, showCommand, type InfisicalError } from "./client.js";

/** Exit code we ask Infisical to use when it finds something, so a leak (3) can't be mistaken for an error (1). */
const LEAK_EXIT = 3;
const SCAN_TIMEOUT_MS = 5 * 60_000;
const MAX_FINDINGS = 50;

/** One possible secret. Where it is and which rule matched; never the secret itself. */
export interface Finding {
  /** e.g. "stripe-access-token". */
  rule: string;
  /** e.g. "Stripe Access Token". */
  description: string;
  file: string;
  line: number;
  /** Short commit id, for history scans. */
  commit?: string;
  /** Put this line in .infisicalignore to mark a false alarm. */
  fingerprint?: string;
}

export interface ScanResult {
  ok: true;
  /** The command, as shown to people. */
  command: string;
  /** Empty when clean. At most 50 are kept; `total` has the full count. */
  findings: Finding[];
  total: number;
}

/** The command that scans staged changes (what `git commit` would save). */
export const STAGED_SCAN = ["scan", "git-changes", "--staged"];
/**
 * The command that scans every snapshot `remote` doesn't have yet: what a push
 * there would send. (Not just "on no remote at all": a snapshot that's only on
 * another remote still goes to this one, so it's scanned too.)
 */
export const unpushedScan = (remote: string) => ["scan", `--log-opts=HEAD --not --remotes=${remote}`];

export const scanStaged = (root: string) => scan(root, STAGED_SCAN);
export const scanUnpushed = (root: string, remote: string) => scan(root, unpushedScan(remote));

/** How the scan is shown to people (the report flags are left out). */
export const showScan = (args: string[]) => showCommand([...args, "--redact"]);

async function scan(root: string, args: string[]): Promise<ScanResult | InfisicalError> {
  const bin = findInfisical();
  if (typeof bin !== "string") return bin;

  // A private folder (only you can read it on macOS and Linux) for the report, removed afterwards.
  const dir = await mkdtemp(path.join(tmpdir(), "cli-village-scan-"));
  const report = path.join(dir, "report.json");
  try {
    const res = await run(
      bin,
      [...args, "--redact", `--exit-code=${LEAK_EXIT}`, "--report-format=json", `--report-path=${report}`],
      { cwd: root, timeoutMs: SCAN_TIMEOUT_MS },
    );
    const command = showScan(args);
    if (res.code === 0) return { ok: true, command, findings: [], total: 0 };
    if (res.code === LEAK_EXIT) {
      const findings = await readReport(report);
      // If the report can't be read, still treat it as a leak: better safe than sorry.
      return { ok: true, command, findings: findings.slice(0, MAX_FINDINGS), total: Math.max(findings.length, 1) };
    }
    if (res.timedOut) return { ok: false, error: "The secret scan took too long (over 5 minutes)." };
    const text = secretGuard.clean(`${res.stderr}\n${res.stdout}`).trim();
    if (/unknown (command|flag)|unknown shorthand/i.test(text)) {
      return {
        ok: false,
        error: "Your Infisical CLI is too old for the secret scan. Update it, then try again.",
        hint: "cli-village doctor",
      };
    }
    const details = text.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200);
    return { ok: false, error: "The secret scan couldn't run.", details };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// These fields say where a possible secret is, never what it is, so they're kept as they are
// (the privacy guard would hide long commit ids, which look like tokens). Only control characters are removed.
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?").slice(0, max) : "");

/** Read only the safe fields from the report. Match, Secret, Line and similar fields are never touched. */
export async function readReport(file: string): Promise<Finding[]> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const findings: Finding[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const commit = str(f.Commit, 64);
    findings.push({
      rule: str(f.RuleID, 80) || "unknown-rule",
      description: str(f.Description, 120) || "Possible secret",
      file: str(f.File, 300) || "(unknown file)",
      line: typeof f.StartLine === "number" && Number.isInteger(f.StartLine) ? f.StartLine : 0,
      ...(/^[0-9a-f]{7,64}$/i.test(commit) ? { commit: commit.slice(0, 7) } : {}),
      ...(str(f.Fingerprint, 400) ? { fingerprint: str(f.Fingerprint, 400) } : {}),
    });
  }
  return findings;
}
