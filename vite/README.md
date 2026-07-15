# @aegisrunner/vite

A [Vite](https://vitejs.dev) plugin that attaches [AegisRunner](https://aegisrunner.com) to your dev server. One line in `vite.config` puts an **AI scan of your localhost app one keypress away** — no deploy, no staging URL, no second terminal. Covers Vue, React, Svelte and the rest of the Vite ecosystem.

When your dev server starts, the plugin learns its port, opens a secure **outbound-only** tunnel to it, and holds it for the session. Press **`a`** (or set `scanOn: 'startup'`) and AegisRunner crawls your running app, generates tests, and streams progress into your dev log.

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
    aegis({ scanOn: 'manual' }),   // 'manual' (press a) | 'startup' (scan on boot)
  ],
})
```

Set your token in the environment (a project **CI trigger token** — Pro or Business plan):

```bash
export AEGIS_TOKEN=aegis_xxxxxxxx
npm run dev
```

```text
  VITE v5  ready in 140 ms
  ➜  Local:   http://localhost:5173/

  ◆ aegis   tunnel open → https://ab12cd.tunnel.aegisrunner.com
  ◆ aegis   press [a] + Enter to scan your local app
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `token` | `process.env.AEGIS_TOKEN` | CI trigger token (Pro/Business). |
| `scanOn` | `'manual'` | `'manual'` — press `a`. `'startup'` — scan once when the tunnel opens. |
| `port` | detected | Dev-server port. Auto-detected from the running server; override if needed. |
| `host` | `'127.0.0.1'` | Local host the tunnel forwards to. |
| `api` | public API | `process.env.AEGIS_API` override. |

The plugin is **dev-only** (`apply: 'serve'`) — it never runs during `vite build`. The tunnel, scan trigger and live-progress stream are reused from [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli), so the protocol and auth live in one place. Prefer the raw command? [`aegis dev -- vite`](https://www.npmjs.com/package/@aegisrunner/cli) does the same thing without a config change.

## Docs

- [Test a localhost app](https://aegisrunner.com/use-cases/localhost-app-testing)
- [Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

MIT © AegisRunner
