import { useEffect, useState, type SubmitEvent } from 'react';
import { message } from '../lib/banking';
import type { AuthedRequest } from './Transactions';

type PinStatus = { configured: boolean; locked_until: string | null };

export function SecurityPin({ send }: { send: AuthedRequest }) {
  const [status, setStatus] = useState<PinStatus>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    send<PinStatus>('security/pin/').then(value => {
      if (active) setStatus(value);
    }, error => {
      if (active) setError(message(error));
    });
    return () => { active = false; };
  }, [send, retry]);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!/^[0-9]{4,6}$/.test(next) || (status?.configured && !/^[0-9]{4,6}$/.test(current))) {
      setError('Enter a 4 to 6 digit PIN.');
      return;
    }
    if (next !== confirmation) {
      setError('The new PIN entries do not match.');
      return;
    }
    setBusy(true);
    try {
      const data = status?.configured ? { current_pin: current, new_pin: next } : { pin: next };
      const result = await send<PinStatus>('security/pin/', data, status?.configured ? 'PATCH' : undefined);
      setStatus(result);
      setCurrent('');
      setNext('');
      setConfirmation('');
      setSuccess('Transaction PIN saved.');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel security-panel">
    <h2>Transaction PIN</h2>
    <p>Use a PIN to authorise withdrawals and transfers.</p>
    {status ? <form className="form-stack" onSubmit={save}>
      {status.configured && <label>Current PIN<input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={current} onChange={event => setCurrent(event.target.value)} required /></label>}
      <label>{status.configured ? 'New PIN' : 'Create PIN'}<input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={next} onChange={event => setNext(event.target.value)} required /></label>
      <label>Confirm PIN<input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
      {status.locked_until && new Date(status.locked_until).getTime() > Date.now() && <p className="feedback error">Your PIN is temporarily locked. Try again later.</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      {success && <p className="positive" role="status">{success}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : status.configured ? 'Change PIN' : 'Set PIN'}</button>
    </form> : error ? <div className="feedback error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
      : <p role="status">Loading security settings…</p>}
  </section>;
}
