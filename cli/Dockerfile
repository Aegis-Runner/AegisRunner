# AegisRunner self-hosted runner — a lightweight agent you run INSIDE your own
# network. It claims jobs from AegisRunner over an outbound-only HTTPS
# connection, executes them locally against your private/staging targets, and
# reports results back. No inbound port is opened.
#
#   docker run --rm \
#     -e AEGIS_TOKEN=aegis_xxx \
#     [-e AEGIS_API=https://app.aegisrunner.com/api/v1] \
#     ghcr.io/aegis-runner/runner:latest      # or: aegisrunner1/runner
#
# Add --network host (or attach it to the network that can reach your target) so
# the runner can reach private hosts on your LAN/VPC. The image is zero-dependency
# (Node builtins only), so it's tiny and has no install step.
FROM node:20-alpine

LABEL org.opencontainers.image.title="AegisRunner self-hosted runner" \
      org.opencontainers.image.description="Outbound-only agent that runs AegisRunner jobs inside your network" \
      org.opencontainers.image.source="https://github.com/Aegis-Runner/AegisRunner" \
      org.opencontainers.image.vendor="AegisRunner"

WORKDIR /app

# Only the files the runner needs (no dependencies to install).
COPY package.json README.md ./
COPY bin ./bin
COPY lib ./lib

# Run as the built-in non-root user.
USER node

# AEGIS_TOKEN is required at runtime; AEGIS_API defaults to production.
ENTRYPOINT ["node", "bin/aegis.mjs", "runner"]
