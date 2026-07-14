// Self-hosted runner agent. Runs inside the customer's network, claims jobs from
// the cloud over OUTBOUND HTTPS, executes them locally against a private target
// the cloud can't reach, and reports results back. No inbound port. Pure fetch.
//
// v1 executes a reachability probe (home page + shallow same-origin link check).
// The full AI crawl in runner-mode ships in the crawler container image; this
// agent proves the outbound-pull control plane and is a useful smoke test today.
import os from 'node:os';
import { DEFAULT_API } from './api.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sameOrigin(base, u) {
  try { return new URL(u, base).origin === new URL(base).origin; } catch { return false; }
}

function extractLinks(base, html) {
  const out = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) && out.size < 40) {
    const href = m[1].split('#')[0];
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const abs = new URL(href, base).toString();
      if (sameOrigin(base, abs) && /^https?:/i.test(abs)) out.add(abs);
    } catch { /* skip */ }
  }
  return [...out];
}

async function probeTarget(target, log) {
  const t0 = Date.now();
  let home;
  try { home = await fetch(target, { redirect: 'follow' }); }
  catch (e) { return { ok: false, target, error: `could not reach ${target} — ${e.message}` }; }
  const ms = Date.now() - t0;
  const isHtml = (home.headers.get('content-type') || '').includes('text/html');
  const html = isHtml ? await home.text() : '';
  const title = ((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [, ''])[1] || '').trim();
  const links = extractLinks(target, html).slice(0, 10);
  log(`    home ${home.status} (${ms}ms)${title ? ` — "${title}"` : ''} · ${links.length} link(s) to check`);
  const broken = [];
  let checked = 0;
  for (const link of links) {
    try {
      const r = await fetch(link, { redirect: 'follow' });
      checked++;
      if (r.status >= 400) { broken.push({ url: link, status: r.status }); log(`    ✗ ${r.status} ${link}`); }
    } catch (e) { broken.push({ url: link, status: 0, error: e.message }); }
  }
  return {
    ok: home.status < 400,
    target,
    homeStatus: home.status,
    title,
    responseMs: ms,
    server: home.headers.get('server') || '',
    pagesChecked: 1 + checked,
    brokenLinks: broken,
    runBy: os.hostname(),
  };
}

export async function runRunner({ api, token, log }) {
  const base = (api || DEFAULT_API).replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };
  const runnerId = `${os.hostname()}-${process.pid}`;

  log('');
  log(`  Self-hosted runner started on ${os.hostname()}`);
  log(`  Polling for jobs (outbound only). Press Ctrl-C to stop.`);
  log('');
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  const beat = () => fetch(`${base}/runner/heartbeat`, { method: 'POST', headers: jsonAuth, body: JSON.stringify({ runnerId, hostname: os.hostname() }) }).catch(() => {});
  await beat();
  const hb = setInterval(beat, 30000);

  try {
    for (;;) {
      let res;
      try { res = await fetch(`${base}/runner/jobs/next`, { headers: auth }); }
      catch { await sleep(2000); continue; }
      if (res.status === 401) throw new Error('unauthorized — check your token');
      if (res.status === 204) continue;              // idle — re-poll
      if (!res.ok) { await sleep(2000); continue; }
      let job;
      try { job = await res.json(); } catch { continue; }
      log(`  ▶ job ${job.id}: ${job.url}${job.note ? `  (${job.note})` : ''}`);
      const result = await probeTarget(job.url, log);
      await fetch(`${base}/runner/jobs/${job.id}/result`, { method: 'POST', headers: jsonAuth, body: JSON.stringify(result) }).catch(() => {});
      log(`  ${result.ok ? '✔' : '✗'} job ${job.id} — ${result.ok ? 'reachable' : 'unreachable'}, ${result.brokenLinks?.length ?? 0} broken link(s)`);
      log('');
    }
  } finally { clearInterval(hb); }
}
