# Claude Code run: claude-run

## Prompt 1: 10 tool calls, 45.2 s, $0.09 (reported), servers visible: playwright

- `mcp__playwright__browser_navigate` {"url": "http://localhost:3000"} → 256 chars
- `mcp__playwright__browser_snapshot` {} → 602 chars
- `mcp__playwright__browser_fill_form` {"fields": [{"target": "e11", "name": "Quantity", "type": "textbox", "value": "2"}]} → 101 chars
- `mcp__playwright__browser_click` {"target": "e12", "element": "Place order button"} → 434 chars
- `mcp__playwright__browser_snapshot` {} → 679 chars
- `mcp__playwright__browser_console_messages` {"level": "info"} → 190 chars
- `mcp__playwright__browser_network_requests` {"static": false} → 158 chars
- `mcp__playwright__browser_network_request` {"index": 3} → 875 chars
- `mcp__playwright__browser_network_request` {"index": 3, "part": "request-body"} → 72 chars
- `mcp__playwright__browser_network_request` {"index": 3, "part": "response-body"} → 44 chars

### Report

After I clicked Place order, the page said **"Order placed!"**, but the order most likely didn't go through: the server returned an error.

**Exact page text after the click:** a status element (`status [ref=e13]`) appeared under the form reading `Order placed!`. Nothing else on the page changed. The form still shows Customer ID `c-1001`, Product "Blue mug", Quantity `2`.

**What actually happened:** the `POST /api/orders` request returned **500 Internal Server Error** with the body `{"error":"Internal Server Error"}`. The browser console logged the same error. The page seems to show the success message no matter how the server responds. I didn't retry, so only one order was submitted, and I made no changes to the app. The only data sent was the pre-filled test data; no real payment or personal information was entered.

**Tools used and what each returned:**

