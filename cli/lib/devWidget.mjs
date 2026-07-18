// devWidget.mjs — the in-page AegisRunner dev widget, shared by the
// @aegisrunner/{vite,nuxt,next} plugins so the UI + control protocol live in one
// place. Each plugin mounts the control handler on its dev server and injects
// `<script src="/__aegis/widget.js">` into dev HTML; the plugin supplies the
// scan/credentials/status callbacks so the tunnel + trigger logic isn't
// duplicated.
//
// Control endpoints (all under /__aegis, dev-only):
//   GET  /__aegis/widget.js     the client widget script
//   GET  /__aegis/status        { scanning, message, resultsUrl?, error? }
//   POST /__aegis/scan          { scope:'page'|'site', path } -> onScan(...)
//   POST /__aegis/credentials   { username, password }        -> setCredentials(...)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Read once at import; the client script is a static asset shipped beside this file.
let WIDGET_JS = '';
try { WIDGET_JS = readFileSync(path.join(__dirname, 'aegisWidget.client.js'), 'utf8'); } catch { /* absent → widget disabled */ }

/** The `<script>` tag the plugin injects into dev HTML. `nonce` is optional (CSP). */
export function aegisWidgetTag(nonce) {
  return `<script src="/__aegis/widget.js"${nonce ? ` nonce="${nonce}"` : ''} defer></script>`;
}

/** The raw client widget script (for frameworks that serve it via their own
 *  dev-handler instead of the createAegisControl middleware, e.g. Nuxt/Next). */
export function getWidgetJs() {
  return WIDGET_JS || '// aegis widget unavailable';
}

/** Map an arbitrary plugin state into the widget's status shape. */
export function widgetStatus({ scanning = false, tunnel = null, message = null, resultsUrl = null, error = false } = {}) {
  return {
    scanning: !!scanning,
    message: message || (tunnel ? 'Ready to scan.' : 'Connecting…'),
    resultsUrl: resultsUrl || undefined,
    error: !!error,
  };
}

/**
 * Build the /__aegis control handler.
 * @param {object} cb
 * @param {(req:{scope:string,path:string})=>void} cb.onScan          start a scan (fire-and-forget)
 * @param {(creds:{username:string,password:string})=>void} cb.setCredentials  store creds for later scans
 * @param {()=>object} cb.getStatus                                   current { scanning, message, resultsUrl?, error? }
 * @returns {(req, res)=>Promise<boolean>}  true if it handled the request
 */
export function createAegisControl({ onScan, onRun, setCredentials, getStatus }) {
  return async function handle(req, res) {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/__aegis')) return false;

    if (req.method === 'GET' && url === '/__aegis/widget.js') {
      res.statusCode = WIDGET_JS ? 200 : 404;
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(WIDGET_JS || '// aegis widget unavailable');
      return true;
    }
    if (req.method === 'GET' && url === '/__aegis/status') {
      let s = {};
      try { s = getStatus() || {}; } catch { /* ignore */ }
      return json(res, 200, s);
    }
    if (req.method === 'POST' && url === '/__aegis/scan') {
      const body = await readJson(req);
      try { onScan({ scope: body.scope === 'page' ? 'page' : 'site', path: String(body.path || '/') }); } catch { /* ignore */ }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/__aegis/run') {
      try { if (onRun) onRun(); } catch { /* ignore */ }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/__aegis/credentials') {
      const body = await readJson(req);
      try { setCredentials({ username: String(body.username || ''), password: String(body.password || '') }); } catch { /* ignore */ }
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  };
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
  return true;
}

function readJson(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) { d = ''; req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
