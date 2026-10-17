# What two browser MCP servers show an agent about a page that lies: a test-first lab

**Lab snapshot: 17 Oct 2026.** `@playwright/mcp` **0.0.83** and `chrome-devtools-mcp` **1.11.0** (exact versions,
`mcp/package-lock.json`), Google Chrome stable (155.0.8059.84 on the build day; the Dockerfile installs whatever is
current), Node 22, Debian 12, all in Docker. Nothing is installed on the host.

Checkout Lab is a tiny local shop with **one bug, planted on purpose**. Click *Place order* and the page says
**"Order placed!"**, but the API answered **500** and saved nothing. The front end sends `customer_id`, the API reads
`customerId`, crashes on `customer.id`, and the page never looks at the reply. The lab asks what each MCP server
hands an AI agent about that: the page, the request, the reply, the console. It doesn't ask which tool is "better".

## What's in it

| Path | What it is |
|---|---|
| `app/` | The shop: `server.mjs` (no dependencies; orders in memory), `api.mjs`, `public/`. The bug lives here. |
| `fix/` | The reference fix (`reference-fix.diff`): send `customerId`, gate the message on `res.ok`, answer 400 for an unknown customer. |
| `mcp/` | The two servers, pinned (`package.json` + lockfile). |
| `tests/mcp_client.mjs` | A 90-line MCP client: starts a server as a child process, JSON-RPC 2.0 over stdio, logs every line. No SDK. |
| `tests/lab.test.mjs` | Tests 0–8 (`node:test`), run in order like one debugging session. Every reply is saved in `tests/out/`. |
| `proxy/mcp_log_proxy.py` | A stdio logging proxy: forwards bytes unchanged, writes every JSON-RPC line with a timestamp. |
| `claude-run/` | `run-claude.sh` (one real headless Claude Code session, three prompts), `summarize.py`. |

## Run it

```bash
docker compose build
docker compose run --rm tests          # tests 0-8, writes tests/out/
bash claude-run/run-claude.sh          # optional: one real Claude Code session (needs `claude` logged in)
python3 claude-run/summarize.py tests/out/claude-run
```

Container-only server flags, not advice for a desktop: `--no-sandbox` (Chrome runs as root in Docker), `--headless`,
`--isolated` (a fresh in-memory profile). chrome-devtools-mcp also runs with `--no-usage-statistics` and
`--no-performance-crux`, and with `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS` set.

## The tests

Written first and run red (`tests/out/red-phase.log`: the client was a stub, 9 failed), then green
(`tests/out/green-phase.log`: **9 passed**).

0. **Versions** (`00_versions.json`). npm `@playwright/mcp` 0.0.83, `chrome-devtools-mcp` 1.11.0. In `initialize`,
   Playwright MCP reports `{"name":"Playwright","version":"1.64.0-alpha-1790635538000"}`: the Playwright build it
   bundles, not its npm version. DevTools MCP reports `1.11.0`. (Both echo the protocol version the client asks for.)
1. **tools/list** (`01_tools_summary.json`, default capabilities, no `--caps`): Playwright MCP **25 tools, 20,286
   characters** of tool JSON; DevTools MCP **32 tools, 29,361 characters**.
2. **The API alone** (`02_api_direct.json`): `{"customer_id":…}` → 500 `{"error":"Internal Server Error"}`;
   `{"customerId":…}` → 201.
3. **Playwright MCP reproduces it** (`03_*`): after the click the snapshot shows `status: Order placed!`, and the
   reply's header already says `Console: 1 errors`. `GET /api/orders` → `[]`.
4. **Playwright MCP alone sees the 500** (`04_*`): `browser_network_requests` lists
   `[POST] http://localhost:3000/api/orders => [500] Internal Server Error`. The detail view has headers only and
   says *Call browser_network_request with part="request-body" to read the request body*; that call returns
   `{"customer_id":"c-1001","items":[{"sku":"mug-blue","qty":2}]}`. The console: `Failed to load resource: … 500`.
