// The beginner explainer: one plain-English line about what a real command
// does, so the app teaches as it runs. Views show it under the command
// (unless you ask for --compact or --quiet).
//
// Like the other files in src/events, this has no Node-only imports: the
// browser village uses it too. It only matches text and returns fixed
// sentences, so nothing from an event is ever repeated back here.

import type { TaskKind } from "./types.js";

// First match wins, so put the more specific patterns first.
// Keep each line to 72 characters or less, so it fits an 80-column terminal.
const COMMANDS: readonly (readonly [RegExp, string])[] = [
  [/^infisical\s+export\b.*--output-file/, "Infisical writes your secrets into that file. It has to stay out of git."],
  [/^infisical\s+export\b/, "Asks Infisical for one environment's secrets. You only see the names."],
  [/^infisical\s+run\b/, "Starts the program with your secrets set as environment variables."],
  [/^infisical\s+scan\b.*--log-opts/, "Checks the snapshots a push would send for passwords or keys."],
  [/^infisical\s+scan\b/, "Checks your changes for passwords or keys that shouldn't be shared."],
  [/^infisical\s+login\b/, "Signs you in to Infisical (in your browser)."],
  [/^infisical\s+init\b/, "Links this folder to a project in Infisical."],
  [/^infisical\s+secrets\b/, "Works with the secrets stored in Infisical."],
  [/^git\s+status\b/, "Lists the files you've changed since your last snapshot."],
  [/^git\s+add\b/, "Picks which changes go into the next snapshot."],
  [/^git\s+commit\b.*--amend/, "Redoes the last snapshot, replacing it with a fixed one."],
  [/^git\s+commit\b/, "Saves a snapshot of your work, with a note about what changed."],
  [/^git\s+push\b/, "Sends your snapshots to GitHub, so they're backed up and shared."],
  [/^git\s+pull\b/, "Brings in the newest snapshots from GitHub."],
  [/^git\s+(checkout\s+-b|switch\s+-c)\b/, "Starts a branch: a separate line of work, so main stays safe."],
  [/^git\s+(checkout|switch)\b/, "Moves to another branch (line of work)."],
  [/^git\s+diff\b/, "Shows exactly what changed, line by line."],
  [/^git\s+log\b/, "Lists your past snapshots."],
  [/^git\s+clone\b/, "Downloads a copy of a project from GitHub."],
  [/^gh\s+pr\s+create\b/, "Opens a pull request: asks to add your branch's changes to main."],
  [/^gh\s+pr\s+merge\b/, "Adds a pull request's changes to main."],
  [/^gh\s+pr\s+review\b/, "Reviews a pull request: approves it, or asks for changes."],
  [/^gh\s+pr\s+(view|diff|checkout|checks)\b/, "Opens a pull request to read its changes before it's added."],
  [/^gh\s+release\s+create\b/, "Publishes a release on GitHub: a named version people can download."],
  [
    /^(npx\s+)?(vercel|netlify)\b.*\bdeploy\b|^(npx\s+)?vercel\s+--prod\b|^(fly|flyctl)\s+deploy\b|^railway\s+up\b|^kubectl\s+(apply|rollout)\b|^helm\s+(upgrade|install)\b|^(npm|pnpm|yarn|bun)\s+run\s+deploy\b/,
    "Sends a new version of your app out to the servers people use.",
  ],
  [
    /^(npx\s+)?prisma\s+(migrate|db\s+push)\b|^(npx\s+)?drizzle-kit\s+(migrate|push)\b|^(npx\s+)?(knex|sequelize)\b.*\bmigrat|^(bin\/)?rails\s+db:migrate\b|^alembic\s+upgrade\b|^python3?\s+manage\.py\s+migrate\b/,
    "Changes the database's layout (a migration) to match the code.",
  ],
  [/^(pg_dump|mysqldump|mongodump)\b/, "Makes a backup copy of the database."],
  [/^(psql|mysql|sqlite3|mongosh|redis-cli)\b/, "Opens the database, to look at or change the data in it."],
  [
    /^(kubectl|docker)\s+logs\b|^(fly|flyctl|heroku|vercel)\s+logs\b|^tail\s+-[fF]\b|^journalctl\b/,
    "Shows the newest lines of a log: the app's diary of what it did.",
  ],
  [
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|^(npx\s+)?(vitest|jest|mocha)\b|^node\s+--test\b|^(python3?\s+-m\s+)?pytest\b|^(cargo|go)\s+test\b/,
    "Runs the tests: small programs that check your code still works.",
  ],
  [/^(npm|pnpm|yarn|bun)\s+(install|i|ci|add)\b/, "Downloads the packages (code by other people) this project uses."],
  [/^(npm|pnpm|yarn|bun)\s+run\s+build\b/, "Turns the source code into the program that actually runs."],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|typecheck)\b/, "Checks the code for mistakes without running it."],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(start|dev)\b/, "Starts the app."],
];

