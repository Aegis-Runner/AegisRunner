# @aegisrunner/nuxt

A [Nuxt](https://nuxt.com) module that attaches [AegisRunner](https://aegisrunner.com) to your dev server. Add it to `modules`, run `nuxt dev`, and an **AI scan of your localhost app is one keypress away** — no deploy, no staging URL, no second terminal.

By default the scan runs **entirely on your machine**: a real browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) drives your app at `http://localhost` directly — **no tunnel, no cloud relay** — the fastest, most reliable path for big apps, and your app and credentials never leave your machine. Press **`a`** (or set `scanOn: 'startup'`) and AegisRunner crawls your running app, generates tests, and streams progress into your dev log. A native **DevTools tab** shows live status and a one-click **Scan now**. Prefer to relay **our** cloud browser over a secure outbound tunnel (nothing to install)? Set `aegis: { runner: 'tunnel' }`.

## Install

```bash
npm install -D @aegisrunner/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@aegisrunner/nuxt'],
  aegis: {
    scanOn: 'manual', // 'manual' (press a) | 'startup' (scan on boot)
    // token: process.env.AEGIS_TOKEN,  // defaults to AEGIS_TOKEN
  },
})
```

```bash
export AEGIS_TOKEN=aegis_xxxxxxxx   # a project CI trigger token (Pro/Business)
npm run dev
```

## In-app widget

A floating AegisRunner **shield** appears in the corner of your app. Click it to
**Test this page** (just the current route), **Test whole site** (a full crawl), or
set **login credentials** for gated pages — with live progress and a link to the
results. The DevTools tab shows the same status. (Pass `aegis: { widget: false }`
to disable; `[a]` in the terminal still works.)

```text
ℹ Nuxt 3  →  http://localhost:3000/

ℹ aegis  AegisRunner widget ready — click the shield in your app to scan
ℹ aegis  local execution ready — the browser runs on your machine (no tunnel)
```

## Options (`aegis` config key)

| Option | Default | Description |
|--------|---------|-------------|
| `token` | `process.env.AEGIS_TOKEN` | CI trigger token (Pro/Business). |
| `runner` | `'local'` | `'local'` — run the browser on your machine, scanning `http://localhost` directly (no tunnel). `'tunnel'` — relay our cloud browser over an outbound tunnel. |
| `scanOn` | `'manual'` | `'manual'` — press `a` / click the widget. `'startup'` — scan once when the dev server is ready. |
| `port` | detected | Dev-server port. Auto-detected via the `listen` hook; override if needed. |
| `host` | `'127.0.0.1'` | Local host your app listens on (what the runner scans, or the tunnel forwards to). |
| `widget` | `true` | Inject the in-app shield widget (+ DevTools tab). |
| `label` | package name | Shown in every log line as `ℹ aegis·<label>` — disambiguates several dev servers running at once (monorepos). |
| `api` | public API | `process.env.AEGIS_API` override. |

**Local mode** fetches the browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) on the first scan (Chromium ~150MB, then cached) and logs in on your machine for gated pages, so **credentials never leave your network**. **Tunnel mode** needs no local browser but round-trips every request through the cloud.

The module is **dev-only** — it never runs in `nuxt build` or production. The runner lifecycle, tunnel client, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli), so the protocol and auth live in one place. Prefer no config change? [`aegis dev -- nuxt dev`](https://www.npmjs.com/package/@aegisrunner/cli) does the same thing.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
