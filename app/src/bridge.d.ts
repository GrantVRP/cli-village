// What the desktop app's window may ask the main process for (see src/app/preload.cjs).

export interface AppInfo {
  mode: string;
  version: string;
  cwd: string;
  /** False in your home folder (where the installed app starts from a shortcut): open a project. */
  project: boolean;
  /** win32, darwin or linux: the window draws its own title bar except on macOS. */
  platform: string;
  maximized: boolean;
  /** How to run CLI Village in the terminal: `cli-village` if installed, else `node …/cli.js`. */
  cli: string;
  branch: string | null;
  infisical: "linked" | "not linked" | "not installed";
  hub: { role: "host" | "follower"; path: string } | { role: "none"; error: string };
}

export interface Bridge {
  info(): Promise<AppInfo | null>;
  pty: {
    create(cols: number, rows: number): Promise<string | null>;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    /** Tell the shell's side the screen was cleared (on Windows it would otherwise reprint it). */
    clear(): void;
    kill(): void;
    onData(listener: (data: string) => void): () => void;
    onExit(listener: (code: number) => void): () => void;
  };
  playDemo(): Promise<boolean>;
  window(action: WindowAction): void;
  onWindowState(listener: (state: { maximized: boolean; fullScreen: boolean }) => void): () => void;
  edit(action: EditAction): void;
  openFolder(): Promise<string | null>;
  openLink(name: "repo" | "issues" | "infisical" | "releases"): void;
}

export type WindowAction = "minimize" | "maximize" | "close" | "fullscreen" | "zoom-in" | "zoom-out" | "zoom-reset" | "reload" | "devtools";
export type EditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

declare global {
  interface Window {
    cliVillage: Bridge;
  }
}