| # | Tool | Returned |
|---|------|----------|
| 1 | `mcp__playwright__browser_navigate` (`http://localhost:3000`) | Page loaded, title "Checkout Lab"; snapshot saved to a file |
| 2 | `mcp__playwright__browser_snapshot` | Form with Customer ID `c-1001`, Product "Blue mug" (selected), Quantity `1`, and a "Place order" button |
| 3 | `mcp__playwright__browser_fill_form` (Quantity = 2) | Ran `getByRole('spinbutton', { name: 'Quantity' }).fill('2')` with no errors |
| 4 | `mcp__playwright__browser_click` (Place order) | Click succeeded; reported "Console: 1 errors" |
| 5 | `mcp__playwright__browser_snapshot` | Quantity now `2`; new status element: "Order placed!" |
| 6 | `mcp__playwright__browser_console_messages` | 1 error: `Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ http://localhost:3000/api/orders` |
| 7 | `mcp__playwright__browser_network_requests` | `[POST] http://localhost:3000/api/orders => [500] Internal Server Error` (2 static requests not shown) |
| 8 | `mcp__playwright__browser_network_request` (#3, full details) | Status 500, took 5ms, response type `application/json`, plus request and response headers |
| 9 | `mcp__playwright__browser_network_request` (#3, request-body) | `{"customer_id":"c-1001","items":[{"sku":"mug-blue","qty":2}]}` |
| 10 | `mcp__playwright__browser_network_request` (#3, response-body) | `{"error":"Internal Server Error"}` |

## Prompt 2: 13 tool calls, 72.1 s, $0.36 (reported), servers visible: chrome-devtools

- `mcp__chrome-devtools__list_pages` {} → 34 chars
- `mcp__chrome-devtools__navigate_page` {"pageId": 1, "type": "url", "url": "http://localhost:3000/api/orders"} → 115 chars
- `mcp__chrome-devtools__evaluate_script` {"pageId": 1, "function": "() => document.body.innerText", "waitForStableDom": false} → 49 chars
- `mcp__chrome-devtools__navigate_page` {"pageId": 1, "type": "url", "url": "http://localhost:3000"} → 109 chars
- `mcp__chrome-devtools__take_snapshot` {"pageId": 1} → 642 chars
- `mcp__chrome-devtools__fill` {"pageId": 1, "uid": "1_12", "value": "2"} → 35 chars
- `mcp__chrome-devtools__click` {"pageId": 1, "uid": "1_13", "includeSnapshot": true} → 792 chars
- `mcp__chrome-devtools__list_network_requests` {"pageId": 1} → 248 chars
- `mcp__chrome-devtools__list_console_messages` {"pageId": 1} → 167 chars
- `mcp__chrome-devtools__get_network_request` {"pageId": 1, "reqid": 6} → 947 chars
- `mcp__chrome-devtools__get_console_message` {"pageId": 1, "msgid": 1} → 112 chars
- `mcp__chrome-devtools__evaluate_script` {"pageId": 1, "function": "async () => { const r = await fetch('/api/orders', {cache: 'no-store'}); return {status: r.st → 71 chars
- `mcp__chrome-devtools__evaluate_script` {"pageId": 1, "function": "async () => (await fetch('/checkout.js', {cache: 'no-store'})).text()", "waitForStableDom": f → 721 chars

### Report

The order was **not saved**. The server rejected it with a 500 error, but the page showed **"Order placed!"** anyway.

**What the page sent** (`POST http://localhost:3000/api/orders`, `content-type: application/json`, 61 bytes):
```json
{"customer_id":"c-1001","items":[{"sku":"mug-blue","qty":2}]}
```

**What the server answered:** status **500 Internal Server Error**, with this body:
```json
{"error":"Internal Server Error"}
```

**Console:** one error and nothing else: `Failed to load resource: the server responded with a status of 500 (Internal Server Error)`.

**What the page showed:** a status message reading **"Order placed!"** appeared under the form.

**Saved orders (`GET /api/orders`):**
- **Before** this submission: `[]`. That's also after the earlier Playwright order, so neither attempt shows up there.
- **After** this submission: status 200, body `[]`.

**Why the page says "Order placed!":** I read `/checkout.js` without changing it. The submit handler `await`s the `fetch` to `/api/orders` and then always calls `showNotice('Order placed!', 'ok')`. It never checks `response.ok` or the status code, so it shows the success message even when the server returns a 500.

**What the evidence doesn't show:** why the server returned a 500. The response body is a generic error, and I didn't look at server logs or server code. I can also only say `GET /api/orders` returns an empty list. I can't confirm how or where the server stores orders.

I submitted one order, made no retries, and didn't modify any application files. The only data sent was the pre-filled test data.

**Tools used and what each returned:**

| # | Tool | Returned |
|---|------|----------|
| 1 | `list_pages` | One page, `about:blank` |
| 2 | `navigate_page` → `/api/orders` | Navigated successfully |
| 3 | `evaluate_script` (`document.body.innerText`) | `"[]"` (baseline) |
| 4 | `navigate_page` → `http://localhost:3000` | Navigated; title "Checkout Lab" |
| 5 | `take_snapshot` | Form: Customer ID `c-1001`, Product "Blue mug", Quantity `1`, "Place order" button |
| 6 | `fill` (Quantity = 2) | "Successfully filled out the element" |
| 7 | `click` (Place order, with snapshot) | Quantity `2`; new status element "Order placed!" |
| 8 | `list_network_requests` | `GET /` 200, `GET /checkout.js` 200, `GET /favicon.ico` 204, `POST /api/orders` **500** |
| 9 | `list_console_messages` | 1 error: failed to load resource, status 500 |
| 10 | `get_network_request` (reqid 6) | Request and response headers and bodies shown above |
| 11 | `get_console_message` (msgid 1) | Same 500 error text |
| 12 | `evaluate_script` (fetch `/api/orders`) | `{"status":200,"body":"[]"}` |
| 13 | `evaluate_script` (fetch `/checkout.js`) | Source code showing the success message is shown without checking the response |

## Prompt 3: 20 tool calls, 85.0 s, $0.89 (reported), servers visible: playwright, chrome-devtools

- `Glob` {"pattern": "**/*"} → 1111 chars
- `Read` {"file_path": "<lab>\\claude-run\\work\\app\\api.mjs"} → 845 chars
- `Read` {"file_path": "<lab>\\claude-run\\work\\app\\server.mjs"} → 2903 chars
- `Read` {"file_path": "<lab>\\claude-run\\work\\app\\public\\index.html"} → 2062 chars
- `Read` {"file_path": "<lab>\\claude-run\\work\\app\\public\\checkout.js"} → 712 chars
- `Bash` {"command": "docker logs --tail 30 checkout-lab-run 2>&1; docker exec checkout-lab-run node --version", "description": " → 727 chars ERROR
- `Edit` {"replace_all": false, "file_path": "<lab>\\claude-run\\work\\app\\public\\checkout.js", "old_string": "    customer_id: → 230 chars
- `Write` {"file_path": "<lab>\\claude-run\\work\\app\\tests\\orders.test.mjs", "content": "// Regression test: the checkout form' → 223 chars
- `mcp__playwright__browser_navigate` {"url": "http://localhost:3000"} → 256 chars
- `mcp__playwright__browser_evaluate` {"function": "async () => (await fetch('/checkout.js', {cache: 'no-store'})).text()"} → 930 chars
- `mcp__playwright__browser_snapshot` {} → 602 chars
- `mcp__playwright__browser_fill_form` {"fields": [{"target": "e11", "name": "Quantity", "type": "textbox", "value": "2"}]} → 101 chars
- `mcp__playwright__browser_click` {"target": "e12", "element": "Place order button"} → 279 chars
- `mcp__playwright__browser_snapshot` {} → 647 chars
- `mcp__playwright__browser_network_requests` {"static": false} → 199 chars
- `mcp__playwright__browser_console_messages` {"level": "info"} → 54 chars
- `mcp__playwright__browser_network_request` {"index": 4, "part": "request-body"} → 71 chars
- `mcp__playwright__browser_network_request` {"index": 4, "part": "response-body"} → 126 chars
- `mcp__playwright__browser_navigate` {"url": "http://localhost:3000/api/orders"} → 250 chars
- `mcp__playwright__browser_evaluate` {"function": "() => document.body.innerText"} → 238 chars
- denied: Bash

### Report

The fix works in the browser: the order now saves and shows up in `/api/orders`. But **I couldn't run the regression test**, because Bash is denied in this session. So the `docker exec` command never ran, and the test's pass/fail status is unknown.

## Comparing the two earlier runs
Playwright and Chrome DevTools captured the same thing. Both sent `{"customer_id":"c-1001","items":[{"sku":"mug-blue","qty":2}]}`, got back **500** with `{"error":"Internal Server Error"}`, and logged one console error. Both pages showed "Order placed!", and `/api/orders` stayed `[]`. The two tools don't disagree; they show the same bug.

## Causal chain
I worked this out from the source code. With Bash blocked I couldn't read the server's stack trace (`docker logs`), so I haven't seen the actual exception.

1. `app/public/checkout.js:13` sent the customer as **`customer_id`** (snake_case).
2. `app/api.mjs:6` reads **`body.customerId`** (camelCase), which is `undefined`, so `db.customers.get(undefined)` returns `undefined`.
3. `app/api.mjs:9` then reads `customer.id`, which throws a `TypeError` before `db.orders.push` runs, so nothing gets saved.
4. `app/server.mjs:46-50` catches the error and returns a 500 with a generic message.
5. `app/public/checkout.js:16-21` waited for the request but never checked the status, so it always showed "Order placed!".

## Fix (only `app/public/checkout.js` changed)
- I renamed the field to `customerId` so it matches what the API reads.
- If `!res.ok`, the page now shows `Order failed (HTTP <status>). Please try again.` instead of the success message.

`api.mjs` is unchanged. It still crashes with a 500, rather than a clean 400 error, when the customer ID is missing or unknown. That would be a reasonable follow-up, but I left it out to keep the fix small.

## Regression test: `app/tests/orders.test.mjs`
It uses only built-in Node modules (`node:test`, `node:vm`). It runs the real `checkout.js` against a fake page and sends its request straight into `api.handle`, turning a thrown error into a 500 the way `server.mjs` does. It has two tests:
1. The form's request saves an order (`c-1001`, `mug-blue`, quantity 2) and the page shows "Order placed!".
2. When the server returns a 500, the page shows an error instead of "Order placed!".

**Status: not run.** I expect both tests to fail on the old code and pass on the new code, but that's untested. To check it, run `docker exec checkout-lab-run node --test /work/app/tests/orders.test.mjs`, or allow Bash and I'll run it.

## Browser re-run (Playwright, Quantity 2)
- **Passed:** the server was serving the fixed `checkout.js`.
- **Passed:** the request sent `{"customerId":"c-1001","items":[{"sku":"mug-blue","qty":2}]}`.
- **Passed:** the server answered **201 Created** with `{"id":"ord-1001","customerId":"c-1001","items":[{"sku":"mug-blue","qty":2}],"createdAt":"2026-10-17T17:36:36.975Z"}`.
- **Passed:** the page showed "Order placed!", and this time the message is backed by a saved order.
- **Passed:** there were no console messages.
- **Passed:** `GET /api/orders` returned that one order, `ord-1001`.
- **Not tested:** the error message itself. Every live order now succeeds, so it would only show in the browser if I forced a failure. Only the unrun regression test covers it.

Nothing is committed. The changes are the edit to `app/public/checkout.js` and the new file `app/tests/orders.test.mjs`. Test order `ord-1001` is still in the server's memory; `POST /api/reset` clears it.
