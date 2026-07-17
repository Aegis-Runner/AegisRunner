// @aegisrunner/nuxt — attach AegisRunner to your Nuxt dev server.
//
// Add the module and one config block. On `nuxt dev` it learns the dev-server
// port (the `listen` hook) and, by DEFAULT, runs the scan ENTIRELY on your
// machine: a real browser (@aegisrunner/scan-runner) drives your app at
// http://localhost directly — no cloud relay, no tunnel. That's the fastest,
// most reliable path for big apps, and your app + credentials never leave your
// machine. Prefer to relay OUR cloud browser over an outbound tunnel instead?
// Set `aegis.runner: 'tunnel'`.
//
// A floating AegisRunner widget is injected into your app — click it to "Test
// this page" or "Test the whole site", add login credentials for gated pages,
// and watch progress. A native Nuxt DevTools tab shows the same status with a
// one-click "Scan now". You can also press [a] in the terminal, or scan on startup.
//
// The runner lifecycle, tunnel client, scan trigger, live-progress stream and the
// widget all come from @aegisrunner/cli so the protocol + auth live in one place.
import { defineNuxtModule, useLogger, addDevServerHandler } from '@nuxt/kit'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { getWidgetJs } from '@aegisrunner/cli/lib/devWidget.mjs'
import { createDevSession } from '@aegisrunner/cli/lib/devSession.mjs'

export default defineNuxtModule({
  meta: { name: '@aegisrunner/nuxt', configKey: 'aegis' },
  defaults: { scanOn: 'manual', host: '127.0.0.1', widget: true, runner: 'local' },
  setup(opts, nuxt) {
    if (!nuxt.options.dev) return // dev-only; no-op in build/production

    const logger = useLogger(aegisTag(deriveLabel(opts.label)))
    const token = opts.token || process.env.AEGIS_TOKEN
    if (!token) {
      logger.warn('no CI trigger token — set AEGIS_TOKEN (or aegis.token). Skipping.')
      return
    }
    const api = opts.api || process.env.AEGIS_API
    const mode = opts.runner === 'tunnel' ? 'tunnel' : 'local'
    const showWidget = opts.widget !== false

    // Created in the `listen` hook once the port is known. The dev-server handlers
    // below are registered synchronously and delegate to it — always before the
    // first request arrives (which only happens after the server is listening).
    let session = null

    nuxt.hook('listen', (server, listener) => {
      const port = opts.port
        || listener?.address?.port
        || (typeof listener?.port === 'number' ? listener.port : null)
        || (typeof server?.address === 'function' ? server.address()?.port : null)
      if (!port) { logger.warn('could not determine the dev-server port — set aegis.port.'); return }

      session = createDevSession({
        token, api, host: opts.host, port, mode,
        scanOn: opts.scanOn, widget: showWidget, log: (m) => logger.info(m),
      })
      if (showWidget) logger.info('AegisRunner widget ready — click the shield in your app to scan.')
      session.start()
    })

    if (opts.scanOn === 'manual' && process.stdin.isTTY) {
      process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a' && session) session.scanSite() })
    }

    // --- In-app widget: served + injected on every dev page. ---
    if (showWidget) {
      addDevServerHandler({ route: '/__aegis/widget.js', handler: (event) => {
        event.node.res.setHeader('content-type', 'application/javascript; charset=utf-8')
        return getWidgetJs()
      }})
      addDevServerHandler({ route: '/__aegis/status', handler: (event) => {
        event.node.res.setHeader('content-type', 'application/json')
        return JSON.stringify(session ? session.getStatus() : { scanning: false, message: 'Connecting…', error: false })
      }})
      addDevServerHandler({ route: '/__aegis/credentials', handler: async (event) => {
        const b = await readJsonBody(event)
        if (session) session.setCredentials({ username: String(b?.username || ''), password: String(b?.password || '') })
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
      const s = session?.state
      return JSON.stringify({
        mode: s?.mode || mode,
        ready: !!s?.ready,
        tunnel: s?.publicUrl || null,        // null in local mode
        scanning: !!s?.scanning,
        last: s?.last || null,
      })
    }})
    addDevServerHandler({ route: '/__aegis/scan', handler: async (event) => {
      const b = await readJsonBody(event) // { scope?, path? } from the widget; empty from the panel
      if (session) session.scan({ scope: b?.scope, path: b?.path }) // fire-and-forget; poll /status or /state
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

    nuxt.hook('close', () => { try { session?.stop() } catch { /* ignore */ } })
  },
})

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
    <div class="row"><span class="k">runs on</span><span class="v" id="where">—</span></div>
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
      $('where').textContent = s.mode==='tunnel' ? (s.tunnel||'opening tunnel…') : 'your machine (local)'
      const st=$('status'); st.className='badge '+(s.scanning?'run':(s.ready?'ok':'warn'))
      st.textContent=s.scanning?'scanning…':(s.ready?'ready':'connecting')
      $('scan').disabled=!s.ready||s.scanning
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
