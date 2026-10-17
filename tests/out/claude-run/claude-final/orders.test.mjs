// Regression test: the checkout form's payload must be accepted by the order API, and a failed
// request must not be reported to the shopper as "Order placed!".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { handle } from '../api.mjs';

const checkoutSrc = await fs.readFile(new URL('../public/checkout.js', import.meta.url), 'utf8');

// Runs public/checkout.js against a stub DOM, submits the form, and returns the notice it shows.
async function submitOrder(fetch) {
  let onSubmit;
  const form = {
    customerId: { value: 'c-1001' },
    sku: { value: 'mug-blue' },
    qty: { value: '2' },
    addEventListener: (type, fn) => { if (type === 'submit') onSubmit = fn; },
  };
  const notice = { textContent: '', className: '' };
  const document = { getElementById: (id) => ({ checkout: form, notice })[id] };
  vm.runInNewContext(checkoutSrc, { document, fetch });
  await onSubmit({ preventDefault() {} });
  return notice;
}

// Routes fetch into api.handle the way server.mjs does, including turning a thrown error into a 500.
function fetchInto(db) {
  return async (url, opts) => {
    let status, json;
    try { ({ status, json } = handle(opts.method, url, JSON.parse(opts.body), db)); }
    catch { status = 500; json = { error: 'Internal Server Error' }; }
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
}

test('the order the checkout form sends is saved', async () => {
  const db = { orders: [], customers: new Map([['c-1001', { id: 'c-1001', name: 'Test Customer' }]]) };
  const notice = await submitOrder(fetchInto(db));
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0].customerId, 'c-1001');
  assert.deepEqual(db.orders[0].items, [{ sku: 'mug-blue', qty: 2 }]);
  assert.equal(notice.textContent, 'Order placed!');
  assert.equal(notice.className, 'ok');
});

test('a failed order is not reported as placed', async () => {
  const notice = await submitOrder(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.notEqual(notice.textContent, 'Order placed!');
  assert.equal(notice.className, 'error');
});
