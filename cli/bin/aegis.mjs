#!/usr/bin/env node
// AegisRunner CLI — wraps the CI trigger API (POST /ci/trigger, GET /ci/runs/:id).
// Zero runtime dependencies: node builtins + global fetch (Node 18+).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, UsageError } from '../lib/args.mjs';
import { makeClient, pollRun, ApiError, DEFAULT_API, waitForAppReady } from '../lib/api.mjs';
import { buildJUnit } from '../lib/junit.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const log = (msg) => process.stderr.write(msg + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Flags shared by every command. Token/base can also come from env so CI
// configs keep secrets out of the command line.
const COMMON = {
  token: { type: 'string' },
  api: { type: 'string' },
  help: { type: 'bool' },
};

const COMMANDS = {
  run: {
    spec: {
      ...COMMON,
      suite: { type: 'list' },
      strategy: { type: 'string' },
      browser: { type: 'string' },
      baseUrl: { type: 'string' },
      crawl: { type: 'bool', default: false },
      local: { type: 'bool', default: false },
      wait: { type: 'bool', default: true },
      timeout: { type: 'int', default: 1800 },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
    },
    help: `aegis run — trigger a test run and (by default) wait for the result

Usage: aegis run [options]

  --suite <id>          Suite ID to run (repeatable). Omit to run the latest scan's suites.
  --strategy <name>     Smart selection instead of suites: smoke | recent-failures |
                        high-priority | regression-risk
  --browser <profile>   chromium (default) | firefox | webkit
  --base-url <url>      Base URL override (e.g. a preview deployment)
  --crawl               Scan the site first; tests are generated after the scan
                        (returns immediately — a CI token cannot poll scan progress)
  --local               Run the browser on YOUR machine instead of our cloud —
                        for localhost / private apps the cloud can't reach. Needs a
                        connected runner (start one: aegis scan-runner). Point
                        --base-url at your app (e.g. http://localhost:3000).
  --wait / --no-wait    Poll until the run finishes (default: wait)
  --timeout <sec>       Max seconds to wait (default 1800)
  --format <fmt>        text (default) | json | junit
  --output <file>       Where junit XML is written (default aegis-results/junit.xml)
  --token <t>           CI trigger token (or env AEGIS_TOKEN)
  --api <base>          API base (or env AEGIS_API; default ${DEFAULT_API})

Exit codes: 0 all passed · 1 test failures · 2 error/timeout/cancelled`,
    fn: cmdRun,
  },
  scan: {
    spec: { ...COMMON, url: { type: 'string' }, wait: { type: 'bool', default: false }, watch: { type: 'bool', default: false }, tunnel: { type: 'bool', default: false }, local: { type: 'bool', default: false }, port: { type: 'int' }, host: { type: 'string', default: '127.0.0.1' }, role: { type: 'string' }, username: { type: 'string' }, passwordStdin: { type: 'bool', default: false } },
    help: `aegis scan — trigger a full site scan (tests auto-generate afterwards)

Usage:
  aegis scan [--url <baseUrl>] [--watch]
  aegis scan --tunnel --port <port>          # scan a LOCAL app through a tunnel
  aegis scan --local --url <private-url>     # scan on YOUR self-hosted runner
  aegis scan --username <u> --password-stdin # scan behind a login

  --url <u>          Base URL to scan (default: the project's configured base URL)
  --watch            Stream live progress (crawl + test generation) until it finishes.
                     Exit 0 when done, 1 if the scan failed.
  --tunnel           Open a tunnel to your local app, scan it, and watch — all in ONE
                     process, so the tunnel stays alive for the whole scan. Needs --port.
  --port <p>         Local port your app runs on (with --tunnel, e.g. 3000).
  --local            Run the BROWSER on your own machine instead of our cloud.
                     Your app, its traffic, and credentials stay on your network —
                     only the findings come back. Ideal for firewalled or
                     localhost-only apps the cloud can't reach. Point --url at the
                     private target (e.g. http://localhost:3000). Needs a runner
                     connected — start one (no Docker) with:  aegis scan-runner
                     (or the container: docker run aegisrunner1/scan-runner).

Sign in during the scan (so pages behind a login get tested):
  --username <u>     Login identity — email, username, phone, whatever the form uses.
                     The scanner maps it onto the form's fields for you (no field
                     names to configure). Pair with a password (below).
  --password-stdin   Read the password from stdin (recommended — keeps it out of your
                     shell history and 'ps'):  printf %s "$PW" | aegis scan --username me@x.com --password-stdin
                     Or set the AEGIS_PASSWORD env var instead of this flag.
  --role <name>      Scan as a saved role (Admin / Buyer / …). Uses that role's stored
                     login — no --username/password needed — and tags the scan + its
                     tests with the role.

Without --watch/--tunnel the scan fires and returns; follow it on the dashboard.`,
    fn: cmdScan,
  },
  'mobile-scan': {
    spec: {
      ...COMMON,
      app: { type: 'string' },
      appName: { type: 'string' },
      platform: { type: 'string' },
      role: { type: 'string' },
      local: { type: 'bool', default: false },
      package: { type: 'string' },
    },
    help: `aegis mobile-scan — start an on-device mobile app scan (fire-and-forget)

Usage: aegis mobile-scan [--app <tb://…|apk-url>] [--platform android|ios] [--role <r>]
       aegis mobile-scan --local --package <app.package.id>

  --app <ref>       Device-cloud ref or APK URL (default: the project's last scanned app)
  --app-name <n>    Display name for the generated suites
  --platform <p>    android | ios
  --role <r>        Explore the app as this role (uses that role's saved login)
  --local           Drive YOUR OWN local device (see 'aegis mobile-runner'). The
                    APK + device never leave your machine; the AI brain stays in
                    the cloud. Requires a running 'aegis mobile-runner'.
  --package <id>    App package id for --local (e.g. com.acme.app)`,
    fn: cmdMobileScan,
  },
  'mobile-runner': {
    spec: { ...COMMON, apk: { type: 'string' }, appium: { type: 'string' } },
    help: `aegis mobile-runner — run the device side of a local mobile scan on your box.

Claims mobile-scan jobs from AegisRunner over an outbound-only HTTPS connection
and replays the cloud explorer's device actions against a LOCAL Appium server —
so your APK and the device never leave your machine. Pair with:
  aegis mobile-scan --local --package <id>

Usage: aegis mobile-runner --apk ./app.apk [--appium http://localhost:4723] [--token <t>]

  --apk <path>     Path to the .apk to install on the local device (required)
  --appium <url>   Local Appium base URL (default http://localhost:4723)
  --token <t>      CI trigger token (or env AEGIS_TOKEN)

Need a device? See the bundled ReDroid+Appium compose (docker compose up).
Press Ctrl-C to stop.`,
    fn: cmdMobileRunner,
  },
  status: {
    spec: { ...COMMON, format: { type: 'string', default: 'text' } },
    help: `aegis status — one-shot status check for a run

Usage: aegis status <runId> [--format text|json] [--token <t>] [--api <base>]

Exit codes mirror the run: 0 passed · 1 failed · 2 cancelled (0 while still running)`,
    fn: cmdStatus,
  },
  tunnel: {
    spec: { ...COMMON, port: { type: 'int' }, host: { type: 'string', default: '127.0.0.1' } },
    help: `aegis tunnel — expose a local app to AegisRunner's cloud scanner over an
encrypted, outbound-only tunnel (no inbound port opened — works behind a firewall/NAT).

Usage: aegis tunnel --port <port> [--host <host>] [--token <t>] [--api <base>]

  --port <p>   Local port your app runs on (required, e.g. 3000)
  --host <h>   Local host to forward to (default 127.0.0.1)
  --token <t>  CI trigger token (or env AEGIS_TOKEN)
  --api <base> API base (or env AEGIS_API; default ${DEFAULT_API})

Prints a public URL — point a scan at it, then press Ctrl-C when done.`,
    fn: cmdTunnel,
  },
  dev: {
    spec: { ...COMMON, port: { type: 'int' }, host: { type: 'string', default: '127.0.0.1' }, scanOn: { type: 'string', default: 'manual' }, label: { type: 'string' } },
    help: `aegis dev — run your dev server with AegisRunner attached. Opens a tunnel to your
local app and lets you scan it on a keypress, without leaving your terminal.

Usage:
  aegis dev [--port <p>] -- <your dev command>
  e.g.  aegis dev --port 3000 -- npm run dev

  --port <p>     Port your dev server listens on. If omitted, aegis dev sniffs it
                 from the dev server's output (best effort).
  --host <h>     Local host to forward to (default 127.0.0.1)
  --scan-on <w>  'manual' (default — press [a] to scan) or 'startup' (scan once
                 as soon as the tunnel opens)
  --token <t>    CI trigger token (or env AEGIS_TOKEN). Pro or Business plan.

While it runs:  [a] scan · [o] open results · [q] quit`,
    fn: cmdDev,
  },
  hooks: {
    spec: { ...COMMON, cmd: { type: 'string' } },
    help: `aegis hooks — gate 'git push' on AegisRunner (a pre-push hook).

Usage:
  aegis hooks install [--cmd "<command>"]   # add the gate (default: aegis run --wait)
  aegis hooks uninstall                       # remove it

On 'git push' the hook runs the command in your repo and BLOCKS the push if it
exits non-zero — so a failing suite stops code before it leaves your machine.
Opt-in: nothing is installed until you run this, and an existing pre-push hook
is backed up (…pre-push.pre-aegis), not clobbered. The hook needs AEGIS_TOKEN in
your environment.`,
    fn: cmdHooks,
  },
  runner: {
    spec: { ...COMMON },
    help: `aegis runner — run a self-hosted runner inside your own network.

Claims jobs from AegisRunner over an outbound-only HTTPS connection, executes
them LOCALLY against your private/staging targets (which the cloud can't reach),
and reports results back. No inbound port is opened.

Usage: aegis runner [--token <t>] [--api <base>]

Queue work for it from anywhere with:
  aegis runner-enqueue --url http://staging.internal:8080

Press Ctrl-C to stop.`,
    fn: cmdRunner,
  },
  'scan-runner': {
    spec: { ...COMMON },
    help: `aegis scan-runner — run the browser executor for 'aegis scan --local' on your
own machine, WITHOUT Docker.

Runs a local headless Chromium (via Playwright) that claims scan jobs over
outbound-only HTTPS and drives them against your app. Your app, its traffic, and
credentials stay on your machine. First run installs Chromium (~150MB, cached).

Usage: aegis scan-runner [--token <t>] [--api <base>]

Authed scans: set AEGIS_USERNAME / AEGIS_PASSWORD in the environment.
Prefer containers? Use the image instead:
  docker run -e AEGIS_TOKEN=… aegisrunner1/scan-runner

Press Ctrl-C to stop.`,
    fn: cmdScanRunner,
  },
  'runner-enqueue': {
    spec: { ...COMMON, url: { type: 'string' }, note: { type: 'string' }, role: { type: 'string' }, wait: { type: 'bool', default: true }, timeout: { type: 'int', default: 120 } },
    help: `aegis runner-enqueue — queue a job for a self-hosted runner to execute.

Usage: aegis runner-enqueue --url <target> [--note <text>] [--no-wait] [--timeout <sec>]

  --url <t>      Target the runner should reach (required)
  --note <n>     Free-text note attached to the job
  --no-wait      Return immediately instead of waiting for the result
  --timeout <s>  Max seconds to wait for a runner to finish (default 120)

Exit codes: 0 ok · 1 target unreachable/failed · 2 error/timeout`,
    fn: cmdRunnerEnqueue,
  },
};

