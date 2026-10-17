// Sends the order to the API and tells the shopper what happened.
const form = document.getElementById('checkout');
const notice = document.getElementById('notice');

function showNotice(text, kind) {
  notice.textContent = text;
  notice.className = kind;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const order = {
    customerId: form.customerId.value,
    items: [{ sku: form.sku.value, qty: Number(form.qty.value) }],
  };
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order),
  });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) {
    showNotice(`Order not placed (HTTP ${res.status}: ${reply.error ?? 'unknown error'})`, 'error');
    return;
  }
  showNotice(`Order placed: ${reply.id}`, 'ok');
});
