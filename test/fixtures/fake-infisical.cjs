// A stand-in for the Infisical CLI, so the tests run without an Infisical
// account or the real program. It copies the behavior CLI Village relies on:
// --version, login status --json, export, run, and scan (a tiny gitleaks).
//
// FAKE_MODE picks a situation: user (default), machine, expired, none, old,
// notlogged, noproject, network, leaky, garbage, scanerror, scanold.
// The scan report always holds the secret itself, like the real Infisical's
// (its --redact only covers what it prints). FAKE_SCAN=unredacted also prints
// it, like a scanner ignoring --redact: CLI Village must never show it either
// way. FAKE_LOG=<file> records each call.
// FAKE_SCAN_TOUCH=<file> edits that file during a scan (like an editor saving).

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { ENVIRONMENTS } = require("./secrets.cjs");

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE || "user";
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(argv)}\n`);
const flag = (name, fallback) => {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (argv.join(" ") === "--version") {
  console.log("infisical version 0.44.10");
  process.exit(0);
}

if (argv.join(" ") === "login status --json") {
  if (mode === "old") fail('Error: unknown command "status" for "infisical login"');
  if (mode === "none") {
    console.log('{"sessions":[]}');
    process.exit(1);
  }
  const sessions = {
    expired: { principalType: "user", status: "expired", email: "dev@example.com", verification: { state: "skipped", reason: "locally expired" } },
    machine: { principalType: "machine-identity", status: "authenticated", identity: { name: "ci-bot" }, tokenSource: "INFISICAL_TOKEN environment variable", verification: { state: "verified" } },
  };
  const session = sessions[mode] ?? { principalType: "user", status: "authenticated", email: "dev@example.com", organizationName: "Test Org", verification: { state: "verified" } };
  console.log(JSON.stringify({ sessions: [session] }, null, 2));
  process.exit(mode === "expired" ? 1 : 0);
}

if (argv[0] === "scan") {
  if (mode === "scanerror") fail("Error: failed to open git repository: fatal: something broke");
  if (mode === "scanold") fail("Error: unknown flag: --exit-code");
  const staged = argv[1] === "git-changes";
  if (staged && !argv.includes("--staged")) fail("fake: expected --staged");
  const logOpts = flag("log-opts");
  const gitArgs = staged ? ["diff", "--cached", "-U0", "--no-color"] : ["log", "-p", "-U0", "--no-color", ...(logOpts ? logOpts.split(" ") : ["--all"])];
  const diff = execFileSync("git", gitArgs, { encoding: "utf8" });
  const RULES = [
    ["stripe-access-token", "Stripe Access Token", /sk_(live|test)_[A-Za-z0-9]{10,}/],
    ["aws-access-token", "AWS Access Key", /AKIA[0-9A-Z]{16}/],
  ];
  let ignore = [];
  try {
    ignore = fs.readFileSync(".infisicalignore", "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {}
  const findings = [];
  let commit = "";
  let file = "";
  let line = 0;
  for (const l of diff.split("\n")) {
    let m;
    if ((m = /^commit ([0-9a-f]{40})/.exec(l))) commit = m[1];
    else if ((m = /^\+\+\+ b\/(.*)$/.exec(l))) file = m[1];
    else if ((m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l))) line = Number(m[1]);
    else if (l.startsWith("+") && !l.startsWith("+++")) {
      for (const [id, description, pattern] of RULES) {
        const hit = pattern.exec(l);
        if (!hit) continue;
        const fingerprint = commit ? `${commit}:${file}:${id}:${line}` : `${file}:${id}:${line}`;
        if (ignore.includes(fingerprint)) continue;
        // Like the real Infisical (checked with 0.45.13): the report FILE holds the secret itself, even
        // with --redact (that flag only covers what it prints). Same fields as the real report, too.
        const secret = hit[0];
        const git = commit ? { "git.sha": commit, "git.message": "Fake commit", "git.author_name": "Fake", "git.author_email": "fake@example.com" } : { "git.sha": "", "git.message": "" };
        findings.push({ RuleID: id, Description: description, StartLine: line, EndLine: line, StartColumn: 1, EndColumn: 2, Match: `key = "${secret}"`, Secret: secret, Attributes: { confidence: "high", ...git, path: file, resource: "git.patch_content" }, Tags: [], Fingerprint: fingerprint, File: file, SymlinkFile: "", Commit: commit, Entropy: 4.2, Author: commit ? "Fake" : "", Email: commit ? "fake@example.com" : "", Date: commit ? "2026-01-01T00:00:00Z" : "", Message: commit ? "Fake commit" : "" });
      }
      line++;
    }
  }
  if (process.env.FAKE_SCAN_TOUCH) fs.appendFileSync(process.env.FAKE_SCAN_TOUCH, "edited during the scan\n");
  const report = flag("report-path");
  if (report) fs.writeFileSync(report, process.env.FAKE_SCAN === "badreport" ? "not json" : JSON.stringify(findings, null, 1));
  console.error(findings.length ? `WRN leaks found: ${findings.length}` : "INF no leaks found");
  // A scanner that ignores --redact and prints the secret: CLI Village must still never show it.
  if ((process.env.FAKE_SCAN === "unredacted" || !argv.includes("--redact")) && findings.length) console.log(`Finding: ${findings[0].Secret}`);
  process.exit(findings.length ? Number(flag("exit-code", "1")) : 0);
}

// What the real Infisical (0.45.13) says when nobody is logged in and it can't ask (no keyboard).
if (mode === "notlogged") fail("INF No valid login session found, triggering login flow\nerror: ^D\nUnable to parse domain url\nFailed to automatically trigger login flow. Please run [infisical login] manually to login.");
if (mode === "noproject") fail("Please either run infisical init to connect to a project or pass in project id with --projectId flag");
if (mode === "network") fail('error: Get "https://app.infisical.com/api/v3/secrets": dial tcp: lookup app.infisical.com: no such host');
if (mode === "leaky") fail(`error: unexpected response, value=${ENVIRONMENTS.dev[1][1]} password: hunter2hunter2`);

const env = flag("env", "dev");
const secrets = ENVIRONMENTS[env];
if (!secrets) fail(`error: environment slug '${env}' not found in this project`);

if (argv[0] === "export") {
  const format = flag("format", "dotenv");
  const outFile = flag("output-file", "");
  let text =
    format === "json"
      ? JSON.stringify(secrets.map(([key, value, hidden]) => ({ key, workspace: "ws1", value, type: "shared", secretPath: "/", secretValueHidden: Boolean(hidden) })))
      : `${secrets.map(([k, v]) => `${k}='${v}'`).join("\n")}\n`;
  if (mode === "garbage") text = "<html>oops</html>";
  if (outFile) {
    fs.writeFileSync(outFile, text, { mode: 0o644 });
    console.error(`Successfully exported secrets to: ${outFile}`);
    process.exit(0);
  }
  process.stdout.write(text);
  process.exit(0);
}

if (argv[0] === "run") {
  const command = argv.slice(argv.indexOf("--") + 1);
  // Like the real CLI: an info line, hidden by --log-level=warn.
  if (["trace", "debug", "info"].includes(flag("log-level", "info"))) console.error(`Injecting ${secrets.length} Infisical secrets into your application process`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: { ...process.env, ...Object.fromEntries(secrets.map(([k, v]) => [k, v])) } });
  process.exit(result.status ?? 1);
}

process.exit(2);
