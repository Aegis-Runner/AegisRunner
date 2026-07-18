#!/usr/bin/env node
// @aegisrunner/scan-runner — Docker-free web executor for `aegis scan --local`.
//
// Thin launcher: ensure the browser is installed, map flags/env onto the
// executor's env, then run the audited, brain-free executor bundle. Playwright is
// a dependency of THIS package. No Docker.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
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

// Make sure the browser is actually present before we launch it. We do NOT rely
// on Playwright's transitive postinstall — it can be silently skipped (npx cache
// reuse, `--ignore-scripts`, some CI) and then the runner crashes on first scan
// with "Executable doesn't exist … chrome-headless-shell". `playwright install`
// is idempotent and fast when the browser is already there, so running it on
// every start is safe. Opt out with AEGIS_SKIP_BROWSER_INSTALL=1.
ensureBrowser();

// Running the bundle starts the outbound-only claim+drive loop. Playwright
// resolves from this package's node_modules.
await import('./runnerExecutor.mjs');

function ensureBrowser() {
  if (process.env.AEGIS_SKIP_BROWSER_INSTALL || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) return;
  try {
    // Use THIS package's bundled Playwright (not a global/npx one) so the browser
    // revision matches the executor exactly.
    const pkgPath = require.resolve('playwright/package.json');
    const bin = require(pkgPath).bin;
    const cliRel = typeof bin === 'string' ? bin : (bin && (bin.playwright || bin['playwright-core']));
    if (!cliRel) throw new Error('Playwright CLI not found in the bundled install');
    const cli = path.join(path.dirname(pkgPath), cliRel);
    console.log('Checking the local browser (first run downloads Chromium ~150MB, then cached)…');
    const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('[aegis] browser install did not finish cleanly. If a scan fails to launch, run once:  npx playwright install chromium');
    }
  } catch (e) {
    console.error(`[aegis] could not auto-install the browser (${e.message}). Install it once with:  npx playwright install chromium`);
  }
}
