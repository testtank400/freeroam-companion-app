// Shared Freeroam auth headers for raw fetch() calls (tRPC batch endpoints, etc.).
// Prefer trpc client for normal API use — it injects these via main.tsx.
// Keep this as the single place that reads cookie/accountId from localStorage.

import {
  ACCOUNT_ID_STORAGE_KEY,
  COOKIE_STORAGE_KEY,
} from '@/hooks/useFreeroamCookie';

/** Headers to attach Freeroam session to non-tRPC fetch requests. */
export function getFreeroamAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = localStorage.getItem(COOKIE_STORAGE_KEY)?.trim();
  const accountId = localStorage.getItem(ACCOUNT_ID_STORAGE_KEY)?.trim();
  if (cookie) headers['x-freeroam-cookie'] = cookie;
  if (accountId) headers['x-freeroam-account-id'] = accountId;
  return headers;
}
