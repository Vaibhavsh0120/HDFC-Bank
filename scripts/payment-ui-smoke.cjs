// Build frontend first, then run with Playwright available on NODE_PATH:
// node scripts/payment-ui-smoke.cjs [--baseline]
// Uses fictional API responses and intercepts built assets; never contacts a bank API.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const baseline = process.argv.includes('--baseline');
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'artifacts/payment-ui');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  const context = await browser.newContext();
  const account = { name: 'Payment Reviewer', email: 'review@example.test', number: '900000000001', type: 'Savings', balance: '55100.00', status: 'Active', payment_locked: false, transfer_alerts: true, has_password: true };
  const recipient = { name: 'Demo Recipient', number: '900000000002' };
  let locked = false;
  let incoming = [];
  await context.addInitScript(() => localStorage.setItem('hdfc.access', 'fictional-ui-test-session'));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const current = { ...account, payment_locked: locked };
      const payload = url.pathname.includes('dashboard') ? { account: current, recent: [] }
        : url.pathname.includes('activity/updates') ? { cursor: 0, account: current, entries: incoming.splice(0) }
        : url.pathname.includes('beneficiaries') ? { beneficiaries: [] }
        : url.pathname.includes('security/pin') ? { configured: true, locked_until: null }
        : url.pathname.includes('recipient') ? recipient : {};
      return route.fulfill({ json: payload, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' } });
    }
    if (url.hostname !== 'payment-ui.test') return route.abort();
    const file = path.join(root, 'frontend/dist', url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    assert(file.startsWith(path.join(root, 'frontend/dist') + path.sep));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
    try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  const states = [];
  const capture = async name => {
    if (!process.env.BD_CAPTURE_SCRIPT) return;
    const state = await page.evaluate(await fs.readFile(process.env.BD_CAPTURE_SCRIPT, 'utf8'));
    states.push({ ...state, name });
    await fs.writeFile(path.join(output, 'spacing-states.json'), JSON.stringify(states));
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const width of [1440, 1728, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://payment-ui.test/#payments');
      await page.getByRole('heading', { name: 'Pay another account', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-card-${width}.png`), fullPage: true });
      await capture(`Payment methods ${width}`);
      await page.getByRole('button', { name: baseline ? 'Enter account number' : /^Pay with account number/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-account-${width}.png`), fullPage: true });
      await capture(`Account payment ${width}`);
      if (!baseline) {
        await dialog.getByRole('heading', { name: 'Pay with account number', exact: true }).waitFor();
        assert.equal(await dialog.getByText('Scan account QR code', { exact: true }).count(), 0);
        assert.equal(await dialog.getByLabel('Upload QR image').count(), 0);
        await dialog.getByLabel('Recipient account number').fill(recipient.number);
        await dialog.getByLabel('Amount (INR)').fill('55101');
        await dialog.getByRole('button', { name: 'Review transfer' }).click();
        await dialog.getByRole('alert').filter({ hasText: 'higher than your available balance' }).waitFor();
        await dialog.getByLabel('Amount (INR)').fill('125.50');
        await dialog.getByRole('button', { name: 'Review transfer' }).click();
        await dialog.getByText(recipient.name, { exact: false }).waitFor();
        await dialog.getByLabel('Transaction PIN', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Edit details' }).click();
        assert.equal(await dialog.getByLabel('Amount (INR)').inputValue(), '125.50');
        const box = await dialog.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width, 'Dialog overflows viewport');
        assert(box.height < 800, 'Dialog stretches beyond its content');
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    }
    if (baseline) return;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://payment-ui.test/#payments');
    await page.getByRole('button', { name: /^Pay with QR/ }).click();
    await page.getByRole('heading', { name: 'Pay with QR', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Recipient account number').count(), 0);
    await page.getByRole('button', { name: 'Scan QR code', exact: true }).click();
    await page.getByRole('button', { name: 'Close scanner' }).click();
    await page.screenshot({ path: path.join(output, 'after-qr-mobile.png'), fullPage: true });
    await page.getByLabel('Upload QR image').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Back to payment methods' }).click();
    // Make a real QR with the app's existing receive screen, then decode the image.
    await page.goto('http://payment-ui.test/#payments/receive');
    await page.getByLabel('Request amount (INR)').fill('75.50');
    await page.getByLabel('Payment note').fill('Shared lunch');
    const ownQr = await page.locator('.receive-code svg').screenshot();
    await page.goto('http://payment-ui.test/#payments');
    await page.getByRole('button', { name: /^Pay with QR/ }).click();
    await page.getByLabel('Upload QR image').setInputFiles({ name: 'own-qr.png', mimeType: 'image/png', buffer: ownQr });
    await page.getByRole('alert').filter({ hasText: 'your own QR code' }).waitFor();
    // Render a second fictional account's receive QR in a fresh intercepted context.
    const receiverPage = await context.newPage();
    await receiverPage.route('**/api/dashboard/', route => route.fulfill({ json: { account: { ...account, ...recipient }, recent: [] }, headers: { 'access-control-allow-origin': '*' } }));
    await receiverPage.route('**/api/activity/updates/**', route => route.fulfill({ json: { account: { ...account, ...recipient }, entries: [], cursor: 0 }, headers: { 'access-control-allow-origin': '*' } }));
    await receiverPage.goto('http://payment-ui.test/#payments/receive');
    await receiverPage.getByLabel('Request amount (INR)').fill('75.50');
    await receiverPage.getByLabel('Payment note').fill('Shared lunch');
    const qr = await receiverPage.locator('.receive-code svg').screenshot();
    await page.getByLabel('Upload QR image').setInputFiles({ name: 'recipient-qr.png', mimeType: 'image/png', buffer: qr });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByLabel('Recipient account number').inputValue(), recipient.number);
    assert.equal(await page.getByLabel('Amount (INR)').inputValue(), '75.50');
    assert.equal(await page.getByPlaceholder('Add a note').inputValue(), 'Shared lunch');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('dialog').getByText(recipient.name, { exact: false }).waitFor();
    await page.getByLabel('Transaction PIN', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    locked = true;
    await page.goto('http://payment-ui.test/#payments');
    await page.getByText('Your outgoing payments are locked.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Pay with account number/ }).count(), 0);
    locked = false;
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto('http://payment-ui.test/#payments');
    await page.reload();
    await page.getByRole('button', { name: /^Pay with QR/ }).waitFor();
    const entry = { reference: 'DEMO-NOTICE-1', kind: 'transfer', amount: '125.50', direction: 'credit', description: '', created_at: new Date().toISOString(), status: 'Completed', counterparty: recipient };
    incoming = [entry, { ...entry, reference: 'DEMO-NOTICE-2' }];
    await page.clock.runFor(4000);
    await page.locator('.transfer-notice').first().waitFor();
    assert.equal(await page.locator('.transfer-notice').count(), 2);
    await page.screenshot({ path: path.join(output, 'after-notifications-mobile.png') });
    await page.getByRole('button', { name: 'Dismiss notification' }).first().click();
    assert.equal(await page.locator('.transfer-notice').count(), 1);
    await page.clock.runFor(1999);
    assert.equal(await page.locator('.transfer-notice').count(), 1, 'Notification disappeared before 2 seconds');
    await page.clock.runFor(1);
    assert.equal(await page.locator('.transfer-notice').count(), 0, 'Notification did not dismiss after 2 seconds');
    const nativePage = await context.newPage();
    await nativePage.addInitScript(() => {
      window.CapacitorCustomPlatform = { name: 'ios' };
      window.scannerCalls = 0;
      window.scannerResult = '';
      window.Capacitor = {
        PluginHeaders: [{ name: 'CapacitorBarcodeScanner', methods: [{ name: 'scanBarcode', rtype: 'promise' }] }],
        nativePromise: async () => { window.scannerCalls++; return { ScanResult: window.scannerResult, format: 0 }; },
      };
    });
    await nativePage.goto('http://payment-ui.test/#payments');
    await nativePage.getByRole('button', { name: /^Pay with QR/ }).click();
    await nativePage.getByRole('button', { name: 'Scan QR code', exact: true }).click();
    await nativePage.waitForFunction(() => window.scannerCalls === 1);
    await nativePage.getByRole('button', { name: 'Scan QR code', exact: true }).waitFor();
    assert.equal(await nativePage.getByRole('button', { name: 'Open camera scanner' }).count(), 0);
    assert.equal(await nativePage.getByRole('button', { name: 'Close scanner' }).count(), 0);
    await nativePage.evaluate(number => { window.scannerResult = 'HDFC-BANK:ACCOUNT:' + number; }, recipient.number);
    await nativePage.getByRole('button', { name: 'Scan QR code', exact: true }).click();
    await nativePage.getByRole('dialog').waitFor();
    assert.equal(await nativePage.getByLabel('Recipient account number').inputValue(), recipient.number);
    await nativePage.close();
    assert.deepEqual(errors, []);
    console.log('PASS: separate manual/QR flows; 4 viewport widths; amount validation; recipient review and PIN; QR image decoding, own-QR/invalid-image errors; payment lock; Escape dismissal; simultaneous notifications, manual dismiss and exact 2-second auto-dismiss. API responses are fictional fixtures.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
