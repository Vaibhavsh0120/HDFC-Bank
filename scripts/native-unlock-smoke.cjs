// UI integration against a simulated Capacitor bridge; this is not a hardware test.
async (page) => {
  const origin = 'http://127.0.0.1:4322';
  const api = 'http://127.0.0.1:8011/api/';
  const assert = (value, why) => { if (!value) throw new Error(why); };
  const response = await page.request.post(api + 'auth/register/', { data: { name: 'Native Review', email: `native-${Date.now()}@example.test`, password: 'Review!Ocean427' } });
  assert(response.ok(), 'Fixture registration failed');
  const session = await response.json();
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ token }) => {
    // Native calls go through the real plugin JS and a test-only bridge adapter.
    window.androidBridge = {};
    const listeners = new Map();
    let nextId = 0;
    const emit = active => { window.__native.active = active; for (const cb of listeners.values()) cb({ isActive: active }); };
    window.__native = { active: true, emit };
    if (!localStorage.getItem('mock.seeded')) { localStorage.setItem('hdfc.access', token); localStorage.setItem('mock.seeded', '1'); }
    const promiseMethods = (name, methods) => ({ name, methods: methods.map(name => ({ name, rtype: 'promise' })) });
    window.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: [{ name: 'getState', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] },
        promiseMethods('BiometricAuthNative', ['checkBiometry', 'internalAuthenticate']),
        promiseMethods('SecureStorage', ['internalGetItem', 'internalSetItem', 'internalRemoveItem', 'setSynchronizeKeychain']),
      ],
      nativeCallback(plugin, method, args, callback) {
        if (plugin !== 'App' || method !== 'addListener') throw new Error('Unexpected callback');
        const id = String(++nextId); listeners.set(id, callback); return id;
      },
      async nativePromise(plugin, method, args = {}) {
        if (plugin === 'App') {
          if (method === 'getState') return { isActive: window.__native.active };
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
            emit(false); await new Promise(resolve => setTimeout(resolve, 30)); emit(true);
            if (localStorage.getItem('mock.cancel')) throw new Error('Authentication cancelled');
            return;
          }
        }
        throw new Error(`Unexpected native call ${plugin}.${method}`);
      },
    };
  }, { token: session.token });
  const native = await context.newPage();
  const errors = [];
  native.on('pageerror', error => errors.push(error.message));
  await native.goto(origin + '/#overview');
  await native.getByRole('dialog').waitFor();
  await native.getByRole('heading', { name: 'Unlock with your phone?' }).waitFor();
  assert(await native.evaluate(() => localStorage.getItem('hdfc.access')) === null, 'Native session left in browser localStorage');
  await native.getByRole('button', { name: 'Not now', exact: true }).click();
  await native.reload();
  await native.getByRole('heading', { name: 'Welcome, Native' }).waitFor();
  assert(await native.getByRole('dialog').count() === 0, 'Declined first-login offer appeared again');
  await native.goto(origin + '/#profile/security');
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).click();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  const count = await native.evaluate(() => Number(localStorage.getItem('mock.authCount')));
  assert(count === 1, 'Enabling did not authenticate exactly once');
  await native.reload();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  assert(await native.evaluate(() => Number(localStorage.getItem('mock.authCount'))) === count + 1, 'Cold open did not authenticate');
  await native.evaluate(() => window.__native.emit(false));
  await native.getByRole('heading', { name: 'App locked', exact: true }).waitFor();
  await native.evaluate(() => { window.__native.emit(true); localStorage.setItem('mock.cancel', '1'); });
  await native.getByRole('button', { name: 'Unlock app', exact: true }).click();
  await native.getByRole('alert').waitFor();
  assert(await native.locator('.app-shell').count() === 0, 'Cancelled unlock exposed account content');
  await native.screenshot({ path: 'artifacts/browser/v150-native-locked-390.png', fullPage: true });
  await native.evaluate(() => localStorage.removeItem('mock.cancel'));
  await native.getByRole('button', { name: 'Unlock app', exact: true }).click();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).click();
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).waitFor();
  await native.reload();
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).waitFor();
  await native.evaluate(() => localStorage.setItem('mock.insecure', '1'));
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).click();
  await native.getByRole('alert').filter({ hasText: 'Set a screen lock' }).waitFor();
  await native.evaluate(() => { localStorage.removeItem('mock.vault.hdfc-bank_device-unlock'); localStorage.removeItem('mock.insecure'); localStorage.setItem('mock.cancel', '1'); });
  await native.reload();
  await native.getByRole('heading', { name: 'Unlock with your phone?' }).waitFor();
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).click();
  await native.getByRole('dialog').getByRole('alert').waitFor();
  assert(await native.evaluate(() => localStorage.getItem('mock.vault.hdfc-bank_device-unlock')) === null, 'Cancelled first-time enable saved a preference');
  await native.evaluate(() => localStorage.removeItem('mock.cancel'));
  await native.getByRole('button', { name: 'Enable device unlock', exact: true }).click();
  await native.getByRole('dialog').waitFor({ state: 'detached' });
  await native.getByRole('button', { name: 'Disable device unlock', exact: true }).waitFor();
  await native.screenshot({ path: 'artifacts/browser/v150-native-security-390.png', fullPage: true });
  assert(errors.length === 0, 'Native UI runtime errors: ' + errors.join('; '));
  await context.close();
  return { passed: ['Legacy-session migration to native vault', 'First-login offer and persisted decline', 'Enable/disable system authentication', 'Cold-open lock', 'Background lock', 'Cancellation stays locked', 'Retry unlock', 'No-screen-lock error', 'Cancelled enable leaves offer open'], boundary: 'Simulated bridge; hardware authentication not claimed' };
}
