// useFreeroamCookie.ts
// Manages the per-user Freeroam session cookie and identity stored in localStorage.
// The cookie is sent as a header with each tRPC request.
// The accountId is also sent as a header so the server can scope data correctly.

import { useCallback, useEffect, useState } from 'react';

export const COOKIE_STORAGE_KEY = 'freeroam_cookie';
export const ACCOUNT_ID_STORAGE_KEY = 'freeroam_account_id';
export const USERNAME_STORAGE_KEY = 'freeroam_username';

export interface FreeroamIdentity {
  accountId: number;
  username: string;
}

export function useFreeroamCookie() {
  const [hasCookie, setHasCookie] = useState(false);
  const [identity, setIdentity] = useState<FreeroamIdentity | null>(null);

  useEffect(() => {
    const cookie = localStorage.getItem(COOKIE_STORAGE_KEY);
    const accountIdStr = localStorage.getItem(ACCOUNT_ID_STORAGE_KEY);
    const username = localStorage.getItem(USERNAME_STORAGE_KEY);
    const hasCookieVal = !!cookie && cookie.trim().length > 0;
    setHasCookie(hasCookieVal);
    if (hasCookieVal && accountIdStr && username) {
      const accountId = parseInt(accountIdStr, 10);
      if (!isNaN(accountId)) {
        setIdentity({ accountId, username });
      }
    }
  }, []);

  const saveIdentity = useCallback((cookieValue: string, accountId: number, username: string) => {
    localStorage.setItem(COOKIE_STORAGE_KEY, cookieValue.trim());
    localStorage.setItem(ACCOUNT_ID_STORAGE_KEY, String(accountId));
    localStorage.setItem(USERNAME_STORAGE_KEY, username);
    setHasCookie(true);
    setIdentity({ accountId, username });
  }, []);

  const clearCookie = useCallback(() => {
    localStorage.removeItem(COOKIE_STORAGE_KEY);
    localStorage.removeItem(ACCOUNT_ID_STORAGE_KEY);
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    setHasCookie(false);
    setIdentity(null);
  }, []);

  /** Get the raw cookie value — only used internally to attach to request headers. */
  const getRawCookie = useCallback((): string | null => {
    return localStorage.getItem(COOKIE_STORAGE_KEY);
  }, []);

  return { hasCookie, identity, saveIdentity, clearCookie, getRawCookie };
}
