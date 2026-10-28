// Tiny terminal color helper (no dependency needed).
// Colors turn off when NO_COLOR is set (https://no-color.org) or when output
// isn't a terminal, e.g. when piped into a file.

function colorEnabled(): boolean {
  const env = process.env;
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  return process.stdout.isTTY === true;
}

const enabled = colorEnabled();

const wrap = (open: number, close: number) => (text: string) =>
  enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

// Older Windows consoles can't draw symbols like ✔, so fall back to plain ones there.
function unicodeSupported(): boolean {
  if (process.platform !== "win32") return process.env.TERM !== "linux";
  const env = process.env;
  return Boolean(
    env.WT_SESSION || // Windows Terminal
      env.TERM_PROGRAM === "vscode" ||
      env.ConEmuTask ||
      env.TERMINUS_SUBLIME ||
      env.TERM === "xterm-256color" ||
      env.TERM === "alacritty",
  );
}

export const symbols = unicodeSupported()
  ? { ok: "✔", warn: "!", fail: "✖", skip: "–", arrow: "→" }
  : { ok: "√", warn: "!", fail: "×", skip: "-", arrow: "->" };
