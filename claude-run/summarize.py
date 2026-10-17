"""Summarize one Claude Code run (tests/out/<run>/): per prompt, the tools Claude saw, every tool call in order with
its reply size, the reported cost/duration, and the final report; plus reply sizes per MCP server from the proxy logs.
Writes <run>/summary.json and <run>/summary.md. Local paths are replaced by <lab> (the owner's machine stays out).

    python3 claude-run/summarize.py tests/out/claude-run
"""
import json
import pathlib
import re
import sys

run = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "tests/out/claude-run")
LOCAL = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\"\s]+[\\/]+[^\"\s]*?checkout-mcp-lab", re.I)


def scrub(s):
    return LOCAL.sub("<lab>", s) if isinstance(s, str) else s


def result_text(c):
    content = c.get("content")
    if isinstance(content, str):
        return content
    return "".join(x.get("text", "") for x in content or [] if isinstance(x, dict))


prompts = []
for n in (1, 2, 3):
    f = run / f"prompt-{n}.stream.jsonl"
    if not f.exists():
        continue
    p = {"prompt": n, "calls": []}
    pending = {}
    for line in f.read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        if e["type"] == "system" and e.get("subtype") == "init":
            p["mcp_servers"] = [s["name"] for s in e.get("mcp_servers", [])]
            p["tools_visible"] = len(e.get("tools", []))
            p["builtin_tools"] = [t for t in e.get("tools", []) if not t.startswith("mcp__")]
            p["model"] = e.get("model")
        elif e["type"] == "assistant":
            for c in e["message"]["content"]:
                if c["type"] == "tool_use":
                    call = {"t": e.get("timestamp"), "tool": c["name"], "input": json.loads(scrub(json.dumps(c["input"])))}
                    pending[c["id"]] = call
                    p["calls"].append(call)
        elif e["type"] == "user":
            for c in e["message"]["content"]:
                if isinstance(c, dict) and c.get("type") == "tool_result" and c["tool_use_id"] in pending:
                    txt = result_text(c)
                    call = pending[c["tool_use_id"]]
                    call["reply_chars"] = len(txt)
                    call["is_error"] = bool(c.get("is_error"))
                    call["reply_head"] = scrub(txt[:240])
        elif e["type"] == "result":
            p.update(cost_usd_reported=e.get("total_cost_usd"), duration_ms=e.get("duration_ms"), turns=e.get("num_turns"),
                     denials=[d["tool_name"] for d in e.get("permission_denials", [])], report=scrub(e.get("result", "")))
    prompts.append(p)

servers = {}
for name in ("playwright", "devtools"):
    f = run / f"{name}-mcp.jsonl"
    if not f.exists():
        continue
    calls, chars, first = {}, 0, {}
    for line in f.read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        m = e["msg"]
        if not isinstance(m, dict):
            continue
        if e["dir"] == "client->server" and m.get("method") in ("initialize", "server/discover") and m["method"] not in first:
            first[m["method"]] = m.get("params", {}).get("protocolVersion")
        if e["dir"] == "server->client" and isinstance(m.get("result"), dict) and "content" in m["result"]:
            n = sum(len(c.get("text", "")) for c in m["result"]["content"] if isinstance(c, dict))
            calls[m["id"]] = n
            chars += n
    servers[name] = {"tool_replies": len(calls), "reply_chars": chars, "client_protocol_versions_sent": first}

summary = {"run": run.name, "session_id": (run / "session-id.txt").read_text().strip() if (run / "session-id.txt").exists() else None,
           "prompts": prompts, "proxy": servers}
(run / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

md = [f"# Claude Code run: {run.name}", ""]
for p in prompts:
    md += [f"## Prompt {p['prompt']}: {len(p['calls'])} tool calls, {p.get('duration_ms', 0) / 1000:.1f} s, "
           f"${p.get('cost_usd_reported') or 0:.2f} (reported), servers visible: {', '.join(p.get('mcp_servers', []))}", ""]
    for c in p["calls"]:
        md.append(f"- `{c['tool']}` {json.dumps(c['input'])[:120]} → {c.get('reply_chars', '?')} chars{' ERROR' if c.get('is_error') else ''}")
    if p.get("denials"):
        md.append(f"- denied: {', '.join(p['denials'])}")
    md += ["", "### Report", "", p.get("report", ""), ""]
(run / "summary.md").write_text("\n".join(md), encoding="utf-8")
print(json.dumps({k: v for k, v in summary.items() if k != "prompts"}, indent=1))
for p in prompts:
    print(p["prompt"], p.get("mcp_servers"), p.get("tools_visible"), len(p["calls"]), p.get("duration_ms"), p.get("cost_usd_reported"), p.get("denials"))
