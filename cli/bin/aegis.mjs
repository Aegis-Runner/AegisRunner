#!/usr/bin/env node
// AegisRunner CLI — wraps the CI trigger API (POST /ci/trigger, GET /ci/runs/:id).
// Zero runtime dependencies: node builtins + global fetch (Node 18+).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, UsageError } from '../lib/args.mjs';
import { makeClient, pollRun, ApiError, DEFAULT_API } from '../lib/api.mjs';
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
    spec: { ...COMMON, url: { type: 'string' }, wait: { type: 'bool', default: false }, watch: { type: 'bool', default: false }, tunnel: { type: 'bool', default: false }, port: { type: 'int' }, host: { type: 'string', default: '127.0.0.1' } },
    help: `aegis scan — trigger a full site scan (tests auto-generate afterwards)

Usage:
  aegis scan [--url <baseUrl>] [--watch]
  aegis scan --tunnel --port <port>          # scan a LOCAL app through a tunnel

  --url <u>    Base URL to scan (default: the project's configured base URL)
  --watch      Stream live progress (crawl + test generation) until it finishes.
               Exit 0 when done, 1 if the scan failed.
  --tunnel     Open a tunnel to your local app, scan it, and watch — all in ONE
               process, so the tunnel stays alive for the whole scan. Needs --port.
  --port <p>   Local port your app runs on (with --tunnel, e.g. 3000).

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
    },
    help: `aegis mobile-scan — start an on-device mobile app scan (fire-and-forget)

Usage: aegis mobile-scan [--app <tb://…|apk-url>] [--platform android|ios] [--role <r>]

  --app <ref>       Device-cloud ref or APK URL (default: the project's last scanned app)
  --app-name <n>    Display name for the generated suites
  --platform <p>    android | ios
  --role <r>        Explore the app as this role (uses that role's saved login)`,
    fn: cmdMobileScan,
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

async function cmdScan(opts) {
  if (opts.tunnel) return await cmdScanViaTunnel(opts);
  // Guard the empty-string footgun: `--url ""` (e.g. a capture script that
  // grabbed nothing) would otherwise be falsy and silently fall back to the
  // project's default URL — mis-targeting the scan. Fail loudly instead.
  if (opts.url !== undefined && String(opts.url).trim() === '') {
    throw new UsageError("--url is empty. Pass a real URL (e.g. https://staging.example.com), or omit --url to scan the project's configured URL.");
  }
  const body = { crawl: true };
  if (opts.url) body.baseUrl = opts.url;
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
        const res = await client(opts).trigger({ crawl: true, baseUrl: publicUrl });
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

async function cmdMobileScan(opts) {
  const mobileScan = {};
  for (const k of ['app', 'appName', 'platform', 'role']) if (opts[k]) mobileScan[k] = opts[k];
  const res = await client(opts).trigger({ mobileScan });
  log(res.message || 'Mobile scan started.');
  return 0;
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
