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
    customer_id: form.customerId.value,
    items: [{ sku: form.sku.value, qty: Number(form.qty.value) }],
  };
  await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order),
  });
  showNotice('Order placed!', 'ok');
});
