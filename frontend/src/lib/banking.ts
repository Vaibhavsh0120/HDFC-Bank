export type Kind = 'deposit' | 'withdraw' | 'transfer';
export type Account = {
  name: string; email: string; number: string; type: string;
  balance: string; status: 'Active' | 'Frozen'; created_at: string;
};
export type Recipient = { name: string; number: string };
export type Entry = {
  reference: string; kind: Kind; amount: string; direction: 'credit' | 'debit';
  description: string; created_at: string; status: string; counterparty: Recipient | null;
};
export type Dashboard = { account: Account; recent: Entry[] };
export type Session = { token: string; account: Account };
export type History = { count: number; next: string | null; previous: string | null; results: Entry[] };
export type Instruction = { kind: Kind; amount: string; request_id: string; recipient?: string; description: string };
export type Receipt = { account: Account; entry: Entry };

const apiUrl = (import.meta.env.PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const timestamp = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
});

export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export async function request<T>(path: string, { token, body, method, timeoutMs = 45000 }: { token?: string; body?: object; method?: 'GET' | 'POST' | 'PATCH'; timeoutMs?: number } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl + '/api/' + path, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('The service is taking longer than expected. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const detail = typeof data?.detail === 'string' ? data.detail : null;
    const validation = data && Object.values(data).flat().find(value => typeof value === 'string');
    throw new ApiError(detail || validation || 'The service is temporarily unavailable. Try again shortly.', response.status);
  }
  return data as T;
}

export function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}
