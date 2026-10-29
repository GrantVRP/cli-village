// Safety net: hide anything that looks like a token before we show text
// that came from another program. Secret values must never be shown.
// No Node-only imports: the browser village may use this too.

export const HIDDEN = "[hidden]";

const TOKEN_PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT access tokens
  /\bst\.[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, // Infisical service tokens (st.<id>.<key>.<key>)
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // AWS access key ids
  // Well-known prefixes (GitHub, GitLab, Slack, Stripe, npm), even when shorter than LONG_KEY.
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|glpat-[\w-]{16,}|xox[abprs]-[\w-]{10,}|[sr]k_(?:live|test)_\w{10,}|npm_\w{20,})/g,
];

/** A word, a word with a number on the end, or a number: "started", "python3", "v2", "2024". */
const isWordy = (part: string) => /^(?:[A-Za-z]+\d*|\d+)$/.test(part);
const mixesLettersAndDigits = (text: string) => /\d/.test(text) && /[A-Za-z]/.test(text);

/** Capitals scattered through lowercase, like base64 ("dXNlcjpwYXNz"), unlike a word ("Configuration"). */
const mixedCase = (value: string) => /[A-Z].*[A-Z]/.test(value.slice(1)) && /[a-z]/.test(value);

/** One piece of something (a path part, a login value) that looks like a key on its own. */
function keyish(value: string): boolean {
  if (/^v?\d+(?:\.\d+)+/.test(value)) return false; // a version, like v2.0.1-beta
  if (mixedCase(value) && value.length >= 12) return true;
  if (isWordy(value)) return false;
  // Otherwise: long, or letters and digits mixed together.
  return value.length >= 20 || (value.length >= 12 && mixesLettersAndDigits(value));
}

/** A part of a web address that looks like a key: 20+ characters that aren't just words and numbers. */
export function looksLikePathKey(part: string): boolean {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(part) || !mixesLettersAndDigits(part)) return false;
  return !part.split(/[-_]/).filter(Boolean).every(isWordy);
}

// A login inside an address, like https://name:password@host or https://TOKEN@host.
// A plain user name (ssh://git@github.com, s3://bucket@...) is left alone.
const URL_LOGIN = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi;

// HTTP logins: "Bearer xyz", "Basic xyz", "token xyz", "Authorization: xyz". Only a value that
// looks like a key is hidden, so plain words stay readable. Found one lead at a time (not one
// match covering lead and value), so "Bearer Authorization: xyz" still finds the second lead.
const AUTH_LEAD = /\b(?:Bearer\s+|Basic\s+|token\s+|Authorization:\s*)/gi;
const AUTH_VALUE = /^[A-Za-z0-9._~+/=-]{8,}/;

function hideAuthValues(text: string): string {
  let out = "";
  let from = 0;
  for (const lead of text.matchAll(AUTH_LEAD)) {
    if (lead.index < from) continue; // inside a value already hidden
    const start = lead.index + lead[0].length;
    const value = AUTH_VALUE.exec(text.slice(start))?.[0];
    if (!value || !keyish(value)) continue;
    out += `${text.slice(from, start)}${HIDDEN}`;
    from = start + value.length;
  }
  return out + text.slice(from);
}

// Any other long run of key-like characters that mixes letters and digits,
// e.g. "sk_live_51Habc..." or base64. Long file paths without digits are left alone.
const LONG_KEY = /[A-Za-z0-9+/=_-]{32,}/g;

/**
 * Words joined by - _ or / (like "docs/getting-started-with-webhooks-v2") are a
 * readable name or path, not one key. (A UUID-style key has digits all through
 * its parts, so it doesn't count.)
 */
const isWordSlug = (run: string) => {
  const parts = run.split(/[-_/]/).filter(Boolean);
  return parts.length >= 4 && parts.filter(isWordy).length / parts.length >= 0.75;
};

function hideLongKey(run: string): string {
  if (!mixesLettersAndDigits(run)) return run;
  if (!isWordSlug(run)) return HIDDEN;
  // A readable name: keep its words, but hide any part that's a key by itself
  // (like the token in /reset/password/confirm/9f8e7d6c5b4a39281706f5e4d3c2b1a0).
  // Digits are needed here, so a file name like UserProfileSettingsPanel stays.
  return run
    .split(/([-_/])/)
    .map((part) => (part.length >= 16 && !isWordy(part) && mixesLettersAndDigits(part) ? HIDDEN : part))
    .join("");
}

export function maskTokens(text: string): string {
  let out = text.replace(URL_LOGIN, (all, scheme: string, login: string) =>
    login.includes(":") || (login.length >= 16 && keyish(login)) ? `${scheme}${HIDDEN}@` : all,
  );
  out = hideAuthValues(out);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, HIDDEN);
  return out.replace(LONG_KEY, hideLongKey);
}
