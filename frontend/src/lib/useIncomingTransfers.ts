import { useCallback, useEffect, useState } from 'react';
import type { Account, Entry } from './banking';

type Updates = { cursor: number; entries: Entry[]; account: Account };
type Send = <T>(path: string) => Promise<T>;

/**
 * Polls while the account is open. The first response establishes a baseline
 * so existing transfers are not announced as new.
 */
export function useIncomingTransfers(send: Send, accountNumber: string | undefined) {
  const [notices, setNotices] = useState<Entry[]>([]);
  const [latestAccount, setLatestAccount] = useState<Account>();
  const dismiss = useCallback((reference: string) => {
    setNotices(previous => previous.filter(item => item.reference !== reference));
  }, []);

  useEffect(() => {
    if (!accountNumber) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let cursor: number | undefined;
    setNotices([]);
    setLatestAccount(undefined);

    async function poll() {
      try {
        const suffix = cursor === undefined ? '' : '?after=' + cursor;
        const result = await send<Updates>('activity/updates/' + suffix);
        if (!active) return;
        cursor = result.cursor;
        setLatestAccount(result.account);
        if (result.entries.length) {
          setNotices(previous => [...previous, ...result.entries.filter(row => !previous.some(item => item.reference === row.reference))].slice(-20));
        }
      } catch {
        // Retry on the next poll. Keep the cursor so interrupted updates are not lost.
      } finally {
        if (active) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [send, accountNumber]);

  return {
    notices,
    latestAccount,
    dismiss,
  };
}
