// Checkout MCP lab: what two browser MCP servers really show an agent about one planted bug.
// Tests 0-8 run in order, like one debugging session. Every reply is saved to tests/out/ (the video quotes
// those files, never memory). Run inside the lab image: `docker compose run --rm tests`.
//
//   broken app  http://localhost:3000  (app/ as shipped: the planted bug)
//   fixed app   http://localhost:3001  (app/ with fix/ copied over it: the reference fix)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient, textOf, imageOf } from './mcp_client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const BROKEN = 'http://localhost:3000';
const FIXED = 'http://localhost:3001';
fs.mkdirSync(OUT, { recursive: true });

// The exact server commands the lab uses everywhere (also in claude-run/). Container-only flags:
// --no-sandbox (Chrome runs as root in Docker), --headless (no display). --isolated: a fresh in-memory profile.
export const PLAYWRIGHT = ['playwright-mcp', ['--browser', 'chrome', '--headless', '--isolated', '--no-sandbox']];
export const DEVTOOLS = ['chrome-devtools-mcp', ['--headless', '--isolated', '--no-usage-statistics', '--no-performance-crux',
  '--chromeArg=--no-sandbox']];

const save = (name, data) =>
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const servers = [];
let pw, dt;

function startApp(dir, port) {
  const p = spawn('node', [path.join(dir, 'server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(OUT, `app-${port}.log`));
  p.stdout.pipe(log); p.stderr.pipe(log);
  servers.push(p);
}
async function waitUp(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url + '/api/orders')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('app did not start: ' + url);
}
const api = async (base, method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const reset = base => api(base, 'POST', '/api/reset');

// Playwright MCP snapshot lines look like:  - button "Place order" [ref=e12]
function pwRef(snapshot, role, name) {
  const m = snapshot.split('\n').find(l => l.includes(`${role} "${name}"`) && l.includes('[ref='));
  assert.ok(m, `no ${role} "${name}" in Playwright snapshot`);
  return m.match(/\[ref=([^\]]+)\]/)[1];
}
// Chrome DevTools MCP snapshot lines look like:  uid=1_5 button "Place order"
function dtUid(snapshot, role, name) {
  const m = snapshot.split('\n').find(l => l.includes(`${role} "${name}"`) && l.includes('uid='));
  assert.ok(m, `no ${role} "${name}" in DevTools snapshot`);
  return m.match(/uid=(\S+)/)[1];
}

async function playwrightCheckout(base, prefix, customer = 'c-1001') {
  await pw.call('browser_navigate', { url: base + '/' });
  const snap = textOf(await pw.call('browser_snapshot', {}));
  save(`${prefix}_snapshot_before.txt`, snap);
  await pw.call('browser_fill_form', { fields: [
    { name: 'Customer ID', type: 'textbox', target: pwRef(snap, 'textbox', 'Customer ID'), value: customer },
    { name: 'Quantity', type: 'textbox', target: pwRef(snap, 'spinbutton', 'Quantity'), value: '2' },
  ] });
  await pw.call('browser_click', { element: 'Place order button', target: pwRef(snap, 'button', 'Place order') });
  await pw.call('browser_wait_for', { time: 1 });
  const after = textOf(await pw.call('browser_snapshot', {}));
  save(`${prefix}_snapshot_after.txt`, after);
  const shot = imageOf(await pw.call('browser_take_screenshot', { type: 'png', scale: 'css' }));
  if (shot) fs.writeFileSync(path.join(OUT, `${prefix}_screenshot.png`), shot);
  return after;
}

before(async () => {
  // The fixed copy: app/ with every file in fix/ copied over it (fix/ mirrors app/'s layout).
  const fixedDir = '/tmp/fixed-app';
  fs.rmSync(fixedDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'app'), fixedDir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'fix'), fixedDir, { recursive: true, filter: s => !s.endsWith('.diff') });
  startApp(path.join(ROOT, 'app'), 3000);
  startApp(fixedDir, 3001);
  await waitUp(BROKEN); await waitUp(FIXED);
  pw = new McpClient(...PLAYWRIGHT, { log: path.join(OUT, 'playwright-mcp.jsonl') });
  dt = new McpClient(...DEVTOOLS, { log: path.join(OUT, 'devtools-mcp.jsonl') });
  await pw.start(); await dt.start();
});
after(async () => {
  await pw?.close(); await dt?.close();
  for (const s of servers) s.kill();
});

