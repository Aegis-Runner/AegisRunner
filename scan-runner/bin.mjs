#!/usr/bin/env node
// @aegisrunner/scan-runner — Docker-free web executor for `aegis scan --local`.
//
// Thin launcher: map flags/env onto the executor's env, then run the audited,
// brain-free executor bundle. Playwright is a dependency of THIS package, so
// `npm install` pulls it (and its postinstall downloads Chromium). No Docker.
const args = process.argv.slice(2);
const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);

if (has('--help') || has('-h')) {
  console.log(`aegis-scan-runner — Docker-free browser executor for \`aegis scan --local\`.

Runs a local headless Chromium that claims scan jobs from AegisRunner over
OUTBOUND HTTPS and drives them against your app. Your app, its traffic, and
credentials never leave your machine; only the findings come back.

Usage:
  npx @aegisrunner/scan-runner --token <ci-token> [--api <base>]

  --token <t>   Project CI token (or env AEGIS_TOKEN). Manage → CI/CD.
  --api <base>  API base (or env AEGIS_API; default https://app.aegisrunner.com/api/v1)

Authed scans: set AEGIS_USERNAME / AEGIS_PASSWORD in the environment (never on
the command line) — the runner logs in locally; credentials stay on your machine.

Then, from anywhere:  aegis scan --local --url http://localhost:3000

First run downloads Chromium (~150MB) via Playwright, then it's cached.
Press Ctrl-C to stop.`);
  process.exit(0);
}

const token = val('--token') || process.env.AEGIS_TOKEN;
if (!token) {
  console.error('Missing token: pass --token or set AEGIS_TOKEN (your project CI token from Manage → CI/CD).');
  process.exit(1);
}
process.env.AEGIS_TOKEN = token;
const api = val('--api') || process.env.AEGIS_API;
if (api) process.env.AEGIS_API = api;
// Credentials for authed scans come ONLY from the environment (never argv, to
// avoid leaking via the process list). AEGIS_USERNAME / AEGIS_PASSWORD are read
// by the executor directly.

// Running the bundle starts the outbound-only claim+drive loop. Playwright
// resolves from this package's node_modules.
await import('./runnerExecutor.mjs');
