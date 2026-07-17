# @aegisrunner/next

Attach [AegisRunner](https://aegisrunner.com) to your [Next.js](https://nextjs.org) dev server. Wrap your `next.config`, run `next dev`, and an **AI scan of your localhost app is one keypress away** — no deploy, no staging URL, no second terminal.

Next has no clean "server listening" plugin hook, so this wraps your config. By default the scan runs **entirely on your machine**: a real browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) drives your app at `http://localhost` directly — **no tunnel, no cloud relay** — the fastest, most reliable path for big apps, and your app and credentials never leave your machine. On **`a`** or on startup it crawls your running app, generates tests, and streams progress into your terminal. Prefer to relay **our** cloud browser over a secure outbound tunnel (nothing to install)? Pass `{ runner: 'tunnel' }`.

## Install

```bash
npm install -D @aegisrunner/next
```

```js
// next.config.mjs
import withAegisRunner from '@aegisrunner/next'

/** @type {import('next').NextConfig} */
const nextConfig = { /* your config */ }

export default withAegisRunner(nextConfig, {
  scanOn: 'manual', // 'manual' (press a) | 'startup' (scan on boot)
})
```

```bash
export AEGIS_TOKEN=aegis_xxxxxxxx   # a project CI trigger token (Pro/Business)
npm run dev
```

```text
  ▲ Next.js  —  Local: http://localhost:3000

  ◆ aegis   AegisRunner widget ready — click the shield in your app to scan
  ◆ aegis   local execution ready — the browser runs on your machine (no tunnel)
```

## In-app widget

A floating AegisRunner **shield** is injected into your dev pages. Click it to
**Test this page** (just the current route), **Test whole site** (a full crawl),
or set **login credentials** for gated pages — with live progress and a link to
the results. (Pass `{ widget: false }` to disable; `[a]` in the terminal still
works.)

The module serves the widget from a small local control server and proxies
`/__aegis/*` to it via a dev-only rewrite, and injects the widget into the client
bundle automatically. If your setup overrides the dev webpack entry and the shield
doesn't appear, add it explicitly to your root layout (dev only):

```jsx
{process.env.NODE_ENV === 'development' && <script async src="/__aegis/widget.js" />}
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `token` | `process.env.AEGIS_TOKEN` | CI trigger token (Pro/Business). |
| `runner` | `'local'` | `'local'` — run the browser on your machine, scanning `http://localhost` directly (no tunnel). `'tunnel'` — relay our cloud browser over an outbound tunnel. |
| `scanOn` | `'manual'` | `'manual'` — press `a` / click the widget. `'startup'` — scan once when the dev server is ready. |
| `port` | `-p` / `PORT` / `3000` | Dev-server port. Set it explicitly if you run on a non-standard port and don't pass `-p`. |
| `host` | `'127.0.0.1'` | Local host your app listens on (what the runner scans, or the tunnel forwards to). |
| `widget` | `true` | Inject the in-app shield widget. |
| `label` | package name | Shown in every log line as `◆ aegis·<label>` — disambiguates several dev servers running at once (monorepos). |
| `api` | public API | `process.env.AEGIS_API` override. |

**Local mode** fetches the browser ([`@aegisrunner/scan-runner`](https://www.npmjs.com/package/@aegisrunner/scan-runner)) on the first scan (Chromium ~150MB, then cached) and logs in on your machine for gated pages, so **credentials never leave your network**. **Tunnel mode** needs no local browser but round-trips every request through the cloud.

The wrapper is a **pure pass-through** in every phase except dev — it never runs in `next build` or production. The runner lifecycle, tunnel client, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli). Prefer no config change? [`aegis dev -- next dev`](https://www.npmjs.com/package/@aegisrunner/cli) is identical.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
