// The real terminal at the bottom of the app: xterm.js in the window, a shell
// (PowerShell, or your $SHELL) in the main process, joined by the bridge.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export interface AppTerminal {
  /** Type a command into the shell and press Enter. */
  run(command: string): void;
  focus(): void;
  fit(): void;
}

/** `isAppKey` says whether the app wants a key (like Ctrl+Shift+P) before the shell sees it. */
export function createTerminal(host: HTMLElement, isAppKey: (e: KeyboardEvent) => boolean): AppTerminal {
  const bridge = window.cliVillage;
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    theme: {
      background: "#0b0b0d",
      foreground: "#e6e6ea",
      cursor: "#dbf530",
      cursorAccent: "#0b0b0d",
      selectionBackground: "rgba(219, 245, 48, 0.25)",
      black: "#1d1d22",
      red: "#f05a5a",
      green: "#7cf06a",
      yellow: "#ffd58a",
      blue: "#8d9bff",
      magenta: "#c58cff",
      cyan: "#6fe3ff",
      white: "#d8d8dc",
      brightBlack: "#5a5a66",
      brightRed: "#ff7b7b",
      brightGreen: "#9cff8c",
      brightYellow: "#ffe3a8",
      brightBlue: "#aab5ff",
      brightMagenta: "#d9adff",
      brightCyan: "#9af0ff",
      brightWhite: "#ffffff",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.attachCustomKeyEventHandler((e) => !isAppKey(e));

  let closed = false;
  const start = async () => {
    closed = false;
    term.reset();
    safeFit();
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
    if (term.cols > 1 && term.rows > 0) bridge.pty.resize(term.cols, term.rows);
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
    fit: safeFit,
  };
}
