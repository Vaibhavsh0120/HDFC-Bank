import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Eye, EyeOff, History, Landmark, ShieldCheck } from 'lucide-react';
import { message, request, type Session } from '../lib/banking';

export function Brand() {
  return <a className="brand" href="#home"><img src="/mark.svg" width="38" height="38" alt="" /><span>HDFC Bank</span></a>;
}

export function Notice() {
  return <p className="notice">Fictional accounts · Virtual funds · Independent student project</p>;
}

export function PublicHeader() {
  return <header className="site-header"><div className="wrap header-inner">
    <Brand />
    <nav className="public-nav" aria-label="Main navigation">
      <a className="nav-services" href="#services">Services</a>
      <a className="sign-in-link" href="#login">Sign in</a>
      <a className="btn primary compact" href="#register">Open account <ArrowUpRight size={16} /></a>
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
            <p className="eyebrow"><span /> PERSONAL BANKING</p>
            <h1>Banking made<br />clearer.</h1>
            <p className="hero-text">Manage your savings, move funds between accounts and see where your balance stands.</p>
            <div className="hero-actions">
              <a className="btn primary" href="#register">Open a savings account <ArrowRight size={18} /></a>
              <a className="btn secondary" href="#login">Sign in</a>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-grid" />
            <svg className="orbital" viewBox="0 0 560 420" fill="none">
              <ellipse cx="290" cy="225" rx="241" ry="103" transform="rotate(-26 290 225)" />
              <ellipse cx="290" cy="225" rx="210" ry="126" transform="rotate(34 290 225)" />
              <ellipse cx="290" cy="225" rx="245" ry="156" transform="rotate(-26 290 225)" />
              <circle cx="93" cy="274" r="5" /><circle cx="457" cy="121" r="4" />
            </svg>
            <div className="art-emblem"><img src="/mark.svg" alt="" /></div>
            <div className="art-label art-label-top"><ShieldCheck size={19} /><span>Private access</span></div>
            <div className="art-label art-label-bottom"><Landmark size={19} /><span>Personal savings</span></div>
            <span className="art-index">01 / EVERYDAY BANKING</span>
          </div>
        </div>
      </section>
      <section id="services" className="services wrap">
        <div className="section-intro"><p className="eyebrow">YOUR ACCOUNT</p><h2>Everyday banking essentials</h2></div>
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
        <p className="auth-switch">{registration ? 'Already have an account?' : 'New to HDFC Bank?'} <a href={registration ? '#login' : '#register'}>{registration ? 'Sign in' : 'Open an account'}</a></p>
      </section>
    </main>
    <footer className="site-footer"><div className="wrap footer-inner"><Brand /><Notice /></div></footer>
  </>;
}
