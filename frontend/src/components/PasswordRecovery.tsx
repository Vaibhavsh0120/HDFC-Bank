import { useState, type SubmitEvent } from 'react';
import { message, request } from '../lib/banking';
import { PublicHeader } from './PublicPages';

export function PasswordRecovery() {
  const [email, setEmail] = useState(''); const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function start(event: SubmitEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request<{ detail: string }>('auth/password/reset/request/', { body: { email } }); setNotice(result.detail); setStep('confirm'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); setError('');
    if (body.password !== body.confirmation) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try { await request('auth/password/reset/confirm/', { body: { email, code: body.code, password: body.password } }); setStep('done'); setNotice('Password reset. Sign in with your new password.'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <><PublicHeader /><main className="recovery-wrap wrap"><section className="panel settings-panel form-stack"><a href="#login" className="back-link">Back to sign in</a><h1>Forgot password</h1>
    {step === 'done' ? <><p className="positive" role="status">{notice}</p><a className="btn primary" href="#login">Sign in</a></> : step === 'request' ? <form className="form-stack" onSubmit={start}><fieldset className="form-stack" disabled={busy}><p>Enter your registered email. We’ll send a 6-digit code to reset your password.</p><label>Email address<input type="email" autoComplete="email" value={email} maxLength={150} onChange={event => setEmail(event.target.value)} required /></label>{error && <p className="feedback error" role="alert">{error}</p>}<button className="btn primary">{busy ? 'Sending…' : 'Send reset code'}</button></fieldset></form> : <form className="form-stack" onSubmit={confirm}><fieldset className="form-stack" disabled={busy}><p role="status">{notice}</p><p className="muted">{email} · Code expires in 10 minutes.</p><label>Email code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /><small>At least 8 characters. Avoid common passwords and your personal details.</small></label><label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" maxLength={128} required /></label>{error && <p className="feedback error" role="alert">{error}</p>}<button className="btn primary">{busy ? 'Resetting…' : 'Reset password'}</button><button type="button" className="btn secondary" onClick={() => { setStep('request'); setError(''); }}>Change email or resend code</button></fieldset></form>}
  </section></main></>;
}
