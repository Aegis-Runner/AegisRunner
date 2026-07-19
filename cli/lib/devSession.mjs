// devSession.mjs — the shared engine behind the @aegisrunner/{vite,nuxt,next} dev
// plugins. Owns scan state, the in-app widget's control endpoints, and BOTH
// execution modes so each plugin stays a thin adapter:
//
//   • 'local'  (default) — runs the browser ON the developer's machine via
//     @aegisrunner/scan-runner and scans http://localhost DIRECTLY. No cloud
//     relay, no tunnel: fastest + most reliable for big apps (hundreds of routes,
//     Vite module bursts), and the app's traffic + credentials never leave the
//     machine. First scan fetches Chromium (~150MB, then cached).
//   • 'tunnel'            — relays OUR cloud browser to the dev app over an
//     outbound-only tunnel. No local browser to install; lighter footprint, but
//     every request round-trips cloud→laptop so it's slower at scale.
//
// A plugin just: mounts `control` on its dev server, injects the widget script,
// binds `[a]`→scanSite, and calls start()/stop().

import { runTunnel } from './tunnel.mjs'
import { makeClient, streamScanEvents, waitForAppReady, pollRun } from './api.mjs'
import { resolveToken, resolveApi } from './config.mjs'
import { createAegisControl } from './devWidget.mjs'
import { startLocalRunner } from './localRunner.mjs'

/**
 * @param {object} opts
 * @param {string} opts.token   CI trigger token
 * @param {string} [opts.api]   API base override
 * @param {string} [opts.host]  local host the app listens on (default 127.0.0.1)
 * @param {number} opts.port    local dev-server port
 * @param {'local'|'tunnel'} [opts.mode]  execution mode (default 'local')
 * @param {'manual'|'startup'} [opts.scanOn]  when to auto-scan (default 'manual')
 * @param {boolean} [opts.widget]  mount the in-app widget control (default true)
 * @param {(msg:string)=>void} [opts.log]
 */
