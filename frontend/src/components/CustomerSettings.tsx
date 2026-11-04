import { useEffect, useState, type ReactNode, type SubmitEvent } from 'react';
import { ArrowRight, CreditCard, Eye, EyeOff, HelpCircle, LockKeyhole, RefreshCw, Settings, ShieldCheck, UserRound, Users } from 'lucide-react';
import { message, timestamp, type Account } from '../lib/banking';
import type { AuthedRequest } from './Transactions';
import { SecurityPin } from './SecurityPin';
import { DeviceUnlockSettings } from './DeviceUnlock';

function Feedback({ error, success }: { error: string; success?: string }) {
  return <>{error && <p className="feedback error" role="alert">{error}</p>}{success && <p className="positive" role="status">{success}</p>}</>;
}

function useRemote<T>(send: AuthedRequest, path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError('');
    send<T>(path).then(value => { if (active) setData(value); }, error => { if (active) setError(message(error)); });
    return () => { active = false; };
  }, [send, path, retry]);
  return { data, setData, error, retry: () => setRetry(value => value + 1) };
}

function Loading({ error, retry }: { error: string; retry: () => void }) {
  return error ? <div className="form-stack"><p role="alert" className="feedback error">{error}</p><button className="btn secondary" onClick={retry}>Try again</button></div> : <p role="status">Loading…</p>;
}

