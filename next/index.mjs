// @aegisrunner/next — attach AegisRunner to your Next.js dev server.
//
// Next has no clean "server is listening" hook and no dev-middleware/head hook,
// so this wraps your next.config. In the dev phase it runs a tiny control server,
// adds a `/__aegis/*` rewrite to it, and injects a floating AegisRunner widget
// into every dev page (via a webpack client entry). Click the shield to Test
// this page / Test the whole site / add login credentials — or press `[a]`.
//
// By DEFAULT the scan runs ENTIRELY on your machine: a real browser
// (@aegisrunner/scan-runner) drives your app at http://localhost directly — no
// cloud relay, no tunnel (fastest + most reliable for big apps; your app +
// credentials never leave your machine). Prefer to relay OUR cloud browser over
// an outbound tunnel instead? Pass `{ runner: 'tunnel' }`.
// (Prefer no config change? `aegis dev -- next dev` from @aegisrunner/cli.)
//
// Reuses the runner lifecycle, tunnel client, scan trigger, live-progress stream
// + widget from @aegisrunner/cli so the protocol and auth live in one place.
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { createDevSession } from '@aegisrunner/cli/lib/devSession.mjs'
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

// Is this `next dev` running under Turbopack? Next 16 defaults to it, and it
// hard-errors if a `webpack` config key is present — so we must not add one.
function usingTurbopack() {
  const a = process.argv
  if (a.includes('--webpack')) return false                       // explicit opt-out → webpack
  if (a.some((x) => x === '--turbo' || x === '--turbopack')) return true
  if (process.env.TURBOPACK || process.env.TURBOPACK_DEV || process.env.__NEXT_TURBOPACK) return true
  try { if (parseInt(require('next/package.json').version, 10) >= 16) return true } catch { /* unknown */ }
  return false
}

function attach(opts, controlPort) {
  if (!acquireDevLock()) return // another Next process already attached

  const token = opts.token || process.env.AEGIS_TOKEN
  if (!token) { console.warn('[aegis] no CI trigger token — set AEGIS_TOKEN. Skipping.'); return }
  const api = opts.api || process.env.AEGIS_API
  const host = opts.host || '127.0.0.1'
  const mode = opts.runner === 'tunnel' ? 'tunnel' : 'local'
  const scanOn = opts.scanOn || 'manual'
  const port = opts.port || Number(process.env.PORT) || portFromArgv() || 3000
  const TAG = aegisTag(deriveLabel(opts.label))
  const info = (m) => console.log(`  ◆ ${TAG}   ${m}`)

  const session = createDevSession({ token, api, host, port, mode, scanOn, widget: opts.widget !== false, log: info })

  // Control server the /__aegis rewrite proxies to (serves widget.js + endpoints).
  if (opts.widget !== false && session.control) {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      session.control(req, res).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }).catch(() => { res.statusCode = 500; res.end() })
    })
    server.on('error', (e) => { if (e.code === 'EADDRINUSE') info(`widget control port ${controlPort} busy — served by another instance`); else info(`widget control error: ${e.message}`) })
    server.listen(controlPort, '127.0.0.1', () => info('AegisRunner widget ready — click the shield in your app to scan'))
    process.on('exit', () => { try { server.close() } catch { /* ignore */ } })
  }

  // Under Turbopack we can't auto-inject the widget (no webpack entry) — tell the
  // user the one line that shows it. Scans + [a] + the widget's endpoints all work.
  if (opts.widget !== false && usingTurbopack()) {
    info('Next is on Turbopack — to show the in-app shield add  <script async src="/__aegis/widget.js"></script>  to your root layout (dev only), or run `next dev --webpack` for auto-injection.')
  }

  // Next config-evals happen before the dev server binds; give it a moment so a
  // startup scan / tunnel doesn't race the port coming up.
  setTimeout(() => session.start(), 1500)

  if (scanOn === 'manual' && process.stdin.isTTY) {
    process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') session.scanSite() })
  }
  process.on('exit', () => { try { session.stop() } catch { /* ignore */ } })
}

/**
 * Wrap your Next config. In the dev phase it attaches AegisRunner (local browser
 * runner or tunnel + in-app widget); in every other phase (build, prod) it's a
 * pure pass-through.
 *
 * @param {object|Function} [nextConfig]  your existing next config
 * @param {object} [opts]  { token, api, port, host, runner:'local'|'tunnel',
 *   scanOn:'manual'|'startup', widget:boolean, label }. runner defaults to
 *   'local' — the browser runs on your machine against http://localhost (no tunnel).
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

  // Next 16 defaults to Turbopack, which HARD-ERRORS if a `webpack` config key is
  // present. So we only wire the webpack entry when webpack is actually in use;
  // under Turbopack the /__aegis rewrite still serves the widget — add
  // <script async src="/__aegis/widget.js"> to your root layout to show it (or run
  // `next dev --webpack` for auto-injection). See attach() for the one-time hint.
  let widgetEntry = null
  try { widgetEntry = require.resolve('@aegisrunner/cli/lib/aegisWidget.client.js') } catch { /* degrade to the manual <script> */ }
  if (widgetEntry && !usingTurbopack()) {
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