const GLOBAL_HELP = `AegisRunner CLI v${pkg.version} — run tests and scans from CI

Usage: aegis <command> [options]

Commands:
  run          Trigger a test run, wait, and report (text/json/junit)
  scan         Trigger a full site scan
  mobile-scan  Trigger an on-device mobile app scan
  mobile-runner   Run the device side of a local mobile scan (--local) on your box
  scan-runner  Run the browser executor for 'scan --local' locally (no Docker)
  status       Check a run's status once
  tunnel       Expose a local app to the cloud scanner (behind a firewall/NAT)
  runner       Run a self-hosted runner inside your network (outbound-only)
  runner-enqueue  Queue a job for a self-hosted runner

Auth: pass --token or set AEGIS_TOKEN to a CI trigger token (Manage → CI/CD).
API base via --api or AEGIS_API (default ${DEFAULT_API}).

Run "aegis <command> --help" for command options.`;

function client(opts) {
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  return makeClient({ api: opts.api || process.env.AEGIS_API, token });
}

// Map a finished run to the CI exit code. The API's exitCode only covers
// status=="failed"; guard on failedCases too in case a run completes with
// failures without flipping the run status.
function exitCodeFor(run) {
  if (run.status === 'cancelled') return 2;
  if (run.status === 'failed' || (run.failedCases ?? 0) > 0 || run.exitCode === 1) return 1;
  return 0;
}

