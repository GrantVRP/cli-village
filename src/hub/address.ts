// Where the village's local socket lives. Agents and commands on this computer
// send events there; nothing outside this computer can reach it.
//
// macOS and Linux: a Unix socket in a folder only you can open (0700), and the
// socket itself is only readable and writable by you (0600).
// Windows: a named pipe with a random name, kept in a file only you can read
// (%LOCALAPPDATA%\cli-village\pipe-name). Windows only lets the account that
// created a pipe (and administrators) write to it, and a name nobody else
// knows can't be taken by someone else first.
//
// CLI_VILLAGE_SOCKET picks another path (handy for tests, or two villages at once).

import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";

export interface HubAddress {
  /** What to listen on / connect to. */
  path: string;
  /** The private folder it lives in (not on Windows). */
  dir?: string;
  /** You picked this path (CLI_VILLAGE_SOCKET): its folder is checked, but never changed. */
  chosen?: boolean;
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
  if (custom) return { path: custom, dir: p.dirname(custom), chosen: true };
  if (platform === "win32") return { path: `\\\\.\\pipe\\${windowsPipeName(env)}` };

  const runtime = env.XDG_RUNTIME_DIR?.trim();
  const dir = runtime ? p.join(runtime, "cli-village") : p.join(homedir(), ".cli-village");
  const file = p.join(dir, "village.sock");
  if (Buffer.byteLength(file) <= MAX_UNIX_PATH) return { path: file, dir };
  // A very long home folder: fall back to a private folder in the temp directory.
  const uid = typeof process.getuid === "function" ? process.getuid() : userName();
  const short = p.join(tmpdir(), `cli-village-${uid}`);
  return { path: p.join(short, "village.sock"), dir: short };
}

const PIPE_NAME = /^cli-village-[0-9a-f]{32}$/;

/**
 * The village's pipe name on Windows: made up once at random, then kept in a
 * file in your own AppData folder, so every command and agent finds it.
 */
function windowsPipeName(env: NodeJS.ProcessEnv): string {
  const base = env.LOCALAPPDATA?.trim() || path.join(homedir(), "AppData", "Local");
  const file = path.join(base, "cli-village", "pipe-name");
  const saved = () => {
    try {
      const name = readFileSync(file, "utf8").trim();
      return PIPE_NAME.test(name) ? name : null;
    } catch {
      return null;
    }
  };
  const known = saved();
  if (known) return known;
  const name = `cli-village-${randomBytes(16).toString("hex")}`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // "wx": if another command makes the file at the same moment, its name wins (read below).
    writeFileSync(file, `${name}\n`, { flag: existsSync(file) ? "w" : "wx" });
    return name;
  } catch {
    // Couldn't save it: fall back to a name from your user name (others could guess it).
    return saved() ?? `cli-village-${userName()}`;
  }
}

/**
 * Before connecting (macOS and Linux): is the socket's folder still a real
 * folder, owned by you, that nobody else can open? If someone else made it,
 * whatever listens there isn't your village, so nothing is sent to it.
 */
export function isSafeToConnect(address: HubAddress, platform = process.platform): boolean {
  if (platform === "win32" || !address.dir) return true;
  try {
    const info = lstatSync(address.dir); // lstat: a link to a folder doesn't count
    if (!info.isDirectory()) return false;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
    return (info.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/**
 * Make sure the socket's folder exists and is private: a real folder (not a
 * link), owned by you, that nobody else can open. Returns a problem, or null.
 * A folder that already existed is only locked down if it's the village's
 * own (`mayChange`); one you picked is left as it is, and refused if it's open.
 */
export async function preparePrivateDir(dir: string, { mayChange = true } = {}): Promise<string | null> {
  try {
    const made = await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return `${dir} isn't a normal folder, so the village won't put its socket there.`;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      return `${dir} belongs to another user, so the village won't put its socket there.`;
    }
    if ((info.mode & 0o077) !== 0) {
      if (!mayChange && made === undefined) {
        return `Other users can open ${dir}, so the village won't put its socket there. Use a folder only you can open (chmod 700 it), or unset CLI_VILLAGE_SOCKET.`;
      }
      await chmod(dir, 0o700);
    }
    return null;
  } catch (err) {
    return `Couldn't prepare ${dir}: ${(err as Error).message}`;
  }
}
