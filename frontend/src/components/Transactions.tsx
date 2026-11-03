import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Search, Wallet } from 'lucide-react';
import { ApiError, message, money, timestamp, type Account, type Entry, type History, type Instruction, type Kind, type Receipt, type Recipient } from '../lib/banking';

export type AuthedRequest = <T>(path: string, body?: object) => Promise<T>;
export const labels: Record<Kind, string> = { deposit: 'Deposit', withdraw: 'Withdrawal', transfer: 'Transfer' };

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

  function search(event: FormEvent) {
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

export function MovementForm({ kind, account, send, onReceipt, close }: {
  kind: Kind; account: Account; send: AuthedRequest; onReceipt: (receipt: Receipt) => void; close: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [review, setReview] = useState<{ instruction: Instruction; recipient?: Recipient }>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const title = kind === 'deposit' ? 'Deposit funds' : kind === 'withdraw' ? 'Withdraw funds' : 'Transfer funds';

  async function prepare(event: FormEvent) {
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
        instruction: { kind, amount, request_id: crypto.randomUUID(), description: description.trim(), ...(target && { recipient: target.number }) },
      });
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<Receipt>('movements/', review.instruction);
      setReceipt(result);
      onReceipt(result);
    } catch (error) {
      setUncertain(error instanceof ApiError && (error.status === 0 || error.status >= 500));
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
    <p className="muted">Check the details before confirming.</p>
    <dl className="details">
      <div><dt>Action</dt><dd>{title}</dd></div>
      <div><dt>Amount</dt><dd>{money.format(Number(amount))}</dd></div>
      <div><dt>Your account</dt><dd>•••• {account.number.slice(-4)}</dd></div>
      {review.recipient && <div><dt>Recipient</dt><dd>{review.recipient.name}<small>{review.recipient.number}</small></dd></div>}
      {description.trim() && <div><dt>Description</dt><dd>{description.trim()}</dd></div>}
    </dl>
    {error && <p className="feedback error" role="alert">{error}{uncertain && ' Retry this confirmation to check the same request.'}</p>}
    <div className="dialog-actions">
      <button className="btn secondary" disabled={busy || uncertain} onClick={() => { setReview(undefined); setError(''); }}>Edit details</button>
      <button className="btn primary" disabled={busy} onClick={confirm}>{busy ? 'Confirming…' : uncertain ? 'Retry confirmation' : 'Confirm ' + labels[kind].toLowerCase()}</button>
    </div>
  </div>;

  return <form className="form-stack" onSubmit={prepare}>
    <p className="muted">Available balance <strong>{money.format(Number(account.balance))}</strong></p>
    {kind === 'transfer' && <label>Recipient account number<input inputMode="numeric" pattern="90[0-9]{10}" maxLength={12} required value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="12-digit account number" /></label>}
    <label>Amount (INR)<input inputMode="decimal" placeholder="0.00" required maxLength={13} value={amount} onChange={e => setAmount(e.target.value)} /></label>
    <label>Description <small>Optional</small><input value={description} onChange={e => setDescription(e.target.value)} maxLength={140} placeholder="Add a note" /></label>
    {error && <p className="feedback error" role="alert">{error}</p>}
    <button className="btn primary" disabled={busy}>{busy ? 'Checking recipient…' : 'Review ' + labels[kind].toLowerCase()} <ArrowRight size={17} /></button>
  </form>;
}
