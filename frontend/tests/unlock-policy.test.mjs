import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnlockPolicy } from '../src/lib/unlockPolicy.ts';

function fixture({ native = true, saved = null, secure = true, cancelled = false } = {}) {
  let value = saved, prompts = 0, writes = 0;
  const policy = createUnlockPolicy({ native, read: async () => value, write: async enabled => { value = enabled; writes++; },
    secure: async () => secure, authenticate: async () => { prompts++; if (cancelled) throw new Error('Cancelled'); } });
  return { policy, value: () => value, prompts: () => prompts, writes: () => writes };
}

test('website never reads native preferences or prompts for device authentication', async () => {
  const f = fixture({ native: false, saved: true });
  assert.equal(await f.policy.preference(), false);
  await f.policy.unlock();
  await assert.rejects(f.policy.configure(true));
  assert.equal(f.prompts(), 0);
});
test('first app login offers a choice and Not now persists without a prompt', async () => {
  const f = fixture();
  assert.equal(await f.policy.preference(), null);
  await f.policy.configure(false);
  assert.equal(await f.policy.preference(), false);
  await f.policy.unlock();
  assert.equal(f.prompts(), 0);
});
test('enabling requires real authentication; enabled cold/resumed opens authenticate again', async () => {
  const f = fixture();
  await f.policy.configure(true);
  assert.equal(f.value(), true);
  await f.policy.unlock(); await f.policy.unlock();
  assert.equal(f.prompts(), 3);
});
test('cancelled enable does not enable or save a choice', async () => {
  const f = fixture({ cancelled: true });
  await assert.rejects(f.policy.configure(true), /Cancelled/);
  assert.equal(f.value(), null); assert.equal(f.writes(), 0);
});
test('cancelled unlock/disable preserves enabled protection', async () => {
  const f = fixture({ saved: true, cancelled: true });
  await assert.rejects(f.policy.unlock());
  await assert.rejects(f.policy.configure(false));
  assert.equal(f.value(), true); assert.equal(f.writes(), 0);
});
test('phones without a screen lock cannot enable protection', async () => {
  const f = fixture({ secure: false });
  await assert.rejects(f.policy.configure(true), /screen lock/);
  assert.equal(f.value(), null); assert.equal(f.prompts(), 0);
});
test('corrupt settings fail closed instead of silently disabling protection', async () => {
  const f = fixture({ saved: 'true' });
  await assert.rejects(f.policy.unlock(), /could not be read/);
});
