import { ArrowLeft, Home, SearchX } from 'lucide-react';
import { Brand } from './PublicPages';

export function NotFound({ staticPage = false }: { staticPage?: boolean }) {
  return <div className="not-found-page"><header className="wrap"><Brand href={staticPage ? '/#home' : '#home'} /></header><main className="not-found-content wrap">
    <span className="not-found-illustration" aria-hidden="true"><SearchX size={52} /></span>
    <p className="eyebrow">ERROR 404</p><h1>Page not found</h1>
    <p className="muted">This page may have moved, or the link may be incorrect.</p>
    <div className="button-row"><a className="btn primary" href={staticPage ? '/#overview' : '#overview'}><Home size={18} />Go to account</a>
      <button className="btn secondary" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.href = '/'; }}><ArrowLeft size={18} />Go back</button></div>
  </main></div>;
}