export function createDevSession(opts = {}) {
  // Token/API: --token/env passed by the plugin win, else fall back to the saved
  // config (~/.config/aegis/config.json or .aegisrc) so `aegis login` once is enough.
  const token = resolveToken(opts)
  const api = resolveApi(opts) || undefined
  const host = opts.host || '127.0.0.1'
  const port = opts.port
  const mode = opts.mode === 'tunnel' ? 'tunnel' : 'local'
  const scanOn = opts.scanOn || 'manual'
  const log = opts.log || (() => {})
  const client = makeClient({ api, token })

  const state = {
    mode,
    scanning: false,
    ready: mode === 'local', // local is ready at once; tunnel flips ready in onReady
    runnerReady: false,
    publicUrl: null, // tunnel URL (tunnel mode only)
    creds: null,
    last: null, // { dashboardUrl, result, pages }
    msg: null,
  }
  const ac = new AbortController()

  // ── local browser runner (mode 'local') ────────────────────────────────────
  let runner = null
  let runnerStarting = null
  async function ensureRunner() {
    if (runner && state.runnerReady) return
    if (runnerStarting) return runnerStarting
    runnerStarting = (async () => {
      log('starting a local browser runner (first run installs Chromium ~150MB, then cached)…')
      const r = startLocalRunner({
        token, api,
        credentials: state.creds,
        log: (line) => log(line),
        onExit: () => { state.runnerReady = false; runner = null; runnerStarting = null },
      })
      runner = r
      const online = await r.waitReady(180_000)
      if (!runner) throw new Error('the local browser runner exited before it came online — see the log above')
      state.runnerReady = true
      log(online ? 'local browser runner ready.' : 'local browser runner still starting — your scan will begin the moment it is online.')
    })()
    return runnerStarting
  }
  // The runner reads credentials from its ENV at startup and logs in locally, so
  // a creds change needs a fresh runner. It's lazy + Chromium is cached → cheap.
  function restartRunnerForCreds() {
    if (runner) { try { runner.stop() } catch { /* already gone */ } }
    runner = null; runnerStarting = null; state.runnerReady = false
  }

  function setCredentials(c) {
    const has = c && c.username
    state.creds = has ? { username: c.username, password: c.password || '' } : null
    log(has
      ? `credentials set for ${state.creds.username}${mode === 'local' ? ' (they stay on your machine)' : ''}`
      : 'credentials cleared')
    if (mode === 'local') restartRunnerForCreds()
  }

  // ── the scan ────────────────────────────────────────────────────────────────
  async function scan({ scope = 'site', path = '/' } = {}) {
    if (state.scanning) { log('a scan is already running…'); return }
    const isPage = scope === 'page'
    const body = { crawl: true }
    if (isPage) { body.maxPages = 1; body.maxDepth = 0 }

    if (mode === 'local') {
      state.scanning = true
      try {
        state.msg = isPage ? 'Preparing to scan this page…' : 'Preparing to scan your app…'
        await ensureRunner()
        body.local = true
        const base = `http://${host}:${port}`
        body.baseUrl = isPage ? joinUrl(base, path) : base
        // Credentials went to the runner's ENV — deliberately NOT sent to the cloud.
        state.msg = isPage ? 'Scanning this page (on your machine)…' : 'Scanning your whole app (on your machine)…'
        await runScan(body)
      } catch (e) {
        log(`scan error: ${e.message}`); state.last = { result: 'failed' }; state.msg = `Scan error: ${e.message}`
      } finally { finishScan() }
      return
    }

    // tunnel mode
    if (!state.publicUrl) { log('tunnel not ready yet — one moment.'); state.msg = 'Connecting…'; return }
    state.scanning = true
    try {
      body.baseUrl = isPage ? joinUrl(state.publicUrl, path) : state.publicUrl
      if (state.creds && state.creds.username) body.credentials = { username: state.creds.username, password: state.creds.password || '' }
      state.msg = isPage ? 'Scanning this page…' : 'Scanning the whole site…'
      await runScan(body)
    } catch (e) {
      log(`scan error: ${e.message}`); state.last = { result: 'failed' }; state.msg = `Scan error: ${e.message}`
    } finally { finishScan() }
  }

  async function runScan(body) {
    log(state.msg + ` → ${body.baseUrl}`)
    const res = await client.trigger(body)
    if (res.status === 'crawl_failed') {
      log(`scan failed to start: ${res.error ?? 'unknown error'}`)
      state.last = { result: 'failed' }; state.msg = `Scan failed: ${res.error ?? 'unknown error'}`
      return
    }
    state.last = { dashboardUrl: res.dashboardUrl || null, result: 'running', pages: 0 }
    if (res.dashboardUrl) log(`results: ${res.dashboardUrl}`)
    if (!res.crawl_id) return
    await streamScanEvents({
      api, token, crawlId: res.crawl_id,
      onEvent: (event, d) => {
        d = d || {}
        if (event === 'crawl_progress') { state.last.pages = d.pagesFound ?? state.last.pages; state.msg = `Scanning · ${d.pagesFound ?? '?'} page(s)`; log(state.msg) }
        // The crawl finishing is NOT the end — the AI still turns the scan into
        // test cases (goal pipeline, ~1-2 min). Bridge the gap so the widget shows
        // clear progress instead of looking finished/stuck between the last
        // crawl_progress and the first ai_generation_progress event.
        else if (event === 'crawl_completed') { state.msg = 'Scan complete · generating tests…'; log(state.msg) }
        else if (event === 'ai_generation_progress') { state.msg = `${d.phase_label || d.phase || 'Generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`; log(state.msg) }
        else if (event === 'done') { state.last.result = d.result || 'ended'; state.msg = d.result === 'completed' ? '✓ Tests generated.' : `Scan ${d.result || 'ended'}.`; log(state.msg) }
      },
    })
  }

  function finishScan() {
    state.scanning = false
    if (!state.last || state.last.result === 'running') state.msg = 'Ready to scan.'
  }

  // Run the latest generated tests (execute, not scan). Local mode runs them on
  // THIS machine via the runner; tunnel mode runs them in our cloud via the tunnel.
  async function runTests() {
    if (state.scanning) { log('a scan or run is already going…'); return }
    const base = mode === 'local' ? `http://${host}:${port}` : state.publicUrl
    if (mode === 'tunnel' && !base) { log('tunnel not ready yet — one moment.'); state.msg = 'Connecting…'; return }
    state.scanning = true
    try {
      state.msg = 'Preparing to run your tests…'
      if (mode === 'local') await ensureRunner()
      state.msg = mode === 'local' ? 'Running your tests (on your machine)…' : 'Running your tests…'
      log(state.msg)
      // No crawl, no suiteIds → run the latest generated suite. local:true routes
      // the cases to the runner; credentials stay on the runner in local mode.
      const res = await client.trigger({ local: mode === 'local', baseUrl: base })
      if (res.status === 'crawl_failed' || (res.error && !res.id)) {
        state.last = { result: 'failed' }; state.msg = `Run failed: ${res.error ?? res.message ?? 'no generated tests yet — scan first'}`; log(state.msg); return
      }
      if (!res.id) { state.last = { result: 'ended' }; state.msg = 'No generated tests yet — run a scan first.'; log(state.msg); return }
      state.last = { dashboardUrl: res.dashboardUrl || null, result: 'running' }
      if (res.dashboardUrl) log(`results: ${res.dashboardUrl}`)
      const run = await pollRun(client, res.id, { timeoutSec: 1800, log: (m) => { state.msg = m; log(m) } })
      const passed = run.passed_cases ?? run.passedCases ?? 0
      const failed = run.failed_cases ?? run.failedCases ?? 0
      state.last.result = failed > 0 ? 'failed' : (run.status || 'completed')
      state.msg = failed > 0 ? `✗ ${failed} test(s) failed${passed ? `, ${passed} passed` : ''}.` : `✓ ${passed} test(s) passed.`
      log(state.msg)
    } catch (e) {
      log(`run error: ${e.message}`); state.last = { result: 'failed' }; state.msg = `Run error: ${e.message}`
    } finally {
      state.scanning = false
      if (!state.last || state.last.result === 'running') state.msg = 'Ready to scan.'
    }
  }

  function getStatus() {
    return {
      scanning: state.scanning,
      message: state.msg || (state.ready ? 'Ready to scan.' : 'Connecting…'),
      resultsUrl: state.last?.dashboardUrl || undefined,
      error: state.last?.result === 'failed',
    }
  }

  const control = opts.widget === false ? null : createAegisControl({
    onScan: (r) => { scan(r) },
    onRun: () => { runTests() },
    setCredentials,
    getStatus,
  })

  // ── lifecycle ──────────────────────────────────────────────────────────────
  function startupScan() {
    (async () => {
      log('waiting for your app to finish loading…')
      await waitForAppReady(host, port, { log })
      scan({ scope: 'site' })
    })()
  }

  function start() {
    if (mode === 'local') {
      state.ready = true
      log('local execution ready — the browser runs on your machine (no tunnel).')
      if (scanOn === 'startup') startupScan()
      else log('press [a] + Enter to scan, or click the in-app widget')
      return
    }
    // tunnel mode — runTunnel is long-lived; fire-and-forget, react in onReady.
    runTunnel({
      api, token, port, host, log, signal: ac.signal,
      onReady: (url) => {
        state.publicUrl = url; state.ready = true
        log(`tunnel open → ${url}`)
        if (scanOn === 'startup') startupScan()
        else log('press [a] + Enter to scan, or click the in-app widget')
      },
    }).catch((e) => log(`tunnel error: ${e.message}`))
  }

  function stop() {
    try { ac.abort() } catch { /* ignore */ }
    if (runner) { try { runner.stop() } catch { /* ignore */ } }
  }

  return { state, control, scan, scanSite: () => scan({ scope: 'site' }), runTests, setCredentials, getStatus, start, stop }
}

function joinUrl(base, path) { try { return new URL(path || '/', base).toString() } catch { return base } }