5. **Chrome DevTools MCP, its own browser** (`05_*`): page tools take a `pageId` (the default; `--no-page-id-routing`
   turns that off). `list_network_requests` → `reqid=4 POST http://localhost:3000/api/orders [500]`;
   `get_network_request` returns headers **and both bodies in one reply**. The console shows the same 500 line.
6. **Two browsers, with these flags** (`06_*`): while both servers run there are two Chrome browser processes with
   two profiles, `/tmp/playwright_chromiumdev_profile-…` and `/tmp/puppeteer_dev_chrome_profile-…`. A fresh DevTools
   server lists only `about:blank`. (Both servers can instead attach to an already running Chrome.)
7. **The reference fix** (`07_*`): same steps → 201, one saved order, the page says `Order placed: ord-1001`.
8. **The fix gates on the reply** (`08_*`): unknown customer `c-9999` → 400, the page says
   `Order not placed (HTTP 400: unknown customerId)`, nothing saved.

Neither browser server sees past the HTTP boundary: the `TypeError` is only in the app's own log (`app-3000.log`).

## One real Claude Code session (`tests/out/claude-run/`, 17 Oct 2026)

Claude Code 2.1.302, one session (`--session-id`, then `--resume`), `--permission-mode dontAsk`, per-prompt MCP configs
so each prompt **sees** only its servers, the owner's personal CLAUDE.md excluded, a neutral app copy (no hints in
code or git history). Prompt 1: Playwright MCP only. Prompt 2: DevTools MCP only. Prompt 3: both, plus Claude Code's
own file tools and one allowed test command. `summary.md` lists every call.

- **Prompt 1** (10 calls, 45.2 s, $0.09 reported): navigate, snapshot, fill, click, snapshot, console, network
  list, the request summary, then — following the summary's own hint — `part: "request-body"` and `"response-body"`.
  Reported "Order placed!" on screen, a 500 behind it, and the `customer_id` body.
- **Prompt 2** (13 calls, 72.1 s, $0.36 reported): checked `/api/orders` first (`[]`), reproduced, `reqid=6 [500]`,
  both bodies inline, the console line; then fetched `/checkout.js` through `evaluate_script` and found the missing
  status check. It said what the evidence did *not* show: why the server returned 500.
- **Prompt 3** (20 calls, 85.0 s, $0.89 reported): read the source, explained the chain, changed only
  `public/checkout.js` (send `customerId`; show an error if `!res.ok`), wrote two regression tests, re-ran the flow
  with Playwright MCP: **201**, `ord-1001` saved. Its first shell command (`docker logs …; docker exec … node
  --version`) was outside the allowed rule and was denied; it then treated all shell use as blocked, never ran the
  one allowed test command, and reported the test as **"not run"**. We ran it afterwards
  (`regression-red-green.txt`): **0/2 on the original app, 2/2 on its fix**. It left the API's 500-on-unknown-customer
  as a named follow-up.

Costs are as reported by the CLI (`total_cost_usd`), not billed amounts. `claude-run-1/` is an earlier, **flawed**
run kept for the record: the owner's CLAUDE.md, a commit message and a code comment saying "planted bug" reached it,
and it was given a test command that doesn't work on Node 22. It fixed the API instead (read `customer_id`) and
left the page's missing status check as a follow-up.

## Safety notes from the servers' own READMEs

- Playwright MCP: "Playwright MCP is **not** a security boundary."
- Chrome DevTools MCP exposes the browser's content to the client; usage statistics are **enabled by default**
  (`--no-usage-statistics`); performance tools may send trace URLs to the CrUX API (`--no-performance-crux`).
- Use a disposable profile and a local app. Pin versions. The agent sees everything that browser sees.

Apache-2.0. The servers under test are Microsoft's and Google's projects under their own licences.