test('0: versions: Chrome, both servers report the pinned versions', () => {
  const chrome = execFileSync('google-chrome', ['--version']).toString().trim();
  const info = { chrome, node: process.version, playwright_mcp: pw.serverInfo, chrome_devtools_mcp: dt.serverInfo,
    playwright_protocol: pw.protocolVersion, devtools_protocol: dt.protocolVersion };
  // The npm packages are the pinned ones. Note what each server *reports*: Playwright MCP's serverInfo carries
  // the Playwright library version it bundles, not the npm package version.
  const pkg = name => JSON.parse(fs.readFileSync(`/opt/mcp/node_modules/${name}/package.json`, 'utf8')).version;
  info.npm = { '@playwright/mcp': pkg('@playwright/mcp'), 'chrome-devtools-mcp': pkg('chrome-devtools-mcp') };
  save('00_versions.json', info);
  assert.match(chrome, /^Google Chrome \d+\./);
  assert.equal(info.npm['@playwright/mcp'], '0.0.83');
  assert.equal(info.npm['chrome-devtools-mcp'], '1.11.0');
  assert.equal(dt.serverInfo.version, '1.11.0');
});

test('1: tools/list: what each server offers the agent (and how much text that costs)', async () => {
  const pt = await pw.listTools(), dtt = await dt.listTools();
  save('01_tools_playwright.json', pt); save('01_tools_devtools.json', dtt);
  const names = t => t.map(x => x.name).sort();
  const summary = {
    playwright: { count: pt.length, json_bytes: JSON.stringify(pt).length, names: names(pt) },
    devtools: { count: dtt.length, json_bytes: JSON.stringify(dtt).length, names: names(dtt) },
  };
  save('01_tools_summary.json', summary);
  for (const n of ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form',
    'browser_network_requests', 'browser_network_request', 'browser_console_messages', 'browser_take_screenshot'])
    assert.ok(summary.playwright.names.includes(n), 'Playwright MCP lacks ' + n);
  for (const n of ['navigate_page', 'take_snapshot', 'click', 'fill', 'list_network_requests', 'get_network_request',
    'list_console_messages', 'performance_start_trace', 'performance_stop_trace', 'list_pages'])
    assert.ok(summary.devtools.names.includes(n), 'Chrome DevTools MCP lacks ' + n);
});

test('2: the API on its own: the field name decides 500 vs 201', async () => {
  await reset(BROKEN);
  const wrong = await api(BROKEN, 'POST', '/api/orders', { customer_id: 'c-1001', items: [{ sku: 'mug-blue', qty: 2 }] });
  const right = await api(BROKEN, 'POST', '/api/orders', { customerId: 'c-1001', items: [{ sku: 'mug-blue', qty: 2 }] });
  const list = await api(BROKEN, 'GET', '/api/orders');
  save('02_api_direct.json', { wrong_field: wrong, right_field: right, orders_after: list });
  assert.equal(wrong.status, 500);
  assert.equal(right.status, 201);
  assert.equal(list.body.length, 1);
  await reset(BROKEN);
});

test('3: Playwright MCP reproduces the lie: "Order placed!" on screen, no order on the server', async () => {
  await reset(BROKEN);
  const after = await playwrightCheckout(BROKEN, '03_pw_broken');
  const orders = await api(BROKEN, 'GET', '/api/orders');
  save('03_orders_after.json', orders);
  assert.match(after, /Order placed!/);
  assert.deepEqual(orders.body, []);
});

