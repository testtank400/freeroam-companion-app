// useFreeroamCookie.ts
// Manages the per-user Freeroam session cookie stored in localStorage.
// The cookie is NEVER sent back to the client after being set — only a "set" flag is exposed.
// The actual cookie value is sent as a header with each tRPC request.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'freeroam_cookie';

export function useFreeroamCookie() {
  const [hasCookie, setHasCookie] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setHasCookie(!!stored && stored.trim().length > 0);
  }, []);

  const setCookie = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
      setHasCookie(true);
    }
  }, []);

  const clearCookie = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHasCookie(false);
  }, []);

  /** Get the raw cookie value — only used internally to attach to request headers. */
  const getRawCookie = useCallback((): string | null => {
    return localStorage.getItem(STORAGE_KEY);
  }, []);

  return { hasCookie, setCookie, clearCookie, getRawCookie };
}
