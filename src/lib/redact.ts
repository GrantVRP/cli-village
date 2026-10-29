// Safety net: hide anything that looks like a token before we show text
// that came from another program. Secret values must never be shown.
// No Node-only imports: the browser village may use this too.

export const HIDDEN = "[hidden]";

const TOKEN_PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT access tokens
  /\bst\.[\w.-]{16,}/g, // Infisical service tokens
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // AWS access key ids
  // Well-known prefixes (GitHub, GitLab, Slack, Stripe, npm), even when shorter than LONG_KEY.
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|glpat-[\w-]{16,}|xox[abprs]-[\w-]{10,}|[sr]k_(?:live|test)_\w{10,}|npm_\w{20,})/g,
];

// A login inside an address, like https://name:password@host or https://TOKEN@host.
const URL_LOGIN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
// HTTP logins: "Bearer xyz", "Basic xyz", "token xyz", "Authorization: xyz". Only values
// that look like keys (a digit, or 20+ characters) are hidden, so plain words stay readable.
const AUTH_VALUE = /\b(Bearer\s+|Basic\s+|token\s+|Authorization:\s*)([A-Za-z0-9._~+/=-]{8,})/gi;

// Any other long run of key-like characters that mixes letters and digits,
// e.g. "sk_live_51Habc..." or base64. Long file paths without digits are left alone.
const LONG_KEY = /[A-Za-z0-9+/=_-]{32,}/g;
// Words joined by - _ or / (like "docs/getting-started-with-webhooks-v2") are a readable name or
// path, not a key. (A UUID-style key has digits in most parts, so it's still hidden.)
const isWordSlug = (run: string) => {
  const parts = run.split(/[-_/]/).filter(Boolean);
  return parts.length >= 4 && parts.filter((p) => /^[A-Za-z]+$/.test(p)).length / parts.length >= 0.75;
};
const looksLikeKey = (run: string) => /\d/.test(run) && /[A-Za-z]/.test(run) && !isWordSlug(run);

export function maskTokens(text: string): string {
  let out = text.replace(URL_LOGIN, `$1${HIDDEN}@`);
  out = out.replace(AUTH_VALUE, (all, lead: string, value: string) => (/\d/.test(value) || value.length >= 20 ? `${lead}${HIDDEN}` : all));
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, HIDDEN);
  return out.replace(LONG_KEY, (run) => (looksLikeKey(run) ? HIDDEN : run));
}
