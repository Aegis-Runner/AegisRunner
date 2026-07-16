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

// Cap how long we wait on the LOCAL app before giving up on a single relayed
// request. Without this, a slow/hung local route blocks until the cloud's own
// relay timeout, stalling the scan; failing fast posts a clean 504 back so the
// crawler moves on. Kept under the cloud's relay wait.
const LOCAL_FETCH_TIMEOUT_MS = 25_000;

// How many pollers drain the request queue in PARALLEL. A single serial poller
// dequeues one request per round-trip, which a Vite dev server (unbundled ES
// modules → dozens/hundreds of requests per page load) overwhelms — the tail of
// the burst 504s and the SPA renders blank. A pool drains the burst concurrently.
const POLLERS = Number(process.env.AEGIS_TUNNEL_POLLERS) || 8;
// Requests drained per poll round-trip. With `?batch=N` the server returns up to
// N queued requests at once, so a Vite module burst drains without N separate
// poll round-trips — the pure-HTTP equivalent of stream multiplexing. Effective
// concurrency is POLLERS × BATCH.
const BATCH = Number(process.env.AEGIS_TUNNEL_BATCH) || 16;
// Abort a single poll if it hangs past this (server long-polls ~20s, so this is
// idle-window + margin) — a wedged connection can't stall a poller forever.
const POLL_TIMEOUT_MS = 30_000;

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
      signal: AbortSignal.timeout(LOCAL_FETCH_TIMEOUT_MS),
    });
    status = r.status;
    headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    body = Buffer.from(await r.arrayBuffer()).toString('base64');
    log(`  ← ${status} ${req.method} ${req.path}`);
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    status = timedOut ? 504 : 502;
    const why = timedOut
      ? `no response from ${target}${req.path} within ${LOCAL_FETCH_TIMEOUT_MS / 1000}s`
      : `could not reach ${target} — ${e.message}`;
    body = Buffer.from(`aegis-tunnel: ${why}`).toString('base64');
    log(`  ! ${req.method} ${req.path} — ${timedOut ? 'local app did not respond in time' : `unreachable (${e.message})`}`);
  }
  await fetch(`${base}/tunnel/${tunnelId}/response`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reqId: req.reqId, status, headers, body }),
  }).catch(() => {});
}

// AbortSignal that fires on EITHER a per-poll timeout OR the caller's shutdown
// signal (AbortSignal.any isn't on Node 18, so wire it by hand).
function pollAbort(outer, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const onOuter = () => ac.abort();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  return { signal: ac.signal, cleanup: () => { clearTimeout(timer); outer?.removeEventListener?.('abort', onOuter); } };
}

export async function runTunnel({ api, token, port, host, log, onReady, signal }) {
  const base = (api || DEFAULT_API).replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${token}` };
  const target = `http://${host}:${port}`;

  let tunnelId = '';
  let publicUrl = '';

  // Open (or reclaim) a tunnel. Passing the current id lets the server hand back
  // the SAME public URL after a blip so an in-flight scan survives.
  async function register(reclaimId) {
    const qs = reclaimId ? `?id=${encodeURIComponent(reclaimId)}` : '';
    const reg = await fetch(`${base}/tunnel/register${qs}`, { method: 'POST', headers: authHeaders });
    if (!reg.ok) {
      const detail = reg.status === 401 ? 'check your token' : reg.status === 402 ? 'tunnels need a Pro or Business plan' : `HTTP ${reg.status}`;
      throw new Error(`Could not open tunnel (${detail}).`);
    }
    const j = await reg.json();
    tunnelId = j.tunnelId;
    publicUrl = j.publicUrl;
    return j;
  }

  await register();

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
  // scan it while THIS process keeps polling. Fire-and-forget.
  if (onReady) Promise.resolve().then(() => onReady(publicUrl));

  // Auto-reconnect: if a network blip lets the 90s+ registration TTL lapse, the
  // next poll 404s. Re-register RECLAIMING the same id (same public URL) so the
  // scan continues. Shared promise so N pollers 404-ing at once reconnect ONCE.
  let reconnecting = null;
  function reconnect() {
    if (!reconnecting) {
      reconnecting = (async () => {
        for (let attempt = 0; !signal?.aborted; attempt++) {
          try {
            await register(tunnelId);
            log('  Tunnel reconnected.');
            return;
          } catch {
            await sleep(Math.min(1000 * 2 ** attempt, 15000));
          }
        }
      })().finally(() => { reconnecting = null; });
    }
    return reconnecting;
  }

  async function poller() {
    for (;;) {
      if (signal?.aborted) return;
      const { signal: ps, cleanup } = pollAbort(signal, POLL_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${base}/tunnel/${tunnelId}/poll?batch=${BATCH}`, { headers: authHeaders, signal: ps });
      } catch {
        cleanup();
        if (signal?.aborted) return;
        await sleep(1000);
        continue;
      }
      cleanup();
      if (res.status === 204) continue;                 // idle window — re-poll
      if (res.status === 404) { await reconnect(); continue; } // registration lapsed — reclaim + resume
      if (!res.ok) { await sleep(1000); continue; }
      let reqs;
      try { const j = await res.json(); reqs = Array.isArray(j) ? j : [j]; } catch { continue; }
      // Fire-and-forget every request in the batch so a slow local response can't
      // stall this poller; the pool + concurrent handleReq keep the queue draining.
      // (Array.isArray guard keeps us compatible with a pre-batch server.)
      for (const req of reqs) handleReq(base, tunnelId, authHeaders, target, req, log);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, POLLERS) }, () => poller()));
}
