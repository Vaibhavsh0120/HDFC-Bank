import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ArrowUpRight, Check, Copy, CreditCard, Eye, EyeOff, History, LayoutGrid, LogOut, QrCode, UserRound, Wallet, X } from 'lucide-react';
import { ApiError, message, money, request, type Account, type Dashboard, type Entry, type Kind, type Receipt, type Session } from '../lib/banking';
import { AuthPage, Brand, Landing } from './PublicPages';
import { EntryDetails, EntryList, HistoryPanel, MovementForm, pendingMovements, type PendingMovement } from './Transactions';
import { PaymentHub, type QrPayment } from './AccountQr';
import { CustomerSettings, VirtualCardPage } from './CustomerSettings';
import { PasswordRecovery } from './PasswordRecovery';
import { useIncomingTransfers } from '../lib/useIncomingTransfers';
import { forgetSession, nativeApp, readSavedSession, saveSession, sessionKey } from '../lib/nativeSecurity';
import { DeviceUnlockBoundary } from './DeviceUnlock';
import { NotFound } from './NotFound';

const items = [
  { route: 'overview', label: 'Overview', icon: LayoutGrid },
  { route: 'activity', label: 'Activity', icon: History },
  { route: 'payments', label: 'Scan & pay', icon: QrCode },
  { route: 'cards', label: 'Cards', icon: CreditCard },
  { route: 'profile', label: 'Settings', icon: UserRound },
] as const;
type Section = typeof items[number]['route'];

function Modal({ title, close, children, className = '' }: { title: string; close: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={'modal ' + className} aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}

function TransferNotification({ entry, dismiss }: { entry: Entry; dismiss: (reference: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(entry.reference), 2000);
    return () => window.clearTimeout(timer);
  }, [entry.reference, dismiss]);

  return <div className="transfer-notice" role="status">
    <span className="transfer-notice-icon" aria-hidden="true"><Check size={22} /></span>
    <span className="transfer-notice-copy"><strong>Money received</strong><small>{money.format(Number(entry.amount))} from {entry.counterparty?.name || 'another account'}</small></span>
    <button className="icon-button" aria-label="Dismiss notification" onClick={() => dismiss(entry.reference)}><X size={18} /></button>
  </div>;
}

function AccountCard({ account }: { account: Account }) {
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(account.number);
      setCopied('Account number copied.');
    } catch {
      setCopied('Use the eye button to show the account number, then select it to copy.');
    }
  }

  return <section className="balance-card">
    <div className="balance-top"><span><Wallet size={18} /> {account.type} account</span><span className={'balance-status ' + (account.status === 'Frozen' ? 'frozen' : '')}><i />{account.status}</span></div>
    <div className="balance-value"><p>Available balance</p><strong>{revealed ? money.format(Number(account.balance)) : '₹ ••••••'}</strong></div>
    <div className="balance-bottom"><div><small>Account number</small><span className="account-number">{revealed ? account.number : '•••• •••• ' + account.number.slice(-4)}</span></div>
      <div className="card-buttons">
        <button aria-label={revealed ? 'Hide balance and account number' : 'Show balance and account number'} aria-pressed={revealed} className="card-button" onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        <button aria-label="Copy account number" className="card-button" onClick={copy}>{copied.startsWith('Account') ? <Check size={18} /> : <Copy size={17} />}</button>
      </div>
    </div>
    {copied && <p className="copy-message" role="status">{copied}</p>}
  </section>;
}

