// Real local API payments: notifications, QR flip timing and interrupted polling.
async (page) => {
  const api = 'http://127.0.0.1:8011/api/', origin = 'http://127.0.0.1:4322';
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.unrouteAll({ behavior: 'wait' });
  const nonce = Date.now();
  async function register(name) {
    const response = await page.request.post(api + 'auth/register/', { data: { name, email: `${name}-${nonce}@example.test`, password: 'Review!Ocean427' } });
    assert(response.ok(), 'Registration failed'); return response.json();
  }
  const receiver = await register('Receiver'), sender = await register('Sender');
  const headers = { Authorization: 'Bearer ' + sender.token };
  await page.request.post(api + 'security/pin/', { headers, data: { pin: '1234' } });
  let seq = 0;
  const requestId = () => '01234567-89ab-4cde-8fab-' + (nonce + ++seq).toString(16).padStart(12, '0');
  assert((await page.request.post(api + 'movements/', { headers, data: { kind: 'deposit', amount: '1000.00', request_id: requestId(), description: '' } })).ok(), 'Funding failed');
  async function transfer(amount) {
    const result = await page.request.post(api + 'movements/', { headers, data: { kind: 'transfer', amount, recipient: receiver.account.number, pin: '1234', request_id: requestId(), description: 'Notification review' } });
    assert(result.ok(), 'Transfer failed: ' + await result.text());
  }
  await page.goto(origin);
  await page.evaluate(token => localStorage.setItem('hdfc.access', token), receiver.token);
  let failures = 1, attempts = [];
  await page.route(api + 'activity/updates/**', async route => {
    attempts.push(route.request().url());
    if (failures-- > 0) return route.fulfill({ status: 503, json: { detail: 'Simulated temporary interruption' } });
    await route.continue();
  });
  await page.goto(origin + '/#payments/receive');
  await page.getByRole('heading', { name: 'Your receive QR' }).waitFor();
  const start = Date.now(); await transfer('123.45');
  const flip = page.locator('.receive-flip');
  await page.locator('.receive-flip.has-payment').waitFor({ timeout: 6000 });
  assert((await flip.innerText()).includes('₹123.45') && (await flip.innerText()).includes('Sender'), 'QR success lost amount or sender');
  assert(attempts[0].includes('after='), 'First poll discarded payments arriving during initial setup');
  assert(await page.locator('.transfer-notice').count() === 0, 'QR has a duplicate banner');
  const latency = Date.now() - start;
  await page.screenshot({ path: 'artifacts/browser/v162-qr-received.png', fullPage: true });
  const shown = Date.now();
  await page.locator('.receive-flip:not(.has-payment)').waitFor({ timeout: 9000 });
  assert(Date.now() - shown >= 6500, 'QR confirmation disappeared too soon');
  await transfer('12.00');
  await page.locator('.receive-flip.has-payment').waitFor();
  await page.getByRole('button', { name: /Payment received/ }).click();
  assert(!(await flip.getAttribute('class')).includes('has-payment'), 'Tap did not restore QR');
  await page.goto(origin + '/#overview');
  await page.getByRole('heading', { name: 'Welcome, Receiver' }).waitFor();
  await transfer('9.00');
  await page.locator('.transfer-notice').filter({ hasText: '₹9.00' }).waitFor({ timeout: 6000 });
  await page.screenshot({ path: 'artifacts/browser/v162-received-banner.png', fullPage: true });
  await page.locator('.transfer-notice').waitFor({ state: 'detached', timeout: 4000 });
  await page.reload();
  await page.getByRole('heading', { name: 'Welcome, Receiver' }).waitFor();
  assert(await page.locator('.transfer-notice').count() === 0, 'Reload replayed an already-seen payment');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin + '/#payments/receive');
  await page.getByRole('heading', { name: 'Your receive QR' }).waitFor();
  assert(await page.locator('.receive-flip-inner').evaluate(e => getComputedStyle(e).transitionDuration) === '0s', 'Reduced-motion preference ignored');
  return { passed: ['Initial request interruption loses no payment', 'Actual credit amount and sender', 'QR flip and 8-second reset', 'Tap restores QR', 'Other pages retain banner', 'No duplicate after reload', 'Reduced motion'], latencyMs: latency };
}
