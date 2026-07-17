// @aegisrunner/nuxt — attach AegisRunner to your Nuxt dev server.
//
// Add the module and one config block: on `nuxt dev` it learns the dev-server
// port (the `listen` hook), opens a secure outbound tunnel to it, and injects a
// floating AegisRunner widget into your app — click it to "Test this page" or
// "Test the whole site", add login credentials for gated pages, and watch
// progress. A native Nuxt DevTools tab shows the same status with a one-click
// "Scan now". You can also press `[a]` in the terminal, or scan on startup.
//
// The tunnel client, scan trigger, live-progress stream and the widget itself are
// reused verbatim from @aegisrunner/cli, so the protocol + auth live in one place.
import { defineNuxtModule, useLogger, addDevServerHandler } from '@nuxt/kit'
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents, waitForAppReady } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { getWidgetJs, widgetStatus } from '@aegisrunner/cli/lib/devWidget.mjs'

export default defineNuxtModule({
  meta: { name: '@aegisrunner/nuxt', configKey: 'aegis' },
  defaults: { scanOn: 'manual', host: '127.0.0.1', widget: true },
  setup(opts, nuxt) {
    if (!nuxt.options.dev) return // dev-only; no-op in build/production

    const logger = useLogger(aegisTag(deriveLabel(opts.label)))
    const token = opts.token || process.env.AEGIS_TOKEN
    if (!token) {
      logger.warn('no CI trigger token — set AEGIS_TOKEN (or aegis.token). Skipping.')
      return
    }
    const api = opts.api || process.env.AEGIS_API

    // Shared state — the terminal, the DevTools panel AND the in-app widget read this.
    const state = { tunnel: null, scanning: false, last: null, msg: null, creds: null }
    let ac = null

    // scope: 'site' (full crawl from root) | 'page' (just the current route).
    async function scan({ scope = 'site', path = '/' } = {}) {
      if (state.scanning) { logger.info('a scan is already running…'); return }
      if (!state.tunnel) { logger.info('tunnel not ready yet — one moment.'); state.msg = 'Connecting…'; return }
      state.scanning = true
      const isPage = scope === 'page'
      const baseUrl = isPage ? joinUrl(state.tunnel, path) : state.tunnel
      state.msg = isPage ? 'Scanning this page…' : 'Scanning the whole site…'
      try {
        logger.info(state.msg + ` → ${baseUrl}`)
        const body = { crawl: true, baseUrl }
        if (isPage) { body.maxPages = 1; body.maxDepth = 0 }
        if (state.creds && state.creds.username) body.credentials = { username: state.creds.username, password: state.creds.password || '' }
        const res = await makeClient({ api, token }).trigger(body)
        if (res.status === 'crawl_failed') { logger.error(`scan failed to start: ${res.error ?? 'unknown error'}`); state.last = { result: 'failed', error: res.error }; state.msg = `Scan failed: ${res.error ?? 'unknown error'}`; return }
        state.last = { crawlId: res.crawl_id, dashboardUrl: res.dashboardUrl || null, result: 'running', pages: 0 }
        if (res.dashboardUrl) logger.info(`results: ${res.dashboardUrl}`)
        if (!res.crawl_id) return
        await streamScanEvents({
          api, token, crawlId: res.crawl_id,
          onEvent: (event, d) => {
            d = d || {}
            if (event === 'crawl_progress') { state.last.pages = d.pagesFound ?? state.last.pages; state.msg = `Crawling · ${d.pagesFound ?? '?'} page(s)`; logger.info(state.msg) }
            else if (event === 'ai_generation_progress') { state.last.phase = d.phase_label || d.phase; state.msg = `${d.phase_label || d.phase || 'Generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`; logger.info(state.msg) }
            else if (event === 'done') { state.last.result = d.result || 'ended'; state.msg = d.result === 'completed' ? '✓ Tests generated.' : `Scan ${d.result || 'ended'}.`; logger.info(state.msg) }
          },
        })
      } catch (e) {
        logger.error(`scan error: ${e.message}`); state.last = { result: 'failed', error: e.message }; state.msg = `Scan error: ${e.message}`
      } finally {
        state.scanning = false
        if (!state.last || state.last.result === 'running') state.msg = 'Ready to scan.'
      }
    }

    // Learn the port the dev server bound to, then open the tunnel.
    nuxt.hook('listen', (server, listener) => {
      const port = opts.port
        || listener?.address?.port
        || (typeof listener?.port === 'number' ? listener.port : null)
        || (typeof server?.address === 'function' ? server.address()?.port : null)
      if (!port) { logger.warn('could not determine the dev-server port — set aegis.port.'); return }
      ac = new AbortController()
      runTunnel({
        api, token, port, host: opts.host, log: (m) => logger.info(m), signal: ac.signal,
        onReady: async (url) => {
          state.tunnel = url
          logger.success(`tunnel open → ${url}`)
          if (opts.widget !== false) logger.info('AegisRunner widget ready — click the shield in your app to scan.')
          if (opts.scanOn === 'startup') {
            logger.info('waiting for your app to finish loading…')
            await waitForAppReady(opts.host, port, { log: (m) => logger.info(m) })
            scan({ scope: 'site' })
          } else logger.info('press [a] + Enter to scan (or use the in-app widget / DevTools tab)')
        },
      }).catch((e) => logger.error(`tunnel error: ${e.message}`))
    })

    if (opts.scanOn === 'manual' && process.stdin.isTTY) {
      process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') scan({ scope: 'site' }) })
    }

    // --- In-app widget: served + injected on every dev page. ---
    if (opts.widget !== false) {
      addDevServerHandler({ route: '/__aegis/widget.js', handler: (event) => {
        event.node.res.setHeader('content-type', 'application/javascript; charset=utf-8')
        return getWidgetJs()
      }})
      addDevServerHandler({ route: '/__aegis/status', handler: (event) => {
        event.node.res.setHeader('content-type', 'application/json')
        return JSON.stringify(widgetStatus({ scanning: state.scanning, tunnel: state.tunnel, message: state.msg, resultsUrl: state.last?.dashboardUrl, error: state.last?.result === 'failed' }))
      }})
      addDevServerHandler({ route: '/__aegis/credentials', handler: async (event) => {
        const b = await readJsonBody(event)
        state.creds = b && b.username ? { username: String(b.username), password: String(b.password || '') } : null
        logger.info(state.creds ? `credentials set for ${state.creds.username}` : 'credentials cleared')
        event.node.res.setHeader('content-type', 'application/json')
        return JSON.stringify({ ok: true })
      }})
      // Inject the widget script into every rendered dev page.
      nuxt.options.app = nuxt.options.app || {}
      nuxt.options.app.head = nuxt.options.app.head || {}
      nuxt.options.app.head.script = nuxt.options.app.head.script || []
      nuxt.options.app.head.script.push({ src: '/__aegis/widget.js', defer: true, tagPosition: 'bodyClose' })
    }

    // --- DevTools panel + shared scan/state handlers. ---
    addDevServerHandler({ route: '/__aegis/state', handler: (event) => {
      event.node.res.setHeader('content-type', 'application/json')
      return JSON.stringify({ tunnel: state.tunnel, scanning: state.scanning, last: state.last })
    }})
    addDevServerHandler({ route: '/__aegis/scan', handler: async (event) => {
      const b = await readJsonBody(event) // { scope?, path? } from the widget; empty from the panel
      scan({ scope: b?.scope, path: b?.path }) // fire-and-forget; poll /status or /state
      event.node.res.setHeader('content-type', 'application/json')
      return JSON.stringify({ ok: true })
    }})
    addDevServerHandler({ route: '/__aegis', handler: (event) => {
      event.node.res.setHeader('content-type', 'text/html')
      return PANEL_HTML
    }})

    nuxt.hook('devtools:customTabs', (tabs) => tabs.push({
      name: 'aegisrunner',
      title: 'AegisRunner',
      icon: 'carbon:security',
      view: { type: 'iframe', src: '/__aegis' },
    }))

    nuxt.hook('close', () => { try { ac?.abort() } catch {} })
  },
})