function summarize(run, dashboardUrl) {
  const lines = [
    `Run:      ${run.id}`,
    `Status:   ${run.status}`,
    `Cases:    ${run.passedCases ?? 0} passed, ${run.failedCases ?? 0} failed, ` +
      `${run.skippedCases ?? 0} skipped (${run.totalCases ?? 0} total)`,
    `Duration: ${((run.duration_ms ?? 0) / 1000).toFixed(1)}s`,
  ];
  if (dashboardUrl) lines.push(`Details:  ${dashboardUrl}`);
  return lines.join('\n');
}

async function cmdRun(opts) {
  const fmt = opts.format;
  if (!['text', 'json', 'junit'].includes(fmt)) {
    throw new UsageError(`--format must be text, json or junit (got "${fmt}")`);
  }
  const body = {};
  if (opts.suite?.length) body.suiteIds = opts.suite;
  if (opts.strategy) body.selectionStrategy = opts.strategy;
  if (opts.browser) body.browserProfile = opts.browser;
  if (opts.baseUrl) body.baseUrl = opts.baseUrl;
  if (opts.crawl) body.crawl = true;
  // --local: execute the run on a connected self-hosted runner (browser on the
  // user's machine). The backend routes it to the run broker instead of the
  // cloud executor; credentials come from the runner's own env, not here.
  if (opts.local) body.local = true;

  const api = client(opts);
  const res = await api.trigger(body);

  // crawl:true short-circuits on the server: no run is created, tests are
  // generated after the scan finishes — nothing to poll with a CI token.
  if (res.status === 'crawl_started') {
    log(`Scan started (crawl ${res.crawl_id}). ${res.message ?? ''}`);
    if (res.dashboardUrl) log(`Watch it: ${res.dashboardUrl}`);
    return 0;
  }
  if (res.status === 'crawl_failed') {
    log(`Scan failed to start: ${res.error ?? 'unknown error'}`);
    return 2;
  }

  log(`Run ${res.id} triggered (${res.runType}, ${res.targetIds?.length ?? 0} target(s))`);
  if (!opts.wait) {
    if (fmt === 'json') process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    else log(`Not waiting. Check later: aegis status ${res.id}`);
    return 0;
  }

  const run = await pollRun(api, res.id, { timeoutSec: opts.timeout, log });
  const dashboardUrl = res.dashboardUrl;

  if (fmt === 'json') {
    process.stdout.write(JSON.stringify({ ...run, dashboardUrl }, null, 2) + '\n');
  } else if (fmt === 'junit') {
    const out = opts.output || 'aegis-results/junit.xml';
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buildJUnit(run, dashboardUrl));
    log(`JUnit report written to ${out}`);
    log(summarize(run, dashboardUrl));
  } else {
    process.stdout.write(summarize(run, dashboardUrl) + '\n');
  }
  return exitCodeFor(run);
}

