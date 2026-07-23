import { useState } from "react";
import { Loader2, Lock } from "lucide-react";

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/site-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Invalid password");
        setLoading(false);
        return;
      }
      onSuccess();
    } catch {
      setError("Could not reach server");
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "oklch(0.11 0.01 264)" }}
    >
      <div
        className="w-full max-w-sm rounded-sm p-6"
        style={{
          background: "oklch(0.14 0.01 264)",
          border: "1px solid oklch(1 0 0 / 0.08)",
        }}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Lock size={18} style={{ color: "oklch(0.769 0.188 70.08)" }} />
          <h1
            className="text-lg font-semibold tracking-wide uppercase"
            style={{ fontFamily: "Rajdhani, sans-serif", color: "oklch(0.9 0.01 65)" }}
          >
            Site Access
          </h1>
        </div>
        <p
          className="text-[11px] mb-5 leading-relaxed"
          style={{ fontFamily: "JetBrains Mono, monospace", color: "oklch(0.5 0.01 264)" }}
        >
          Enter the shared site password. After that, connect your Freeroam cookie in Settings.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Site password"
            className="w-full px-3 py-2.5 rounded-sm text-sm outline-none"
            style={{
              fontFamily: "JetBrains Mono, monospace",
              background: "oklch(0.11 0.01 264)",
              border: "1px solid oklch(1 0 0 / 0.12)",
              color: "oklch(0.88 0.01 65)",
            }}
          />
          {error && (
            <p
              className="text-[11px]"
              style={{ fontFamily: "JetBrains Mono, monospace", color: "oklch(0.65 0.22 25)" }}
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!password.trim() || loading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-xs font-semibold tracking-wider uppercase transition-all disabled:opacity-40 hover:brightness-110"
            style={{
              fontFamily: "Rajdhani, sans-serif",
              background: "oklch(0.769 0.188 70.08 / 0.15)",
              border: "1px solid oklch(0.769 0.188 70.08 / 0.5)",
              color: "oklch(0.769 0.188 70.08)",
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Checking…
              </>
            ) : (
              "Enter"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
