// @aegisrunner/vite — attach AegisRunner to your Vite dev server.
//
// One line in vite.config puts an AI scan of your LOCALHOST app right in the
// browser: the plugin learns the dev-server port, opens a secure outbound tunnel
// (held for the whole session), and injects a floating AegisRunner widget into
// your dev app. Click it to "Test this page" or "Test the whole site", add login
// credentials for gated pages, and watch progress — no deploy, no staging URL,
// no second terminal. (You can still press `[a]` in the terminal, or scan on
// startup.)
//
// The tunnel client, scan trigger, live-progress stream and the widget/control
// protocol are reused verbatim from @aegisrunner/cli, so the protocol and auth
// live in exactly one place.
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents, waitForAppReady } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { createAegisControl, aegisWidgetTag } from '@aegisrunner/cli/lib/devWidget.mjs'

/**
 * @param {object} [opts]
 * @param {string} [opts.token]   CI trigger token (default: process.env.AEGIS_TOKEN). Pro/Business.
 * @param {string} [opts.api]     API base (default: process.env.AEGIS_API or the public API).
 * @param {number} [opts.port]    Dev-server port (default: detected from the running server).
 * @param {string} [opts.host]    Local host to forward to (default: '127.0.0.1').
 * @param {'manual'|'startup'} [opts.scanOn]  'manual' or 'startup'. Default 'manual'.
 * @param {boolean} [opts.widget]  Inject the in-page widget (default true).
 * @param {string} [opts.label]   Label shown in logs (default: package name).
 */
export default function aegis(opts = {}) {
  const scanOn = opts.scanOn || 'manual'
  const host = opts.host || '127.0.0.1'
  const token = opts.token || process.env.AEGIS_TOKEN
  const api = opts.api || process.env.AEGIS_API
  const showWidget = opts.widget !== false
  const TAG = aegisTag(deriveLabel(opts.label))

  let publicUrl = null
  let scanning = false
  let ac = null
  let logger = console
  let creds = null
  // Widget/CLI-visible status. resultsUrl is set when a scan finishes.
  const status = { scanning: false, message: 'Ready to scan.', resultsUrl: null, error: false }

  const emit = (fn, mark, m) => { const s = `  ${mark} ${TAG}   ${m}`; (logger && logger[fn]) ? logger[fn](s) : console[fn === 'error' ? 'error' : fn === 'warn' ? 'warn' : 'log'](s) }
  const info = (m) => emit('info', '◆', m)
  const warn = (m) => emit('warn', '!', m)
  const err = (m) => emit('error', '!', m)

  // scope: 'site' (full crawl from root) | 'page' (just the current route). path
  // is the current route for page scope.
  async function scan({ scope = 'site', path = '/' } = {}) {
    if (scanning) { info('a scan is already running…'); return }
    if (!publicUrl) { info('tunnel not ready yet — one moment.'); status.message = 'Connecting…'; return }
    scanning = true
    status.scanning = true; status.error = false; status.resultsUrl = null
    const isPage = scope === 'page'
    const baseUrl = isPage ? joinUrl(publicUrl, path) : publicUrl
    status.message = isPage ? 'Scanning this page…' : 'Scanning the whole site…'
    try {
      info(status.message + ` → ${baseUrl}`)
      const body = { crawl: true, baseUrl }
      if (isPage) { body.maxPages = 1; body.maxDepth = 0 }     // just this route
      if (creds && creds.username) body.credentials = { username: creds.username, password: creds.password || '' }
      const res = await makeClient({ api, token }).trigger(body)
      if (res.status === 'crawl_failed') { status.error = true; status.message = `Scan failed: ${res.error ?? 'unknown error'}`; err(status.message); return }
      if (res.dashboardUrl) { status.resultsUrl = res.dashboardUrl; info(`results: ${res.dashboardUrl}`) }
      if (!res.crawl_id) return
      await streamScanEvents({
        api, token, crawlId: res.crawl_id,
        onEvent: (event, d) => {
          d = d || {}
          if (event === 'crawl_progress') { status.message = `Crawling · ${d.pagesFound ?? '?'} page(s)`; info(status.message) }
          else if (event === 'ai_generation_progress') { status.message = `${d.phase_label || d.phase || 'Generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`; info(status.message) }
          else if (event === 'done') { status.message = d.result === 'completed' ? '✓ Tests generated.' : `Scan ${d.result || 'ended'}.`; info(status.message) }
        },
      })
    } catch (e) {
      status.error = true; status.message = `Scan error: ${e.message}`; err(status.message)
    } finally {
      scanning = false
      status.scanning = false
      if (scanOn === 'manual' && !status.error && !status.resultsUrl) status.message = 'Ready to scan.'
    }
  }

  const control = createAegisControl({
    onScan: (r) => { scan(r) },
    setCredentials: (c) => { creds = c && c.username ? c : null; info(creds ? `credentials set for ${creds.username}` : 'credentials cleared') },
    getStatus: () => ({ scanning: status.scanning, message: status.message, resultsUrl: status.resultsUrl || undefined, error: status.error }),
  })

  return {
    name: 'aegisrunner',
    apply: 'serve', // dev only — never runs in `vite build`

    // Inject the widget into every served HTML document.
    transformIndexHtml(html) {
      if (!token || !showWidget) return html
      return { html, tags: [{ tag: 'script', attrs: { src: '/__aegis/widget.js', defer: true }, injectTo: 'body' }] }
    },

    configureServer(server) {
      logger = server.config.logger || console
      if (!token) {
        warn('no CI trigger token — set AEGIS_TOKEN (or pass { token }). Skipping.')
        return
      }

      // Serve the widget + control endpoints.
      server.middlewares.use((req, res, next) => { control(req, res).then((handled) => { if (!handled) next() }).catch(() => next()) })

      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address()
        const port = opts.port || (addr && typeof addr === 'object' ? addr.port : null)
        if (!port) { warn('could not determine the dev-server port — pass { port }.'); return }

        ac = new AbortController()
        runTunnel({
          api, token, port, host, log: info, signal: ac.signal,
          onReady: async (url) => {
            publicUrl = url
            info(`tunnel open → ${url}`)
            if (showWidget) info('AegisRunner widget ready — click the shield in your app to scan.')
            if (scanOn === 'startup') {
              info('waiting for your app to finish loading…')
              await waitForAppReady(host, port, { log: info })
              scan({ scope: 'site' })
            } else info('press [a] + Enter to scan, or use the in-app widget')
          },
        }).catch((e) => err(`tunnel error: ${e.message}`))
      })

      if (scanOn === 'manual' && process.stdin.isTTY) {
        process.stdin.on('data', (buf) => { if (String(buf).trim().toLowerCase() === 'a') scan({ scope: 'site' }) })
      }

      const close = () => { try { ac?.abort() } catch {} }
      server.httpServer?.once('close', close)
      const orig = server.close?.bind(server)
      if (orig) server.close = async (...a) => { close(); return orig(...a) }
    },
  }
}

function joinUrl(base, path) {
  try { return new URL(path || '/', base).toString() } catch { return base }
}
