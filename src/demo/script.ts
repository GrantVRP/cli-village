// The demo: pretend robots act out a day in the village.
// Nothing real runs. The commands are shown so beginners can see what the
// real thing would type.
//
// Odd rounds are a normal day. Even rounds show the secret-scan checkpoint
// catching a leaked key before it reaches GitHub.

import type { Building, EventInput } from "../events/types.js";

export interface DemoStep {
  /** How long to wait before this event, in milliseconds (at speed 1). */
  wait: number;
  /** null means "just wait". */
  event: EventInput | null;
}

export const DEMO_AGENTS = ["Mayor", "Bolt", "Pip", "Rivet", "Sprocket"] as const;

const DEV_KEYS = [
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REDIS_URL",
  "SENTRY_DSN",
  "JWT_SIGNING_KEY",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "FEATURE_FLAGS",
  "LOG_LEVEL",
];

/** Small helper so the script below reads like a story. */
function storyboard(round: number) {
  const steps: DemoStep[] = [];
  const task = (name: string) => `r${round}-${name}`;
  const at = (wait: number, event: EventInput) => steps.push({ wait, event });
  const walk = (wait: number, agent: string, to: Building) => at(wait, { type: "move", agent, to });
  const pause = (wait: number) => steps.push({ wait, event: null });
  return { steps, task, at, walk, pause };
}

function normalDay(round: number): DemoStep[] {
  const { steps, task, at, walk, pause } = storyboard(round);

  // The Mayor hands out today's jobs.
  walk(600, "Mayor", "townhall");
  at(1200, { type: "start", agent: "Mayor", task: task("plan"), kind: "coordinate", title: "Planning today's work" });
  at(1500, { type: "progress", agent: "Mayor", task: task("plan"), percent: 50, message: "Handing out 4 jobs" });
  at(1200, {
    type: "done",
    agent: "Mayor",
    task: task("plan"),
    message: "Jobs: secrets → Bolt, research → Pip, code → Rivet, tests → Sprocket",
    count: 4,
  });

  // Everyone heads to work.
  walk(400, "Bolt", "vault");
  walk(300, "Pip", "library");
  walk(300, "Rivet", "workshop");

  at(1800, {
    type: "start",
    agent: "Bolt",
    task: task("fetch"),
    kind: "secrets",
    title: "Fetching dev secrets",
    command: "infisical export --env=dev --format=json",
  });
  at(600, {
    type: "start",
    agent: "Pip",
    task: task("research"),
    kind: "research",
    title: "Researching: how to retry failed payments",
  });
  at(600, { type: "start", agent: "Rivet", task: task("code"), kind: "code", title: "Editing src/payments.ts" });
  at(1200, { type: "progress", agent: "Bolt", task: task("fetch"), percent: 60, message: "Reading secret names (values stay hidden)" });
  at(900, { type: "progress", agent: "Rivet", task: task("code"), percent: 30, message: "Adding a retry loop" });
  at(900, {
    type: "done",
    agent: "Bolt",
    task: task("fetch"),
    message: `Loaded ${DEV_KEYS.length} secrets`,
    keys: DEV_KEYS,
    count: DEV_KEYS.length,
  });
  at(900, { type: "progress", agent: "Pip", task: task("research"), percent: 50, message: "Reading 3 sources" });
  at(1000, { type: "progress", agent: "Rivet", task: task("code"), percent: 70, message: "Writing a test for retries" });
  at(1200, { type: "done", agent: "Pip", task: task("research"), message: "Saved 3 notes for Rivet", count: 3 });
  walk(300, "Pip", "home");
  at(1000, { type: "done", agent: "Rivet", task: task("code"), message: "Changed 2 files", count: 2 });

  // Tests: one fails, Rivet fixes it, then everything passes.
  walk(400, "Sprocket", "lab");
  at(1500, {
    type: "start",
    agent: "Sprocket",
    task: task("test"),
    kind: "test",
    title: "Running the tests",
    command: "npm test",
  });
  at(1200, { type: "progress", agent: "Sprocket", task: task("test"), percent: 45, message: "18 of 40 tests passed" });
  at(1200, { type: "fail", agent: "Sprocket", task: task("test"), message: "1 test failed: payments › retries stop after 3 tries" });
  at(900, { type: "start", agent: "Rivet", task: task("fix"), kind: "code", title: "Fixing the failing test" });
  at(1500, { type: "done", agent: "Rivet", task: task("fix"), message: "Fixed an off-by-one in the retry counter", count: 1 });
  at(600, {
    type: "start",
    agent: "Sprocket",
    task: task("retest"),
    kind: "test",
    title: "Running the tests again",
    command: "npm test",
  });
  at(1500, { type: "progress", agent: "Sprocket", task: task("retest"), percent: 80, message: "32 of 40 tests passed" });
  at(1000, { type: "done", agent: "Sprocket", task: task("retest"), message: "All 40 tests passed", count: 40 });
  walk(300, "Sprocket", "home");

  // Commit → checkpoint scan → push.
  walk(300, "Rivet", "harbor"); // commits are packed into crates at the harbor
  at(800, {
    type: "start",
    agent: "Rivet",
    task: task("commit"),
    kind: "git",
    title: "Saving a snapshot of your work",
    command: 'git commit -m "Retry failed payments"',
  });
  at(900, { type: "commit", agent: "Rivet", message: "Retry failed payments", sha: "a1b2c3d", files: 2 });
  at(200, { type: "done", agent: "Rivet", task: task("commit"), message: "Snapshot saved and packed in a crate" });
  at(1500, {
    type: "start",
    agent: "Rivet",
    task: task("scan"),
    kind: "git",
    title: "Checkpoint: scanning the crate for leaked secrets",
    command: 'infisical scan --log-opts="origin/main..HEAD" --redact',
  });
  at(1800, { type: "done", agent: "Rivet", task: task("scan"), message: "No leaks found. The gate opens." });
  at(800, {
    type: "start",
    agent: "Rivet",
    task: task("push"),
    kind: "git",
    title: "Sending your work to GitHub",
    command: "git push origin main",
  });
  at(1500, { type: "push", agent: "Rivet", remote: "origin", branch: "main", commits: 1 });
  at(300, { type: "done", agent: "Rivet", task: task("push"), message: "Your work is safe on GitHub", count: 1 });

  // Home time.
  walk(1500, "Rivet", "home");
  walk(300, "Bolt", "home");
  walk(300, "Mayor", "home");
  pause(3000); // a quiet moment before the next round
  return steps;
}

