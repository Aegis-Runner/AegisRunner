# AegisRunner scan-runner

The browser executor for `aegis scan --local` — run it inside your own network to
scan localhost / private / firewalled web apps that AegisRunner's cloud can't
reach. The AI brain + storage stay in AegisRunner's cloud; the browser, your app,
and any credentials stay on your machine.

## Run

```bash
docker run --rm \
  -e AEGIS_TOKEN=aegis_xxx \        # your project CI token (Manage → CI/CD)
  aegisrunner1/scan-runner:latest
```

Then trigger a scan (from anywhere):

```bash
aegis scan --local --url http://localhost:3000
```

Optional: `-e AEGIS_USERNAME=… -e AEGIS_PASSWORD=…` for authed scans (the runner
logs in locally; credentials never reach the cloud).

## Security

Brain-free by construction: built from the official Playwright image + only the
audited executor bundle. No AegisRunner cloud code, and zero shared secrets — it
speaks only the broker's outbound HTTPS API.
