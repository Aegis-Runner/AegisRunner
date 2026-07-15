// Derive a short, monorepo-distinct label for a dev process so several tunnels
// running at once (e.g. `turbo dev` fanning out apps into one terminal) can be
// told apart: prefer an explicit label, else the package name (scope stripped),
// else the working-dir basename.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

export function deriveLabel(explicit) {
  if (explicit) return String(explicit).trim()
  try {
    const p = JSON.parse(readFileSync('package.json', 'utf8'))
    if (p && p.name) return String(p.name).replace(/^@[^/]+\//, '')
  } catch {}
  try { return basename(process.cwd()) } catch {}
  return ''
}

// The log tag: "aegis" or "aegis·<label>".
export function aegisTag(label) {
  return label ? `aegis·${label}` : 'aegis'
}
