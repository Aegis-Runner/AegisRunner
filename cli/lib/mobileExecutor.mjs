// mobileExecutor.mjs — the device side of `aegis mobile-scan --local`.
//
// Claims mobile-scan jobs from AegisRunner (outbound long-poll, CI-token auth),
// then replays each Appium W3C call the cloud EXPLORER makes against a LOCAL
// Appium server, posting the device's response back. On session-create it injects
// the local apk path into the capabilities, so the app is installed from the
// customer's disk and never uploaded. The exploration brain + storage stay in the
// cloud; the device + APK stay local. Zero shared secrets — only the CI token (to
// claim) + a per-session JIT `arm_` token (delivered once in the claimed job).

const DEFAULT_API = 'https://app.aegisrunner.com/api/v1';

const localTimeout = (path) => (path === '/session' ? 280_000 : 90_000);

function injectLocalApp(bodyStr, apk) {
  try {
    const caps = JSON.parse(bodyStr || '{}');
    const am = caps?.capabilities?.alwaysMatch;
    if (am && typeof am === 'object') {
      am['appium:app'] = apk;
      return JSON.stringify(caps);
    }
  } catch { /* forward as-is */ }
  return bodyStr;
}

async function handleFrame({ API, apk, appium, log }, msid, arm, frame) {
  const reqId = frame.reqId;
  let status = 502;
  let outB64 = '';
  try {
    let body = frame.bodyB64 ? Buffer.from(frame.bodyB64, 'base64').toString('utf8') : '';
    const path = frame.path || '/';
    if (frame.method === 'POST' && path === '/session') {
      body = injectLocalApp(body, apk);
      log(`installing ${apk} + starting the local session…`);
    }
    const url = appium + path + (frame.query ? `?${frame.query}` : '');
    const init = { method: frame.method || 'GET', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(localTimeout(path)) };
    if (frame.method !== 'GET' && frame.method !== 'HEAD') init.body = body || '{}';
    const resp = await fetch(url, init);
    status = resp.status;
    outB64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
  } catch (e) {
    status = 500;
    outB64 = Buffer.from(JSON.stringify({ value: { error: 'unknown error', message: `local executor: ${e.message}` } }), 'utf8').toString('base64');
    log(`! local Appium call failed (${frame.method} ${frame.path}): ${e.message}`);
  }
  await fetch(`${API}/mobile-scan/${msid}/response`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${arm}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reqId, status, bodyB64: outB64 }),
  }).catch((e) => log(`! post response failed: ${e.message}`));
}

async function runSession(ctx, job) {
  const { API, log } = ctx;
  const msid = job.sessionId;
  const arm = job.token;
  log(`claimed a scan${job.appPackage ? ` for ${job.appPackage}` : ''} — driving your local device`);
  const hb = setInterval(() => {
    fetch(`${API}/mobile-scan/${msid}/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${arm}` } }).catch(() => {});
  }, 30_000);
  try {
    for (;;) {
      let res;
      try {
        res = await fetch(`${API}/mobile-scan/${msid}/requests`, { headers: { Authorization: `Bearer ${arm}` }, signal: AbortSignal.timeout(30_000) });
      } catch { continue; }
      if (res.status === 204) continue;
      if (res.status === 401 || res.status === 404 || res.status === 410) break;
      if (res.status !== 200) continue;
      let frame;
      try { frame = await res.json(); } catch { continue; }
      if (!frame || !frame.reqId) continue;
      await handleFrame(ctx, msid, arm, frame);
    }
  } finally {
    clearInterval(hb);
    await fetch(`${API}/mobile-scan/${msid}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${arm}` } }).catch(() => {});
    log('scan finished — waiting for the next one');
  }
}

export async function runMobileExecutor({ api, token, apk, appium, log = console.log }) {
  const API = (api || DEFAULT_API).replace(/\/+$/, '');
  const APPIUM = (appium || 'http://localhost:4723').replace(/\/+$/, '');
  const ciHeaders = { Authorization: `Bearer ${token}` };
  try {
    const s = await fetch(`${APPIUM}/status`, { signal: AbortSignal.timeout(5_000) });
    log(`local Appium at ${APPIUM} → HTTP ${s.status}`);
  } catch (e) {
    throw new Error(`Local Appium not reachable at ${APPIUM}: ${e.message}. Start a device first (docker compose up in the ReDroid unit).`);
  }
  const ctx = { API, apk, appium: APPIUM, log };
  log(`mobile runner online — polling ${API} for local scans (outbound only). Ctrl-C to stop.`);
  for (;;) {
    let res;
    try {
      res = await fetch(`${API}/runner/mobile-jobs/next`, { headers: ciHeaders, signal: AbortSignal.timeout(30_000) });
    } catch { await new Promise((r) => setTimeout(r, 2_000)); continue; }
    if (res.status === 401) throw new Error('CI token rejected (AEGIS_TOKEN).');
    if (res.status !== 200) continue;
    let job;
    try { job = await res.json(); } catch { continue; }
    if (!job?.sessionId || !job?.token) continue;
    try { await runSession(ctx, job); } catch (e) { log(`! session error: ${e.message}`); }
  }
}
