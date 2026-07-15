# @aegisrunner/nuxt

A [Nuxt](https://nuxt.com) module that attaches [AegisRunner](https://aegisrunner.com) to your dev server. Add it to `modules`, run `nuxt dev`, and an **AI scan of your localhost app is one keypress away** — no deploy, no staging URL, no second terminal.

On startup the module learns your dev-server port, opens a secure **outbound-only** tunnel to it, and holds it for the session. Press **`a`** (or set `scanOn: 'startup'`) and AegisRunner crawls your running app, generates tests, and streams progress into your dev log. A **DevTools tab** links you to the results.

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

```text
ℹ Nuxt 3  →  http://localhost:3000/

ℹ aegis  tunnel open → https://ab12cd.tunnel.aegisrunner.com
ℹ aegis  press [a] + Enter to scan your local app
```

## Options (`aegis` config key)

| Option | Default | Description |
|--------|---------|-------------|
| `token` | `process.env.AEGIS_TOKEN` | CI trigger token (Pro/Business). |
| `scanOn` | `'manual'` | `'manual'` — press `a`. `'startup'` — scan once when the tunnel opens. |
| `port` | detected | Dev-server port. Auto-detected via the `listen` hook; override if needed. |
| `host` | `'127.0.0.1'` | Local host the tunnel forwards to. |
| `api` | public API | `process.env.AEGIS_API` override. |

The module is **dev-only** — it never runs in `nuxt build` or production. The tunnel, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli), so the protocol and auth live in one place. Prefer no config change? [`aegis dev -- nuxt dev`](https://www.npmjs.com/package/@aegisrunner/cli) does the same thing.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
