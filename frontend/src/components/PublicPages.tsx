import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Eye, EyeOff, History, Landmark, Smartphone, ShieldCheck } from 'lucide-react';
import { message, request, type Session } from '../lib/banking';

type GoogleApi = {
  accounts: { id: {
    initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
    renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; width: number; text: string }) => void;
  } };
};

declare global {
  interface Window { google?: GoogleApi }
}

let googleScript: Promise<void> | undefined;
function loadGoogleScript(): Promise<void> {
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { googleScript = undefined; script.remove(); reject(new Error('Google sign-in could not load.')); };
      document.head.appendChild(script);
    });
  }
  return googleScript;
}

function GoogleSignIn({ registration, onSession }: { registration: boolean; onSession: (session: Session) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (Capacitor.isNativePlatform() || !window.isSecureContext) return;
    request<{ client_id: string }>('auth/google/config/').then(async ({ client_id }) => {
      if (!active || !client_id) return;
      setEnabled(true);
      await loadGoogleScript();
      if (!active || !element.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id,
        callback: async ({ credential }) => {
          if (!active) return;
          setBusy(true);
          setError('');
          try {
            onSession(await request<Session>('auth/google/', { body: { credential } }));
          } catch (error) {
            if (active) setError(message(error));
          } finally {
            if (active) setBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(element.current, {
        type: 'standard', theme: 'outline', size: 'large',
        width: Math.min(element.current.clientWidth || 360, 400),
        text: registration ? 'signup_with' : 'signin_with',
      });
    }).catch(() => {
      if (active) setError('Google sign-in could not load. Use your email and password or try again later.');
    });
    return () => { active = false; };
  }, [registration, onSession]);

  return <div className="google-sign-in">
    {enabled && <div className="auth-divider"><span>or</span></div>}
    <div ref={element} aria-label="Google sign-in" />
    {busy && <p role="status" className="muted">Signing in with Google…</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
  </div>;
}

export function Brand() {
  return <a className="brand" href="#home"><img src="/mark.svg" width="38" height="38" alt="" /><span>HDFC Bank</span></a>;
}

export function Notice() {
  return <p className="notice">Fictional accounts · Virtual funds · Independent student project · <a href="/privacy/">Privacy</a></p>;
}

export function PublicHeader() {
  return <header className="site-header"><div className="wrap header-inner">
    <Brand />
    <nav className="public-nav" aria-label="Main navigation">
      <a className="nav-services" href="#services">Everyday banking</a>
      <a className="sign-in-link" href="#login">Sign in</a>
      <a className="btn primary compact" href="#register">Open an account <ArrowUpRight size={16} /></a>
    </nav>
  </div></header>;
}

const services = [
  { icon: Landmark, title: 'Savings account', text: 'See your balance and account details in one place.' },
  { icon: ArrowDownToLine, title: 'Deposits and withdrawals', text: 'Review each amount before it reaches your balance.' },
  { icon: ArrowUpRight, title: 'Account transfers', text: 'Confirm the recipient and keep a receipt for every transfer.' },
  { icon: History, title: 'Transaction history', text: 'Search your activity or open a mini-statement.' },
];

export function Landing() {
  return <>
    <PublicHeader />
    <main>
      <section className="hero">
        <div className="wrap hero-inner">
          <div className="hero-copy">
            <p className="eyebrow"><span /> EVERYDAY BANKING</p>
            <h1>Your money.<br />In your hands.</h1>
            <p className="hero-text">A simpler way to manage your savings. Check your balance, transfer funds and keep track of your activity, all in one place.</p>
            <div className="hero-actions">
              <a className="btn primary" href="#register">Open an account <ArrowRight size={18} /></a>
              <a className="hero-link" href="#login">Already a customer? <span>Sign in</span> <ArrowRight size={16} /></a>
            </div>
          </div>
          <aside className="hero-panel" aria-label="Banking features">
            <img className="hero-photo" src="/people-banking.webp" alt="A woman using a laptop at home" width="1200" height="675" fetchPriority="high" />
            <div className="hero-photo-note">
              <span className="hero-photo-icon"><Smartphone size={20} /></span>
              <p><strong>Banking on your terms</strong><small>Your account is just a few taps away.</small></p>
            </div>
          </aside>
        </div>
      </section>
      <div className="service-strip">
        <div className="wrap service-strip-inner">
          <span><ShieldCheck size={18} /> Personal account access</span>
          <span><Smartphone size={18} /> Designed for any screen</span>
          <span><History size={18} /> Activity in one place</span>
        </div>
      </div>
      <section id="services" className="services wrap">
        <div className="section-intro"><div><p className="eyebrow">YOUR ACCOUNT</p><h2>All the essentials, together.</h2><p>Explore the ways you can manage your account.</p></div><a className="text-link" href="#register">Get started <ArrowRight size={16} /></a></div>
        <div className="service-grid">{services.map(({ icon: Icon, title, text }) => <article className="service-card" key={title}>
          <span className="icon-box"><Icon size={21} /></span><h3>{title}</h3><p>{text}</p>
        </article>)}</div>
      </section>
    </main>
    <footer className="site-footer"><div className="wrap footer-inner"><Brand /><Notice /></div></footer>
  </>;
}

export function AuthPage({ mode, onSession }: { mode: 'login' | 'register'; onSession: (session: Session) => void }) {
  const registration = mode === 'register';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      onSession(await request<Session>('auth/' + mode + '/', { body }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PublicHeader />
    <main className="auth-wrap wrap">
      <section className="auth-side">
        <span className="icon-box"><Landmark size={24} /></span>
        <p className="eyebrow">PERSONAL BANKING</p>
        <h1>Your savings.<br />Always in view.</h1>
        <p>Check your balance, make a transfer and find recent activity from the same account.</p>
      </section>
      <section className="auth-panel">
        <a className="back-link" href="#home"><ArrowLeft size={16} /> Back to home</a>
        <h2>{registration ? 'Open a savings account' : 'Sign in to your account'}</h2>
        <p className="muted">{registration ? 'Enter your details to get started.' : 'Enter the email and password for your account.'}</p>
        <form onSubmit={submit} className="form-stack">
          {registration && <label>Full name<input name="name" placeholder="Enter your name" autoComplete="name" maxLength={150} required /></label>}
          <label>Email address<input type="email" name="email" placeholder="name@example.com" autoComplete="username" maxLength={150} required /></label>
          <label>Password
            <span className="password-field">
              <input type={visible ? 'text' : 'password'} name="password" aria-label="Password" placeholder="Enter password"
                autoComplete={registration ? 'new-password' : 'current-password'} required
                minLength={registration ? 8 : undefined} maxLength={128} />
              <button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
            {registration && <small>Use at least 8 characters and avoid common passwords.</small>}
          </label>
          {error && <p className="feedback error" role="alert">{error}</p>}
          <button className="btn primary w-full" disabled={busy}>{busy ? (registration ? 'Opening account…' : 'Signing in…') : (registration ? 'Open account' : 'Sign in')} <ArrowRight size={17} /></button>
        </form>
        <GoogleSignIn registration={registration} onSession={onSession} />
        <p className="auth-switch">{registration ? 'Already have an account?' : 'New to HDFC Bank?'} <a href={registration ? '#login' : '#register'}>{registration ? 'Sign in' : 'Open an account'}</a></p>
      </section>
    </main>
    <footer className="site-footer"><div className="wrap footer-inner"><Brand /><Notice /></div></footer>
  </>;
}
