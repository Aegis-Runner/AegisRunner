# @aegisrunner/vite

A [Vite](https://vitejs.dev) plugin that attaches [AegisRunner](https://aegisrunner.com) to your dev server. One line in `vite.config` puts an **AI scan of your localhost app one keypress away** — no deploy, no staging URL, no second terminal. Covers Vue, React, Svelte and the rest of the Vite ecosystem.

By default the scan runs **entirely on your machine**: a real browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) drives your app at `http://localhost` directly — **no tunnel, no cloud relay**. That's the fastest and most reliable path for big apps (hundreds of routes, Vite's unbundled module bursts), and your app and credentials never leave your machine. Press **`a`** (or set `scanOn: 'startup'`) and AegisRunner crawls your running app, generates tests, and streams progress into your dev log.

Prefer to relay **our** cloud browser over a secure outbound tunnel instead (nothing to install locally)? Pass `aegis({ runner: 'tunnel' })`.

## Install

```bash
npm install -D @aegisrunner/vite
```

## Use

```js
// vite.config.js
import { defineConfig } from 'vite'
import aegis from '@aegisrunner/vite'

export default defineConfig({
  plugins: [
    // React, Vue, Svelte, Solid… — one plugin for the whole Vite ecosystem
    aegis({ token: process.env.AEGIS_TOKEN, scanOn: 'manual' }),   // see "Your token" below
  ],
})
```

### Your token

Provide your project **CI trigger token** (create one under **Manage → CI/CD**, Pro/Business) one of three ways — **never commit the literal token**:

```bash
# 1. save it once (recommended) — every command AND the dev widget/plugins read it,
#    so you can drop the `token` option entirely:
npx @aegisrunner/cli login --token aegis_xxxxxxxx
# 2. or an env var — a git-ignored .env your dev server loads, or your shell:
export AEGIS_TOKEN=aegis_xxxxxxxx
```

Precedence: the `token` option (above) → `AEGIS_TOKEN` env → the saved `aegis login` file.

## In-app widget

A floating AegisRunner **shield** appears in the corner of your dev app. Click it to:

- **Test this page** — scan just the current route
- **Test whole site** — a full AI crawl + test generation
- **Login credentials** — set a username/password so gated pages get scanned

…and watch live progress with a link to the results. No terminal, no context switch.
(Pass `aegis({ widget: false })` to disable it; you can still press **[a]** in the terminal.)

```text
  VITE v5  ready in 140 ms
  ➜  Local:   http://localhost:5173/

  ◆ aegis   AegisRunner widget ready — click the shield in your app to scan
  ◆ aegis   local execution ready — the browser runs on your machine (no tunnel)
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `token` | `process.env.AEGIS_TOKEN` | CI trigger token (Pro/Business). |
| `runner` | `'local'` | `'local'` — run the browser on your machine, scanning `http://localhost` directly (no tunnel). `'tunnel'` — relay our cloud browser over an outbound tunnel. |
| `scanOn` | `'manual'` | `'manual'` — press `a` / click the widget. `'startup'` — scan once when the dev server is ready. |
| `port` | detected | Dev-server port. Auto-detected from the running server; override if needed. |
| `host` | `'127.0.0.1'` | Local host your app listens on (what the runner scans, or the tunnel forwards to). |
| `widget` | `true` | Inject the in-app shield widget. |
| `label` | package name | Shown in every log line as `◆ aegis·<label>` — disambiguates several dev servers running at once (monorepos / `turbo dev`). |
| `api` | public API | `process.env.AEGIS_API` override. |

**Local mode** fetches the browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) on the first scan (Chromium ~150MB, then cached) and logs in on your machine for gated pages, so **credentials never leave your network**. **Tunnel mode** needs no local browser but round-trips every request through the cloud.

The plugin is **dev-only** (`apply: 'serve'`) — it never runs during `vite build`. The runner lifecycle, tunnel client, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli), so the protocol and auth live in one place. Prefer the raw command? [`aegis dev -- vite`](https://www.npmjs.com/package/@aegisrunner/cli) does the same thing without a config change.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