test('4: Playwright MCP alone also sees the failed request and the console error', async () => {
  const list = textOf(await pw.call('browser_network_requests', { static: false }));
  save('04_pw_network_requests.txt', list);
  const line = list.split('\n').find(l => l.includes('/api/orders') && l.includes('POST'));
  assert.ok(line, 'POST /api/orders not listed');
  assert.match(line, /500/);
  const index = Number(line.match(/^\s*\[?(\d+)/)[1]);
  const detail = textOf(await pw.call('browser_network_request', { index }));
  save('04_pw_network_request.txt', detail);
  assert.match(detail, /status:\s+\[500\]/);
  // The body is not in the summary; the agent has to ask for that part (the summary says so).
  const reqBody = textOf(await pw.call('browser_network_request', { index, part: 'request-body' }));
  const resBody = textOf(await pw.call('browser_network_request', { index, part: 'response-body' }));
  save('04_pw_request_body.txt', reqBody); save('04_pw_response_body.txt', resBody);
  assert.match(reqBody, /customer_id/);
  assert.doesNotMatch(reqBody, /customerId/);
  assert.match(resBody, /Internal Server Error/);
  const console = textOf(await pw.call('browser_console_messages', { level: 'error' }));
  save('04_pw_console.txt', console);
  assert.match(console, /500/);
});

test('5: Chrome DevTools MCP: same app, its own browser; network detail + console', async () => {
  await reset(BROKEN);
  // Every page tool in 1.11.0 takes a pageId; new_page opens the app and list_pages shows its id.
  save('05_dt_new_page.txt', textOf(await dt.call('new_page', { url: BROKEN + '/' })));
  const pages = textOf(await dt.call('list_pages', {}));
  save('05_dt_pages.txt', pages);
  const pageId = Number(pages.split('\n').find(l => l.includes('localhost:3000')).match(/(\d+)/)[1]);
  const snap = textOf(await dt.call('take_snapshot', { pageId }));
  save('05_dt_snapshot_before.txt', snap);
  await dt.call('fill', { pageId, uid: dtUid(snap, 'textbox', 'Customer ID'), value: 'c-1001' });
  await dt.call('fill', { pageId, uid: dtUid(snap, 'spinbutton', 'Quantity'), value: '2' });
  await dt.call('click', { pageId, uid: dtUid(snap, 'button', 'Place order') });
  await dt.call('wait_for', { pageId, text: ['Order placed!'] });
  const list = textOf(await dt.call('list_network_requests', { pageId, resourceTypes: ['fetch', 'xhr'] }));
  save('05_dt_network_requests.txt', list);
  const line = list.split('\n').find(l => l.includes('/api/orders') && l.includes('POST'));
  assert.ok(line, 'POST /api/orders not listed by DevTools MCP');
  assert.match(line, /500/);
  const reqid = Number(line.match(/reqid=(\d+)/)[1]);
  const detail = textOf(await dt.call('get_network_request', { pageId, reqid }));
  save('05_dt_network_request.txt', detail);
  assert.match(detail, /customer_id/);
  assert.match(detail, /500/);
  const console = textOf(await dt.call('list_console_messages', { pageId }));
  save('05_dt_console.txt', console);
  assert.match(console, /500/);
  const shot = imageOf(await dt.call('take_screenshot', { pageId, format: 'png' }));
  if (shot) fs.writeFileSync(path.join(OUT, '05_dt_screenshot.png'), shot);
  assert.deepEqual((await api(BROKEN, 'GET', '/api/orders')).body, []);
});

test('6: two servers, two browsers: a fresh DevTools server does not see Playwright\'s tab', async () => {
  // Playwright's browser is still on localhost:3000 (test 3). A new DevTools MCP server starts its own Chrome.
  const fresh = new McpClient(...DEVTOOLS, { log: path.join(OUT, 'devtools-mcp-fresh.jsonl') });
  await fresh.start();
  try {
    const pages = textOf(await fresh.call('list_pages', {}));
    save('06_fresh_devtools_pages.txt', pages);
    assert.doesNotMatch(pages, /localhost:3000/);
  } finally { await fresh.close(); }
});

test('7: the reference fix: same steps, HTTP 201, the order is saved, the page names it', async () => {
  await reset(FIXED);
  await pw.call('browser_navigate', { url: FIXED + '/' });   // new page load: the request list starts again
  const after = await playwrightCheckout(FIXED, '07_pw_fixed');
  const list = textOf(await pw.call('browser_network_requests', { static: false }));
  save('07_pw_network_requests.txt', list);
  const orders = await api(FIXED, 'GET', '/api/orders');
  save('07_orders_after.json', orders);
  assert.match(list.split('\n').find(l => l.includes('/api/orders') && l.includes('POST')) ?? '', /201/);
  assert.equal(orders.body.length, 1);
  assert.match(after, new RegExp(`Order placed: ${orders.body[0].id}`));
});

test('8: the fix gates on the reply: an unknown customer gets an error on screen, not "Order placed"', async () => {
  await reset(FIXED);
  const after = await playwrightCheckout(FIXED, '08_pw_fixed_rejected', 'c-9999');
  const orders = await api(FIXED, 'GET', '/api/orders');
  save('08_orders_after.json', orders);
  assert.doesNotMatch(after, /Order placed/);
  assert.match(after, /Order not placed/);
  assert.deepEqual(orders.body, []);
});
