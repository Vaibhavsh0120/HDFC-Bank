import { Capacitor } from '@capacitor/core';
import { createUnlockPolicy } from './unlockPolicy';

export const nativeApp = Capacitor.isNativePlatform();
export const sessionKey = 'hdfc.access';
let initialized: Promise<{ store: typeof import('@aparajita/capacitor-secure-storage').SecureStorage }> | undefined;
async function vault() {
  initialized ??= (async () => {
    const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.setKeyPrefix('hdfc-bank_');
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    // Capacitor proxies expose a synthetic `then` method. Never resolve a Promise
    // with the proxy itself: Promise assimilation would wait forever.
    return { store: SecureStorage };
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}

export const deviceUnlock = createUnlockPolicy({
  native: nativeApp,
  read: async () => (await vault()).store.get('device-unlock', false, false),
  write: async enabled => (await vault()).store.set('device-unlock', enabled, false, false),
  secure: async () => (await (await import('@aparajita/capacitor-biometric-auth')).BiometricAuth.checkBiometry()).deviceIsSecure,
  authenticate: async () => {
    const { BiometricAuth, AndroidBiometryStrength } = await import('@aparajita/capacitor-biometric-auth');
    return BiometricAuth.authenticate({
    reason: 'Unlock HDFC Bank', allowDeviceCredential: true,
    iosFallbackTitle: 'Use phone passcode', androidTitle: 'Unlock HDFC Bank',
    androidSubtitle: 'Use your fingerprint, face or phone screen lock',
    androidBiometryStrength: AndroidBiometryStrength.strong,
    });
  },
});

export async function readSavedSession(): Promise<string | undefined> {
  if (nativeApp) {
    const { store } = await vault();
    const saved = await store.get(sessionKey, false, false);
    if (saved !== null && typeof saved !== 'string') throw new Error('Saved login could not be read.');
    if (saved) { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); return saved; }
    const legacy = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);
    if (legacy) {
      await store.set(sessionKey, legacy, false, false);
      localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey);
      return legacy;
    }
    return undefined;
  }
  const saved = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);
  if (saved) { localStorage.setItem(sessionKey, saved); sessionStorage.removeItem(sessionKey); }
  return saved || undefined;
}

export async function saveSession(token: string) {
  if (nativeApp) {
    await (await vault()).store.set(sessionKey, token, false, false);
    localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey);
  } else localStorage.setItem(sessionKey, token);
}

export async function forgetSession() {
  if (nativeApp) await (await vault()).store.remove(sessionKey, false);
  localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey);
}
