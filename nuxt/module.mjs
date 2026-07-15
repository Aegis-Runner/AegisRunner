// @aegisrunner/nuxt — attach AegisRunner to your Nuxt dev server.
//
// Add the module and one config block: on `nuxt dev` it learns the dev-server
// port (the `listen` hook), opens a secure outbound tunnel to it, and — on `[a]`
// or on startup — runs a full AI crawl + test generation against your LOCALHOST
// app, streaming progress into your dev log. No deploy, no staging URL. A native
// Nuxt DevTools tab (served from a local /__aegis route) shows live status and a
// one-click "Scan now".
//
// The tunnel client, scan trigger and live-progress stream are reused verbatim
// from @aegisrunner/cli, so the protocol and auth live in exactly one place.
import { defineNuxtModule, useLogger, addDevServerHandler } from '@nuxt/kit'
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'

export default defineNuxtModule({
  meta: { name: '@aegisrunner/nuxt', configKey: 'aegis' },
  defaults: { scanOn: 'manual', host: '127.0.0.1' },
  setup(opts, nuxt) {
    // Dev-only: a no-op during `nuxt build` / production.
    if (!nuxt.options.dev) return

    const logger = useLogger(aegisTag(deriveLabel(opts.label)))
    const token = opts.token || process.env.AEGIS_TOKEN
    if (!token) {
      logger.warn('no CI trigger token — set AEGIS_TOKEN (or aegis.token). Skipping.')
      return
    }
    const api = opts.api || process.env.AEGIS_API

    // Shared state — the terminal AND the DevTools panel read from this.
    const state = { tunnel: null, scanning: false, last: null }
    let ac = null

    async function scan() {
      if (state.scanning) { logger.info('a scan is already running…'); return }
      if (!state.tunnel) { logger.info('tunnel not ready yet — one moment.'); return }
      state.scanning = true
      try {
        logger.info('scanning your local app…')
        const res = await makeClient({ api, token }).trigger({ crawl: true, baseUrl: state.tunnel })
        if (res.status === 'crawl_failed') { logger.error(`scan failed to start: ${res.error ?? 'unknown error'}`); state.last = { result: 'failed', error: res.error }; return }
        state.last = { crawlId: res.crawl_id, dashboardUrl: res.dashboardUrl || null, result: 'running', pages: 0 }
        if (res.dashboardUrl) logger.info(`results: ${res.dashboardUrl}`)
        if (!res.crawl_id) return
        await streamScanEvents({
          api, token, crawlId: res.crawl_id,
          onEvent: (event, d) => {
            d = d || {}
            if (event === 'crawl_progress') { state.last.pages = d.pagesFound ?? state.last.pages; logger.info(`crawling · ${d.pagesFound ?? '?'} page(s)`) }
            else if (event === 'ai_generation_progress') { state.last.phase = d.phase_label || d.phase; logger.info(`${d.phase_label || d.phase || 'generating tests'}${d.progress != null ? ' · ' + d.progress + '%' : ''}`) }
            else if (event === 'done') { state.last.result = d.result || 'ended'; logger.info(d.result === 'completed' ? '✓ scan complete — tests generated' : `scan ${d.result || 'ended'}`) }
          },
        })
      } catch (e) {
        logger.error(`scan error: ${e.message}`)
      } finally {
        state.scanning = false
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
        onReady: (url) => {
          state.tunnel = url
          logger.success(`tunnel open → ${url}`)
          if (opts.scanOn === 'startup') scan()
          else logger.info('press [a] + Enter to scan (or use the AegisRunner DevTools tab)')
        },
      }).catch((e) => logger.error(`tunnel error: ${e.message}`))
    })

    if (opts.scanOn === 'manual' && process.stdin.isTTY) {
      process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') scan() })
    }

    // --- Native DevTools panel: a local, same-origin route the tab iframes
    // (the dashboard sets X-Frame-Options, so we render status ourselves). ---
    addDevServerHandler({ route: '/__aegis/state', handler: (event) => {
      event.node.res.setHeader('content-type', 'application/json')
      return JSON.stringify(state)
    }})
    addDevServerHandler({ route: '/__aegis/scan', handler: (event) => {
      scan() // fire-and-forget; the panel polls /state for progress
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

// Self-contained DevTools panel. Polls /__aegis/state, renders tunnel + last
// scan, and POSTs /__aegis/scan on the button. Theme-aware, zero deps.
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
  <p class="muted">You can also press <b>[a]</b> in your dev terminal.</p>
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