function CustomerArea({ token, section, detail, end, initialData, onReady }: { token: string; section: Section; detail?: string; end: (expired: boolean) => void; initialData?: Dashboard; onReady: () => void }) {
  const [data, setData] = useState<Dashboard | undefined>(initialData);
  const useInitialData = useRef(!!initialData);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const [action, setAction] = useState<Kind>();
  const [selected, setSelected] = useState<Entry>();
  const [statement, setStatement] = useState(false);
  const [pending, setPending] = useState<PendingMovement[]>([]);
  const [resuming, setResuming] = useState<PendingMovement>();
  const [initialPayment, setInitialPayment] = useState<QrPayment>();
  const [receiveMode, setReceiveMode] = useState(false);
  const startPayment = useCallback((payment?: QrPayment) => {
    setResuming(undefined); setInitialPayment(payment); setAction('transfer');
  }, []);
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
  const send = useCallback(async <T,>(path: string, body?: object, method?: 'PATCH' | 'DELETE') => {
    try {
      return await request<T>(path, { token, body, method });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) end(true);
      throw error;
    }
  }, [token, end]);
  const { notices, latestReceived, latestAccount, dismiss } = useIncomingTransfers(send, data?.account.number, data?.incoming_cursor);
  const qrReceiving = section === 'payments' && receiveMode;
  useEffect(() => {
    if (qrReceiving || data?.account.transfer_alerts === false) notices.forEach(entry => dismiss(entry.reference));
  }, [qrReceiving, data?.account.transfer_alerts, notices, dismiss]);
  const lastNotice = useRef('');

  useEffect(() => {
    if (latestAccount) setData(previous => previous ? { ...previous, account: latestAccount } : previous);
  }, [latestAccount]);
  useEffect(() => {
    const last = notices.at(-1);
    if (last && last.reference !== lastNotice.current) {
      lastNotice.current = last.reference;
      setRefresh(value => value + 1);
    }
  }, [notices]);

  useEffect(() => {
    if (data) onReady();
  }, [!!data, onReady]);

  useEffect(() => {
    if (useInitialData.current) { useInitialData.current = false; return; }
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
        <div className="transfer-notices" aria-live="polite">
          {!qrReceiving && data?.account.transfer_alerts !== false && notices.map(entry => <TransferNotification key={entry.reference} entry={entry} dismiss={dismiss} />)}
        </div>
        {exitError && <div className="feedback error form-stack" role="alert"><p>{exitError}</p><button className="btn secondary compact" onClick={() => end(false)}>Sign out on this device</button></div>}
        {loadError && <div className="feedback error flex items-center justify-between gap-3" role="alert"><span>{loadError}</span><button className="btn secondary compact" onClick={() => { setLoadError(''); setRefresh(value => value + 1); }}>Retry</button></div>}
        {!data && !loadError && <DashboardSkeleton />}
        {data && <>
          {pending.length > 0 && <section className="feedback pending-notice" aria-label="Pending transactions">
            <strong>Transaction awaiting confirmation</strong>
            <p>Check the result before creating another request for the same transaction.</p>
            {pending.map(item => <button className="btn secondary compact" key={item.instruction.request_id} onClick={() => {
              setResuming(item);
              setAction(item.instruction.kind);
            }}>Review {item.instruction.kind} · {money.format(Number(item.instruction.amount))}</button>)}
          </section>}
          {data.account.status === 'Frozen' && <p className="feedback error">Your account is frozen. Payments and card changes are unavailable. <a className="text-link" href="#profile/help">Contact support</a>.</p>}
          {data.account.payment_locked && <p className="feedback">Outgoing payments are locked. You can still receive transfers. <a className="text-link" href="#profile/preferences">Manage payment lock</a>.</p>}
          {section === 'overview' && <>
            <div className="page-heading"><p className="eyebrow">ACCOUNT OVERVIEW</p><h1>Welcome, {data.account.name.split(/\s+/)[0]}</h1><p>See your balance and manage your savings.</p></div>
            <div className="account-grid">
              <AccountCard account={data.account} />
              <section className="panel quick-panel">
                <h2>Quick actions</h2><p>Manage funds in your savings account.</p>
                {data.account.status === 'Frozen' && <p className="feedback error">Transactions are unavailable while this account is frozen.</p>}
                <div className="quick-grid">
                  <button disabled={data.account.status !== 'Active'} onClick={() => { setResuming(undefined); setAction('deposit'); }}><span className="icon-box"><ArrowDownToLine size={19} /></span>Deposit</button>
                  <button disabled={data.account.status !== 'Active' || data.account.payment_locked} onClick={() => { setResuming(undefined); setAction('withdraw'); }}><span className="icon-box"><ArrowUpFromLine size={19} /></span>Withdraw</button>
                  <button disabled={data.account.status !== 'Active' || data.account.payment_locked} onClick={() => startPayment()}><span className="icon-box"><ArrowLeftRight size={19} /></span>Transfer</button>
                  <a href="#payments"><span className="icon-box"><QrCode size={19} /></span>Scan & pay</a>
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
          {section === 'profile' && <CustomerSettings key={detail || 'menu'} active={detail} account={data.account} send={send} update={account => setData(previous => previous ? { ...previous, account } : previous)} />}
          {section === 'payments' && <PaymentHub key={detail || 'pay'} initialMode={detail === 'receive' ? 'receive' : 'pay'} account={data.account} onPay={startPayment} latestReceived={data.account.transfer_alerts ? latestReceived : undefined} onReceiveModeChange={setReceiveMode} />}
          {section === 'cards' && <VirtualCardPage account={data.account} send={send} />}
          {action && <Modal className={action === 'transfer' ? 'payment-modal' : ''} title={action === 'deposit' ? 'Deposit funds' : action === 'withdraw' ? 'Withdraw funds' : initialPayment && !resuming ? 'Pay with QR' : 'Pay with account number'} close={() => setAction(undefined)}>
            <MovementForm kind={action} account={data.account} send={send} onReceipt={saveReceipt} close={() => setAction(undefined)} pending={resuming} initial={action === 'transfer' && !resuming ? initialPayment : undefined} onPendingChange={refreshPending} />
          </Modal>}
          {statement && <Modal title="Mini-statement" close={() => setStatement(false)}>
            <p className="muted statement-note">Latest 10 transactions · Account ending {data.account.number.slice(-4)}</p>
            <EntryList entries={data.recent} onSelect={entry => { setStatement(false); setSelected(entry); }} />
          </Modal>}
          {selected && <Modal title="Transaction details" close={() => setSelected(undefined)}><EntryDetails entry={selected} /></Modal>}
        </>}
      </main>
    </div>
  </div>;
}

export default function BankingApp() {
  const [route, setRoute] = useState('home');
  const [token, setToken] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [freshLogin, setFreshLogin] = useState(false);
  const [initialDashboard, setInitialDashboard] = useState<Dashboard>();
  const [dashboardReady, setDashboardReady] = useState(false);
  const [restoreProblem, setRestoreProblem] = useState('');
  const accountReady = useCallback(() => { setDashboardReady(true); setInitialDashboard(undefined); }, []);
  useEffect(() => {
    let active = true;
    const readRoute = () => {
      const next = window.location.hash.slice(1) || 'home';
      setRoute(next);
      if (next !== 'services') window.scrollTo(0, 0);
    };
    const readLogin = async () => {
      let saved: string | undefined;
      try {
        saved = await readSavedSession();
        // A stored token is not proof of a valid session. Validate it before
        // offering device security or prompting to unlock an expired login.
        if (nativeApp && saved) {
          const dashboard = await request<Dashboard>('dashboard/', { token: saved });
          if (active) setInitialDashboard(dashboard);
        }
        if (active) setToken(saved);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          await forgetSession().catch(() => {});
          if (!active) return;
          setExpired(true); setToken(undefined); window.location.hash = 'login';
        } else if (nativeApp && saved) setRestoreProblem(message(error));
        else setStorageNotice('Saved login is unavailable. Sign in again to continue.');
      }
      finally { if (active) setInitialized(true); }
    };
    readLogin();
    const changed = (event: StorageEvent) => { if (event.key === sessionKey) readLogin(); };
    window.addEventListener('storage', changed);
    readRoute();
    window.addEventListener('hashchange', readRoute);
    return () => { active = false; window.removeEventListener('hashchange', readRoute); window.removeEventListener('storage', changed); };
  }, []);

  const end = useCallback((expired: boolean) => {
    void forgetSession().catch(() => setStorageNotice('Saved login could not be cleared. Your current session has ended; check device storage before sharing this device.'));
    setToken(undefined);
    setInitialDashboard(undefined);
    setDashboardReady(false);
    setRestoreProblem('');
    setFreshLogin(false);
    setExpired(expired);
    window.location.hash = expired ? 'login' : 'home';
  }, []);

  function begin(session: Session) {
    void saveSession(session.token).catch(() => setStorageNotice('Login could not be saved on this device. Keep this page open or allow secure storage.'));
    setExpired(false);
    setFreshLogin(true);
    setDashboardReady(false);
    setInitialDashboard(undefined);
    setToken(session.token);
    window.location.hash = 'overview';
  }

  if (restoreProblem) return <main className="startup-screen"><Brand /><section className="unlock-panel panel form-stack"><h1>Account unavailable</h1><p className="feedback error" role="alert">{restoreProblem}</p><button className="btn primary" onClick={() => window.location.reload()}>Try again</button><button className="btn secondary" onClick={() => { end(false); window.location.hash = 'login'; }}>Sign in again</button></section></main>;
  if (!initialized) return <main className="startup-screen" aria-busy="true"><Brand /><p role="status">Opening your account…</p></main>;
  if (token) {
    const [base, detail] = route.split('/');
    const known = ['home', 'services', 'login', 'register', 'receive', 'forgot-password', ...items.map(item => item.route)];
    const knownDetails: Record<string, string[]> = { profile: ['details', 'security', 'nominee', 'recipients', 'preferences', 'help'], payments: ['receive'] };
    if (!known.includes(base) || (detail && !knownDetails[base]?.includes(detail)) || route.split('/').length > 2) return <NotFound />;
    const section = base === 'receive' ? 'payments' : items.find(item => item.route === base)?.route ?? 'overview';
    return <DeviceUnlockBoundary key={token} end={end} freshLogin={freshLogin} offerSetup={freshLogin && dashboardReady && section === 'overview' && route !== 'forgot-password'}>{storageNotice && <p className="session-notice" role="status">{storageNotice}</p>}{route === 'forgot-password' ? <PasswordRecovery /> : <CustomerArea token={token} section={section} detail={base === 'receive' ? 'receive' : detail} end={end} initialData={initialDashboard} onReady={accountReady} />}</DeviceUnlockBoundary>;
  }
  if (route === 'forgot-password') return <PasswordRecovery />;
  if (route === 'home' || route === 'services') return <Landing />;
  if (!['login', 'register', 'overview', 'activity', 'payments', 'payments/receive', 'receive', 'cards', 'profile', 'profile/details', 'profile/security', 'profile/nominee', 'profile/recipients', 'profile/preferences', 'profile/help'].includes(route)) return <NotFound />;
  const mode = route === 'register' ? 'register' : 'login';
  return <>
    {expired && mode === 'login' && <p className="session-notice" role="status">Your session ended. Sign in to continue.</p>}
    <AuthPage key={mode} mode={mode} onSession={begin} />
  </>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" role="status" aria-label="Loading your account" aria-busy="true">
    <span className="sr-only">Loading your account…</span>
    <div className="skeleton skeleton-title" aria-hidden="true" />
    <div className="account-grid" aria-hidden="true"><div className="panel skeleton-card"><div className="skeleton" /><div className="skeleton skeleton-amount" /><div className="skeleton" /></div><div className="panel skeleton-card"><div className="skeleton" /><div className="skeleton skeleton-amount" /></div></div>
    <div className="panel skeleton-card" aria-hidden="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
  </div>;
}
