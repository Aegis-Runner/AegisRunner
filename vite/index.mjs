// @aegisrunner/vite — attach AegisRunner to your Vite dev server.
//
// One line in vite.config puts an AI scan of your LOCALHOST app right in the
// browser. By DEFAULT the scan runs ENTIRELY on your machine: a real browser
// (@aegisrunner/scan-runner) drives your app at http://localhost directly — no
// cloud relay, no tunnel. That's the fastest, most reliable path for big apps
// (hundreds of routes, Vite's module bursts) and your app + credentials never
// leave your machine. Prefer to relay OUR cloud browser over an outbound tunnel
// instead (nothing to install locally)? Pass { runner: 'tunnel' }.
//
// A floating AegisRunner widget is injected into your dev app: click it to
// "Test this page" or "Test the whole site", add login credentials for gated
// pages, and watch progress. You can still press [a] in the terminal, or scan on
// startup.
//
// The runner lifecycle, tunnel client, scan trigger, live-progress stream and the
// widget/control protocol all come from @aegisrunner/cli so the protocol and auth
// live in exactly one place.
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { createDevSession } from '@aegisrunner/cli/lib/devSession.mjs'

/**
 * @param {object} [opts]
 * @param {string} [opts.token]   CI trigger token (default: process.env.AEGIS_TOKEN). Pro/Business.
 * @param {string} [opts.api]     API base (default: process.env.AEGIS_API or the public API).
 * @param {'local'|'tunnel'} [opts.runner]  where the browser runs. 'local' (default) — on your
 *        machine, scanning http://localhost directly (no tunnel). 'tunnel' — relay our cloud browser.
 * @param {number} [opts.port]    Dev-server port (default: detected from the running server).
 * @param {string} [opts.host]    Local host the app listens on (default: '127.0.0.1').
 * @param {'manual'|'startup'} [opts.scanOn]  'manual' (press a / click) or 'startup'. Default 'manual'.
 * @param {boolean} [opts.widget]  Inject the in-page widget (default true).
 * @param {string} [opts.label]   Label shown in logs (default: package name).
 */
export default function aegis(opts = {}) {
  const token = opts.token || process.env.AEGIS_TOKEN
  const api = opts.api || process.env.AEGIS_API
  const host = opts.host || '127.0.0.1'
  const mode = opts.runner === 'tunnel' ? 'tunnel' : 'local'
  const scanOn = opts.scanOn || 'manual'
  const showWidget = opts.widget !== false
  const TAG = aegisTag(deriveLabel(opts.label))

  let logger = console
  const emit = (fn, mark, m) => { const s = `  ${mark} ${TAG}   ${m}`; (logger && logger[fn]) ? logger[fn](s) : console[fn === 'error' ? 'error' : fn === 'warn' ? 'warn' : 'log'](s) }
  const info = (m) => emit('info', '◆', m)
  const warn = (m) => emit('warn', '!', m)

  let session = null

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
      if (!token) { warn('no CI trigger token — set AEGIS_TOKEN (or pass { token }). Skipping.'); return }

      // Serve the widget + control endpoints. Registered synchronously (before the
      // server starts listening) so /__aegis is caught; it delegates to the session,
      // which is created once we know the port — always before the first request.
      server.middlewares.use((req, res, next) => {
        const control = session && session.control
        if (!control) return next()
        control(req, res).then((handled) => { if (!handled) next() }).catch(() => next())
      })

      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address()
        const port = opts.port || (addr && typeof addr === 'object' ? addr.port : null)
        if (!port) { warn('could not determine the dev-server port — pass { port }.'); return }

        session = createDevSession({ token, api, host, port, mode, scanOn, widget: showWidget, log: info })
        if (showWidget) info('AegisRunner widget ready — click the shield in your app to scan.')
        session.start()

        if (scanOn === 'manual' && process.stdin.isTTY) {
          process.stdin.on('data', (buf) => { if (String(buf).trim().toLowerCase() === 'a') session.scanSite() })
        }
      })

      const close = () => { try { session?.stop() } catch { /* ignore */ } }
      server.httpServer?.once('close', close)
      const orig = server.close?.bind(server)
      if (orig) server.close = async (...a) => { close(); return orig(...a) }
    },
  }
}
