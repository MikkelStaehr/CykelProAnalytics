"use client";

import { useState } from "react";
import type { Race } from "@/lib/types";

type RunStatus = "idle" | "loading" | "success" | "error";

interface RunLog {
  label: string;
  status: RunStatus;
  timestamp: string | null;
  stdout: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

const EMPTY_LOG: RunLog = { label: "", status: "idle", timestamp: null, stdout: null, result: null, error: null };

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6 flex flex-col gap-5"
      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}
    >
      <h2 className="text-sm font-semibold" style={{ color: "var(--c-text)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Select({
  races, value, onChange, disabled,
}: { races: Race[]; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed w-72"
      style={{
        backgroundColor: "var(--c-bg)",
        border: "1px solid var(--c-border)",
        color: "var(--c-text)",
      }}
    >
      {races.map((r) => (
        <option key={r.slug} value={r.slug}>
          {r.game_type === "stage_race" ? "🚵 " : ""}{r.name} ({r.year})
        </option>
      ))}
    </select>
  );
}

function Btn({
  onClick, disabled, loading, children, variant = "primary",
}: { onClick: () => void; disabled: boolean; loading: boolean; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const style =
    variant === "primary"
      ? { backgroundColor: "var(--c-blue)", color: "#fff" }
      : { backgroundColor: "var(--c-border)", color: "var(--c-text)" };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80"
      style={style}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  if (status === "idle") return null;
  const map: Record<string, { label: string; color: string; bg: string }> = {
    loading: { label: "Kører…",  color: "var(--c-amber)", bg: "rgba(245,158,11,0.1)" },
    success: { label: "Succes",  color: "var(--c-green)", bg: "rgba(34,197,94,0.1)"  },
    error:   { label: "Fejl",    color: "var(--c-red)",   bg: "rgba(239,68,68,0.1)"  },
  };
  const { label, color, bg } = map[status];
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ color, backgroundColor: bg }}>
      {label}
    </span>
  );
}

function ResultGrid({ result }: { result: Record<string, unknown> }) {
  const skip = new Set(["ok", "stdout"]);
  const entries = Object.entries(result).filter(([k]) => !skip.has(k));
  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <div key={key} className="col-span-full space-y-1">
              <p className="text-xs" style={{ color: "var(--c-muted)" }}>{key}</p>
              {(value as string[]).length > 0 ? (
                (value as string[]).map((v, i) => (
                  <p key={i} className="text-xs font-mono" style={{ color: "var(--c-amber)" }}>{v}</p>
                ))
              ) : (
                <p className="text-xs" style={{ color: "var(--c-muted)" }}>ingen</p>
              )}
            </div>
          );
        }
        return (
          <div key={key} className="rounded-lg px-3 py-2" style={{ backgroundColor: "var(--c-bg)", border: "1px solid var(--c-border)" }}>
            <p className="text-[10px] uppercase tracking-wider truncate" style={{ color: "var(--c-muted)" }}>{key}</p>
            <p className="text-sm font-semibold mt-0.5 truncate tabular-nums" style={{ color: "var(--c-text)" }}>{String(value)}</p>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ log }: { log: RunLog }) {
  if (log.status === "idle") return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusPill status={log.status} />
        {log.timestamp && <span className="text-xs" style={{ color: "var(--c-muted)" }}>{log.timestamp}</span>}
        {log.label && <span className="text-xs" style={{ color: "var(--c-muted)" }}>{log.label}</span>}
      </div>
      {log.stdout && (
        <pre
          className="rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-48"
          style={{ backgroundColor: "var(--c-bg)", border: "1px solid var(--c-border)", color: "var(--c-muted)" }}
        >
          {log.stdout.trim()}
        </pre>
      )}
      {log.result && <ResultGrid result={log.result} />}
      {log.error && (
        <pre
          className="rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-48"
          style={{ backgroundColor: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--c-red)" }}
        >
          {log.error.trim()}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function callFetchHoldet(race: string, snapshot: "before" | "after") {
  const res = await fetch("/api/fetch-holdet", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ race, snapshot }),
  });
  const data = await res.json();
  return res.ok
    ? { stdout: data.stdout ?? "", result: data.result, error: null }
    : { stdout: data.stdout ?? "", result: null, error: data.stderr ?? data.error ?? "Ukendt fejl" };
}

async function callFetchPcs(race: string) {
  const res = await fetch("/api/fetch-pcs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ race }),
  });
  const data = await res.json();
  return res.ok
    ? { stdout: data.stdout ?? "", result: data.result, error: null }
    : { stdout: data.stdout ?? "", result: null, error: data.stderr ?? data.error ?? "Ukendt fejl" };
}

