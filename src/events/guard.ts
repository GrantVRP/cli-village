// The privacy guard: every piece of text in every event passes through here
// before any view sees it. No Node-only imports (the browser uses events too).

import { HIDDEN, maskTokens } from "../lib/redact.js";

// Values shorter than this are too common ("true", "dev") to hide everywhere.
const MIN_SECRET_LENGTH = 4;

// KEY=value or password: value written in plain text. (An already hidden value stays just
// that, so cleaning twice doesn't swallow the text after it.)
const VALUE = String.raw`("[^"]*"|'[^']*'|\[hidden\]|\S+)`;
const ASSIGNMENT = new RegExp(String.raw`\b([A-Z][A-Z0-9_]{2,})=${VALUE}`, "g");
const NAMED_SECRET = new RegExp(String.raw`\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|(?:access|auth|refresh)[_-]?token|private[_-]?key|client[_-]?secret)(\s*[:=]\s*)${VALUE}`, "gi");
// The same as a command-line flag with a space before its value, like `--password hunter2` or
// `--token abc` (deploy and database tools take these). The value is whatever follows, unless
// it's the next flag. (`--password-stdin` and the like are other flags, so they don't count.)
const SECRET_FLAG = new RegExp(
  String.raw`(--?(?:password|passwd|token|api[_-]?key|access[_-]?key|(?:access|auth|refresh)[_-]?token|private[_-]?key|secret[_-]?key|client[_-]?secret))(\s+)("[^"]*"|'[^']*'|\[hidden\]|[^\s-]\S*)`,
  "gi",
);
// Terminal codes (colors, "clear screen", window titles), then any other control characters.
const ANSI_CODES = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[@-Z\\-_])/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

export class SecretGuard {
  private values = new Set<string>();
  private longestFirst: string[] = [];

  /**
   * Remember secret values seen this session so they're hidden if they ever
   * show up in text. Kept in memory only, never written anywhere.
   */
  remember(values: Iterable<unknown>): void {
    for (const value of values) {
      if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) this.values.add(value);
    }
    // Longest first, so a value that contains another one is hidden whole.
    this.longestFirst = [...this.values].sort((a, b) => b.length - a.length);
  }

  /** Forget every remembered value (e.g. when the session ends). */
  forget(): void {
    this.values.clear();
    this.longestFirst = [];
  }

  /** True if the text contains a remembered secret value. */
  containsSecret(text: string): boolean {
    return this.longestFirst.some((value) => text.includes(value));
  }

  /**
   * Make text safe to show: strip control characters and hide anything secret.
   * Cleaning already cleaned text changes nothing (events are checked again when relayed):
   * it runs again until nothing more changes, which can only ever hide more.
   */
  clean(text: string): string {
    let out = this.cleanOnce(text);
    for (let i = 0; i < 3; i++) {
      const again = this.cleanOnce(out);
      if (again === out) break;
      out = again;
    }
    return out;
  }

  private cleanOnce(text: string): string {
    let out = text.replace(ANSI_CODES, "").replace(CONTROL, " ");
    for (const value of this.longestFirst) out = out.split(value).join(HIDDEN);
    // Tokens first, so "Authorization: Bearer xyz" hides xyz, not just the word Bearer.
    out = maskTokens(out);
    out = out.replace(ASSIGNMENT, `$1=${HIDDEN}`);
    out = out.replace(NAMED_SECRET, `$1$2${HIDDEN}`);
    out = out.replace(SECRET_FLAG, `$1$2${HIDDEN}`);
    return out.replace(/\s+/g, " ").trim();
  }
}

/** The guard shared by the whole app. */
export const secretGuard = new SecretGuard();