// Read all of stdin (used for --password-stdin so the password never lands in
// argv / shell history / `ps`). Strips a single trailing newline.
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
  });
}

// Build the auth fragment of the scan trigger body from --role / --username /
// --password-stdin / AEGIS_PASSWORD. The scanner's AI login maps `username`
// onto whatever the form calls its identity field (email / username / phone /
// …), so there's nothing to configure per-app. A password is NEVER read from
// argv — `--password <p>` would leak via `ps` and shell history — only from
// stdin or the AEGIS_PASSWORD env var.
async function resolveScanAuth(opts) {
  const body = {};
  const role = opts.role && String(opts.role).trim();
  if (role) body.authRole = role;
  const username = opts.username && String(opts.username).trim();
  let password;
  if (opts.passwordStdin) {
    password = await readStdin();
    if (!password) throw new UsageError('--password-stdin was set but stdin was empty. Pipe the password in, e.g.  printf %s "$PW" | aegis scan --username me@example.com --password-stdin');
  } else if (process.env.AEGIS_PASSWORD) {
    password = process.env.AEGIS_PASSWORD;
  }
  if (username || password) {
    if (!username) throw new UsageError('A password was provided but no --username. Add --username <email-or-username>.');
    if (!password) throw new UsageError('--username needs a password. Set AEGIS_PASSWORD=… or add --password-stdin (never put the password on the command line).');
    body.credentials = { username, password };
  }
  return body;
}

async function cmdScan(opts) {
  if (opts.tunnel && opts.local) {
    throw new UsageError('--tunnel and --local are mutually exclusive. --tunnel relays OUR cloud browser to your app; --local runs the browser ON your own runner (nothing relayed).');
  }
  if (opts.local) return await cmdScanLocal(opts);
  if (opts.tunnel) return await cmdScanViaTunnel(opts);
  // Guard the empty-string footgun: `--url ""` (e.g. a capture script that
  // grabbed nothing) would otherwise be falsy and silently fall back to the
  // project's default URL — mis-targeting the scan. Fail loudly instead.
  if (opts.url !== undefined && String(opts.url).trim() === '') {
    throw new UsageError("--url is empty. Pass a real URL (e.g. https://staging.example.com), or omit --url to scan the project's configured URL.");
  }
  const body = { crawl: true };
  if (opts.url) body.baseUrl = opts.url;
  Object.assign(body, await resolveScanAuth(opts));
  const res = await client(opts).trigger(body);
  if (res.status === 'crawl_failed') {
    log(`Scan failed to start: ${res.error ?? 'unknown error'}`);
    return 2;
  }
  log(`Scan started (crawl ${res.crawl_id ?? '?'}).`);
  if (res.dashboardUrl) log(`Watch it: ${res.dashboardUrl}`);
  if ((opts.watch || opts.wait) && res.crawl_id) return await watchScan(opts, res.crawl_id);
  return 0;
}

