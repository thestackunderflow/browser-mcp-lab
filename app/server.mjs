// Checkout Lab: a tiny local shop with ONE planted bug (see README). No dependencies, no real payments,
// nothing leaves this machine. Orders live in memory; POST /api/reset clears them.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const db = { orders: [], customers: new Map([['c-1001', { id: 'c-1001', name: 'Test Customer' }]]) };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

// api.mjs is re-imported whenever its file changes, so an edit takes effect without a restart
// (file watchers are unreliable on Docker bind mounts from Windows; a stat per request is not).
let api, apiMtime = 0;
async function loadApi() {
  const file = path.join(HERE, 'api.mjs');
  const { mtimeMs } = await fs.stat(file);
  if (mtimeMs !== apiMtime) { api = await import(pathToFileURL(file).href + '?v=' + mtimeMs); apiMtime = mtimeMs; }
  return api;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const { status, json } = (await loadApi()).handle(req.method, url.pathname, body, db);
      console.log(`${req.method} ${url.pathname} -> ${status}`);
      return send(res, status, json);
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }   // keeps the console free of a 404
    // Static files are read on every request, so a front-end edit shows on the next page load.
    const file = path.join(HERE, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(path.join(HERE, 'public'))) return send(res, 404, { error: 'Not found' });
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, { error: 'Not found' });
    // The stack trace stays in the server log. The browser only gets a 500 and a generic message.
    console.error(`${req.method} ${url.pathname} -> 500\n${err.stack}`);
    send(res, 500, { error: 'Internal Server Error' });
  }
}).listen(PORT, () => console.log(`Checkout Lab on http://localhost:${PORT}`));
