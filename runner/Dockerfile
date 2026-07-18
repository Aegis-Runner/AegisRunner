# AegisRunner scan-runner — the browser executor for `aegis scan --local`.
#
# It claims scan sessions from AegisRunner over OUTBOUND HTTPS, drives a local
# headless Chromium against YOUR app, and returns snapshot/screenshot
# observations. The app, its traffic, and credentials never leave your network;
# only the findings come back. No inbound port. No shared secrets baked in — the
# only credential is the AEGIS_TOKEN you pass at `docker run` (+ optional
# AEGIS_USERNAME/PASSWORD for authed scans, used locally); the per-session JIT
# token arrives at runtime in the claimed job.
#
# BRAIN-FREE BY CONSTRUCTION: this builds from the OFFICIAL Playwright image
# (Chromium + Node, no AegisRunner code) plus ONLY the audited executor bundle
# (runnerExecutor.mjs). No cloud exploration/AI code is present in ANY layer.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# The bundle does `import 'playwright'`; the base already ships the matching
# browsers at /ms-playwright.
RUN npm install --no-save playwright@1.60.0
COPY runnerExecutor.mjs /app/runnerExecutor.mjs
ENTRYPOINT ["node", "/app/runnerExecutor.mjs"]
