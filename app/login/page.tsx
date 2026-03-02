"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Forkert adgangskode");
      }
    } catch {
      setError("Netværksfejl — prøv igen");
    } finally {
      setLoading(false);
    }
  }

  return (
    // Full-screen overlay that covers the sidebar nav
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--c-bg)" }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          backgroundColor: "var(--c-surface)",
          border: "1px solid var(--c-border)",
        }}
      >
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>
            🚴 CykelPro
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--c-muted)" }}>
            Analytics 2026
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--c-muted)" }}
            >
              Adgangskode
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              placeholder="••••••••"
              className="rounded-lg px-4 py-3 text-sm outline-none transition-all"
              style={{
                backgroundColor: "var(--c-bg)",
                border: "1px solid var(--c-border)",
                color: "var(--c-text)",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = "var(--c-blue)")
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = "var(--c-border)")
              }
            />
          </div>

          {error && (
            <p
              className="rounded-lg px-3 py-2 text-sm text-center"
              style={{
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "var(--c-red)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-1 rounded-lg px-4 py-3 text-sm font-semibold transition-all disabled:opacity-40"
            style={{
              backgroundColor: "var(--c-blue)",
              color: "#fff",
              cursor: loading || !password ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Logger ind…" : "Log ind"}
          </button>
        </form>
      </div>
    </div>
  );
}
