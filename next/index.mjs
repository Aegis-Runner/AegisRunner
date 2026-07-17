// @aegisrunner/next — attach AegisRunner to your Next.js dev server.
//
// Next has no clean "server is listening" hook and no dev-middleware/head hook,
// so this wraps your next.config. In the dev phase it: opens a secure outbound
// tunnel to the dev port; runs a tiny control server; adds a `/__aegis/*` rewrite
// to it; and injects a floating AegisRunner widget into every dev page (via a
// webpack client entry). Click the shield to Test this page / Test the whole
// site / add login credentials — or press `[a]`. No deploy, no staging URL.
// (Prefer no config change? `aegis dev -- next dev` from @aegisrunner/cli.)
//
// Reuses the tunnel client, scan trigger, live-progress stream + widget from
// @aegisrunner/cli so the protocol and auth live in exactly one place.
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents, waitForAppReady } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { createAegisControl, widgetStatus } from '@aegisrunner/cli/lib/devWidget.mjs'
import { writeFileSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DEV_PHASE = 'phase-development-server'

// Next evaluates next.config in SEVERAL processes for one `next dev`. Two guards:
// (1) an exclusive lockfile so exactly ONE process opens the tunnel + control
// server; (2) a DETERMINISTIC control port derived from the project dir, so every
// process's rewrite proxies to the same place without cross-process coordination.
function acquireDevLock() {
  const lock = join(tmpdir(), `aegis-next-${Buffer.from(process.cwd()).toString('hex').slice(0, 20)}.lock`)
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      process.on('exit', () => { try { unlinkSync(lock) } catch {} })
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') return true
      try { if (Date.now() - statSync(lock).mtimeMs > 60_000) { unlinkSync(lock); continue } } catch {}
      return false
    }
  }
  return false
}

function controlPortFor(cwd) {
  let h = 2166136261
  for (let i = 0; i < cwd.length; i++) { h ^= cwd.charCodeAt(i); h = Math.imul(h, 16777619) }
  return 41000 + ((h >>> 0) % 20000) // 41000–60999, stable per project
}

function portFromArgv() {
  const a = process.argv
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === '-p' || a[i] === '--port') && a[i + 1]) return Number(a[i + 1])
    const m = /^--port=(\d+)$/.exec(a[i]); if (m) return Number(m[1])
  }
  return null
}

function attach(opts, controlPort) {
  if (!acquireDevLock()) return // another Next process already attached

  const token = opts.token || process.env.AEGIS_TOKEN
  if (!token) { console.warn('[aegis] no CI trigger token — set AEGIS_TOKEN. Skipping.'); return }
  const api = opts.api || process.env.AEGIS_API
  const host = opts.host || '127.0.0.1'
  const scanOn = opts.scanOn || 'manual'
  const port = opts.port || Number(process.env.PORT) || portFromArgv() || 3000
  const TAG = aegisTag(deriveLabel(opts.label))
  const info = (m) => console.log(`  ◆ ${TAG}   ${m}`)
  const err = (m) => console.error(`  ! ${TAG}   ${m}`)

  const state = { publicUrl: null, scanning: false, last: null, msg: null, creds: null }
  const ac = new AbortController()

  async function scan({ scope = 'site', path = '/' } = {}) {
    if (state.scanning) { info('a scan is already running…'); return }
    if (!state.publicUrl) { info('tunnel not ready yet — one moment.'); state.msg = 'Connecting…'; return }
    state.scanning = true
    const isPage = scope === 'page'
    const baseUrl = isPage ? joinUrl(state.publicUrl, path) : state.publicUrl
    state.msg = isPage ? 'Scanning this page…' : 'Scanning the whole site…'
    try {
      info(state.msg + ` → ${baseUrl}`)
      const body = { crawl: true, baseUrl }
      if (isPage) { body.maxPages = 1; body.maxDepth = 0 }
      if (state.creds && state.creds.username) body.credentials = { username: state.creds.username, password: state.creds.password || '' }
      const res = await makeClient({ api, token }).trigger(body)
      if (res.status === 'crawl_failed') { err(`scan failed to start: ${res.error ?? 'unknown error'}`); state.last = { result: 'failed' }; state.msg = `Scan failed: ${res.error ?? 'unknown error'}`; return }
      state.last = { dashboardUrl: res.dashboardUrl || null, result: 'running', pages: 0 }
      if (res.dashboardUrl) info(`results: ${res.dashboardUrl}`)
      if (!res.crawl_id) return
      await streamScanEvents({
        api, token, crawlId: res.crawl_id,
        onEvent: (event, d) => {
          d = d || {}
          if (event === 'crawl_progress') { state.last.pages = d.pagesFound ?? state.last.pages; state.msg = `Crawling · ${d.pagesFound ?? '?'} page(s)`; info(state.msg) }
          else if (event === 'ai_generation_progress') { state.msg = `${d.phase_label || d.phase || 'Generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`; info(state.msg) }
          else if (event === 'done') { state.last.result = d.result || 'ended'; state.msg = d.result === 'completed' ? '✓ Tests generated.' : `Scan ${d.result || 'ended'}.`; info(state.msg) }
        },
      })
    } catch (e) {
      err(`scan error: ${e.message}`); state.last = { result: 'failed' }; state.msg = `Scan error: ${e.message}`
    } finally {
      state.scanning = false
      if (!state.last || state.last.result === 'running') state.msg = 'Ready to scan.'
    }
  }

  // Control server the /__aegis rewrite proxies to (serves widget.js + endpoints).
  if (opts.widget !== false) {
    const control = createAegisControl({
      onScan: (r) => { scan(r) },
      setCredentials: (c) => { state.creds = c && c.username ? c : null; info(state.creds ? `credentials set for ${state.creds.username}` : 'credentials cleared') },
      getStatus: () => widgetStatus({ scanning: state.scanning, tunnel: state.publicUrl, message: state.msg, resultsUrl: state.last?.dashboardUrl, error: state.last?.result === 'failed' }),
    })
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      control(req, res).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }).catch(() => { res.statusCode = 500; res.end() })
    })
    server.on('error', (e) => { if (e.code === 'EADDRINUSE') info(`widget control port ${controlPort} busy — served by another instance`); else err(`widget control error: ${e.message}`) })
    server.listen(controlPort, '127.0.0.1', () => info(`AegisRunner widget ready — click the shield in your app to scan`))
    ac.signal.addEventListener('abort', () => { try { server.close() } catch {} })
  }

  setTimeout(() => {
    runTunnel({
      api, token, port, host, log: info, signal: ac.signal,
      onReady: async (url) => {
        state.publicUrl = url
        info(`tunnel open → ${url}`)
        if (scanOn === 'startup') {
          info('waiting for your app to finish loading…')
          await waitForAppReady(host, port, { log: info })
          scan({ scope: 'site' })
        } else info('press [a] + Enter to scan, or use the in-app widget')
      },
    }).catch((e) => err(`tunnel error: ${e.message}`))
  }, 1500)

  if (scanOn === 'manual' && process.stdin.isTTY) {
    process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') scan({ scope: 'site' }) })
  }
  process.on('exit', () => { try { ac.abort() } catch {} })
}

