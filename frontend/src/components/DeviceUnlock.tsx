import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App } from '@capacitor/app';
import { Fingerprint, LockKeyhole } from 'lucide-react';
import { deviceUnlock, nativeApp } from '../lib/nativeSecurity';
import { Brand } from './PublicPages';

type Controls = { enabled: boolean; busy: boolean; error: string; change: (enabled: boolean) => Promise<void> };
const Context = createContext<Controls | null>(null);
const failure = (error: unknown) => error instanceof Error && error.message.includes('screen lock')
  ? error.message : 'Device authentication was not completed. Try again with your phone’s screen lock.';

export function DeviceUnlockSettings() {
  const controls = useContext(Context);
  if (!nativeApp || !controls) return null;
  return <section className="panel settings-panel form-stack"><h2>Device unlock</h2>
    <p className="muted">Use Face ID, fingerprint or your phone’s screen lock when opening this app.</p>
    <p>Status: <strong>{controls.enabled ? 'Enabled' : 'Disabled'}</strong></p>
    {controls.error && <p className="feedback error" role="alert">{controls.error}</p>}
    <button className="btn secondary" disabled={controls.busy} onClick={() => void controls.change(!controls.enabled)}>
      <Fingerprint size={19} />{controls.busy ? 'Checking…' : controls.enabled ? 'Disable device unlock' : 'Enable device unlock'}
    </button></section>;
}

export function DeviceUnlockBoundary({ children, end, freshLogin = false }: { children: ReactNode; end: (expired: boolean) => void; freshLogin?: boolean }) {
  const [phase, setPhase] = useState<'loading' | 'locked' | 'ready'>('loading');
  const [enabled, setEnabled] = useState(false);
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const authenticating = useRef(false);
  const enabledRef = useRef(false);
  const alive = useRef(true);
  const offerDialog = useRef<HTMLDialogElement>(null);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true; setBusy(true); setError('');
    try {
      await deviceUnlock.unlock();
      const state = await App.getState();
      if (alive.current && state.isActive) setPhase('ready');
    } catch (error) { if (alive.current) setError(failure(error)); }
    finally { authenticating.current = false; if (alive.current) setBusy(false); }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!nativeApp) { setPhase('ready'); return; }
    deviceUnlock.preference().then(value => {
      if (!alive.current) return;
      enabledRef.current = value === true; setEnabled(value === true);
      setOffer(value === null);
      setPhase(value === true && !freshLogin ? 'locked' : 'ready');
      if (value === true && !freshLogin) void unlock();
    }).catch(() => { if (alive.current) { setPhase('locked'); setError('Device unlock settings could not be read. Try again or sign in again.'); } });
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (!enabledRef.current) return;
      document.documentElement.classList.toggle('native-private', !isActive);
      if (!isActive && !authenticating.current) setPhase('locked');
      // Retry is explicit after cancellation; resume never repeatedly opens prompts.
    });
    return () => {
      alive.current = false;
      void listener.then(handle => handle.remove());
      document.documentElement.classList.remove('native-private');
    };
  }, [unlock, freshLogin]);

  useEffect(() => { if (offer) offerDialog.current?.showModal(); }, [offer]);

  async function change(value: boolean) {
    if (authenticating.current) return;
    authenticating.current = true; setBusy(true); setError('');
    try {
      await deviceUnlock.configure(value);
      if (!alive.current) return;
      setEnabled(value); enabledRef.current = value; setOffer(false);
      if (value && !(await App.getState()).isActive) setPhase('locked');
    } catch (error) { if (alive.current) setError(failure(error)); }
    finally { authenticating.current = false; if (alive.current) setBusy(false); }
  }

  if (!nativeApp) return <>{children}</>;
  if (phase !== 'ready') return <main className="startup-screen"><Brand /><section className="unlock-panel panel form-stack">
    <span className="icon-box"><LockKeyhole size={26} /></span><h1>{phase === 'loading' ? 'Opening your account' : 'App locked'}</h1>
    <p className="muted">{phase === 'loading' ? 'Checking device unlock…' : 'Use your phone’s security to access your account.'}</p>
    {error && <p className="feedback error" role="alert">{error}</p>}
    {phase === 'locked' && <><button className="btn primary" disabled={busy} onClick={() => void unlock()}>{busy ? 'Authenticating…' : 'Unlock app'}</button>
      <button className="btn secondary" disabled={busy} onClick={() => end(false)}>Sign in again</button></>}
  </section></main>;
  return <Context.Provider value={{ enabled, busy, error, change }}>{children}{offer && <dialog ref={offerDialog} className="modal device-unlock-offer" aria-labelledby="device-unlock-title" onCancel={event => { event.preventDefault(); if (!busy) void change(false); }}>
    <div className="modal-body form-stack"><span className="icon-box"><Fingerprint size={26} /></span><h2 id="device-unlock-title">Unlock with your phone?</h2>
      <p>Use Face ID, fingerprint or your phone’s screen lock when you open this app. You can change this in Security settings.</p>
      {error && <p className="feedback error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => void change(true)}>{busy ? 'Checking…' : 'Enable device unlock'}</button>
      <button className="btn secondary" disabled={busy} onClick={() => void change(false)}>Not now</button>
    </div></dialog>}</Context.Provider>;
}