// Follow a scan to completion over SSE (GET /ci/crawls/:id/events): rewrite a
// single progress line on TTYs, throttle to periodic lines in CI logs.
async function watchScan(opts, crawlId) {
  const { streamScanEvents } = await import('../lib/api.mjs');
  const tty = process.stderr.isTTY;
  let result = null, lastPlain = 0, lastPhase = '';
  const show = (s, force) => {
    if (tty) process.stderr.write('\r\x1b[2K  ' + s);
    else if (force || Date.now() - lastPlain > 12000) { log('  ' + s); lastPlain = Date.now(); }
  };
  const onEvent = (event, d) => {
    d = d || {};
    if (event === 'crawl_progress') {
      show(`crawling · ${d.pagesFound ?? '?'} page(s) found`);
    } else if (event === 'ai_generation_progress') {
      const ph = d.phase_label || d.phase || 'generating tests';
      show(`${ph}${d.progress != null ? ' · ' + d.progress + '%' : ''}`, ph !== lastPhase);
      lastPhase = ph;
    } else if (event === 'done') {
      if (tty) process.stderr.write('\n');
      result = d.result; return true;
    } else if (event === 'timeout') {
      if (tty) process.stderr.write('\n');
      result = 'timeout'; return true;
    }
  };
  // Reconnect if the stream drops before a terminal event — the scan is still
  // running (common when this same process is also forwarding tunnel traffic).
  // The backend replays current status on connect and sends `done` immediately
  // if the scan finished during the gap, so reconnecting can't miss the ending.
  const deadline = Date.now() + 35 * 60 * 1000;
  while (result === null && Date.now() < deadline) {
    try {
      await streamScanEvents({ api: opts.api || process.env.AEGIS_API, token: opts.token || process.env.AEGIS_TOKEN, crawlId, onEvent });
    } catch { /* connection error — reconnect */ }
    if (result === null) await new Promise((r) => setTimeout(r, 2000));
  }
  if (result === 'completed') { log('✓ Scan complete — pages crawled and tests generated.'); return 0; }
  if (result === 'failed') { log('Scan failed — check the dashboard.'); return 1; }
  if (result === 'timeout') { log('Scan still running after 30 min — check the dashboard.'); return 0; }
  log('Live updates ended — check the dashboard for the final result.');
  return 0;
}

// aegis scan --tunnel --port <p>: open a tunnel to the local app, scan the URL
// it hands back, and watch — all in ONE process. The tunnel's poll loop runs
// concurrently with the scan, so it stays connected for the whole crawl (no
// two-terminal juggling, no dropped tunnel, no URL to copy).
async function cmdScanViaTunnel(opts) {
  if (!opts.port) throw new UsageError('Usage: aegis scan --tunnel --port <port>  (e.g. --port 3000)');
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  // Resolve auth BEFORE opening the tunnel: validates the flags and consumes
  // --password-stdin up front, so a bad login or empty stdin fails fast instead
  // of after the tunnel is live.
  const auth = await resolveScanAuth(opts);
  const { runTunnel } = await import('../lib/tunnel.mjs');
  const ac = new AbortController();
  let exitCode = 2;
  await runTunnel({
    api: opts.api || process.env.AEGIS_API,
    token,
    port: opts.port,
    host: opts.host || '127.0.0.1',
    log,
    signal: ac.signal,
    onReady: async (publicUrl) => {
      try {
        log(`Scanning your local app (port ${opts.port}) through the tunnel…`);
        const res = await client(opts).trigger({ crawl: true, baseUrl: publicUrl, ...auth });
        if (res.status === 'crawl_failed') {
          log(`Scan failed to start: ${res.error ?? 'unknown error'}`);
          exitCode = 2;
        } else {
          log(`Scan started (crawl ${res.crawl_id ?? '?'}).`);
          exitCode = res.crawl_id ? await watchScan(opts, res.crawl_id) : 2;
        }
      } catch (e) {
        log(`Scan error: ${e.message}`);
        exitCode = 2;
      } finally {
        ac.abort(); // scan finished → stop the tunnel so the process exits
      }
    },
  });
  return exitCode;
}