/**
 * Wrap your Next config. In the dev phase it attaches AegisRunner (tunnel +
 * in-app widget); in every other phase (build, prod) it's a pure pass-through.
 *
 * @param {object|Function} [nextConfig]  your existing next config
 * @param {object} [opts]  { token, api, port, host, scanOn:'manual'|'startup', widget:boolean, label }
 */
export default function withAegisRunner(nextConfig = {}, opts = {}) {
  const controlPort = controlPortFor(process.cwd())
  let attached = false
  return (phase, ctx) => {
    const base = typeof nextConfig === 'function' ? nextConfig(phase, ctx) : (nextConfig || {})
    if (phase !== DEV_PHASE) return base
    if (!attached) { attached = true; try { attach(opts, controlPort) } catch (e) { console.error(`[aegis] ${e.message}`) } }
    const token = opts.token || process.env.AEGIS_TOKEN
    if (!token || opts.widget === false) return base
    return injectWidget(base, controlPort)
  }
}

// Add the /__aegis rewrite (→ control server) + inject the widget into the dev
// client bundle. Both wrap the user's existing rewrites/webpack (never replace).
function injectWidget(config, controlPort) {
  const cfg = { ...config }
  const dest = `http://127.0.0.1:${controlPort}/__aegis/:path*`

  const origRewrites = cfg.rewrites
  cfg.rewrites = async () => {
    const mine = [{ source: '/__aegis/:path*', destination: dest }]
    const user = origRewrites ? await origRewrites() : []
    if (Array.isArray(user)) return [...mine, ...user]
    return { beforeFiles: [...mine, ...(user.beforeFiles || [])], afterFiles: user.afterFiles || [], fallback: user.fallback || [] }
  }

  let widgetEntry = null
  try { widgetEntry = require.resolve('@aegisrunner/cli/lib/aegisWidget.client.js') } catch { /* degrade to the manual <script> */ }
  if (widgetEntry) {
    const origWebpack = cfg.webpack
    cfg.webpack = (wc, wctx) => {
      const out = origWebpack ? origWebpack(wc, wctx) : wc
      if (wctx && wctx.dev && !wctx.isServer) {
        try {
          const prev = out.entry
          out.entry = async () => {
            const entries = typeof prev === 'function' ? await prev() : prev
            const key = entries['main-app'] ? 'main-app' : (entries['main'] ? 'main' : null)
            if (key) {
              const e = entries[key]
              if (Array.isArray(e)) { if (!e.includes(widgetEntry)) e.unshift(widgetEntry) }
              else if (e && Array.isArray(e.import)) { if (!e.import.includes(widgetEntry)) e.import.unshift(widgetEntry) }
            }
            return entries
          }
        } catch { /* leave the bundle untouched; manual <script src="/__aegis/widget.js"> still works */ }
      }
      return out
    }
  }
  return cfg
}

function joinUrl(base, path) {
  try { return new URL(path || '/', base).toString() } catch { return base }
}
