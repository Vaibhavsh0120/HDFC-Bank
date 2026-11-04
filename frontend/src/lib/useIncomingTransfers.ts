import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account, Entry } from './banking';

type Updates = { cursor: number; entries: Entry[]; account: Account };
type Send = <T>(path: string) => Promise<T>;

/**
 * Polls while the account is open. The first response establishes a baseline
 * so existing transfers are not announced as new.
 */
export function useIncomingTransfers(send: Send, accountNumber: string | undefined, initialCursor?: number) {
  const [notices, setNotices] = useState<Entry[]>([]);
  const [latestReceived, setLatestReceived] = useState<Entry>();
  const [latestAccount, setLatestAccount] = useState<Account>();
  const baseline = useRef(initialCursor);
  baseline.current = initialCursor;
  const dismiss = useCallback((reference: string) => {
    setNotices(previous => previous.filter(item => item.reference !== reference));
  }, []);

  useEffect(() => {
    if (!accountNumber) return;
    let active = true;
    let polling = false;
    let timer: ReturnType<typeof setTimeout>;
    const storageKey = 'hdfc.incoming-cursor.' + accountNumber;
    let cursor = baseline.current;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved !== null && /^\d{1,15}$/.test(saved) && Number.isSafeInteger(Number(saved))) cursor = Number(saved);
    } catch { /* Storage is optional; the dashboard still provides the baseline. */ }
    const seen = new Set<string>();
    setNotices([]);
    setLatestReceived(undefined);
    setLatestAccount(undefined);

    async function poll() {
      if (!active || polling) return;
      polling = true;
      clearTimeout(timer);
      try {
        const suffix = cursor === undefined ? '' : '?after=' + cursor;
        const result = await send<Updates>('activity/updates/' + suffix);
        if (!active) return;
        cursor = result.cursor;
        try { sessionStorage.setItem(storageKey, String(cursor)); } catch { /* Keep the in-memory cursor. */ }
        setLatestAccount(result.account);
        const fresh = result.entries.filter(row => row.kind === 'transfer' && row.direction === 'credit' && !seen.has(row.reference));
        fresh.forEach(row => seen.add(row.reference));
        if (!result.account.transfer_alerts) {
          setNotices([]);
          setLatestReceived(undefined);
        } else if (fresh.length) {
          setNotices(previous => [...previous, ...fresh].slice(-20));
          setLatestReceived(fresh.at(-1));
        }
      } catch {
        // Retry on the next poll. Keep the cursor so interrupted updates are not lost.
      } finally {
        polling = false;
        if (active) timer = setTimeout(poll, document.hidden ? 15000 : 1000);
      }
    }
    const resume = () => { if (!document.hidden) void poll(); };
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    void poll();
    return () => {
      active = false; clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [send, accountNumber]);

  return {
    notices,
    latestReceived,
    latestAccount,
    dismiss,
  };
}