async function callFetchRiderProfiles(race: string, force: boolean) {
  const res = await fetch("/api/fetch-rider-profiles", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ race, force }),
  });
  const data = await res.json();
  return res.ok
    ? { stdout: data.stdout ?? "", result: data.result, error: null }
    : { stdout: data.stdout ?? "", result: null, error: data.stderr ?? data.error ?? "Ukendt fejl" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function AdminClient({ races }: { races: Race[] }) {
  const [holdetRace, setHoldetRace] = useState(races[0]?.slug ?? "");
  const [holdetLog, setHoldetLog] = useState<RunLog>(EMPTY_LOG);
  const [pcsRace, setPcsRace] = useState(races[0]?.slug ?? "");
  const [pcsLog, setPcsLog] = useState<RunLog>(EMPTY_LOG);
  const [profilesRace, setProfilesRace] = useState(races[0]?.slug ?? "");
  const [profilesLog, setProfilesLog] = useState<RunLog>(EMPTY_LOG);

  const holdetBusy   = holdetLog.status === "loading";
  const pcsBusy      = pcsLog.status === "loading";
  const profilesBusy = profilesLog.status === "loading";

  const raceBySlug = Object.fromEntries(races.map((r) => [r.slug, r]));
  const selectedHoldetRace = raceBySlug[holdetRace];

  async function fetchHoldet(snapshot: "before" | "after") {
    const label = `${holdetRace} — ${snapshot}`;
    setHoldetLog({ ...EMPTY_LOG, status: "loading", label, timestamp: new Date().toLocaleTimeString("da-DK") });
    const { stdout, result, error } = await callFetchHoldet(holdetRace, snapshot);
    setHoldetLog({ label, status: error ? "error" : "success", timestamp: new Date().toLocaleTimeString("da-DK"), stdout, result, error });
  }

  async function fetchPcs() {
    const label = pcsRace;
    setPcsLog({ ...EMPTY_LOG, status: "loading", label, timestamp: new Date().toLocaleTimeString("da-DK") });
    const { stdout, result, error } = await callFetchPcs(pcsRace);
    setPcsLog({ label, status: error ? "error" : "success", timestamp: new Date().toLocaleTimeString("da-DK"), stdout, result, error });
  }

  async function fetchRiderProfiles(force: boolean) {
    const label = `${profilesRace}${force ? " (force)" : ""}`;
    setProfilesLog({ ...EMPTY_LOG, status: "loading", label, timestamp: new Date().toLocaleTimeString("da-DK") });
    const { stdout, result, error } = await callFetchRiderProfiles(profilesRace, force);
    setProfilesLog({ label, status: error ? "error" : "success", timestamp: new Date().toLocaleTimeString("da-DK"), stdout, result, error });
  }

  return (
    <div className="max-w-xl mx-auto px-8 py-9 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>Admin</h1>
        <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>Datahåndtering — kør scripts manuelt.</p>
      </div>

      <Card title="Fetch Holdet Snapshot">
        <Select races={races} value={holdetRace} onChange={setHoldetRace} disabled={holdetBusy} />
        {selectedHoldetRace?.game_type === "stage_race" && (
          <div
            className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
            style={{ backgroundColor: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "var(--c-blue)" }}
          >
            <span>🚵 Etapeløb</span>
            <span style={{ color: "var(--c-muted)" }}>·</span>
            <span>Game ID: {selectedHoldetRace.holdet_game_id}</span>
            {selectedHoldetRace.budget && (
              <>
                <span style={{ color: "var(--c-muted)" }}>·</span>
                <span>Budget: {(selectedHoldetRace.budget / 1_000_000).toFixed(0)}M</span>
              </>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Btn onClick={() => fetchHoldet("before")} disabled={holdetBusy || !holdetRace} loading={holdetBusy && holdetLog.label.endsWith("before")}>
            Fetch Before
          </Btn>
          <Btn onClick={() => fetchHoldet("after")} disabled={holdetBusy || !holdetRace} loading={holdetBusy && holdetLog.label.endsWith("after")} variant="secondary">
            Fetch After
          </Btn>
        </div>
        <LogPanel log={holdetLog} />
      </Card>

      <Card title="Fetch PCS Startlist">
        <Select races={races} value={pcsRace} onChange={setPcsRace} disabled={pcsBusy} />
        <Btn onClick={fetchPcs} disabled={pcsBusy || !pcsRace} loading={pcsBusy}>
          Fetch Startlist
        </Btn>
        <LogPanel log={pcsLog} />
      </Card>

      <Card title="Fetch Rider Profiles">
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          Scraper PCS-ryttersider for alle startlistryttere — henter specialitetpoint og dage siden seneste løb.
          Data caches i 7 dage pr. rytter.
        </p>
        <Select races={races} value={profilesRace} onChange={setProfilesRace} disabled={profilesBusy} />
        <div className="flex gap-2">
          <Btn onClick={() => fetchRiderProfiles(false)} disabled={profilesBusy || !profilesRace} loading={profilesBusy && !profilesLog.label.includes("force")}>
            Fetch (brug cache)
          </Btn>
          <Btn
            onClick={() => fetchRiderProfiles(true)}
            disabled={profilesBusy || !profilesRace}
            loading={profilesBusy && profilesLog.label.includes("force")}
            variant="secondary"
          >
            Fetch (tving alle)
          </Btn>
        </div>
        <LogPanel log={profilesLog} />
      </Card>
    </div>
  );
}
