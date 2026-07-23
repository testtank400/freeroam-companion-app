import Login from "@/pages/Login";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type AuthStatus = {
  authRequired: boolean;
  authenticated: boolean;
  misconfigured?: boolean;
};

interface SiteAuthGateProps {
  children: React.ReactNode;
}

/**
 * Layer 1 site gate: if SITE_PASSWORD is configured, require companion_site_session
 * before rendering the main app. Freeroam cookie (layer 2) is handled inside Settings.
 */
export default function SiteAuthGate({ children }: SiteAuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/site-auth/status", { credentials: "include" });
      if (!res.ok) {
        setError("Could not check site auth status");
        setStatus({ authRequired: true, authenticated: false });
        return;
      }
      const data = (await res.json()) as AuthStatus;
      setStatus(data);
      setError("");
    } catch {
      setError("Could not reach server");
      setStatus({ authRequired: true, authenticated: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Allow other parts of the app (e.g. 401 handler) to force re-check
  useEffect(() => {
    const onNeedAuth = () => {
      setStatus((s) => (s ? { ...s, authRequired: true, authenticated: false } : { authRequired: true, authenticated: false }));
    };
    window.addEventListener("site-auth-required", onNeedAuth);
    return () => window.removeEventListener("site-auth-required", onNeedAuth);
  }, []);

  if (!status) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "oklch(0.11 0.01 264)" }}
      >
        <Loader2 size={22} className="animate-spin" style={{ color: "oklch(0.769 0.188 70.08)" }} />
      </div>
    );
  }

  if (status.authRequired && !status.authenticated) {
    return (
      <>
        {error && (
          <div
            className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-sm text-[11px]"
            style={{
              fontFamily: "JetBrains Mono, monospace",
              background: "oklch(0.2 0.05 25)",
              color: "oklch(0.8 0.1 25)",
              border: "1px solid oklch(0.65 0.22 25 / 0.4)",
            }}
          >
            {error}
          </div>
        )}
        <Login
          onSuccess={() => {
            void refresh();
          }}
        />
      </>
    );
  }

  return <>{children}</>;
}

/** Call after site logout so the gate re-checks without full reload. */
export function requestSiteAuthGate() {
  window.dispatchEvent(new Event("site-auth-required"));
}
