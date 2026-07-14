// Reverse HTTP tunnel client. Long-polls the control plane for requests the
// cloud scanner made against the public tunnel URL, replays each one against
// the developer's local app, and posts the response back. Pure fetch — no
// dependencies, no inbound port. (Node 18+.)
import { DEFAULT_API } from './api.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Headers we must not forward verbatim to the local app: Host is rewritten by
// pointing fetch at localhost; the rest are hop-by-hop or would fight fetch's
// own transfer handling.
const DROP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'accept-encoding', 'upgrade']);
function forwardHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) if (!DROP.has(k.toLowerCase())) out[k] = v;
  return out;
}

async function handleReq(base, tunnelId, authHeaders, target, req, log) {
  let status = 502;
  let headers = { 'content-type': 'text/plain' };
  let body = '';
  try {
    const hasBody = req.body && req.method !== 'GET' && req.method !== 'HEAD';
    const r = await fetch(target + req.path, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: hasBody ? Buffer.from(req.body, 'base64') : undefined,
      redirect: 'manual',
    });
    status = r.status;
    headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    body = Buffer.from(await r.arrayBuffer()).toString('base64');
    log(`  ← ${status} ${req.method} ${req.path}`);
  } catch (e) {
    body = Buffer.from(`aegis-tunnel: could not reach ${target} — ${e.message}`).toString('base64');
    log(`  ! ${req.method} ${req.path} — local app unreachable (${e.message})`);
  }
  await fetch(`${base}/tunnel/${tunnelId}/response`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reqId: req.reqId, status, headers, body }),
  }).catch(() => {});
}

export async function runTunnel({ api, token, port, host, log, onReady, signal }) {
  const base = (api || DEFAULT_API).replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${token}` };
  const target = `http://${host}:${port}`;

  const reg = await fetch(`${base}/tunnel/register`, { method: 'POST', headers: authHeaders });
  if (!reg.ok) {
    const detail = reg.status === 401 ? 'check your token' : reg.status === 402 ? 'tunnels need a Pro or Business plan' : `HTTP ${reg.status}`;
    throw new Error(`Could not open tunnel (${detail}).`);
  }
  const { tunnelId, publicUrl } = await reg.json();

  log('');
  log(`  Tunnel open`);
  log(`  Forwarding  ${publicUrl}  →  ${target}`);
  log('');
  if (!onReady) {
    log('  Point a scan at the public URL above. Press Ctrl-C to stop.');
    log('');
  }

  const shutdown = () => process.exit(0);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Warn early (don't fail) if nothing is listening locally yet.
  try { await fetch(target, { method: 'HEAD' }); }
  catch { log(`  ! Nothing responding at ${target} yet — start your app; requests 502 until it's up.`); log(''); }

  // Combined mode (aegis scan --tunnel): hand the URL back so the caller can
  // scan it while THIS process keeps polling — that concurrent poll loop is
  // exactly what keeps the tunnel alive for the whole scan. Fire-and-forget.
  if (onReady) Promise.resolve().then(() => onReady(publicUrl));

  for (;;) {
    if (signal?.aborted) return;
    let res;
    try { res = await fetch(`${base}/tunnel/${tunnelId}/poll`, { headers: authHeaders, signal }); }
    catch { if (signal?.aborted) return; await sleep(1000); continue; }
    if (res.status === 204) continue;                 // idle window elapsed — re-poll
    if (res.status === 404) { log('  Tunnel closed.'); return; }
    if (!res.ok) { await sleep(1000); continue; }
    let req;
    try { req = await res.json(); } catch { continue; }
    // Fire-and-forget so a slow local response doesn't stall the poll loop
    // (multiple in-flight requests are handled concurrently).
    handleReq(base, tunnelId, authHeaders, target, req, log);
  }
}
