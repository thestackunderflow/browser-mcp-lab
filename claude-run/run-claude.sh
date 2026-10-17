#!/usr/bin/env bash
# One real, logged, headless Claude Code session against Checkout Lab: three prompts in ONE session.
#   Prompt 1 may use only Playwright MCP tools. Prompt 2 only Chrome DevTools MCP tools.
#   Prompt 3 also gets Claude Code's own file tools (Read/Edit/...) and one test command: editing power
#   comes from the client, never from the browser MCP servers.
# Host needs `docker` and `claude` (logged in). The app, both servers, both browsers and the logging proxy
# run in one lab container, so "localhost:3000" means the same app to both browsers.
#   Claude Code --stdio--> docker exec -i lab [mcp_log_proxy.py --stdio--> playwright-mcp | chrome-devtools-mcp]
set -uo pipefail
cd "$(dirname "$0")/.."
LAB="$(pwd -W 2>/dev/null || pwd)"
OUT=tests/out/${RUN_DIR:-claude-run}
NAME=checkout-lab-run
rm -rf "$OUT" claude-run/work && mkdir -p "$OUT" claude-run/work
cp -r app claude-run/work/app                      # a disposable copy: the lab's app/ keeps the planted bug
(cd claude-run/work && git init -q && git add -A && git -c user.name=lab -c user.email=lab@localhost commit -qm "Checkout Lab")   # neutral: no hint in history or code

docker rm -f "$NAME" >/dev/null 2>&1
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" --init --shm-size 1g \
  -v "$LAB/claude-run/work:/work" -v "$LAB/proxy:/proxy:ro" -v "$LAB/$OUT:/out" \
  checkout-mcp-lab:0.1 node /work/app/server.mjs >/dev/null
sleep 2

# One MCP config per prompt, so each prompt *sees* only the servers it may use (not just permission):
#   prompt 1: Playwright only · prompt 2: DevTools only · prompt 3: both.
PW_SERVER='"playwright": {
      "command": "docker",
      "args": ["exec", "-i", "'"$NAME"'", "python3", "/proxy/mcp_log_proxy.py", "--log", "/out/playwright-mcp.jsonl", "--png-dir", "/out",
               "--", "playwright-mcp", "--browser", "chrome", "--headless", "--isolated", "--no-sandbox", "--output-dir", "/out/pw-files"]
    }'
DT_SERVER='"chrome-devtools": {
      "command": "docker",
      "args": ["exec", "-i", "'"$NAME"'", "python3", "/proxy/mcp_log_proxy.py", "--log", "/out/devtools-mcp.jsonl", "--png-dir", "/out",
               "--", "chrome-devtools-mcp", "--headless", "--isolated", "--no-usage-statistics", "--no-performance-crux", "--chromeArg=--no-sandbox"]
    }'
printf '{ "mcpServers": { %s } }
' "$PW_SERVER" > claude-run/mcp-playwright.json
printf '{ "mcpServers": { %s } }
' "$DT_SERVER" > claude-run/mcp-devtools.json
printf '{ "mcpServers": { %s, %s } }
' "$PW_SERVER" "$DT_SERVER" > claude-run/mcp-both.json

SESSION=$(python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || python -c 'import uuid; print(uuid.uuid4())')
echo "$SESSION" > "$OUT/session-id.txt"
CLAUDE="${CLAUDE:-claude}"
# The owner's personal CLAUDE.md must not reach the run (it would steer the agent): excluded by setting;
# user settings are not loaded either (--setting-sources project,local). Auth is unaffected.
COMMON=(--setting-sources project,local --settings '{"claudeMdExcludes":["**/.claude/CLAUDE.md"],"autoMemoryEnabled":false}'
        --strict-mcp-config --permission-mode dontAsk --max-budget-usd 3
        --output-format stream-json --verbose)

run() {   # run <n> <mcp-config> <tools> <allowed> <prompt> [--session-id|--resume]
  local n=$1 cfg=$2 tools=$3 allowed=$4 prompt=$5 flag=$6
  echo "{\"prompt\": $n, \"started\": \"$(date -u +%FT%TZ)\"}" >> "$OUT/timeline.jsonl"
  (cd claude-run/work && MSYS_NO_PATHCONV=1 timeout 900 "$CLAUDE" -p "$prompt" "$flag" "$SESSION" \
      --mcp-config "$LAB/$cfg" --tools "$tools" --allowedTools "$allowed" "${COMMON[@]}" < /dev/null) > "$OUT/prompt-$n.stream.jsonl" 2> "$OUT/prompt-$n.stderr.txt"
  echo "{\"prompt\": $n, \"exit\": $?, \"ended\": \"$(date -u +%FT%TZ)\"}" >> "$OUT/timeline.jsonl"
}

P1='Use the Playwright MCP tools to open http://localhost:3000 and submit one test order (the form is pre-filled with test data; set Quantity to 2).
Record exactly what the page says after clicking Place order.
Do not edit the application. List the tool names you used and what each returned.
Do not use real payment or personal information.'

P2='Now use the Chrome DevTools MCP tools to open http://localhost:3000 and submit the same test order (Quantity 2).
Find out what the page sent to the server and what the server answered, and check the console.
Also check http://localhost:3000/api/orders to see whether any order was saved.
State only what the captured evidence supports. Do not modify application files.'

P3='Compare the two results.
Read the app source code in this folder. Explain the causal chain first, then make the smallest fix. You have my approval to edit files under app/.
Add a regression test as app/tests/orders.test.mjs using node:test (no new dependencies); run it with:
docker exec checkout-lab-run node --test /work/app/tests/orders.test.mjs
Then re-run the same browser flow with Playwright MCP (Quantity 2) and check http://localhost:3000/api/orders again.
Report what passed and what failed, honestly.'

run 1 claude-run/mcp-playwright.json "" "mcp__playwright" "$P1" --session-id
run 2 claude-run/mcp-devtools.json "" "mcp__chrome-devtools" "$P2" --resume
run 3 claude-run/mcp-both.json "Read,Edit,Write,Glob,Grep,Bash" "mcp__playwright,mcp__chrome-devtools,Read,Edit,Write,Glob,Grep,Bash(docker exec checkout-lab-run node --test:*)" "$P3" --resume

(cd claude-run/work && git add -A && git diff --cached > "../../$OUT/claude-fix.diff" && git -c user.name=lab -c user.email=lab@localhost commit -qm "Claude's fix" || true)
MSYS_NO_PATHCONV=1 docker exec "$NAME" node --test /work/app/tests/orders.test.mjs > "$OUT/regression-test-rerun.txt" 2>&1
docker logs "$NAME" > "$OUT/app-server.log" 2>&1
docker rm -f "$NAME" >/dev/null
echo done