function joinUrl(base, path) {
  try { return new URL(path || '/', base).toString() } catch { return base }
}

function readJsonBody(event) {
  return new Promise((resolve) => {
    try {
      const req = event.node.req
      let d = ''
      req.on('data', (c) => { d += c; if (d.length > 1e6) { d = ''; req.destroy() } })
      req.on('end', () => { try { resolve(JSON.parse(d || '{}')) } catch { resolve({}) } })
      req.on('error', () => resolve({}))
    } catch { resolve({}) }
  })
}

// Self-contained DevTools panel (theme-aware, zero deps). Polls /__aegis/state.
const PANEL_HTML = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--bg:#fff;--ink:#15232a;--muted:#5b6b70;--line:#e2e8ea;--accent:#0a8ea1;--ok:#1c8a5f;--warn:#a56a12;--card:#f6f9fa}
  @media(prefers-color-scheme:dark){:root{--bg:#0e1416;--ink:#dbe6e9;--muted:#8ba0a6;--line:#233034;--accent:#24c3d6;--ok:#45c78d;--warn:#d3982f;--card:#131b1e}}
  *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{padding:16px;max-width:640px}
  h1{font-size:15px;margin:0 0 2px;letter-spacing:-.01em}.sub{color:var(--muted);font-size:12px;margin:0 0 16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
  .row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin:4px 0}
  .k{color:var(--muted);font-size:12px}.v{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all;text-align:right}
  a{color:var(--accent)}
  .badge{font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}
  .badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
  .badge.run{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
  .badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}
  button{font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:8px;padding:8px 16px}
  button:disabled{opacity:.55;cursor:default}
  button.ghost{background:transparent;color:var(--accent)}
  .muted{color:var(--muted);font-size:12px}
</style></head><body><div class="wrap">
  <h1>AegisRunner</h1>
  <p class="sub">Scan this localhost app with AI — no deploy.</p>
  <div class="card">
    <div class="row"><span class="k">tunnel</span><span class="v" id="tunnel">—</span></div>
    <div class="row"><span class="k">status</span><span id="status" class="badge">idle</span></div>
  </div>
  <div class="card" id="lastCard" style="display:none">
    <div class="row"><span class="k">last scan</span><span id="lastResult" class="badge">—</span></div>
    <div class="row"><span class="k">pages</span><span class="v" id="lastPages">—</span></div>
    <div class="row"><span class="k">report</span><span class="v"><a id="lastLink" href="#" target="_blank" rel="noreferrer">open ↗</a></span></div>
  </div>
  <p><button id="scan">Scan now</button> <button class="ghost" id="refresh">Refresh</button></p>
  <p class="muted">You can also press <b>[a]</b> in your dev terminal, or use the in-app widget.</p>
<script>
  const $=id=>document.getElementById(id)
  async function pull(){
    try{
      const s=await (await fetch('/__aegis/state')).json()
      $('tunnel').textContent=s.tunnel||'opening…'
      const st=$('status'); st.className='badge '+(s.scanning?'run':(s.tunnel?'ok':'warn'))
      st.textContent=s.scanning?'scanning…':(s.tunnel?'ready':'connecting')
      $('scan').disabled=!s.tunnel||s.scanning
      if(s.last){$('lastCard').style.display=''
        const r=$('lastResult'); r.className='badge '+(s.last.result==='completed'?'ok':s.last.result==='running'?'run':'warn')
        r.textContent=s.last.result||'—'
        $('lastPages').textContent=s.last.pages??'—'
        const a=$('lastLink'); if(s.last.dashboardUrl){a.href=s.last.dashboardUrl;a.style.display=''}else{a.style.display='none'}
      }
    }catch{}
  }
  $('scan').onclick=async()=>{$('scan').disabled=true;await fetch('/__aegis/scan',{method:'POST'});setTimeout(pull,400)}
  $('refresh').onclick=pull
  pull();setInterval(pull,1500)
</script></div></body></html>`
