// The order API. GET /api/orders lists saved orders; POST /api/orders saves one; POST /api/reset clears them.
export function handle(method, pathname, body, db) {
  if (method === 'GET' && pathname === '/api/orders') return { status: 200, json: db.orders };
  if (method === 'POST' && pathname === '/api/reset') { db.orders.length = 0; return { status: 200, json: { ok: true } }; }
  if (method === 'POST' && pathname === '/api/orders') {
    const customer = db.customers.get(body.customerId);
    const order = {
      id: `ord-${1000 + db.orders.length + 1}`,
      customerId: customer.id,
      items: body.items,
      createdAt: new Date().toISOString(),
    };
    db.orders.push(order);
    return { status: 201, json: order };
  }
  return { status: 404, json: { error: 'Not found' } };
}
