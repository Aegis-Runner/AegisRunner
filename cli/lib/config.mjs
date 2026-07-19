// config.mjs — resolve the CI token (and API base) from a saved config file so
// you don't have to `export AEGIS_TOKEN=…` in every shell. Zero deps by design.
//
// Precedence (first hit wins): --token flag → AEGIS_TOKEN env → config file.
// Config file search order:
//   1. $AEGIS_CONFIG (explicit path)
//   2. ./.aegisrc or ./aegis.json, walking up toward the filesystem root
//      (project-local, keep it gitignored)
//   3. $XDG_CONFIG_HOME/aegis/config.json  (or ~/.config/aegis/config.json)
//   4. ~/.aegis/config.json
// A file is JSON `{ "token": "aegis_…", "api": "…" }` OR dotenv-style
// `AEGIS_TOKEN=aegis_…` lines. `aegis login` writes location #3.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function candidatePaths() {
  const out = [];
  if (process.env.AEGIS_CONFIG) out.push(process.env.AEGIS_CONFIG);
  let dir = process.cwd();
  for (let i = 0; i < 24; i++) {
    out.push(path.join(dir, '.aegisrc'));
    out.push(path.join(dir, 'aegis.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  out.push(userConfigPath());
  out.push(path.join(homedir(), '.aegis', 'config.json'));
  return out;
}

function parseConfigFile(text) {
  const t = (text || '').trim();
  if (!t) return {};
  if (t.startsWith('{')) { try { return normalize(JSON.parse(t)); } catch { return {}; } }
  const obj = {};
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const k = s.slice(0, eq).trim().toLowerCase().replace(/^aegis[_-]?/, '');
    const v = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    obj[k] = v;
  }
  return normalize(obj);
}

// Accept a few key spellings (token/AEGIS_TOKEN/apiToken, api/apiUrl/base).
function normalize(o) {
  const token = o.token || o.AEGIS_TOKEN || o.apiToken || o.ci_token;
  const api = o.api || o.AEGIS_API || o.apiUrl || o.base;
  const out = {};
  if (token) out.token = String(token);
  if (api) out.api = String(api);
  return out;
}

/** First config file that yields a token or api. Empty object if none. */
export function readConfig() {
  for (const p of candidatePaths()) {
    try {
      const cfg = parseConfigFile(readFileSync(p, 'utf8'));
      if (cfg.token || cfg.api) return { ...cfg, _path: p };
    } catch { /* not found / unreadable — try next */ }
  }
  return {};
}

/** Token from --token → AEGIS_TOKEN → config file. '' if none found. */
export function resolveToken(opts = {}) {
  return opts.token || process.env.AEGIS_TOKEN || readConfig().token || '';
}

/** API base from --api → AEGIS_API → config file. '' if none (caller defaults). */
export function resolveApi(opts = {}) {
  return opts.api || process.env.AEGIS_API || readConfig().api || '';
}

/** Where `aegis login` writes (XDG-aware). */
export function userConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(xdg, 'aegis', 'config.json');
}

/** Merge `patch` into the user config file (0600). Returns the path written. */
export function saveConfig(patch) {
  const p = userConfigPath();
  let cur = {};
  try { cur = JSON.parse(readFileSync(p, 'utf8')); } catch { /* new file */ }
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return p;
}