// aegis scan --local: run the BROWSER on the customer's own self-hosted runner.
// The backend mints a broker session when it sees local:true; the cloud AI loop
// drives that session's browser (on the runner) over the broker. The app, its
// traffic, and any credentials never leave the customer's network — only the
// findings come back. The runner claims the scan job from the project's queue
// over outbound HTTPS. Requires a connected runner (the runner image).
async function cmdScanLocal(opts) {
  if (opts.url !== undefined && String(opts.url).trim() === '') {
    throw new UsageError("--local needs a target: pass --url pointing at your private app (e.g. --url http://localhost:3000), or omit --url to use the project's configured URL.");
  }
  // A local scan's whole point is that credentials never reach our cloud. So we
  // refuse cloud-bound login flags here — the runner supplies them from its OWN
  // environment (AEGIS_USERNAME / AEGIS_PASSWORD) so they stay on your network.
  if (opts.username || opts.passwordStdin || process.env.AEGIS_PASSWORD) {
    throw new UsageError('For --local, credentials must NOT be sent to the cloud. Set AEGIS_USERNAME and AEGIS_PASSWORD on the RUNNER instead — they stay on your network and the runner logs in locally. Drop --username/--password-stdin/AEGIS_PASSWORD from this command.');
  }
  const body = { crawl: true, local: true };
  if (opts.url) body.baseUrl = opts.url;
  // --role is a tag only (no secret) — safe to forward so the scan/tests are
  // labelled with the role. The actual login happens on the runner.
  const role = opts.role && String(opts.role).trim();
  if (role) body.authRole = role;

  const res = await client(opts).trigger(body);
  if (res.status === 'crawl_failed') {
    log(`Local scan failed to start: ${res.error ?? 'unknown error'}`);
    return 2;
  }
  log(`Local scan started (crawl ${res.crawl_id ?? '?'}).`);
  log('  The browser runs on your self-hosted runner — your app never leaves your network.');
  log('  If it stalls, make sure a runner is connected to this project (see RUNNER.md).');
  if (res.dashboardUrl) log(`  Watch it: ${res.dashboardUrl}`);
  if ((opts.watch || opts.wait) && res.crawl_id) return await watchScan(opts, res.crawl_id);
  return 0;
}

// aegis dev -- <cmd>: run the dev server AND keep a tunnel open to it for the
// whole session, so a full AI scan is one keypress away — no second terminal,
// no URL to copy. The universal primitive the framework plugins wrap.
async function cmdDev(opts, positional) {
  const childCmd = (positional || []).filter(Boolean);
  if (childCmd.length === 0) {
    throw new UsageError('Usage: aegis dev [--port <p>] -- <your dev command>\n  e.g.  aegis dev --port 3000 -- npm run dev');
  }
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');

  const { spawn } = await import('node:child_process');
  const { runTunnel } = await import('../lib/tunnel.mjs');
  const win = process.platform === 'win32';

  // Own stdin (for [a]/[o]/[q]); the child gets its own process group on Unix so
  // we can kill the whole tree (npm → node …) cleanly on exit.
  const child = spawn(childCmd[0], childCmd.slice(1), {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: win,          // npm/pnpm/yarn resolve via the shell on Windows
    detached: !win,
    env: process.env,
  });

  const ac = new AbortController();
  let publicUrl = null, scanning = false, tunnelStarted = false, sniffBuf = '';

  // Tagged logger — "aegis" or "aegis·<label>" so several `aegis dev` / plugin
  // tunnels in one terminal (monorepo) stay distinguishable.
  const { deriveLabel, aegisTag } = await import('../lib/label.mjs');
  const TAG = aegisTag(deriveLabel(opts.label));
  const aeg = (m) => log(`  \x1b[36m◆ ${TAG}\x1b[0m   ${m}`);
  const aegW = (m) => log(`  ! ${TAG}   ${m}`);

  const printKeys = () => aeg('press [a] scan · [o] open results · [q] quit');

  const runScan = async () => {
    if (scanning) { aeg('a scan is already running…'); return; }
    if (!publicUrl) { aeg('tunnel not ready yet — one moment.'); return; }
    scanning = true;
    try {
      aeg('scanning your local app…');
      const res = await client(opts).trigger({ crawl: true, baseUrl: publicUrl });
      if (res.status === 'crawl_failed') aegW(`scan failed to start: ${res.error ?? 'unknown error'}`);
      else if (res.crawl_id) {
        if (res.dashboardUrl) aeg(`results: ${res.dashboardUrl}`);
        await watchScan(opts, res.crawl_id);
      }
    } catch (e) { aegW(`scan error: ${e.message}`); }
    finally { scanning = false; printKeys(); }
  };

  const startTunnel = (port) => {
    if (tunnelStarted) return;
    tunnelStarted = true;
    log('');
    aeg(`dev server on :${port} — opening tunnel…`);
    runTunnel({
      api: opts.api || process.env.AEGIS_API, token,
      port, host: opts.host || '127.0.0.1', log, signal: ac.signal,
      onReady: async (url) => {
        publicUrl = url;
        aeg(`tunnel open → ${url}`);
        if (opts.scanOn === 'startup') {
          aeg('waiting for your app to finish loading…');
          await waitForAppReady(opts.host || '127.0.0.1', port, { log });
          runScan();
        } else printKeys();
      },
    }).catch((e) => aegW(`tunnel error: ${e.message}`));
  };

  // No --port? sniff the dev server's own output for the port it bound to.
  const sniffPort = (chunk) => {
    if (tunnelStarted) return;
    sniffBuf = (sniffBuf + chunk.toString()).slice(-16000);
    const m = sniffBuf.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i)
           || sniffBuf.match(/https?:\/\/[^\s/'"]*:(\d{2,5})/i);
    if (m) startTunnel(Number(m[1]));
  };

  // Re-emit the child's output verbatim (preserves colors/spinners); sniff it
  // only when we weren't handed a --port.
  child.stdout.on('data', (c) => { process.stdout.write(c); if (!opts.port) sniffPort(c); });
  child.stderr.on('data', (c) => { process.stderr.write(c); if (!opts.port) sniffPort(c); });
  if (opts.port) setTimeout(() => startTunnel(opts.port), 700); // give the server a moment to bind

  let exiting = false;
  const shutdown = (code = 0) => {
    if (exiting) return; exiting = true;
    ac.abort();
    try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
    try { if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-child.pid, 'SIGTERM'); }
    catch { try { child.kill(); } catch {} }
    process.exit(code);
  };

  const openResults = () => {
    const url = 'https://app.aegisrunner.com';
    const opener = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = win ? ['/c', 'start', '', url] : [url];
    try { spawn(opener, args, { stdio: 'ignore', detached: true }).unref(); aeg(`opened ${url}`); }
    catch { aeg(`open ${url}`); }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      const k = key.toLowerCase();
      if (k === 'a') runScan();
      else if (k === 'o') openResults();
      else if (k === 'q' || key === '') shutdown(0); // q or Ctrl-C
    });
  }

  child.on('exit', (code) => { aeg('dev server exited — closing tunnel.'); shutdown(code ?? 0); });
  child.on('error', (e) => { aegW(`could not start "${childCmd.join(' ')}": ${e.message}`); shutdown(1); });
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  await new Promise(() => {}); // keep the process alive; shutdown() exits explicitly
}

