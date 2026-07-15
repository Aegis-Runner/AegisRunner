// @aegisrunner/nuxt — attach AegisRunner to your Nuxt dev server.
//
// Add the module and one config block: on `nuxt dev` it learns the dev-server
// port (the `listen` hook), opens a secure outbound tunnel to it, and — on `[a]`
// or on startup — runs a full AI crawl + test generation against your LOCALHOST
// app, streaming progress into your dev log. No deploy, no staging URL. A Nuxt
// DevTools tab links out to the results.
//
// The tunnel client, scan trigger and live-progress stream are reused verbatim
// from @aegisrunner/cli, so the protocol and auth live in exactly one place.
import { defineNuxtModule, useLogger } from '@nuxt/kit'
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents } from '@aegisrunner/cli/lib/api.mjs'

export default defineNuxtModule({
  meta: { name: '@aegisrunner/nuxt', configKey: 'aegis' },
  defaults: { scanOn: 'manual', host: '127.0.0.1' },
  setup(opts, nuxt) {
    // Dev-only: a no-op during `nuxt build` / production.
    if (!nuxt.options.dev) return

    const logger = useLogger('aegis')
    const token = opts.token || process.env.AEGIS_TOKEN
    if (!token) {
      logger.warn('no CI trigger token — set AEGIS_TOKEN (or aegis.token). Skipping.')
      return
    }
    const api = opts.api || process.env.AEGIS_API

    let publicUrl = null
    let scanning = false
    let ac = null

    async function scan() {
      if (scanning) { logger.info('a scan is already running…'); return }
      if (!publicUrl) { logger.info('tunnel not ready yet — one moment.'); return }
      scanning = true
      try {
        logger.info('scanning your local app…')
        const res = await makeClient({ api, token }).trigger({ crawl: true, baseUrl: publicUrl })
        if (res.status === 'crawl_failed') { logger.error(`scan failed to start: ${res.error ?? 'unknown error'}`); return }
        if (res.dashboardUrl) logger.info(`results: ${res.dashboardUrl}`)
        if (!res.crawl_id) return
        await streamScanEvents({
          api, token, crawlId: res.crawl_id,
          onEvent: (event, d) => {
            d = d || {}
            if (event === 'crawl_progress') logger.info(`crawling · ${d.pagesFound ?? '?'} page(s)`)
            else if (event === 'ai_generation_progress') logger.info(`${d.phase_label || d.phase || 'generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`)
            else if (event === 'done') logger.info(d.result === 'completed' ? '✓ scan complete — tests generated' : `scan ${d.result || 'ended'}`)
          },
        })
      } catch (e) {
        logger.error(`scan error: ${e.message}`)
      } finally {
        scanning = false
        if (opts.scanOn === 'manual') logger.info('press [a] + Enter to scan again')
      }
    }

    // Learn the port the dev server actually bound to, then open the tunnel.
    nuxt.hook('listen', (server, listener) => {
      const port = opts.port
        || listener?.address?.port
        || (typeof listener?.port === 'number' ? listener.port : null)
        || (typeof server?.address === 'function' ? server.address()?.port : null)
      if (!port) { logger.warn('could not determine the dev-server port — set aegis.port.'); return }
      ac = new AbortController()
      runTunnel({
        api, token, port, host: opts.host, log: (m) => logger.info(m), signal: ac.signal,
        onReady: (url) => {
          publicUrl = url
          logger.success(`tunnel open → ${url}`)
          if (opts.scanOn === 'startup') scan()
          else logger.info('press [a] + Enter to scan your local app')
        },
      }).catch((e) => logger.error(`tunnel error: ${e.message}`))
    })

    // Manual trigger: watch stdin for `a` (best-effort — Nuxt owns stdin for its
    // own shortcuts too). `scanOn: 'startup'` is the zero-keypress alternative.
    if (opts.scanOn === 'manual' && process.stdin.isTTY) {
      process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') scan() })
    }

    // Nuxt DevTools tab. The dashboard sets X-Frame-Options, so v0.1 links out
    // rather than embedding it; a native inline view (pages/issues) is a follow-up.
    nuxt.hook('devtools:customTabs', (tabs) => {
      tabs.push({
        name: 'aegisrunner',
        title: 'AegisRunner',
        icon: 'carbon:security',
        view: {
          type: 'launch',
          description: 'Scan your localhost app with AegisRunner — press [a] in your dev terminal to run an AI scan. Generated tests, accessibility, SEO and functional findings open in the dashboard at app.aegisrunner.com.',
          actions: [],
        },
      })
    })

    // Close the tunnel cleanly when the dev server shuts down.
    nuxt.hook('close', () => { try { ac?.abort() } catch {} })
  },
})
