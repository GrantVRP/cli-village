// The real terminal at the bottom of the app: xterm.js in the window, a shell
// (PowerShell, or your $SHELL) in the main process, joined by the bridge.
// Its colours follow the village's light, like the rest of the window.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export interface AppTerminal {
  /** Type a command into the shell and press Enter. */
  run(command: string): void;
  focus(): void;
  hasFocus(): boolean;
  fit(): void;
  /** Wipe the screen and the scrollback (the shell keeps running). */
  clear(): void;
  /** A fresh shell, in place of the current one. */
  restart(): void;
  /** Stop the shell. Enter starts a new one. */
  kill(): void;
  setTheme(theme: Partial<ITheme>): void;
}

/** The colours that don't change with the light: readable, not neon. */
const PALETTE: ITheme = {
  black: "#20222f",
  red: "#e06b66",
  green: "#8fc98a",
  yellow: "#e0b878",
  blue: "#8d9bff",
  magenta: "#c08fe0",
  cyan: "#7fc4d6",
  white: "#d8d8dc",
  brightBlack: "#636790",
  brightRed: "#ff8a85",
  brightGreen: "#a9e0a2",
  brightYellow: "#f0cf96",
  brightBlue: "#aab5ff",
  brightMagenta: "#d9b0f0",
  brightCyan: "#a0dcea",
  brightWhite: "#ffffff",
};

/** `isAppKey` says whether the app wants a key (like Ctrl+Shift+P) before the shell sees it. */
export function createTerminal(host: HTMLElement, isAppKey: (e: KeyboardEvent) => boolean): AppTerminal {
  const bridge = window.cliVillage;
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    theme: { ...PALETTE, background: "#121426", foreground: "#dadcec", cursor: "#e0b878", cursorAccent: "#121426", selectionBackground: "rgba(224, 184, 120, 0.3)" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.attachCustomKeyEventHandler((e) => !isAppKey(e));

  let closed = false;
  /** The size the shell was last told, so it's only told again when the size really changes. */
  let sent = "";
  const start = async () => {
    closed = false;
    term.reset();
    safeFit();
    sent = `${term.cols}x${term.rows}`;
    const shell = await bridge.pty.create(term.cols, term.rows);
    if (shell === null) term.writeln("\x1b[31mCouldn't start a shell.\x1b[0m");
  };
  bridge.pty.onData((data) => term.write(data));
  bridge.pty.onExit((code) => {
    closed = true;
    term.writeln(`\r\n\x1b[2m[the shell closed (${code}). Press Enter to start a new one]\x1b[0m`);
  });
  term.onData((data) => {
    if (closed) {
      if (data === "\r") void start();
      return;
    }
    bridge.pty.write(data);
  });

  function safeFit(): void {
    if (host.clientWidth === 0 || host.clientHeight === 0) return;
    fit.fit();
    // On Windows a resize makes the shell's side print the whole screen again, so only
    // send one when the size really changed (Clear and showing the panel call this too).
    const size = `${term.cols}x${term.rows}`;
    if (term.cols > 1 && term.rows > 0 && size !== sent) {
      sent = size;
      bridge.pty.resize(term.cols, term.rows);
    }
  }
  new ResizeObserver(safeFit).observe(host);
  void start();

  return {
    run(command) {
      if (closed) {
        void start().then(() => bridge.pty.write(`${command}\r`));
        return;
      }
      bridge.pty.write(`${command}\r`);
      term.focus();
    },
    focus: () => term.focus(),
    hasFocus: () => host.contains(document.activeElement),
    fit: safeFit,
    clear: () => {
      term.clear();
      bridge.pty.clear();
    },
    restart: () => void start(),
    kill: () => bridge.pty.kill(),
    setTheme: (theme) => {
      term.options.theme = { ...PALETTE, ...term.options.theme, ...theme };
    },
  };
}