// aegis hooks install|uninstall — a git pre-push gate. Opt-in (never installed
// silently), marker-guarded, and it backs up any existing pre-push hook rather
// than clobbering it. Resolves the spec's `scanOn: 'commit'` without surprising
// anyone with a silent hook write.
const AEGIS_HOOK_MARK = '# >>> aegisrunner pre-push gate >>>';
async function cmdHooks(opts, positional) {
  const action = String((positional || [])[0] || '').toLowerCase();
  const fs = await import('node:fs');
  const { join } = await import('node:path');
  const { execSync } = await import('node:child_process');

  let gitDir;
  try { gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw new UsageError('Not a git repository — run this from inside your repo.'); }
  const hooksDir = join(gitDir, 'hooks');
  const hookPath = join(hooksDir, 'pre-push');
  const backup = hookPath + '.pre-aegis';

  if (action === 'install') {
    const cmd = opts.cmd || 'aegis run --wait';
    fs.mkdirSync(hooksDir, { recursive: true });
    if (fs.existsSync(hookPath)) {
      const cur = fs.readFileSync(hookPath, 'utf8');
      if (cur.includes(AEGIS_HOOK_MARK)) log('An AegisRunner pre-push gate is already installed — reinstalling.');
      else { fs.renameSync(hookPath, backup); log('Backed up your existing pre-push hook → pre-push.pre-aegis'); }
    }
    const script = `#!/bin/sh\n${AEGIS_HOOK_MARK}\n`
      + `# Installed by \`aegis hooks install\`. Remove with \`aegis hooks uninstall\`.\n`
      + `# Blocks 'git push' when the command below exits non-zero.\n`
      + `${cmd}\n`
      + `# <<< aegisrunner pre-push gate <<<\n`;
    fs.writeFileSync(hookPath, script);
    fs.chmodSync(hookPath, 0o755);
    log(`✓ Installed a pre-push gate at ${hookPath}`);
    log(`  runs:   ${cmd}`);
    log('  needs:  AEGIS_TOKEN in your environment · remove with: aegis hooks uninstall');
    return 0;
  }
  if (action === 'uninstall') {
    if (!fs.existsSync(hookPath)) { log('No pre-push hook found — nothing to remove.'); return 0; }
    if (!fs.readFileSync(hookPath, 'utf8').includes(AEGIS_HOOK_MARK)) {
      log('The pre-push hook was not installed by AegisRunner — leaving it alone.'); return 0;
    }
    fs.unlinkSync(hookPath);
    if (fs.existsSync(backup)) { fs.renameSync(backup, hookPath); log('Restored your previous pre-push hook.'); }
    log('✓ Removed the AegisRunner pre-push gate.');
    return 0;
  }
  throw new UsageError('Usage: aegis hooks install [--cmd "<command>"] | aegis hooks uninstall');
}

async function cmdMobileScan(opts) {
  const mobileScan = {};
  for (const k of ['app', 'appName', 'platform', 'role']) if (opts[k]) mobileScan[k] = opts[k];
  if (opts.local) {
    mobileScan.local = true;
    if (opts.package) mobileScan.appPackage = opts.package;
    if (!opts.package) log('note: pass --package <app.id> so the explorer can track your app on the device.');
  }
  const res = await client(opts).trigger({ mobileScan });
  log(res.message || 'Mobile scan started.');
  if (opts.local) log('Driving your local device — keep `aegis mobile-runner` running until it finishes.');
  return 0;
}

