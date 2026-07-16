// @aegisrunner/next — attach AegisRunner to your Next.js dev server.
//
// Next has no clean "server is listening" plugin hook, so this wraps your
// next.config: in the dev phase it opens a secure outbound tunnel to the dev
// port (from -p / PORT / 3000, or an explicit `port` option) once the server is
// up, and runs a full AI scan of your LOCALHOST app on `[a]` or on startup.
// No deploy, no staging URL. Prefer no config change? `aegis dev -- next dev`
// (from @aegisrunner/cli) does the same thing.
//
// Reuses the tunnel client, scan trigger and live-progress stream from
// @aegisrunner/cli so the protocol and auth live in exactly one place.
import { runTunnel } from '@aegisrunner/cli/lib/tunnel.mjs'
import { makeClient, streamScanEvents, waitForAppReady } from '@aegisrunner/cli/lib/api.mjs'
import { deriveLabel, aegisTag } from '@aegisrunner/cli/lib/label.mjs'
import { writeFileSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEV_PHASE = 'phase-development-server'

// Next evaluates next.config in SEVERAL processes for one `next dev` (the env
// var / module-state guards can't see across them), so we'd otherwise open a
// tunnel per process. Take a cross-process lock — an atomic exclusive lockfile
// keyed by the project dir — so exactly one process attaches. Stale locks
// (crashed run, >60s old) are reclaimed; the holder removes it on exit.
function acquireDevLock() {
  const lock = join(tmpdir(), `aegis-next-${Buffer.from(process.cwd()).toString('hex').slice(0, 20)}.lock`)
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' }) // atomic: fails if it exists
      process.on('exit', () => { try { unlinkSync(lock) } catch {} })
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') return true // unknown error → don't block
      try { if (Date.now() - statSync(lock).mtimeMs > 60_000) { unlinkSync(lock); continue } } catch {}
      return false // fresh lock held by a sibling process → this one skips
    }
  }
  return false
}

function portFromArgv() {
  const a = process.argv
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === '-p' || a[i] === '--port') && a[i + 1]) return Number(a[i + 1])
    const m = /^--port=(\d+)$/.exec(a[i]); if (m) return Number(m[1])
  }
  return null
}

function attach(opts) {
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

  let publicUrl = null
  let scanning = false
  const ac = new AbortController()

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

  // Next gives us no listen hook — wait briefly for the server to bind, then
  // open the tunnel to the known dev port.
  setTimeout(() => {
    runTunnel({
      api, token, port, host, log: info, signal: ac.signal,
      onReady: async (url) => {
        publicUrl = url
        info(`tunnel open → ${url}`)
        if (scanOn === 'startup') {
          info('waiting for your app to finish loading…')
          await waitForAppReady(host, port, { log: info })
          scan()
        } else info('press [a] + Enter to scan your local app')
      },
    }).catch((e) => err(`tunnel error: ${e.message}`))
  }, 1500)

  if (scanOn === 'manual' && process.stdin.isTTY) {
    process.stdin.on('data', (b) => { if (String(b).trim().toLowerCase() === 'a') scan() })
  }
  process.on('exit', () => { try { ac.abort() } catch {} })
}

/**
 * Wrap your Next config. In the dev phase it attaches AegisRunner; in every
 * other phase (build, prod) it's a pure pass-through.
 *
 * @param {object|Function} [nextConfig]  your existing next config (object or (phase,ctx)=>config)
 * @param {object} [opts]  { token, api, port, host, scanOn: 'manual'|'startup', label }
 */
export default function withAegisRunner(nextConfig = {}, opts = {}) {
  return (phase, ctx) => {
    const resolved = typeof nextConfig === 'function' ? nextConfig(phase, ctx) : nextConfig
    if (phase === DEV_PHASE) {
      try { attach(opts) } catch (e) { console.error(`[aegis] ${e.message}`) }
    }
    return resolved
  }
}
