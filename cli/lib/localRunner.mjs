// localRunner.mjs — start & supervise the local browser executor used by the
// framework dev plugins' "local execution" mode (runner: 'local').
//
// The executor is @aegisrunner/scan-runner: a real headless Chromium (Playwright)
// that claims scan jobs over OUTBOUND-only HTTPS and drives them against your app
// on THIS machine — no cloud relay, no tunnel. It lives in its own package (so the
// CLI/plugins stay light) and is fetched + cached on first use via `npx`. The token
// and any credentials go via ENV, never argv, so they don't leak into the process
// list — and for a local scan the credentials never leave this machine at all.
import { spawn } from 'node:child_process'

// The executor prints this once it's authenticated and polling for scan sessions.
const READY_RE = /scan executor online|polling .* for scan/i

/**
 * Spawn the local scan-runner and return handles to wait for readiness / stop it.
 * @param {object} o
 * @param {string} o.token        CI trigger token (→ AEGIS_TOKEN)
 * @param {string} [o.api]        API base override (→ AEGIS_API)
 * @param {{username?:string,password?:string}} [o.credentials]  login for gated
 *        pages — handed to the executor's ENV so it logs in LOCALLY (never cloud)
 * @param {(line:string)=>void} [o.log]   sink for the executor's own output
 * @param {(code:number|null)=>void} [o.onExit]  called when the executor exits
 * @returns {{child:import('node:child_process').ChildProcess, waitReady:(ms?:number)=>Promise<boolean>, stop:()=>void}}
 */
export function startLocalRunner({ token, api, credentials, log = () => {}, onExit } = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const env = { ...process.env, AEGIS_TOKEN: token }
  if (api) env.AEGIS_API = api
  // Credentials stay on THIS machine: the executor reads them from its env at
  // startup and logs in locally. They are deliberately NOT sent to the cloud.
  if (credentials && credentials.username) {
    env.AEGIS_USERNAME = credentials.username
    env.AEGIS_PASSWORD = credentials.password || ''
  } else {
    // Don't inherit a stale login from the parent env when none was set here.
    delete env.AEGIS_USERNAME
    delete env.AEGIS_PASSWORD
  }

  const child = spawn(npx, ['--yes', '@aegisrunner/scan-runner'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  let ready = false
  let resolveReady
  const readyPromise = new Promise((r) => { resolveReady = r })
  const onData = (buf) => {
    const text = String(buf)
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (t) log(t)
    }
    if (!ready && READY_RE.test(text)) { ready = true; resolveReady(true) }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code) => {
    if (!ready) resolveReady(false)
    if (onExit) onExit(code)
  })
  child.on('error', (e) => { log(`local runner failed to start: ${e.message}`); if (!ready) resolveReady(false) })

  return {
    child,
    // Resolves true once the executor is online, false if it exits first or the
    // timeout lapses (a slow first-run Chromium install still counts as "coming",
    // so the caller may proceed and let the job wait in the queue).
    waitReady: (ms = 180_000) => Promise.race([
      readyPromise,
      new Promise((r) => setTimeout(() => r(ready), ms)),
    ]),
    stop: () => { try { child.kill('SIGINT') } catch { /* already gone */ } },
  }
}