function leakCaughtDay(round: number): DemoStep[] {
  const { steps, task, at, walk, pause } = storyboard(round);

  walk(600, "Mayor", "townhall");
  at(1000, { type: "start", agent: "Mayor", task: task("plan"), kind: "coordinate", title: "Planning the next job" });
  at(1400, { type: "done", agent: "Mayor", task: task("plan"), message: "Jobs: config → Rivet, secrets check → Bolt", count: 2 });

  walk(400, "Rivet", "workshop");
  walk(300, "Bolt", "vault");
  at(1500, { type: "start", agent: "Rivet", task: task("code"), kind: "code", title: "Editing config/payments.ts" });
  at(600, {
    type: "start",
    agent: "Bolt",
    task: task("diff"),
    kind: "secrets",
    title: "Comparing dev and prod secrets (names only)",
    command: "infisical export --env=prod --format=json",
  });
  at(1400, { type: "progress", agent: "Rivet", task: task("code"), percent: 60, message: "Adding the new payment settings" });
  at(1200, {
    type: "done",
    agent: "Bolt",
    task: task("diff"),
    message: "2 keys are in dev but missing from prod",
    keys: ["RETRY_LIMIT", "DEBUG_PAYMENTS"],
    count: 2,
  });
  at(1200, { type: "done", agent: "Rivet", task: task("code"), message: "Changed 1 file", count: 1 });

  walk(300, "Rivet", "harbor"); // commits are packed into crates at the harbor
  at(800, {
    type: "start",
    agent: "Rivet",
    task: task("commit"),
    kind: "git",
    title: "Saving a snapshot of your work",
    command: 'git commit -m "Update payment config"',
  });
  at(900, { type: "commit", agent: "Rivet", message: "Update payment config", sha: "b4e5f6a", files: 1 });
  at(200, { type: "done", agent: "Rivet", task: task("commit"), message: "Snapshot saved and packed in a crate" });

  // The checkpoint catches a key that was pasted straight into the code.
  at(1500, {
    type: "start",
    agent: "Rivet",
    task: task("scan"),
    kind: "git",
    title: "Checkpoint: scanning the crate for leaked secrets",
    command: 'infisical scan --log-opts="origin/main..HEAD" --redact',
  });
  at(1800, {
    type: "fail",
    agent: "Rivet",
    task: task("scan"),
    message: "Stopped at the gate: 1 possible secret in config/payments.ts line 12 (value hidden). Nothing was pushed.",
  });

  // Fix it properly: move the key into Infisical and redo the snapshot.
  walk(1500, "Rivet", "workshop");
  at(1200, {
    type: "start",
    agent: "Rivet",
    task: task("fix"),
    kind: "code",
    title: "Moving the key into the Vault and out of the code",
  });
  at(1500, { type: "done", agent: "Rivet", task: task("fix"), message: "The code now reads STRIPE_SECRET_KEY from Infisical", keys: ["STRIPE_SECRET_KEY"] });
  walk(300, "Rivet", "harbor");
  at(800, {
    type: "start",
    agent: "Rivet",
    task: task("amend"),
    kind: "git",
    title: "Fixing the snapshot so the key is never saved in history",
    command: "git commit --amend --no-edit",
  });
  at(900, { type: "commit", agent: "Rivet", message: "Update payment config", sha: "c7d8e9f", files: 1 });
  at(200, { type: "done", agent: "Rivet", task: task("amend"), message: "Clean snapshot packed in a new crate" });
  at(1500, {
    type: "start",
    agent: "Rivet",
    task: task("rescan"),
    kind: "git",
    title: "Checkpoint: scanning the new crate",
    command: 'infisical scan --log-opts="origin/main..HEAD" --redact',
  });
  at(1800, { type: "done", agent: "Rivet", task: task("rescan"), message: "No leaks found. The gate opens." });
  at(800, {
    type: "start",
    agent: "Rivet",
    task: task("push"),
    kind: "git",
    title: "Sending your work to GitHub",
    command: "git push origin main",
  });
  at(1500, { type: "push", agent: "Rivet", remote: "origin", branch: "main", commits: 1 });
  at(300, { type: "done", agent: "Rivet", task: task("push"), message: "Your work is safe on GitHub", count: 1 });

  walk(1500, "Rivet", "home");
  walk(300, "Bolt", "home");
  walk(300, "Mayor", "home");
  pause(3000);
  return steps;
}

/** The events for one round of the demo. */
export function demoRound(round: number): DemoStep[] {
  return round % 2 === 1 ? normalDay(round) : leakCaughtDay(round);
}
