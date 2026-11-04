// Local UI checks. Google selection is simulated; server token verification is
// covered separately by banking.test_auth_methods with the verifier boundary mocked.
async (page) => {
  const origin = 'http://127.0.0.1:4322', api = 'http://127.0.0.1:8011/api/';
  const assert = (ok, why) => { if (!ok) throw new Error(why); };
  const registered = await page.request.post(api + 'auth/register/', { data: { name: 'Account Review', email: `v160-${Date.now()}@example.test`, password: 'Review!Ocean427' } });
  const session = await registered.json();
  const headers = { Authorization: 'Bearer ' + session.token };
  await page.request.post(api + 'security/pin/', { headers, data: { pin: '1234' } });
  await page.request.post(api + 'card/', { headers, data: { pin: '1234', network: 'mastercard' } });
  let googleLinked = false, hasPassword = true;
  await page.route(api + 'activity/updates/**', route => route.fulfill({ json: { cursor: 0, entries: [], account: { ...session.account, google_linked: googleLinked, has_password: hasPassword } } }));
  await page.route(api + 'dashboard/', async route => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, account: { ...data.account, google_linked: googleLinked, has_password: hasPassword } } });
  });
  await page.route(api + 'auth/google/config/', route => route.fulfill({ json: { client_id: 'local-ui-test' } }));
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: `window.google={accounts:{id:{initialize(options){window.testGoogleCallback=options.callback},renderButton(element){const button=document.createElement('button');button.type='button';button.textContent='Confirm Google account';button.onclick=()=>window.testGoogleCallback({credential:'local-ui-identity'});element.replaceChildren(button)}}}};` }));
  await page.route(api + 'auth/google/link/', async route => {
    const data = route.request().postDataJSON();
    assert(data.current_password === 'Review!Ocean427' && data.credential === 'local-ui-identity', 'Link lost credential or password');
    googleLinked = true;
    await route.fulfill({ json: { ...session.account, google_linked: true, has_password: true } });
  });
  await page.route(api + 'auth/google/unlink/', async route => {
    assert(route.request().postDataJSON().current_password === 'Review!Ocean427', 'Unlink lost password');
    googleLinked = false;
    await route.fulfill({ json: { ...session.account, google_linked: false, has_password: true } });
  });
  await page.route(api + 'auth/password/add/', async route => {
    const data = route.request().postDataJSON();
    assert(data.new_password === 'Review!Ocean978' && data.credential === 'local-ui-identity', 'Password creation lost Google proof');
    hasPassword = true;
    await route.fulfill({ json: { ...session.account, google_linked: true, has_password: true } });
  });
  await page.goto(origin);
  await page.evaluate(token => localStorage.setItem('hdfc.access', token), session.token);
  await page.goto(origin + '/#profile/security');
  await page.getByRole('button', { name: 'Link Google account', exact: true }).click();
  const methodForm = page.locator('.method-form');
  await methodForm.getByLabel('Current password', { exact: true }).fill('Review!Ocean427');
  await methodForm.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Google account', exact: true }).click();
  await page.getByText('Google linked. Both sign-in methods are available.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Unlink Google', exact: true }).click();
  await methodForm.getByLabel('Current password', { exact: true }).fill('Review!Ocean427');
  await page.getByRole('button', { name: 'Confirm unlink Google', exact: true }).click();
  await page.getByText(/Google unlinked\. Use your email/).waitFor();
  hasPassword = false; googleLinked = true;
  await page.reload();
  assert(await page.getByRole('button', { name: 'Unlink Google', exact: true }).isDisabled(), 'Last sign-in method can be removed');
  await page.getByRole('button', { name: 'Add email password', exact: true }).click();
  await methodForm.getByLabel('New password', { exact: false }).first().fill('Review!Ocean978');
  await methodForm.getByLabel('Confirm new password', { exact: true }).fill('Mismatch!Ocean978');
  await methodForm.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('New passwords do not match.', { exact: true }).waitFor();
  await methodForm.getByLabel('Confirm new password', { exact: true }).fill('Review!Ocean978');
  await methodForm.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Google account', exact: true }).click();
  await page.getByText('Password added. You can now sign in with Google or email and password.', { exact: true }).waitFor();
  const measured = [];
  for (const width of [320, 390, 768, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['profile', 'profile/security', 'cards']) {
      await page.goto(origin + '/#' + section);
      await page.getByRole('heading', { level: 1 }).waitFor();
      if (section === 'cards') {
        await page.getByRole('button', { name: 'Show card details' }).waitFor();
        const cardBox = await page.locator('.virtual-card').boundingBox();
        assert(Math.abs(cardBox.width / cardBox.height - 85.6 / 53.98) < .02, 'Card is not debit-card proportions');
      }
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector('main').getBoundingClientRect().toJSON(), panels: [...document.querySelectorAll('.settings-menu, .card-page, .security-settings')].map(e => e.getBoundingClientRect().toJSON()) }));
      assert(geometry.document <= width, `Overflow at ${width} on ${section}`);
      if (section === 'profile' && width >= 1100) {
        const tiles = await page.locator('.settings-link').evaluateAll(elements => elements.slice(0, 3).map(e => e.getBoundingClientRect().y));
        assert(tiles.every(y => y === tiles[0]), 'Large desktop profile does not have three columns');
      }
      await page.screenshot({ path: `artifacts/browser/v160-${section.replace('/', '-')}-${width}.png`, fullPage: true });
      measured.push({ width, section, ...geometry });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('native-ios'));
  const topPadding = await page.locator('.app-header').evaluate(e => parseFloat(getComputedStyle(e).paddingTop));
  assert(topPadding === 54, 'iOS header reduction not applied');
  await page.evaluate(() => document.documentElement.classList.remove('native-ios'));
  return { passed: ['Explicit Google link and unlink forms', 'Last-method protection', 'Google-only password creation with confirmation', 'Password mismatch feedback', 'Five-width profile, security and card layouts', 'iOS header spacing'], measured };
}
