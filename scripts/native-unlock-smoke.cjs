// 1.5.1 iOS/LiveContainer regressions using the real plugin JavaScript and a simulated native bridge.
async (page) => {
  const run = async (platform) => {
  const origin = new URL(page.url()).origin;
  const api = 'http://127.0.0.1:8011/api/';
  const assert = (value, why) => { if (!value) throw new Error(why); };
  assert(['http://127.0.0.1:4321', 'http://127.0.0.1:4322'].includes(origin), 'Use the isolated local demo');
  const response = await page.request.post(api + 'auth/register/', { data: { name: 'Native Review', email: `native-${Date.now()}@example.test`, password: 'Review!Ocean427' } });
  assert(response.ok(), 'Fixture registration failed');
  const session = await response.json();
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ token, platform }) => {
    // Native calls go through the real plugin JS and a test-only bridge adapter.
    if (platform === 'ios') window.webkit = { messageHandlers: { bridge: {} } };
    else window.androidBridge = {};
    const listeners = new Map();
    let nextId = 0;
    const emit = active => { window.__native.active = active; for (const item of listeners.values()) if (item.event === 'appStateChange') item.callback({ isActive: active }); };
    window.__native = { active: true, emit, pause: () => { for (const item of listeners.values()) if (item.event === 'pause') item.callback(); } };
    const promiseMethods = (name, methods) => ({ name, methods: methods.map(name => ({ name, rtype: 'promise' })) });
    window.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: [{ name: 'getState', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] },
        promiseMethods('BiometricAuthNative', ['checkBiometry', 'internalAuthenticate']),
        promiseMethods('SecureStorage', ['internalGetItem', 'internalSetItem', 'internalRemoveItem', 'setSynchronizeKeychain']),
      ],
      nativeCallback(plugin, method, args, callback) {
        if (plugin !== 'App' || method !== 'addListener') throw new Error('Unexpected callback');
        const id = String(++nextId); listeners.set(id, { event: args.eventName, callback }); return id;
      },
      async nativePromise(plugin, method, args = {}) {
        if (plugin === 'App') {
          if (method === 'getState') return { isActive: !localStorage.getItem('mock.staleActive') && window.__native.active };
          if (method === 'removeListener') { listeners.delete(args.callbackId); return; }
        }
        if (plugin === 'SecureStorage') {
          const key = 'mock.vault.' + args.prefixedKey;
          if (method === 'internalGetItem') return { data: localStorage.getItem(key) };
          if (method === 'internalSetItem') { localStorage.setItem(key, args.data); return; }
          if (method === 'internalRemoveItem') { localStorage.removeItem(key); return { success: true }; }
          if (method === 'setSynchronizeKeychain') return;
        }
        if (plugin === 'BiometricAuthNative') {
          if (method === 'checkBiometry') return { deviceIsSecure: !localStorage.getItem('mock.insecure'), isAvailable: true, strongBiometryIsAvailable: true, biometryType: 3, biometryTypes: [3], reason: '', code: '' };
          if (method === 'internalAuthenticate') {
            localStorage.setItem('mock.authCount', String(Number(localStorage.getItem('mock.authCount')) + 1));
            if (!args.allowDeviceCredential) throw new Error('Missing OS credential fallback');
            emit(false); await new Promise(resolve => setTimeout(resolve, 30)); if (!localStorage.getItem('mock.noActiveEvent')) setTimeout(() => emit(true), 150);
            if (localStorage.getItem('mock.cancel')) throw new Error('Authentication cancelled');
            return;
          }
        }
        throw new Error(`Unexpected native call ${plugin}.${method}`);
      },
    };
  }, { token: session.token, platform });
  const native = await context.newPage();
  const errors = [];
  native.on('pageerror', error => errors.push(error.message));
  const login = async () => {
    await native.goto(origin + '/#login');
    await native.getByLabel('Email address', { exact: true }).fill(session.account.email);
    await native.getByRole('textbox', { name: 'Password', exact: true }).fill('Review!Ocean427');
    await native.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  await native.goto(origin + '/#login');
  await native.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
  assert(await native.getByRole('dialog').count() === 0, 'Logged-out app offered device unlock');
  await native.evaluate(token => localStorage.setItem('hdfc.access', token), session.token);
  await native.goto(origin + '/#overview');
  await native.reload();
  await native.getByRole('heading', { name: 'Welcome, Native' }).waitFor({ timeout: 5000 }).catch(async () => { throw new Error('Welcome checkpoint 1: ' + (await native.locator('body').innerText()).slice(-1200)); });
  assert(await native.getByRole('dialog').count() === 0, 'Restored session incorrectly offered setup without a fresh login');
  await native.goto(origin + '/#profile/security');
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).click();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  await native.evaluate(() => { localStorage.setItem('mock.staleActive', '1'); localStorage.setItem('mock.noActiveEvent', '1'); });
  await native.reload();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor({ timeout: 5000 });
  assert(await native.getByRole('heading', { name: 'App locked', exact: true }).count() === 0, 'Successful Face ID left the app locked');
  // Genuine iOS backgrounding emits pause; the Face ID interruption only emits inactive.
  await native.evaluate(() => window.__native.emit(false));
  await native.evaluate(() => window.__native.pause());
  await native.getByRole('heading', { name: 'App locked', exact: true }).waitFor();
  await native.evaluate(() => { window.__native.emit(true); localStorage.setItem('mock.cancel', '1'); });
  await native.getByRole('button', { name: 'Unlock app', exact: true }).click();
  await native.getByRole('alert').waitFor();
  assert(await native.locator('.app-shell').count() === 0, 'Cancellation exposed the account');
  await native.evaluate(() => localStorage.removeItem('mock.cancel'));
  await native.getByRole('button', { name: 'Unlock app', exact: true }).click();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  await native.getByRole('button', { name: 'Sign out', exact: true }).click();
  await native.getByRole('heading', { name: /Your money/ }).waitFor();
  const cleared = await native.evaluate(() => ({ token: localStorage.getItem('mock.vault.hdfc-bank_hdfc.access'), preference: localStorage.getItem('mock.vault.hdfc-bank_device-unlock') }));
  assert(!cleared.token && cleared.preference === 'false', 'Logout kept the saved session or device lock enabled');
  // Simulate a device that has never answered setup to test first-login timing.
  await native.evaluate(() => localStorage.removeItem('mock.vault.hdfc-bank_device-unlock'));
  let releaseDashboard;
  const holdDashboard = new Promise(resolve => { releaseDashboard = resolve; });
  await native.route(api + 'dashboard/', async route => { await holdDashboard; await route.continue(); }, { times: 1 });
  await login();
  await native.getByRole('status', { name: 'Loading your account' }).waitFor();
  assert(await native.getByRole('dialog').count() === 0, 'Setup appeared before the dashboard verified login');
  releaseDashboard();
  await native.getByRole('dialog').waitFor();
  assert((await native.locator('.page-heading h1').innerText()).includes('Welcome, Native'), 'Setup opened without the dashboard');
  const measurements = [];
  for (const [width, height] of [[320, 740], [390, 844], [393, 852], [844, 390]]) {
    await native.setViewportSize({ width, height });
    const box = await native.getByRole('dialog').boundingBox();
    assert(box.height <= height - 32, 'Offer stretched to phone height');
    assert(Math.abs((box.x + box.width / 2) - width / 2) < 2, 'Offer is not horizontally centered');
    assert(box.y >= 12 && box.y + box.height <= height - 12, 'Offer is outside the safe viewport');
    measurements.push({ width, height, box });
    await native.screenshot({ path: `artifacts/browser/v151-${platform}-offer-${width}.png`, fullPage: true });
  }
  await native.setViewportSize({ width: 390, height: 844 });
  await native.getByRole('button', { name: 'Not now', exact: true }).click();
  await native.reload();
  await native.getByRole('heading', { name: 'Welcome, Native' }).waitFor({ timeout: 5000 }).catch(async () => { throw new Error('Welcome checkpoint 2: ' + (await native.locator('body').innerText()).slice(-1200)); });
  assert(await native.getByRole('dialog').count() === 0, 'Declined setup was shown again');
  await native.getByRole('button', { name: 'Sign out', exact: true }).click();
  await native.getByRole('heading', { name: /Your money/ }).waitFor();
  await login();
  await native.getByRole('heading', { name: 'Welcome, Native' }).waitFor();
  assert(await native.getByRole('dialog').count() === 0, 'Setup repeated on a later login');
  await native.getByRole('button', { name: 'Sign out', exact: true }).click();
  await native.getByRole('heading', { name: /Your money/ }).waitFor();
  await native.goto(origin + '/#login');
  const google = native.getByRole('button', { name: 'Continue with Google', exact: true });
  await google.waitFor();
  const visual = await google.evaluate(e => ({ height: e.getBoundingClientRect().height, border: getComputedStyle(e).borderTopWidth, icon: !!e.querySelector('img,svg') }));
  assert(visual.height >= 48 && visual.border !== '0px' && visual.icon, 'Google sign-in is not a clear outlined provider button');
  await native.screenshot({ path: `artifacts/browser/v151-${platform}-signin-390.png`, fullPage: true });
  await native.evaluate(() => { localStorage.setItem('mock.vault.hdfc-bank_hdfc.access', JSON.stringify('expired-session')); localStorage.setItem('mock.vault.hdfc-bank_device-unlock', 'true'); });
  await native.reload();
  await native.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
  assert(await native.getByRole('dialog').count() === 0 && await native.getByRole('heading', { name: 'App locked', exact: true }).count() === 0, 'Expired session opened device authentication');
  assert(errors.length === 0, 'Runtime errors: ' + errors.join('; '));
  await context.close();
  return { platform, passed: ['No setup before login or on restoration', 'Successful Face ID with stale inactive state', 'Genuine background lock and cancellation/retry', 'Logout clears device lock', 'Offer only after dashboard verification', 'Content-sized centered phone dialog', 'Visible Google button', 'Expired-session recovery'], measurements, boundary: 'Simulated native bridge; physical biometric behavior still needs phone confirmation' };
  };
  const results = [];
  for (const platform of ['ios', 'android']) results.push(await run(platform));
  return results;
}
