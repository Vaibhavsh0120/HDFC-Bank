import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Search, Wallet } from 'lucide-react';
import { ApiError, message, money, timestamp, type Account, type Entry, type History, type Instruction, type Kind, type Receipt, type Recipient } from '../lib/banking';
import { QrScanner } from './AccountQr';

export type AuthedRequest = <T>(path: string, body?: object, method?: 'PATCH') => Promise<T>;
export const labels: Record<Kind, string> = { deposit: 'Deposit', withdraw: 'Withdrawal', transfer: 'Transfer' };
export type PendingMovement = { instruction: Instruction; recipient?: Recipient };

const pendingPrefix = 'hdfc.pending.';

function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function pendingMovements(accountNumber: string): PendingMovement[] {
  const prefix = pendingPrefix + accountNumber + '.';
  const entries: PendingMovement[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) || '');
      if (value?.instruction?.request_id && value?.instruction?.kind && value?.instruction?.amount) {
        entries.push(value);
      }
    } catch {
      // A malformed local record must not prevent the account from loading.
    }
  }
  return entries;
}

function pendingKey(accountNumber: string, requestId: string) {
  return pendingPrefix + accountNumber + '.' + requestId;
}

export function EntryList({ entries, onSelect }: { entries: Entry[]; onSelect: (entry: Entry) => void }) {
  if (!entries.length) return <div className="empty"><span className="icon-box"><Wallet size={22} /></span><strong>No transactions to show</strong><p>Account activity will appear here.</p></div>;
  return <div className="entry-list">
    <div className="entry-heading" aria-hidden="true"><span>Transaction</span><span>Date & time</span><span>Amount</span><span /></div>
    {entries.map(entry => {
      const credit = entry.direction === 'credit';
      const title = entry.kind === 'transfer'
        ? (credit ? 'From ' : 'To ') + (entry.counterparty?.name || entry.counterparty?.number)
        : labels[entry.kind];
      return <button className="entry-row" key={entry.reference} onClick={() => onSelect(entry)} aria-label={title + ', ' + money.format(Number(entry.amount)) + ', view details'}>
        <span className="entry-main"><span className={'entry-icon ' + (credit ? 'credit' : '')}>{credit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
          <span><strong>{title}</strong><small>{entry.kind === 'transfer' ? 'Internal transfer' : entry.status}</small><small className="entry-mobile-date">{timestamp.format(new Date(entry.created_at))}</small></span>
        </span>
        <span className="entry-date">{timestamp.format(new Date(entry.created_at))}</span>
        <strong className={credit ? 'positive' : ''}>{credit ? '+' : '−'}{money.format(Number(entry.amount))}</strong>
        <ChevronRight size={17} className="muted" />
      </button>;
    })}
  </div>;
}

export function EntryDetails({ entry }: { entry: Entry }) {
  return <dl className="details">
    <div><dt>Amount</dt><dd>{money.format(Number(entry.amount))}</dd></div>
    <div><dt>Type</dt><dd>{labels[entry.kind]} · {entry.direction === 'credit' ? 'Credit' : 'Debit'}</dd></div>
    <div><dt>Status</dt><dd className="positive">{entry.status}</dd></div>
    <div><dt>Date and time</dt><dd>{timestamp.format(new Date(entry.created_at))} IST</dd></div>
    {entry.counterparty && <div><dt>{entry.direction === 'credit' ? 'Sender' : 'Recipient'}</dt><dd>{entry.counterparty.name}<small>{entry.counterparty.number}</small></dd></div>}
    {entry.description && <div><dt>Description</dt><dd>{entry.description}</dd></div>}
    <div><dt>Reference</dt><dd className="reference">{entry.reference}</dd></div>
  </dl>;
}

export function HistoryPanel({ send, onSelect }: { send: AuthedRequest; onSelect: (entry: Entry) => void }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ data?: History; error?: string }>({});

  useEffect(() => {
    let current = true;
    setState({});
    const params = new URLSearchParams({ q: query, kind, page: String(page) });
    send<History>('history/?' + params).then(data => {
      if (current) setState({ data });
    }, error => {
      if (current) setState({ error: message(error) });
    });
    return () => { current = false; };
  }, [send, query, kind, page, retry]);

  function search(event: SubmitEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(input.trim());
  }

  return <section className="panel">
    <form className="history-filters" onSubmit={search}>
      <label className="search-field"><Search size={18} /><input aria-label="Search transactions" placeholder="Name, description or reference" value={input} maxLength={140} onChange={e => setInput(e.target.value)} /></label>
      <button className="btn secondary compact">Search</button>
      <label className="select-field"><select aria-label="Transaction type" value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}>
        <option value="">All types</option><option value="deposit">Deposits</option><option value="withdraw">Withdrawals</option><option value="transfer">Transfers</option>
      </select><ChevronDown size={16} /></label>
    </form>
    {state.error ? <div className="panel-message"><p role="alert">{state.error}</p><button className="btn secondary compact" onClick={() => setRetry(retry + 1)}>Try again</button></div>
      : state.data ? <>
        <EntryList entries={state.data.results} onSelect={onSelect} />
        <div className="pagination"><span>{state.data.count} {state.data.count === 1 ? 'transaction' : 'transactions'}</span>
          <div><button className="btn secondary compact" disabled={!state.data.previous} onClick={() => setPage(page - 1)} aria-label="Previous page"><ArrowLeft size={17} /></button>
          <span>Page {page}</span>
          <button className="btn secondary compact" disabled={!state.data.next} onClick={() => setPage(page + 1)} aria-label="Next page"><ArrowRight size={17} /></button></div>
        </div>
      </> : <p className="panel-message" role="status">Loading transactions…</p>}
  </section>;
}

