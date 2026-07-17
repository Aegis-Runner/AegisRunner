# @aegisrunner/next

Attach [AegisRunner](https://aegisrunner.com) to your [Next.js](https://nextjs.org) dev server. Wrap your `next.config`, run `next dev`, and an **AI scan of your localhost app is one keypress away** — no deploy, no staging URL, no second terminal.

Next has no clean "server listening" plugin hook, so this wraps your config: in the dev phase it opens a secure **outbound-only** tunnel to your dev port and — on **`a`** or on startup — crawls your running app, generates tests, and streams progress into your terminal.

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
  ◆ aegis   tunnel open → https://ab12cd.tunnel.aegisrunner.com
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
| `scanOn` | `'manual'` | `'manual'` — press `a`. `'startup'` — scan once when the tunnel opens. |
| `port` | `-p` / `PORT` / `3000` | Dev-server port. Set it explicitly if you run on a non-standard port and don't pass `-p`. |
| `host` | `'127.0.0.1'` | Local host the tunnel forwards to. |
| `label` | package name | Shown in every log line as `◆ aegis·<label>` — disambiguates tunnels when several dev servers run at once (monorepos). |
| `api` | public API | `process.env.AEGIS_API` override. |

The wrapper is a **pure pass-through** in every phase except dev — it never runs in `next build` or production. The tunnel, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli). Prefer no config change? [`aegis dev -- next dev`](https://www.npmjs.com/package/@aegisrunner/cli) is identical.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
