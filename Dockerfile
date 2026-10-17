# Checkout MCP lab: two browser MCP servers, pinned, plus Google Chrome stable, on Debian 12.
# Lab snapshot 17 Oct 2026. Nothing is installed on the host.
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive
# Google Chrome stable, whatever is current on the build day (the lab recorded 155.0.8059.84 on 17 Oct 2026; tests/out/00_versions.json).
# Both servers drive this one binary, each in its own browser process and profile.
# chrome-devtools-mcp officially supports Chrome stable / Chrome for Testing; Playwright MCP is pointed at it with --browser chrome.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget python3 fonts-dejavu-core \
 && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
# The two MCP servers, exact versions (mcp/package.json). No @latest anywhere in this lab.
WORKDIR /opt/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm ls --depth=0
ENV PATH=/opt/mcp/node_modules/.bin:$PATH
# No telemetry or update checks from chrome-devtools-mcp during the lab (both documented in its README).
ENV CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1 CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
WORKDIR /work
