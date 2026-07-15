// @aegisrunner/vite — attach AegisRunner to your Vite dev server.
//
// One line in vite.config puts an AI scan of your LOCALHOST app one keypress
// away: the plugin learns the dev-server port, opens a secure outbound tunnel
// (held for the whole session), and — on `[a]` or on startup — runs a full
// crawl + test generation and streams progress into your dev log. No deploy,
// no staging URL, no second terminal.
//
// The tunnel client, scan trigger and live-progress stream are reused verbatim
// from @aegisrunner/cli, so the protocol and auth live in exactly one place.
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'

/**
 * @param {object} [opts]
 * @param {string} [opts.token]   CI trigger token (default: process.env.AEGIS_TOKEN). Pro/Business.
 * @param {string} [opts.api]     API base (default: process.env.AEGIS_API or the public API).
 * @param {number} [opts.port]    Dev-server port (default: detected from the running server).
 * @param {string} [opts.host]    Local host to forward to (default: '127.0.0.1').
 * @param {'manual'|'startup'} [opts.scanOn]  'manual' (press [a]) or 'startup'. Default 'manual'.
 * @param {string} [opts.label]   Label shown in logs (default: package name) — disambiguates monorepo tunnels.
 */
export default function aegis(opts = {}) {
  const scanOn = opts.scanOn || 'manual'
  const host = opts.host || '127.0.0.1'
  const token = opts.token || process.env.AEGIS_TOKEN
  const api = opts.api || process.env.AEGIS_API
  const TAG = aegisTag(deriveLabel(opts.label))

  let publicUrl = null
  let scanning = false
  let ac = null
  let logger = console

  // Tag every line "◆ aegis·<label>" so parallel dev servers stay legible.
  const emit = (fn, mark, m) => { const s = `  ${mark} ${TAG}   ${m}`; (logger && logger[fn]) ? logger[fn](s) : console[fn === 'error' ? 'error' : fn === 'warn' ? 'warn' : 'log'](s) }
  const info = (m) => emit('info', '◆', m)
  const warn = (m) => emit('warn', '!', m)
  const err = (m) => emit('error', '!', m)

  async function scan() {
    if (scanning) { info('a scan is already running…'); return }
    if (!publicUrl) { info('tunnel not ready yet — one moment.'); return }
    scanning = true
    try {
      info('scanning your local app…')
      const res = await makeClient({ api, token }).trigger({ crawl: true, baseUrl: publicUrl })
      if (res.status === 'crawl_failed') { err(`scan failed to start: ${res.error ?? 'unknown error'}`); return }
      if (res.dashboardUrl) info(`results: ${res.dashboardUrl}`)
      if (!res.crawl_id) return
      await streamScanEvents({
        api, token, crawlId: res.crawl_id,
        onEvent: (event, d) => {
          d = d || {}
          if (event === 'crawl_progress') info(`crawling · ${d.pagesFound ?? '?'} page(s)`)
          else if (event === 'ai_generation_progress') info(`${d.phase_label || d.phase || 'generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`)
          else if (event === 'done') info(d.result === 'completed' ? '✓ scan complete — tests generated' : `scan ${d.result || 'ended'}`)
        },
      })
    } catch (e) {
      err(`scan error: ${e.message}`)
    } finally {
      scanning = false
      if (scanOn === 'manual') info('press [a] + Enter to scan again')
    }
  }

  return {
    name: 'aegisrunner',
    apply: 'serve', // dev only — never runs in `vite build`
    configureServer(server) {
      logger = server.config.logger || console
      if (!token) {
        warn('no CI trigger token — set AEGIS_TOKEN (or pass { token }). Skipping.')
        return
      }

      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address()
        const port = opts.port || (addr && typeof addr === 'object' ? addr.port : null)
        if (!port) { warn('could not determine the dev-server port — pass { port }.'); return }

        ac = new AbortController()
        runTunnel({
          api, token, port, host, log: info, signal: ac.signal,
          onReady: (url) => {
            publicUrl = url
            info(`tunnel open → ${url}`)
            if (scanOn === 'startup') scan()
            else info('press [a] + Enter to scan your local app')
          },
        }).catch((e) => err(`tunnel error: ${e.message}`))
      })

      if (scanOn === 'manual' && process.stdin.isTTY) {
        process.stdin.on('data', (buf) => { if (String(buf).trim().toLowerCase() === 'a') scan() })
      }

      const close = () => { try { ac?.abort() } catch {} }
      server.httpServer?.once('close', close)
      const orig = server.close?.bind(server)
      if (orig) server.close = async (...a) => { close(); return orig(...a) }
    },
  }
}