export function MovementForm({ kind, account, send, onReceipt, close, pending, onPendingChange }: {
  kind: Kind; account: Account; send: AuthedRequest; onReceipt: (receipt: Receipt) => void; close: () => void;
  pending?: PendingMovement; onPendingChange: () => void;
}) {
  const [amount, setAmount] = useState(pending?.instruction.amount ?? '');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState(pending?.instruction.description ?? '');
  const [review, setReview] = useState<PendingMovement | undefined>(pending);
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!pending);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [pinStatus, setPinStatus] = useState<{ configured: boolean; locked_until: string | null }>();
  const [pinStatusError, setPinStatusError] = useState('');
  const [pinRetry, setPinRetry] = useState(0);
  const title = kind === 'deposit' ? 'Deposit funds' : kind === 'withdraw' ? 'Withdraw funds' : 'Transfer funds';

  useEffect(() => {
    if (kind === 'deposit') return;
    let active = true;
    setPinStatusError('');
    send<{ configured: boolean; locked_until: string | null }>('security/pin/').then(value => {
      if (active) setPinStatus(value);
    }, error => {
      if (active) setPinStatusError(message(error));
    });
    return () => { active = false; };
  }, [kind, send, pinRetry]);

  const scanned = useCallback((number: string) => {
    setRecipient(number);
    setScanning(false);
  }, []);

  async function prepare(event: SubmitEvent) {
    event.preventDefault();
    setError('');
    if (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError('Enter a positive amount with up to two decimal places.');
      return;
    }
    if (kind !== 'deposit' && Number(amount) > Number(account.balance)) {
      setError('This amount is higher than your available balance.');
      return;
    }
    setBusy(true);
    try {
      const target = kind === 'transfer' ? await send<Recipient>('recipient/', { number: recipient }) : undefined;
      setReview({
        recipient: target,
        instruction: { kind, amount, request_id: newRequestId(), description: description.trim(), ...(target && { recipient: target.number }) },
      });
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review || busy) return;
    if (kind !== 'deposit' && !/^[0-9]{4,6}$/.test(pin)) {
      setError('Enter your 4 to 6 digit transaction PIN.');
      return;
    }
    if (kind !== 'deposit' && !pinStatus?.configured && pin !== pinConfirmation) {
      setError('The PIN entries do not match.');
      return;
    }
    setBusy(true);
    setError('');
    if (kind !== 'deposit' && !pinStatus?.configured) {
      try {
        await send('security/pin/', { pin });
        setPinStatus({ configured: true, locked_until: null });
        setPinConfirmation('');
      } catch (error) {
        setError(message(error));
        setBusy(false);
        return;
      }
    }
    const key = pendingKey(account.number, review.instruction.request_id);
    try {
      localStorage.setItem(key, JSON.stringify(review));
      onPendingChange();
    } catch {
      setError('This device could not save the transaction request. Check your browser storage settings and try again.');
      setBusy(false);
      return;
    }
    try {
      const result = await send<Receipt>('movements/', { ...review.instruction, ...(kind !== 'deposit' && { pin }) });
      setPin('');
      localStorage.removeItem(key);
      onPendingChange();
      setReceipt(result);
      onReceipt(result);
    } catch (error) {
      const unknown = uncertain || !(error instanceof ApiError) || error.status === 0 || error.status === 401 || error.status === 408 || error.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        localStorage.removeItem(key);
        onPendingChange();
      }
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  if (receipt) return <div className="form-stack">
    <div className="receipt-heading"><span className="icon-box positive"><Check size={24} /></span><h3>{labels[kind]} completed</h3></div>
    <EntryDetails entry={receipt.entry} />
    <button className="btn primary" onClick={close}>Done</button>
  </div>;

  if (review) return <div className="form-stack">
    <p className="muted">{uncertain ? 'The result is not yet confirmed. Retry to check this same request.' : 'Check the details before confirming.'}</p>
    <dl className="details">
      <div><dt>Action</dt><dd>{title}</dd></div>
      <div><dt>Amount</dt><dd>{money.format(Number(amount))}</dd></div>
      <div><dt>Your account</dt><dd>•••• {account.number.slice(-4)}</dd></div>
      {review.recipient && <div><dt>Recipient</dt><dd>{review.recipient.name}<small>{review.recipient.number}</small></dd></div>}
      {description.trim() && <div><dt>Description</dt><dd>{description.trim()}</dd></div>}
    </dl>
    {kind !== 'deposit' && <>
      {pinStatusError ? <div className="feedback error" role="alert">{pinStatusError} <button type="button" onClick={() => setPinRetry(value => value + 1)}>Try again</button></div>
        : !pinStatus ? <p className="muted" role="status">Checking transaction security…</p>
        : <>
          <label>{pinStatus.configured ? 'Transaction PIN' : 'Create transaction PIN'}
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={pin} onChange={event => setPin(event.target.value)} placeholder="4 to 6 digits" />
          </label>
          {!pinStatus.configured && <label>Confirm transaction PIN
            <input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} value={pinConfirmation} onChange={event => setPinConfirmation(event.target.value)} placeholder="Re-enter PIN" />
            <small>Use this PIN to authorise withdrawals and transfers.</small>
          </label>}
          {pinStatus.locked_until && new Date(pinStatus.locked_until).getTime() > Date.now() && <p className="feedback error">PIN is temporarily locked. Try again after {timestamp.format(new Date(pinStatus.locked_until))} IST.</p>}
        </>}
    </>}
    {error && <p className="feedback error" role="alert">{error}{uncertain && ' Retry this confirmation to check the same request.'}</p>}
    <div className="dialog-actions">
      <button className="btn secondary" disabled={busy || uncertain} onClick={() => { setReview(undefined); setError(''); }}>Edit details</button>
      <button className="btn primary" disabled={busy || (kind !== 'deposit' && !pinStatus)} onClick={confirm}>{busy ? 'Confirming…' : uncertain ? 'Retry confirmation' : 'Confirm ' + labels[kind].toLowerCase()}</button>
    </div>
  </div>;

  return <form className="form-stack" onSubmit={prepare}>
    <p className="muted">Available balance <strong>{money.format(Number(account.balance))}</strong></p>
    {kind === 'transfer' && <>
      <label>Recipient account number<input inputMode="numeric" pattern="9[01][0-9]{10}" maxLength={12} required value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="12-digit account number" /></label>
      {!scanning ? <button type="button" className="text-link scan-toggle" onClick={() => setScanning(true)}>Scan account QR code</button>
        : <QrScanner onScan={scanned} close={() => setScanning(false)} />}
    </>}
    <label>Amount (INR)<input inputMode="decimal" placeholder="0.00" required maxLength={13} value={amount} onChange={e => setAmount(e.target.value)} /></label>
    <label>Description <small>Optional</small><input value={description} onChange={e => setDescription(e.target.value)} maxLength={140} placeholder="Add a note" /></label>
    {error && <p className="feedback error" role="alert">{error}</p>}
    <button className="btn primary" disabled={busy}>{busy ? 'Checking recipient…' : 'Review ' + labels[kind].toLowerCase()} <ArrowRight size={17} /></button>
  </form>;
}
