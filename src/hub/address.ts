// Where the village's local socket lives. Agents and commands on this computer
// send events there; nothing outside this computer can reach it.
//
// macOS and Linux: a Unix socket in a folder only you can open (0700), and the
// socket itself is only readable and writable by you (0600).
// Windows: a named pipe for your user name. Windows only lets the account that
// created a pipe (and administrators) write to it.
//
// CLI_VILLAGE_SOCKET picks another path (handy for tests, or two villages at once).

import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";

export interface HubAddress {
  /** What to listen on / connect to. */
  path: string;
  /** The private folder it lives in (not on Windows). */
  dir?: string;
}

// Unix socket paths can't be longer than this (macOS allows 104 bytes).
const MAX_UNIX_PATH = 100;

function userName(): string {
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "user";
  } catch {
    return "user";
  }
}

export function hubAddress(env: NodeJS.ProcessEnv = process.env, platform = process.platform): HubAddress {
  const custom = env.CLI_VILLAGE_SOCKET?.trim();
  if (custom && platform === "win32") {
    // A full pipe path (\\.\pipe\name or //./pipe/name), or just a name. (Some shells, like Git Bash, eat a backslash.)
    const slashed = custom.replace(/\//g, "\\");
    if (/^\\\\[.?]\\pipe\\[^\\]+$/i.test(slashed)) return { path: slashed };
    return { path: `\\\\.\\pipe\\${slashed.split("\\").filter(Boolean).pop() ?? "cli-village"}` };
  }
  const p = path.posix;
  if (custom) return { path: custom, dir: p.dirname(custom) };
  if (platform === "win32") return { path: `\\\\.\\pipe\\cli-village-${userName()}` };

  const runtime = env.XDG_RUNTIME_DIR?.trim();
  const dir = runtime ? p.join(runtime, "cli-village") : p.join(homedir(), ".cli-village");
  const file = p.join(dir, "village.sock");
  if (Buffer.byteLength(file) <= MAX_UNIX_PATH) return { path: file, dir };
  // A very long home folder: fall back to a private folder in the temp directory.
  const uid = typeof process.getuid === "function" ? process.getuid() : userName();
  const short = p.join(tmpdir(), `cli-village-${uid}`);
  return { path: p.join(short, "village.sock"), dir: short };
}

/**
 * Make sure the socket's folder exists and is private: a real folder (not a
 * link), owned by you, that nobody else can open. Returns a problem, or null.
 */
export async function preparePrivateDir(dir: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return `${dir} isn't a normal folder, so the village won't put its socket there.`;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      return `${dir} belongs to another user, so the village won't put its socket there.`;
    }
    if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
    return null;
  } catch (err) {
    return `Couldn't prepare ${dir}: ${(err as Error).message}`;
  }
}
