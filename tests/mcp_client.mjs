// A small MCP client over stdio: starts the server as a child process and speaks JSON-RPC 2.0, one message
// per line, on its stdin/stdout. No SDK. Every line both ways is logged (JSONL) with a timestamp; image data in
// the log is replaced by its size (the caller still gets the full image).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const PROTOCOL = '2025-06-18';

export class McpClient {
  constructor(command, args, { log, timeoutMs = 60000 } = {}) {
    this.command = command; this.args = args; this.timeoutMs = timeoutMs;
    this.log = log ? fs.createWriteStream(log) : null;
    this.nextId = 1; this.pending = new Map();
  }

  #write(direction, msg) {
    if (!this.log) return;
    const short = JSON.parse(JSON.stringify(msg), (k, v) => (k === 'data' && typeof v === 'string' && v.length > 200 ? `<${v.length} chars of base64>` : v));
    this.log.write(JSON.stringify({ t: new Date().toISOString(), dir: direction, msg: short }) + '\n');
  }

  async start() {
    this.proc = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.on('error', err => { for (const p of this.pending.values()) p.reject(err); });
    this.proc.stderr.on('data', d => this.log?.write(JSON.stringify({ t: new Date().toISOString(), dir: 'server-stderr', msg: d.toString() }) + '\n'));
    readline.createInterface({ input: this.proc.stdout }).on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }      // not JSON-RPC (should not happen on stdout)
      this.#write('server->client', msg);
      const p = msg.id !== undefined && this.pending.get(msg.id);
      if (!p) return;                                          // a notification or a server->client request
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`)) : p.resolve(msg.result);
    });
    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'checkout-mcp-lab', version: '0.1' },
    });
    this.serverInfo = init.serverInfo; this.protocolVersion = init.protocolVersion; this.capabilities = init.capabilities;
    this.notify('notifications/initialized');
    return init;
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    this.#write('client->server', msg);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no reply in ${this.timeoutMs} ms`)); }, this.timeoutMs);
      this.pending.set(id, { method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    this.#write('client->server', msg);
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      tools.push(...r.tools); cursor = r.nextCursor;
    } while (cursor);
    return tools;
  }

  // Calls a tool; a tool-level error (isError: true) throws, with the server's own text.
  async call(name, args = {}) {
    const r = await this.request('tools/call', { name, arguments: args });
    if (r.isError) throw new Error(`${name} failed: ${textOf(r)}`);
    return r;
  }

  async close() {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.proc.stdin.end();
    await new Promise(res => { const t = setTimeout(() => { this.proc.kill('SIGKILL'); res(); }, 5000); this.proc.on('exit', () => { clearTimeout(t); res(); }); });
    this.log?.end();
  }
}

export const textOf = result => (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
export const imageOf = result => {
  const img = (result.content ?? []).find(c => c.type === 'image');
  return img ? Buffer.from(img.data, 'base64') : null;
};
