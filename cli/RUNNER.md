# AegisRunner self-hosted runner

Run AegisRunner **inside your own network** to test private, staging, or offline
environments the cloud can't reach. The runner makes an **outbound-only** HTTPS
connection to AegisRunner, claims jobs, executes them **locally** against your
targets, and reports results back. **No inbound port is opened** — so it works
from behind a corporate firewall, a VPN, or NAT.

```
   your network                          │  AegisRunner cloud
                                         │
   ┌─────────────┐   local http   ┌──────┴──────┐   outbound https   ┌───────────────┐
   │  staging    │◄───────────────│   runner    │───────────────────►│ control plane │
   │ (private)   │                │ (this agent)│    claim + report  │  (coordinates)│
   └─────────────┘                └─────────────┘                    └───────────────┘
```

## Install

### Docker (recommended)

```bash
docker run --network host \
  -e AEGIS_TOKEN=aegis_xxxxxxxx \
  aegisrunner1/runner
```

Also on GitHub Container Registry: `ghcr.io/aegis-runner/runner`.

`--network host` lets the runner reach private hosts on your LAN/VPC. If your
target is on a specific Docker network, attach the container to that network
instead (`--network my-net`).

### npm (Node 18+)

```bash
npm install -g @aegisrunner/cli
aegis runner            # reads AEGIS_TOKEN from the environment
```

## Get a token

Create a **CI trigger token** in AegisRunner: **Manage → CI/CD** (Pro or
Business plan). The runner is scoped to that token's project.

```bash
export AEGIS_TOKEN=aegis_xxxxxxxx
# On-prem / self-hosted API? also set:
export AEGIS_API=https://app.aegisrunner.com/api/v1   # (this is the default)
```

## Run jobs

Once a runner is connected, queue work for it from anywhere — the CLI, CI, or the
**dashboard** (Project settings → Self-hosted runner → *Run a check*).

```bash
# waits for the result and prints it
aegis runner-enqueue --url http://staging.internal:8080 --note "nightly smoke"

# fire and forget
aegis runner-enqueue --url http://staging.internal:8080 --no-wait
```

Exit codes: **0** target reachable · **1** unreachable/failed · **2** error/timeout.

## Deploy examples

### docker-compose

```yaml
services:
  aegis-runner:
    image: aegisrunner1/runner:latest
    network_mode: host          # or: networks: [your-private-net]
    restart: unless-stopped
    environment:
      AEGIS_TOKEN: ${AEGIS_TOKEN}
      # AEGIS_API: https://app.aegisrunner.com/api/v1
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aegis-runner
spec:
  replicas: 1
  selector: { matchLabels: { app: aegis-runner } }
  template:
    metadata: { labels: { app: aegis-runner } }
    spec:
      containers:
        - name: runner
          image: aegisrunner1/runner:latest
          env:
            - name: AEGIS_TOKEN
              valueFrom:
                secretKeyRef: { name: aegis-runner, key: token }
---
apiVersion: v1
kind: Secret
metadata: { name: aegis-runner }
type: Opaque
stringData:
  token: aegis_xxxxxxxx
```

The pod needs egress to `app.aegisrunner.com:443` and network reach to your
target. It runs as non-root and needs no privileges.

## Networking & security

- **Outbound only.** The runner initiates every connection; you never open an
  inbound port or expose your environment to the internet.
- **Egress:** allow HTTPS to `app.aegisrunner.com` (or your configured
  `AEGIS_API` host).
- **Data:** the runner reaches your target directly; the target's traffic stays
  in your network. Only the job result (status, timings, findings) is sent back.
- **Least privilege:** a single CI token, scoped to one project. Revoke it under
  Manage → CI/CD to cut a runner off.

## What it does today

v1 performs a **reachability + broken-link probe** from inside your network
(home page reachability, timing, title, and a shallow same-origin link check) —
a useful smoke test for private environments. The full AI crawl in runner-mode
ships in the runner image next; the control plane (claim → execute → report) is
identical, so nothing about how you deploy it changes.

## Which network option should I use?

| Situation | Use |
|---|---|
| Staging is on the internet but IP-restricted | **Static-IP allowlist** — allow our scanner IPs (Project settings → Testing behind a firewall) |
| A dev app on `localhost` | **`aegis tunnel --port <port>`** — temporary encrypted tunnel |
| Staging behind a VPN / firewall / air-gapped | **Self-hosted runner** (this) |
