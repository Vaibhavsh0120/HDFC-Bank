import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ArrowUpRight, Check, Copy, Eye, EyeOff, History, LayoutGrid, LogOut, UserRound, Wallet, X } from 'lucide-react';
import { ApiError, message, money, request, timestamp, type Account, type Dashboard, type Entry, type Kind, type Receipt, type Session } from '../lib/banking';
import { AuthPage, Brand, Landing, Notice } from './PublicPages';
import { EntryDetails, EntryList, HistoryPanel, MovementForm, pendingMovements, type PendingMovement } from './Transactions';

const sessionKey = 'hdfc.access';
const items = [
  { route: 'overview', label: 'Overview', icon: LayoutGrid },
  { route: 'activity', label: 'Activity', icon: History },
  { route: 'profile', label: 'Profile', icon: UserRound },
] as const;
type Section = typeof items[number]['route'];

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}

function AccountCard({ account }: { account: Account }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(account.number);
      setCopied('Account number copied.');
    } catch {
      setRevealed(true);
      setCopied('Select the account number to copy it.');
    }
  }

  return <section className="balance-card">
    <div className="balance-top"><span><Wallet size={18} /> {account.type} account</span><span className={'balance-status ' + (account.status === 'Frozen' ? 'frozen' : '')}><i />{account.status}</span></div>
    <div className="balance-value"><p>Available balance</p><strong>{money.format(Number(account.balance))}</strong></div>
    <div className="balance-bottom"><div><small>Account number</small><span className="account-number">{revealed ? account.number : '•••• •••• ' + account.number.slice(-4)}</span></div>
      <div className="card-buttons">
        <button aria-label={revealed ? 'Hide account number' : 'Show account number'} className="card-button" onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        <button aria-label="Copy account number" className="card-button" onClick={copy}>{copied.startsWith('Account') ? <Check size={18} /> : <Copy size={17} />}</button>
      </div>
    </div>
    {copied && <p className="copy-message" role="status">{copied}</p>}
  </section>;
}

function Profile({ account }: { account: Account }) {
  return <section className="panel profile-panel">
    <div className="profile-person"><span className="avatar big">{account.name.slice(0, 1).toUpperCase()}</span><div><h2>{account.name}</h2><p>{account.email}</p></div></div>
    <dl className="details">
      <div><dt>Account type</dt><dd>{account.type}</dd></div>
      <div><dt>Account number</dt><dd>{account.number}</dd></div>
      <div><dt>Account status</dt><dd>{account.status}</dd></div>
      <div><dt>Opened on</dt><dd>{timestamp.format(new Date(account.created_at))} IST</dd></div>
    </dl>
  </section>;
}

