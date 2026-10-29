// Pretend secret values for the tests. They're put together at runtime, so
// no whole key-like string is ever written in this repository (GitHub's push
// protection and secret scanners would rightly complain).
const join = (...parts) => parts.join("");

const STRIPE_TEST = join("sk_", "test_", "51Habc", "DEFghiJKLmno", "PQRstu");
const STRIPE_LIVE = join("sk_", "live_", "51Hxyz", "UVWrstOPQlmn", "IJKfgh");
const AWS_KEY = join("AKIA", "ABCDEFGH", "IJKLMNOP");

const ENVIRONMENTS = {
  dev: [
    ["DATABASE_URL", join("postgres://dev-user:", "SuperSecret", "Dev123", "@localhost:5432/shop")],
    ["STRIPE_SECRET_KEY", STRIPE_TEST],
    ["RETRY_LIMIT", "3"],
    ["DEBUG_PAYMENTS", "true"],
    ["SHARED_SAME", join("same-", "value-", "123")],
  ],
  prod: [
    ["DATABASE_URL", join("postgres://prod-user:", "SuperSecret", "Prod456", "@db.internal:5432/shop")],
    ["STRIPE_SECRET_KEY", STRIPE_LIVE],
    ["SENTRY_DSN", join("https://", "abc123", "def456", "@o1.ingest.sentry.io/42")],
    ["SHARED_SAME", join("same-", "value-", "123")],
    ["LOCKED_KEY", "", true],
  ],
};

/** Every value that must never show up in CLI Village's output (short, harmless ones like "3" left out). */
const SECRET_VALUES = [
  ...Object.values(ENVIRONMENTS).flatMap((list) => list.map(([, value]) => value).filter((v) => v.length >= 8)),
  AWS_KEY,
  "SuperSecret",
];

module.exports = { ENVIRONMENTS, SECRET_VALUES, STRIPE_TEST, STRIPE_LIVE, AWS_KEY };
