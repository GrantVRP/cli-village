// What the desktop app's window may ask the main process for (see src/app/preload.cjs).

export interface AppInfo {
  mode: string;
  version: string;
  cwd: string;
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
    onData(listener: (data: string) => void): () => void;
    onExit(listener: (code: number) => void): () => void;
  };
  playDemo(): Promise<boolean>;
}

declare global {
  interface Window {
    cliVillage: Bridge;
  }
}
