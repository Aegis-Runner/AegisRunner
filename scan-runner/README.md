# AegisRunner scan-runner

The browser executor for `aegis scan --local` — run it inside your own network to
scan localhost / private / firewalled web apps that AegisRunner's cloud can't
reach. The AI brain + storage stay in AegisRunner's cloud; the browser, your app,
and any credentials stay on your machine.

## Run it — no Docker needed (npm)

```bash
npx @aegisrunner/scan-runner --token aegis_xxx     # your project CI token
```

First run installs a local Chromium via Playwright (~150 MB, cached after). Then,
from anywhere:

```bash
aegis scan --local --url http://localhost:3000
```

Authed scans: set `AEGIS_USERNAME` / `AEGIS_PASSWORD` in the environment (never on
the command line) — the runner logs in locally; credentials never reach the cloud.

## Or run it with Docker

```bash
docker run --rm -e AEGIS_TOKEN=aegis_xxx aegisrunner1/scan-runner:latest
```

## Security

Brain-free by construction: only the audited executor bundle + Playwright. No
AegisRunner cloud code, zero shared secrets — it speaks only the broker's
outbound HTTPS API. The per-session token arrives at runtime.
