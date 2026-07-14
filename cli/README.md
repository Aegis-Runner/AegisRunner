# @aegisrunner/cli

Run [AegisRunner](https://aegisrunner.com) test suites, site scans and mobile
app scans from any CI pipeline. Zero dependencies — Node 18+ builtins only.

## Install

```bash
npm install -g @aegisrunner/cli
```

Or run without installing: `npx @aegisrunner/cli ...`, or `node bin/aegis.mjs ...` from a checkout.

## Auth

Create a **CI trigger token** in your project (**Manage → CI/CD**; Pro or
Business plan). Pass it with `--token aegis_...` or set it once:

```bash
export AEGIS_TOKEN=aegis_xxxxxxxx
```

Self-hosted / staging API? Set `AEGIS_API` or pass `--api https://your-host/api/v1`
(default `https://app.aegisrunner.com/api/v1`).

## Commands

### `aegis run` — trigger a test run and wait

```bash
aegis run --suite 0197c0ff-... --token $AEGIS_TOKEN          # one suite
aegis run --suite <id1> --suite <id2>                         # several suites
aegis run                                                     # latest scan's suites
aegis run --strategy smoke                                    # smart selection:
                                                              # smoke | recent-failures |
                                                              # high-priority | regression-risk
aegis run --browser firefox --base-url https://pr-42.preview.example.com
aegis run --format junit --output aegis-results/junit.xml     # JUnit for CI ingestion
aegis run --no-wait                                           # fire and forget
aegis run --timeout 3600                                      # wait up to 1h (default 30m)
```

Exit codes: **0** all passed · **1** test failures · **2** error / timeout / cancelled.

`--format`:

- `text` (default) — human summary on stdout.
- `json` — final run status JSON on stdout (machine-readable).
- `junit` — writes JUnit XML to `--output` (default `aegis-results/junit.xml`).
  Note: the CI status API reports aggregate counts, so the XML carries correct
  totals/failures with synthesized case entries; per-case names and errors live
  on the linked dashboard run page.

`--crawl` scans the site first and generates tests from what it finds; the
command returns immediately in that mode. Add `--watch` to stream live crawl +
test-generation progress until it finishes (or open the printed dashboard link).

### `aegis scan` — trigger a full site scan

```bash
aegis scan                                            # project's configured base URL
aegis scan --url https://staging.example.com          # must be on the project's domain
aegis scan --url https://staging.example.com --watch  # stream live progress until done
aegis scan --tunnel --port 3000                       # scan a LOCAL app: tunnel + scan + watch, one command
```

With `--watch` the CLI streams crawl and test-generation progress live (over
Server-Sent Events) and exits 0 when the scan completes, 1 if it failed —
handy for a CI step that should block on the scan and its generated tests.

**Scanning behind a login.** To test pages that require signing in, hand the
scan a login and it will authenticate during the crawl:

```bash
# username + password (password from stdin, never on the command line)
printf %s "$STAGING_PW" | aegis scan --username qa@example.com --password-stdin --watch

# or provide the password via an env var instead of stdin
AEGIS_PASSWORD="$STAGING_PW" aegis scan --username qa@example.com --watch

# or scan as a role whose login you've already saved in the project
aegis scan --role Admin --watch
```

| Flag | What it does |
|------|--------------|
| `--username <u>` | Login identity — **email, username, phone, employee id, anything**. The scanner's AI maps it onto whatever the login form actually calls its identity field, so there's nothing to configure per app. |
| `--password-stdin` | Reads the password from stdin. Recommended — keeps it out of your shell history and `ps`. Or set `AEGIS_PASSWORD` instead. |
| `--role <name>` | Scan as a saved role (Admin / Buyer / …). Uses that role's stored login (no `--username`/password needed) and tags the scan + its generated tests with the role. |

> The CLI never accepts a password as a plain flag (a `--password <p>` would leak
> through `ps` and shell history) — use `--password-stdin` or `AEGIS_PASSWORD`.
> Credentials sent this way are saved to the project's login so authenticated
> **test runs** and re-scans can sign in too. Works with `--tunnel` and `--url`.

### `aegis mobile-scan` — on-device mobile app scan (fire-and-forget)

```bash
aegis mobile-scan                                     # re-scan the last uploaded app
aegis mobile-scan --app tb://abc123 --platform android --role admin
```

### `aegis status` — one-shot run status

```bash
aegis status <runId> [--format json]
```

### `aegis tunnel` — scan a local app behind a firewall/NAT

Exposes an app running on your machine (or a private network) to AegisRunner's
cloud scanner over an **encrypted, outbound-only** tunnel — no inbound port is
opened, so it works from `localhost` and behind corporate firewalls/NAT.

```bash
aegis tunnel --port 3000                       # forward localhost:3000
aegis tunnel --port 8080 --host 10.0.0.5       # forward another host on your LAN
```

It prints a public URL — point a scan at it (`aegis scan --url <public-url>` or
the dashboard), then press **Ctrl-C** when done. The tunnel is ephemeral: it
lives only while the command runs. Uses the same `--token` / `--api` as the
other commands.

**Simpler — one command:** `aegis scan --tunnel --port 3000` opens the tunnel,
scans it, and streams progress **in a single process**, keeping the tunnel alive
for the whole scan. No separate URL to copy, and no risk of the tunnel dropping
mid-scan. Prefer this for local apps; use standalone `aegis tunnel` only when you
want to point several scans (or the dashboard) at one long-lived tunnel.

For fully offline or VPN-only environments where you can't tunnel out, use a
**self-hosted runner** (below) instead.

### `aegis runner` — self-hosted runner (execute inside your network)

For staging behind a VPN/firewall that can't be tunnelled out. Run the agent
**inside** your network; it claims jobs over an **outbound-only** HTTPS
connection, executes them **locally** against your private targets (which the
cloud never touches), and reports results back. No inbound port is opened.

```bash
# On a machine inside your network (a CI worker, a bastion, a container):
aegis runner                       # starts polling for jobs

# From anywhere (another shell, CI, a laptop) — queue work for it:
aegis runner-enqueue --url http://staging.internal:8080 --note "nightly smoke"
```

`runner-enqueue` waits for the result and prints it (add `--no-wait` to fire and
forget). Exit codes: **0** target reachable · **1** unreachable/failed · **2**
error/timeout.

> v1 runs a reachability + broken-link probe from inside your network. The full
> AI crawl in runner-mode ships in the runner container image; the control plane
> (claim → execute → report) is identical.

## CI examples

### GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g @aegisrunner/cli
      - run: aegis run --format junit
        env:
          AEGIS_TOKEN: ${{ secrets.AEGIS_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: aegis-results
          path: aegis-results/junit.xml
```

### GitLab CI

```yaml
aegis-e2e:
  image: node:20-alpine
  script:
    - npm install -g @aegisrunner/cli
    - aegis run --format junit   # AEGIS_TOKEN set as a masked CI/CD variable
  artifacts:
    when: always
    reports:
      junit: aegis-results/junit.xml
```

## PR comments / commit statuses

The underlying API can post a sticky PR comment and commit status when you pass
GitHub metadata — supported via the raw API today (`githubRepo`,
`githubPrNumber`, `githubCommitSha`, `githubToken` on `POST /ci/trigger`);
CLI flags for this are planned.