function CustomerArea({ token, section, end }: { token: string; section: Section; end: (expired: boolean) => void }) {
  const [data, setData] = useState<Dashboard>();
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const [action, setAction] = useState<Kind>();
  const [selected, setSelected] = useState<Entry>();
  const [statement, setStatement] = useState(false);
  const [pending, setPending] = useState<PendingMovement[]>([]);
  const [resuming, setResuming] = useState<PendingMovement>();
  const refreshPending = useCallback(() => {
    if (!data) return;
    try {
      setPending(pendingMovements(data.account.number));
    } catch {
      setPending([]);
    }
  }, [data?.account.number]);
  useEffect(() => {
    refreshPending();
    window.addEventListener('storage', refreshPending);
    return () => window.removeEventListener('storage', refreshPending);
  }, [refreshPending]);
  const send = useCallback(async <T,>(path: string, body?: object) => {
    try {
      return await request<T>(path, { token, body });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) end(true);
      throw error;
    }
  }, [token, end]);

  useEffect(() => {
    let current = true;
    send<Dashboard>('dashboard/').then(result => {
      if (current) { setData(result); setLoadError(''); }
    }, error => {
      if (current) setLoadError(message(error));
    });
    return () => { current = false; };
  }, [send, refresh, section]);

  async function logout() {
    setExitBusy(true);
    setExitError('');
    try {
      await send('auth/logout/', {});
      end(false);
    } catch (error) {
      setExitError(message(error));
    } finally {
      setExitBusy(false);
    }
  }

  function saveReceipt({ account, entry }: Receipt) {
    setData(previous => ({ account, recent: [entry, ...(previous?.recent ?? []).filter(row => row.reference !== entry.reference)].slice(0, 10) }));
    setRefresh(value => value + 1);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <p className="sidebar-label">PERSONAL BANKING</p>
      <nav aria-label="Account navigation">{items.map(({ route, label, icon: Icon }) => <a key={route} href={'#' + route}
        aria-current={section === route ? 'page' : undefined}><Icon size={19} />{label}</a>)}</nav>
      <button className="sidebar-exit" disabled={exitBusy} onClick={logout}><LogOut size={18} /> {exitBusy ? 'Signing out…' : 'Sign out'}</button>
    </aside>
    <div className="app-content">
      <header className="app-header">
        <span className="desktop-breadcrumb">Personal banking <span>/</span> <strong>{items.find(item => item.route === section)?.label}</strong></span>
        <div className="mobile-brand"><Brand /></div>
        <div className="app-user">{data && <a href="#profile" className="profile-link"><span className="avatar">{data.account.name.slice(0, 1).toUpperCase()}</span><span>{data.account.name}</span></a>}
          <button className="icon-button mobile-exit" aria-label="Sign out" disabled={exitBusy} onClick={logout}><LogOut size={19} /></button>
        </div>
      </header>
      <main className="dashboard">
        {exitError && <p className="feedback error" role="alert">{exitError}</p>}
        {loadError && <div className="feedback error flex items-center justify-between gap-3" role="alert"><span>{loadError}</span><button className="btn secondary compact" onClick={() => { setLoadError(''); setRefresh(value => value + 1); }}>Retry</button></div>}
        {!data && !loadError && <p className="panel panel-message" role="status">Loading your account…</p>}
        {data && <>
          {pending.length > 0 && <section className="feedback pending-notice" aria-label="Pending transactions">
            <strong>Transaction awaiting confirmation</strong>
            <p>Check the result before creating another request for the same transaction.</p>
            {pending.map(item => <button className="btn secondary compact" key={item.instruction.request_id} onClick={() => {
              setResuming(item);
              setAction(item.instruction.kind);
            }}>Review {item.instruction.kind} · {money.format(Number(item.instruction.amount))}</button>)}
          </section>}
          {section === 'overview' && <>
            <div className="page-heading"><p className="eyebrow">ACCOUNT OVERVIEW</p><h1>Welcome, {data.account.name.split(/\s+/)[0]}</h1><p>See your balance and manage your savings.</p></div>
            <div className="account-grid">
              <AccountCard account={data.account} />
              <section className="panel quick-panel">
                <h2>Quick actions</h2><p>Manage funds in your savings account.</p>
                {data.account.status === 'Frozen' && <p className="feedback error">Transactions are unavailable while this account is frozen.</p>}
                <div className="quick-grid">
                  <button disabled={data.account.status !== 'Active'} onClick={() => { setResuming(undefined); setAction('deposit'); }}><span className="icon-box"><ArrowDownToLine size={19} /></span>Deposit</button>
                  <button disabled={data.account.status !== 'Active'} onClick={() => { setResuming(undefined); setAction('withdraw'); }}><span className="icon-box"><ArrowUpFromLine size={19} /></span>Withdraw</button>
                  <button disabled={data.account.status !== 'Active'} onClick={() => { setResuming(undefined); setAction('transfer'); }}><span className="icon-box"><ArrowLeftRight size={19} /></span>Transfer</button>
                </div>
              </section>
            </div>
            <section className="panel recent-panel">
              <div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest savings account transactions.</p></div>
                <div className="panel-links"><button className="btn secondary compact" onClick={() => setStatement(true)}>Mini-statement</button><a className="text-link" href="#activity">View all <ArrowUpRight size={16} /></a></div>
              </div>
              <EntryList entries={data.recent.slice(0, 5)} onSelect={setSelected} />
            </section>
          </>}
          {section === 'activity' && <>
            <div className="page-heading"><p className="eyebrow">SAVINGS ACCOUNT</p><h1>Transaction history</h1><p>Search and review deposits, withdrawals and transfers.</p></div>
            <HistoryPanel send={send} onSelect={setSelected} />
          </>}
          {section === 'profile' && <>
            <div className="page-heading"><p className="eyebrow">PERSONAL DETAILS</p><h1>Your profile</h1><p>View your customer and account information.</p></div>
            <Profile account={data.account} />
          </>}
          {action && <Modal title={action === 'deposit' ? 'Deposit funds' : action === 'withdraw' ? 'Withdraw funds' : 'Transfer funds'} close={() => setAction(undefined)}>
            <MovementForm kind={action} account={data.account} send={send} onReceipt={saveReceipt} close={() => setAction(undefined)} pending={resuming} onPendingChange={refreshPending} />
          </Modal>}
          {statement && <Modal title="Mini-statement" close={() => setStatement(false)}>
            <p className="muted statement-note">Latest 10 transactions · Account ending {data.account.number.slice(-4)}</p>
            <EntryList entries={data.recent} onSelect={entry => { setStatement(false); setSelected(entry); }} />
          </Modal>}
          {selected && <Modal title="Transaction details" close={() => setSelected(undefined)}><EntryDetails entry={selected} /></Modal>}
        </>}
        <Notice />
      </main>
    </div>
  </div>;
}

export default function BankingApp() {
  const [route, setRoute] = useState('home');
  const [token, setToken] = useState<string>();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const readRoute = () => {
      const next = window.location.hash.slice(1) || 'home';
      setRoute(next);
      if (next !== 'services') window.scrollTo(0, 0);
    };
    setToken(sessionStorage.getItem(sessionKey) || undefined);
    readRoute();
    window.addEventListener('hashchange', readRoute);
    return () => window.removeEventListener('hashchange', readRoute);
  }, []);

  const end = useCallback((expired: boolean) => {
    sessionStorage.removeItem(sessionKey);
    setToken(undefined);
    setExpired(expired);
    window.location.hash = expired ? 'login' : 'home';
  }, []);

  function begin(session: Session) {
    sessionStorage.setItem(sessionKey, session.token);
    setExpired(false);
    setToken(session.token);
    window.location.hash = 'overview';
  }

  if (token) {
    const section = items.find(item => item.route === route)?.route ?? 'overview';
    return <CustomerArea token={token} section={section} end={end} />;
  }
  if (route === 'home' || route === 'services') return <Landing />;
  const mode = route === 'register' ? 'register' : 'login';
  return <>
    {expired && mode === 'login' && <p className="session-notice" role="status">Your session ended. Sign in to continue.</p>}
    <AuthPage key={mode} mode={mode} onSession={begin} />
  </>;
}
