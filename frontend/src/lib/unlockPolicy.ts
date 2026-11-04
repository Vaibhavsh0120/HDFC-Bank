type Driver = {
  native: boolean;
  read: () => Promise<unknown>;
  write: (enabled: boolean) => Promise<void>;
  secure: () => Promise<boolean>;
  authenticate: () => Promise<void>;
};

// Keep the policy independent of native APIs so cancellation and failures can be tested.
export function createUnlockPolicy(driver: Driver) {
  async function preference(): Promise<boolean | null> {
    if (!driver.native) return false;
    const value = await driver.read();
    if (value === null || typeof value === 'boolean') return value;
    throw new Error('Device unlock settings could not be read. Sign in again to continue.');
  }
  async function authenticate() {
    if (!await driver.secure()) throw new Error('Set a screen lock in your phone settings, then try again.');
    await driver.authenticate();
  }
  return {
    preference,
    async configure(enabled: boolean) {
      if (!driver.native) throw new Error('Device unlock is available in the mobile app.');
      // Turning an existing lock off also requires the device owner's confirmation.
      if (enabled || await preference() === true) await authenticate();
      await driver.write(enabled);
    },
    async unlock() {
      if (!driver.native) return;
      if (await preference() === true) await authenticate();
    },
  };
}
