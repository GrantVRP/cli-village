// Safety net: hide anything that looks like a token before we print text
// that came from another program. Secret values must never be shown.

const TOKEN_PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT access tokens
  /\bst\.[\w.-]{16,}/g, // Infisical service tokens
  /[A-Za-z0-9+/_-]{32,}={0,2}/g, // any other long key-like string
];

export function maskTokens(text: string): string {
  return TOKEN_PATTERNS.reduce((out, pattern) => out.replace(pattern, "[hidden]"), text);
}