function PersonalDetails({ account, send, update }: SettingsProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { update(await send<Account>('profile/', body, 'PATCH')); setEditing(false); setSuccess('Profile updated.'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><div className="profile-person"><span className="avatar big">{account.name.slice(0, 1).toUpperCase()}</span><div><h2>Contact information</h2><p>{account.email}</p></div></div>
    {editing ? <form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack">
      <label>Full name<input name="name" autoComplete="name" maxLength={150} defaultValue={account.name} required /></label>
      <label>Email address<input name="email" type="email" autoComplete="email" maxLength={150} defaultValue={account.email} required /></label>
      <label>Mobile number <small>Optional · include country code, for example +919876543210</small><input name="phone" type="tel" autoComplete="tel" maxLength={16} pattern="\+?[1-9][0-9]{6,14}" defaultValue={account.phone} /></label>
      <label>Address <small>Optional</small><textarea name="address" autoComplete="street-address" maxLength={300} rows={3} defaultValue={account.address} /></label>
      <label>Current password <small>Required only if you change your email address</small><input name="current_password" type="password" autoComplete="current-password" maxLength={128} /></label>
      {!account.has_password && <p className="muted">To change your Google account’s contact email, first create a password with <a className="text-link" href="#forgot-password">Forgot password</a>.</p>}
      <Feedback error={error} /><div className="button-row"><button className="btn primary">{busy ? 'Saving…' : 'Save profile'}</button><button className="btn secondary" type="button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button></div>
    </fieldset></form> : <><dl className="details"><div><dt>Name</dt><dd>{account.name}</dd></div><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Mobile</dt><dd>{account.phone || 'Not added'}</dd></div><div><dt>Address</dt><dd>{account.address || 'Not added'}</dd></div><div><dt>Account</dt><dd>{account.number}</dd></div><div><dt>Status</dt><dd>{account.status}</dd></div><div><dt>Opened</dt><dd>{timestamp.format(new Date(account.created_at))} IST</dd></div></dl><Feedback error="" success={success} /><button className="btn secondary" onClick={() => { setEditing(true); setSuccess(''); }}>Edit personal details</button></>}
  </section>;
}

function PasswordSettings({ account, send }: SettingsProps) {
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
    setError(''); setSuccess('');
    if (body.new_password !== body.confirmation) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try { await send('auth/password/change/', { current_password: body.current_password, new_password: body.new_password }); form.reset(); setSuccess('Password changed.'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><h2>Login password</h2>{account.has_password ? <form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack">
    <label>Current password<input name="current_password" type="password" autoComplete="current-password" maxLength={128} required /></label>
    <label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /><small>At least 8 characters. Avoid common passwords and your personal details.</small></label>
    <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" maxLength={128} required /></label><Feedback error={error} success={success} /><button className="btn primary">{busy ? 'Changing…' : 'Change password'}</button>
  </fieldset></form> : <p>You sign in with Google. Use <a className="text-link" href="#forgot-password">Forgot password</a> to create a password for email sign-in.</p>}
  <a className="text-link" href="#forgot-password">Forgot your password?</a></section>;
}

export function PinRecovery({ send, onSaved }: { send: AuthedRequest; onSaved: () => void }) {
  const [step, setStep] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function start() {
    setBusy(true); setError('');
    try { await send('security/pin/reset/request/', {}); setStep(true); setNotice('Enter the code sent to your registered email. It expires in 10 minutes.'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); setError('');
    if (body.pin !== body.confirmation) { setError('PIN entries do not match.'); return; }
    setBusy(true);
    try { await send('security/pin/reset/confirm/', { code: body.code, pin: body.pin }); setStep(false); setNotice('Transaction PIN reset.'); onSaved(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><h2>Forgot transaction PIN?</h2><p className="muted">Reset it with a code sent to your registered email.</p>{step ? <form onSubmit={confirm} className="form-stack"><fieldset disabled={busy} className="form-stack"><label>Email code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} required /></label><label>New PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="off" required /></label><label>Confirm new PIN<input name="confirmation" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="off" required /></label><button className="btn primary">{busy ? 'Resetting…' : 'Reset transaction PIN'}</button><button type="button" className="btn secondary" onClick={start}>Resend code</button></fieldset></form> : <button className="btn secondary" disabled={busy} onClick={start}>{busy ? 'Sending…' : 'Send PIN reset code'}</button>}<Feedback error={error} success={notice} /></section>;
}

type Nominee = { name: string; relationship: string; date_of_birth: string; address: string; guardian_name: string; guardian_relationship: string; guardian_address: string };
function Nomination({ send }: SettingsProps) {
  const remote = useRemote<{ nominee: Nominee | null }>(send, 'nominee/');
  const [editing, setEditing] = useState(false); const [removing, setRemoving] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [born, setBorn] = useState('');
  const current = remote.data?.nominee;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
  const minor = !!born && new Date(born + 'T00:00:00') > cutoff;
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); setError(''); setSuccess(''); setBusy(true);
    try {
      if (removing) { await send('nominee/', { pin: body.pin }, 'DELETE'); remote.setData({ nominee: null }); }
      else remote.setData(await send('nominee/', body));
      setEditing(false); setRemoving(false); setSuccess(removing ? 'Nominee removed.' : 'Nominee saved.');
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const begin = () => { setBorn(current?.date_of_birth || ''); setEditing(true); setError(''); setSuccess(''); };
  return <section className="panel settings-panel form-stack"><h2>Account nominee</h2><p className="muted">Record one nominee for this fictional savings account. This is a project record, not a legal bank nomination.</p>
    {!remote.data ? <Loading error={remote.error} retry={remote.retry} /> : editing || removing ? <form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack">
      {removing ? <p>Remove {current?.name} as your nominee? This does not close the account.</p> : <><label>Nominee full name<input name="name" defaultValue={current?.name} maxLength={150} required /></label><label>Relationship<select name="relationship" defaultValue={current?.relationship || ''} required><option value="">Choose relationship</option>{['Spouse', 'Parent', 'Child', 'Sibling', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Date of birth<input type="date" name="date_of_birth" value={born} max={new Date().toISOString().slice(0, 10)} onChange={event => setBorn(event.target.value)} required /></label><label>Nominee address<textarea name="address" defaultValue={current?.address} maxLength={300} rows={3} required /></label>
        {minor && <><p className="muted">Nominees under 18 need an adult guardian.</p><label>Guardian full name<input name="guardian_name" defaultValue={current?.guardian_name} maxLength={150} required /></label><label>Guardian relationship<input name="guardian_relationship" defaultValue={current?.guardian_relationship} maxLength={40} required /></label><label>Guardian address<textarea name="guardian_address" defaultValue={current?.guardian_address} maxLength={300} rows={3} required /></label></>}
      </>}
      <label>Transaction PIN<input type="password" name="pin" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="off" required /></label><Feedback error={error} /><div className="button-row"><button className="btn primary">{busy ? 'Saving…' : removing ? 'Remove nominee' : 'Save nominee'}</button><button type="button" className="btn secondary" onClick={() => { setEditing(false); setRemoving(false); }}>Cancel</button></div>
    </fieldset></form> : <>{current ? <dl className="details"><div><dt>Name</dt><dd>{current.name}</dd></div><div><dt>Relationship</dt><dd>{current.relationship}</dd></div><div><dt>Date of birth</dt><dd>{current.date_of_birth}</dd></div><div><dt>Address</dt><dd>{current.address}</dd></div>{current.guardian_name && <div><dt>Guardian</dt><dd>{current.guardian_name}<small>{current.guardian_relationship} · {current.guardian_address}</small></dd></div>}<div><dt>Share</dt><dd>100%</dd></div></dl> : <p>No nominee added yet.</p>}<Feedback error="" success={success} /><div className="button-row"><button className="btn secondary" onClick={begin}>{current ? 'Edit nominee' : 'Add nominee'}</button>{current && <button className="btn secondary" onClick={() => { setRemoving(true); setError(''); }}>Remove nominee</button>}</div><a className="text-link" href="#profile/security">Set up or reset your PIN</a></>}
  </section>;
}

type Payee = { name: string; nickname: string; number: string };
function SavedRecipients({ send }: SettingsProps) {
  const remote = useRemote<{ beneficiaries: Payee[] }>(send, 'beneficiaries/');
  const [adding, setAdding] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [removing, setRemoving] = useState<string>();
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { remote.setData(await send('beneficiaries/', Object.fromEntries(new FormData(event.currentTarget)))); setAdding(false); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function remove(number: string) {
    setBusy(true); setError('');
    try { remote.setData(await send('beneficiaries/', { number }, 'DELETE')); setRemoving(undefined); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><h2>Saved recipients</h2><p className="muted">Save an account for your next transfer. The account holder’s name is checked before payment.</p>{!remote.data ? <Loading error={remote.error} retry={remote.retry} /> : <>{remote.data.beneficiaries.length ? <ul className="record-list">{remote.data.beneficiaries.map(row => <li key={row.number}><div><strong>{row.nickname || row.name}</strong><small>{row.name} · {row.number}</small></div><button className="btn secondary compact" disabled={busy} onClick={() => setRemoving(row.number)}>Remove</button></li>)}</ul> : <p>No recipients saved yet.</p>}
    {removing && <div className="feedback form-stack"><p>Remove this saved recipient? Past transfers will remain in your history.</p><div className="button-row"><button className="btn secondary" disabled={busy} onClick={() => remove(removing)}>Remove recipient</button><button className="btn secondary" disabled={busy} onClick={() => setRemoving(undefined)}>Cancel</button></div></div>}
    {adding ? <form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack"><label>Recipient account number<input name="number" inputMode="numeric" pattern="9[01][0-9]{10}" maxLength={12} required /></label><label>Nickname <small>Optional</small><input name="nickname" maxLength={80} /></label><div className="button-row"><button className="btn primary">{busy ? 'Checking…' : 'Save recipient'}</button><button type="button" className="btn secondary" onClick={() => setAdding(false)}>Cancel</button></div></fieldset></form> : <button className="btn secondary" onClick={() => setAdding(true)}>Add recipient</button>}</>}<Feedback error={error} /></section>;
}

function Preferences({ account, send, update }: SettingsProps) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const body = new FormData(event.currentTarget); setBusy(true); setError(''); setSuccess('');
    try { update(await send<Account>('profile/', { payment_locked: body.get('payment_locked') === 'on', transfer_alerts: body.get('transfer_alerts') === 'on', pin: body.get('pin') }, 'PATCH')); setSuccess('Preferences saved.'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><h2>Payment preferences</h2><form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack">
    <label className="checkbox-row"><input name="payment_locked" type="checkbox" defaultChecked={account.payment_locked} /><span>Lock outgoing payments<small>Stop transfers and withdrawals. You can still receive funds.</small></span></label>
    <label className="checkbox-row"><input name="transfer_alerts" type="checkbox" defaultChecked={account.transfer_alerts} /><span>Incoming transfer alerts<small>Show alerts while this app or website is open.</small></span></label>
    <label>Transaction PIN <small>Required when changing the outgoing-payment lock</small><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="off" /></label><Feedback error={error} success={success} /><button className="btn primary">{busy ? 'Saving…' : 'Save preferences'}</button>
  </fieldset></form></section>;
}

type Ticket = { reference: string; category: string; message: string; status: string; response: string; created_at: string };
function Help({ send, account }: SettingsProps) {
  const remote = useRemote<{ requests: Ticket[] }>(send, 'support/');
  const [adding, setAdding] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { remote.setData(await send('support/', Object.fromEntries(new FormData(event.currentTarget)))); setAdding(false); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel form-stack"><h2>Support requests</h2><p className="muted">Requests are saved for the project administrator. Do not include passwords, PINs or recovery codes.</p>
    <details><summary>Payment response interrupted?</summary><p>Open Overview and review the pending transaction. Retry the same confirmation to avoid paying twice. Quote the receipt reference when reporting a completed payment.</p></details>
    <details><summary>Account frozen or suspicious payment?</summary><p>Lock outgoing payments in Preferences, change your password and raise a support request. Only the administrator can unfreeze an account. Pending requests can still be checked.</p></details>
    <details><summary>Close or delete my account</summary><p>Request closure here or contact the maintainer. Account and transaction records are reviewed before closure; deleting your profile does not erase another customer’s ledger.</p></details>
    <p className="muted">Account ending {account.number.slice(-4)} · <a className="text-link" href="mailto:vaibhavsh0120@gmail.com">Email the maintainer</a> · <a className="text-link" href="/privacy/">Privacy notice</a></p>
    {adding ? <form onSubmit={save} className="form-stack"><fieldset disabled={busy} className="form-stack"><label>Topic<select name="category"><option>Payment</option><option>Account</option><option>Card</option><option>Other</option></select></label><label>Describe the problem<textarea name="message" minLength={10} maxLength={2000} rows={5} required /></label><div className="button-row"><button className="btn primary">{busy ? 'Sending…' : 'Submit support request'}</button><button type="button" className="btn secondary" onClick={() => setAdding(false)}>Cancel</button></div></fieldset></form> : <button className="btn secondary" onClick={() => setAdding(true)}>New support request</button>}<Feedback error={error} />
    {!remote.data ? <Loading error={remote.error} retry={remote.retry} /> : remote.data.requests.length ? <div className="ticket-list">{remote.data.requests.map(row => <article key={row.reference}><h3>{row.category} · {row.status}</h3><p>{row.message}</p><small>{timestamp.format(new Date(row.created_at))} IST · {row.reference}</small>{row.response && <p><strong>Administrator reply:</strong> {row.response}</p>}</article>)}</div> : <p>No support requests yet.</p>}
  </section>;
}

type SettingsProps = { account: Account; send: AuthedRequest; update: (account: Account) => void };
const sections = [{ id: 'details', title: 'Personal details', description: 'Name, email, phone and address', icon: UserRound }, { id: 'security', title: 'Security', description: 'Transaction PIN and password', icon: ShieldCheck }, { id: 'nominee', title: 'Nominee', description: 'Nomination and guardian details', icon: Users }, { id: 'recipients', title: 'Saved recipients', description: 'Manage accounts you pay', icon: Users }, { id: 'preferences', title: 'Preferences', description: 'Payment lock and transfer alerts', icon: Settings }, { id: 'help', title: 'Help & support', description: 'Report an issue and follow replies', icon: HelpCircle }] as const;
export function CustomerSettings(props: SettingsProps & { active?: string }) {
  const active = sections.find(section => section.id === props.active);
  const [pinVersion, setPinVersion] = useState(0);
  let panel: ReactNode;
  switch (active?.id) {
    case 'details': panel = <PersonalDetails {...props} />; break;
    case 'security': panel = <><DeviceUnlockSettings /><SecurityPin key={pinVersion} send={props.send} /><PinRecovery send={props.send} onSaved={() => setPinVersion(value => value + 1)} /><PasswordSettings {...props} /></>; break;
    case 'nominee': panel = <Nomination {...props} />; break;
    case 'recipients': panel = <SavedRecipients {...props} />; break;
    case 'preferences': panel = <Preferences {...props} />; break;
    case 'help': panel = <Help {...props} />; break;
  }
  return <><div className="page-heading"><p className="eyebrow">YOUR ACCOUNT</p><h1>{active?.title || 'Profile & settings'}</h1><p>{active ? active.description : 'Manage your details, security and account services.'}</p></div>{active ? <><a className="back-link" href="#profile">Back to Profile & settings</a><div className="settings-content">{panel}</div></> : <><section className="panel settings-panel profile-person"><span className="avatar big">{props.account.name.slice(0, 1).toUpperCase()}</span><div><h2>{props.account.name}</h2><p>{props.account.email}</p></div></section><div className="settings-menu">{sections.map(({ id, title, description, icon: Icon }) => <a className="panel settings-link" href={'#profile/' + id} key={id}><span className="icon-box"><Icon size={22} /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={18} /></a>)}</div></>}</>;
}

type Network = 'visa' | 'rupay' | 'mastercard';
type Card = { identifier: string; last_four: string; number: string; security_code: string; network: Network; frozen: boolean; expires: string; created_at: string };
const networks: Record<Network, string> = { visa: 'VISA', rupay: 'RuPay', mastercard: 'Mastercard' };
export function VirtualCardPage({ send, account }: { send: AuthedRequest; account: Account }) {
  const remote = useRemote<{ card: Card | null }>(send, 'card/');
  const [changing, setChanging] = useState<'create' | 'freeze' | 'replace'>();
  const [network, setNetwork] = useState<Network>('visa');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const body = { pin: data.pin, ...(changing === 'freeze' ? { frozen: !remote.data?.card?.frozen } : { network }), ...(changing === 'replace' ? { action: 'replace' } : {}) };
      const result = await send<{ card: Card }>('card/', body, changing === 'create' ? undefined : 'PATCH');
      remote.setData(result); setChanging(undefined); setRevealed(false);
      setSuccess(changing === 'replace' ? 'Card replaced. Your previous card number is no longer active.' : changing === 'create' ? 'Virtual card created.' : result.card.frozen ? 'Card frozen.' : 'Card active.');
    }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const card = remote.data?.card;
  function manage(action: 'create' | 'freeze' | 'replace') {
    setChanging(action); setNetwork(card?.network || 'visa'); setRevealed(false); setError(''); setSuccess('');
  }
  return <><div className="page-heading"><p className="eyebrow">CARDS</p><h1>Virtual debit card</h1><p>Manage your project’s virtual card.</p></div><div className="card-page">
    {!remote.data ? <section className="panel settings-panel"><Loading error={remote.error} retry={remote.retry} /></section> : <>
      {card ? <section className={'virtual-card ' + (card.frozen ? 'is-frozen' : '')} aria-label="Demo virtual debit card">
        <div className="button-row"><strong>HDFC Bank</strong><CreditCard size={26} /></div>
        <div className="virtual-status"><span>{card.frozen ? 'Frozen' : account.status !== 'Active' ? 'Account frozen' : 'Active'} · Demo card</span><strong className={'card-network ' + card.network}>{networks[card.network]}</strong></div>
        <div className="virtual-number-row"><strong className="virtual-number">{revealed ? card.number.match(/.{1,4}/g)?.join(' ') : '•••• •••• •••• ' + card.last_four}</strong>
          <button className="card-button" aria-label={revealed ? 'Hide card details' : 'Show card details'} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
        <div className="virtual-bottom"><div><small>Cardholder</small><strong>{account.name}</strong></div><div><small>Valid until</small><strong>{card.expires}</strong></div><div><small>CVV</small><strong>{revealed ? card.security_code : '•••'}</strong></div></div>
      </section> : <section className="panel settings-panel form-stack"><span className="icon-box"><CreditCard size={24} /></span><h2>No virtual card yet</h2><p>Create a demo card linked to your savings account.</p></section>}
      <section className="panel settings-panel form-stack"><h2>{changing === 'replace' ? 'Replace virtual card' : card ? 'Manage card' : 'Create virtual card'}</h2>
        <p className="muted">This demo card cannot make purchases or ATM withdrawals. Freezing it does not lock account transfers.</p>
        {account.status !== 'Active' ? <p className="feedback error">Your account is frozen. Contact support for card changes.</p> : changing ? <form className="form-stack" onSubmit={save}><fieldset disabled={busy} className="form-stack">
          {changing !== 'freeze' && <label>Card network<select name="network" value={network} onChange={event => setNetwork(event.target.value as Network)}>{Object.entries(networks).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {changing === 'replace' && <p className="feedback">Your old number and CVV will be replaced. The new card will keep your current freeze setting.</p>}
          <label>Transaction PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" maxLength={6} required /></label>
          <div className="button-row"><button className="btn primary">{busy ? 'Saving…' : changing === 'create' ? 'Confirm card creation' : changing === 'replace' ? 'Replace card' : card?.frozen ? 'Confirm unfreeze' : 'Confirm freeze'}</button><button className="btn secondary" type="button" onClick={() => { setChanging(undefined); setError(''); }}>Cancel</button></div>
        </fieldset></form> : <div className="form-stack"><button className="btn secondary" onClick={() => manage(card ? 'freeze' : 'create')}><LockKeyhole size={17} />{!card ? 'Create virtual card' : card.frozen ? 'Unfreeze card' : 'Freeze card'}</button>
          {card && <button className="btn secondary" onClick={() => manage('replace')}><RefreshCw size={17} />Replace card or change network</button>}</div>}
        <Feedback error={error} success={success} /><a className="text-link" href="#profile/security">Manage transaction PIN</a><a className="text-link" href="#profile/help">Report a card problem</a>
      </section>
    </>}
  </div></>;
}