async function cmdMobileRunner(opts) {
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  const apk = opts.apk || process.env.AEGIS_APK;
  if (!apk) throw new UsageError('Usage: aegis mobile-runner --apk ./app.apk  (path the local Appium can read)');
  const { runMobileExecutor } = await import('../lib/mobileExecutor.mjs');
  await runMobileExecutor({
    api: opts.api || process.env.AEGIS_API,
    token,
    apk,
    appium: opts.appium || process.env.AEGIS_APPIUM,
    log,
  });
  return 0; // loops until Ctrl-C
}

async function cmdTunnel(opts) {
  if (!opts.port) throw new UsageError('Usage: aegis tunnel --port <port>  (e.g. --port 3000)');
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  const { runTunnel } = await import('../lib/tunnel.mjs');
  await runTunnel({ api: opts.api || process.env.AEGIS_API, token, port: opts.port, host: opts.host, log });
  return 0; // runTunnel loops until Ctrl-C (which exits directly)
}

async function cmdRunner(opts) {
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  const { runRunner } = await import('../lib/runner.mjs');
  await runRunner({ api: opts.api || process.env.AEGIS_API, token, log });
  return 0; // loops until Ctrl-C
}

async function cmdScanRunner(opts) {
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  // The browser executor needs Playwright (~a heavy dep), so it lives in its own
  // package to keep this CLI zero-dependency. Delegate to it via npx — installed
  // + cached on first use. The token/api go via ENV (not argv) so they don't leak
  // into the process list.
  const { spawn } = await import('node:child_process');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const env = { ...process.env, AEGIS_TOKEN: token };
  const api = opts.api || process.env.AEGIS_API;
  if (api) env.AEGIS_API = api;
  log('starting the local browser executor via @aegisrunner/runner (no Docker)…');
  const child = spawn(npx, ['--yes', '@aegisrunner/runner'], { env, stdio: 'inherit', shell: process.platform === 'win32' });
  const onSig = () => { try { child.kill('SIGINT'); } catch { /* ignore */ } };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
  await new Promise((r) => child.on('exit', r));
  return 0; // loops until Ctrl-C
}

async function cmdRunnerEnqueue(opts) {
  if (!opts.url) throw new UsageError('Usage: aegis runner-enqueue --url <target>');
  const token = opts.token || process.env.AEGIS_TOKEN;
  if (!token) throw new UsageError('Missing token: pass --token or set AEGIS_TOKEN');
  const base = (opts.api || process.env.AEGIS_API || DEFAULT_API).replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${token}` };
  const r = await fetch(`${base}/runner/enqueue`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: opts.url, note: opts.note, role: opts.role }),
  });
  if (!r.ok) { log(`Could not queue job (HTTP ${r.status}).`); return 2; }
  const { jobId } = await r.json();
  log(`Job queued: ${jobId}`);
  if (!opts.wait) return 0;

  const deadline = Date.now() + opts.timeout * 1000;
  log('Waiting for a runner to pick it up…');
  while (Date.now() < deadline) {
    await sleep(2000);
    const s = await fetch(`${base}/runner/jobs/${jobId}`, { headers: auth }).catch(() => null);
    if (!s || !s.ok) continue;
    const { job, result } = await s.json();
    if (job.status === 'completed') {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return result && result.ok === false ? 1 : 0;
    }
  }
  log(`Timed out after ${opts.timeout}s — is a runner running? Start one with "aegis runner".`);
  return 2;
}

async function cmdStatus(opts, positional) {
  const runId = positional[0];
  if (!runId) throw new UsageError('Usage: aegis status <runId>');
  const run = await client(opts).runStatus(runId);
  if (opts.format === 'json') process.stdout.write(JSON.stringify(run, null, 2) + '\n');
  else process.stdout.write(summarize(run) + '\n');
  return run.isFinished ? exitCodeFor(run) : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv[0] === '-v') { console.log(pkg.version); return 0; }
  const cmdName = argv[0];
  if (!cmdName || cmdName === '--help' || cmdName === 'help') { console.log(GLOBAL_HELP); return 0; }
  const cmd = COMMANDS[cmdName];
  if (!cmd) throw new UsageError(`Unknown command: ${cmdName}. Run "aegis --help".`);
  const { opts, positional } = parseArgs(argv.slice(1), cmd.spec);
  if (opts.help) { console.log(cmd.help); return 0; }
  return cmd.fn(opts, positional);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UsageError) log(`Error: ${err.message}`);
    else if (err instanceof ApiError) log(`API error${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
    else log(`Unexpected error: ${err.stack || err.message}`);
    process.exit(2);
  },
);
