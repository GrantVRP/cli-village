// Safety net: hide anything that looks like a token before we show text
// that came from another program. Secret values must never be shown.
// No Node-only imports: the browser village may use this too.

export const HIDDEN = "[hidden]";

const TOKEN_PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT access tokens
  /\bst\.[\w.-]{16,}/g, // Infisical service tokens
];

// Any other long run of key-like characters that mixes letters and digits,
// e.g. "sk_live_51Habc..." or base64. Long file paths without digits are left alone.
const LONG_KEY = /[A-Za-z0-9+/=_-]{32,}/g;
const looksLikeKey = (run: string) => /\d/.test(run) && /[A-Za-z]/.test(run);

export function maskTokens(text: string): string {
  let out = text;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, HIDDEN);
  return out.replace(LONG_KEY, (run) => (looksLikeKey(run) ? HIDDEN : run));
}