/** Used when there's no command, or one we don't know. */
const KINDS: Record<TaskKind, string> = {
  coordinate: "The coordinator splits the work into jobs and hands them to robots.",
  secrets: "Secrets (passwords and keys) come from Infisical. Only names are shown.",
  research: "Gathering information from the internet.",
  code: "Writing or changing the project's code.",
  test: "Tests are small programs that check your code still works.",
  git: "git keeps snapshots of your work, and GitHub keeps a copy online.",
  scan: "Checks that no password or key slipped in before your work is shared.",
  deploy: "Deploying puts a new version of your app where people can use it.",
  data: "Working with the database, where your app keeps its data.",
  review: "Reading changes and saying what to fix before they're added.",
  monitor: "Watching logs and alerts, to spot trouble before people notice.",
};

/** What usually helps when this kind of work runs into a problem. */
const PROBLEMS: Record<TaskKind, string> = {
  coordinate: "The coordinator couldn't plan the work. The message says why.",
  secrets: "Infisical couldn't do that. Run cli-village doctor to check your setup.",
  research: "The research didn't work out. The robot can try again.",
  code: "The code change didn't work. Fix what the message says, then try again.",
  test: "A test found a problem. Fix the code, then run the tests again.",
  git: "git couldn't finish. Usually it's a login, or changes that clash.",
  scan: "Move that secret into Infisical, then save a new snapshot.",
  deploy: "The deploy didn't finish. Check its log, fix the cause, then retry.",
  data: "The database step failed. Read the message before running it again.",
  review: "The review asked for changes. Make them, then ask for another look.",
  monitor: "Something needs a look. The message says what the alert is about.",
};

/** What a real command does, in plain English, or undefined if we don't know it. */
export function explainCommand(command: string): string | undefined {
  const text = command.trim().replace(/^npx\s+(?=infisical\b)/, "");
  return COMMANDS.find(([pattern]) => pattern.test(text))?.[1];
}

/** The explainer line for a task: about its command if we know it, otherwise about the kind of work. */
export function explainTask(kind: TaskKind, command?: string): string {
  return (command && explainCommand(command)) || KINDS[kind];
}

/** The explainer line for a problem: what usually helps. */
export function explainProblem(kind: TaskKind): string {
  return PROBLEMS[kind];
}

/** `git commit -m "message"`, for showing what a commit event means. */
export function commitCommand(message: string): string {
  return `git commit -m "${message.replace(/["\\$`]/g, "\\$&")}"`;
}

/** Words beginners will meet, for the ? help. Short enough to fit beside each other. */
export const GLOSSARY: readonly { word: string; meaning: string }[] = [
  { word: "secret", meaning: "a password or key your app needs" },
  { word: "environment", meaning: "one set of secrets, like dev or prod" },
  { word: "commit", meaning: "a saved snapshot of your work" },
  { word: "push", meaning: "sending your commits to GitHub" },
  { word: "secret scan", meaning: "checks no secret slipped into a commit" },
];

/** What a live view suggests before anything has happened. */
export interface WaitingHint {
  subtitle: string;
  command: string;
  explain: string;
}

/** The suggestion both views show in live mode, until the first work arrives. */
export const WAITING: WaitingHint = {
  subtitle: "Waiting for work. In another terminal, try:",
  command: 'cli-village status · test · commit -m "..." · push',
  explain: "AI agents can report their work too: cli-village emit (docs/EVENTS.md)",
};

/** The expert flags, for the ? help, so they're easy to find. */
export const EXPERT_FLAGS = "--compact, --quiet, --json, --no-animation";
