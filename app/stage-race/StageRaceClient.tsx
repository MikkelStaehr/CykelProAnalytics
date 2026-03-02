"use client";

import { useState, useEffect, useCallback } from "react";
import type { Race, RiderAnalysis } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types returned by the API
// ---------------------------------------------------------------------------

interface ScoredRider extends RiderAnalysis {
  price: number;
  is_out: boolean;
}

interface StageRaceData {
  riders: ScoredRider[];
  suggestedTeam: ScoredRider[];
  budget: number;
  budgetUsed: number;
  teamIds: number[];
  raceProfile: string | null;
  riderProfilesLoaded: number;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(p: number): string {
  if (p === 0) return "—";
  return (p / 1_000_000).toFixed(1) + "M";
}

function fmtBudget(p: number): string {
  if (p === 0) return "0";
  return (p / 1_000_000).toFixed(2) + "M";
}

const PROFILE_COLORS: Record<string, string> = {
  flat:     "#3b82f6",
  cobbled:  "#f59e0b",
  hilly:    "#22c55e",
  mixed:    "#a78bfa",
  mountain: "#ef4444",
};

const PROFILE_LABELS: Record<string, string> = {
  flat: "Flad", cobbled: "Brosten", hilly: "Bakket", mixed: "Mixed", mountain: "Bjerg",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return null;
  const color = PROFILE_COLORS[profile] ?? "#6b6b80";
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {PROFILE_LABELS[profile] ?? profile}
    </span>
  );
}

function SpecialtyBadge({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{
        backgroundColor: "rgba(129,140,248,0.12)",
        color: "#818cf8",
        border: "1px solid rgba(129,140,248,0.25)",
      }}
    >
      {label}
    </span>
  );
}

function FreshnessBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  const color =
    days <= 7  ? "var(--c-green)" :
    days <= 14 ? "var(--c-amber)" :
    "var(--c-red)";
  const hex = days <= 7 ? "#22c55e" : days <= 14 ? "#f59e0b" : "#ef4444";
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{ color, backgroundColor: `${hex}18`, border: `1px solid ${hex}40` }}
    >
      {days}d
    </span>
  );
}

function SegmentedScoreBar({ r, compact = false }: { r: RiderAnalysis; compact?: boolean }) {
  const total = r.total_score;
  if (total <= 0) {
    return (
      <div
        className={`rounded-full ${compact ? "w-12 h-1.5" : "flex-1 h-2"}`}
        style={{ backgroundColor: "var(--c-border)" }}
      />
    );
  }
  const pPct = ((r.profile_score * 0.4) / total) * 100;
  const fPct = ((r.form_score_norm * 0.4) / total) * 100;
  const vPct = ((r.value_score * 0.2) / total) * 100;

  return (
    <div
      className={`rounded-full overflow-hidden ${compact ? "w-12 h-1.5" : "flex-1 h-2"}`}
      style={{ backgroundColor: "var(--c-border)" }}
      title={`Total: ${total.toFixed(1)} | Profil: ${r.profile_score.toFixed(1)} | Form: ${r.form_score_norm.toFixed(1)} | Value: ${r.value_score.toFixed(1)}`}
    >
      <div className="h-full flex" style={{ width: `${total}%` }}>
        <div style={{ width: `${pPct}%`, backgroundColor: "#3b82f6" }} />
        <div style={{ width: `${fPct}%`, backgroundColor: "#22c55e" }} />
        <div style={{ width: `${vPct}%`, backgroundColor: "#f59e0b" }} />
      </div>
    </div>
  );
}

// Budget bar showing used vs total
function BudgetBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const remaining = total - used;
  const isNearFull = pct > 85;
  const barColor = isNearFull ? "var(--c-amber)" : "var(--c-green)";

  return (
    <div
      className="rounded-xl px-5 py-4 space-y-3"
      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-muted)" }}>
          Budget
        </p>
        <p className="text-xs font-semibold tabular-nums" style={{ color: isNearFull ? "var(--c-amber)" : "var(--c-green)" }}>
          {fmtBudget(remaining)} tilbage
        </p>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--c-border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums" style={{ color: "var(--c-text)" }}>
          {fmtBudget(used)}
        </span>
        <span className="text-sm" style={{ color: "var(--c-muted)" }}>
          / {fmtBudget(total)} brugt
        </span>
        <span className="ml-auto text-xs" style={{ color: "var(--c-muted)" }}>
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// Rider card for suggested team
function TeamRiderCard({ r, rank }: { r: ScoredRider; rank: number }) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        backgroundColor: "var(--c-bg)",
        border: "1px solid var(--c-border)",
        borderLeft: r.form_flag === "green"
          ? "3px solid var(--c-green)"
          : r.form_flag === "red"
          ? "3px solid var(--c-red)"
          : "1px solid var(--c-border)",
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] tabular-nums w-4 pt-0.5" style={{ color: "var(--c-border)" }}>{rank}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight" style={{ color: "var(--c-text)" }}>
            {r.rider.full_name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold tabular-nums" style={{ color: "var(--c-blue)" }}>
            {fmtPrice(r.price)}
          </p>
          {r.is_out && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "var(--c-red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              Ude
            </span>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <SpecialtyBadge label={r.top_specialty} />
        <FreshnessBadge days={r.days_since_race} />
      </div>

      {/* Score */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tabular-nums w-8 shrink-0" style={{ color: "var(--c-text)" }}>
          {r.total_score > 0 ? r.total_score.toFixed(1) : "—"}
        </span>
        <SegmentedScoreBar r={r} />
      </div>

      {/* Efficiency */}
      {r.price > 0 && r.total_score > 0 && (
        <p className="text-[10px]" style={{ color: "var(--c-muted)" }}>
          Effektivitet: <span style={{ color: "var(--c-text)" }}>
            {(r.total_score / (r.price / 1_000_000)).toFixed(2)}
          </span> pts/M
        </p>
      )}
    </div>
  );
}

// Row in the full ranking table
function RiderRow({ r, rank, inTeam }: { r: ScoredRider; rank: number; inTeam: boolean }) {
  const flagColor =
    r.form_flag === "green" ? "var(--c-green)" :
    r.form_flag === "red"   ? "var(--c-red)"   : "transparent";

  return (
    <tr
      className="transition-colors"
      style={{ borderTop: "1px solid var(--c-border)", backgroundColor: inTeam ? "rgba(59,130,246,0.04)" : "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = inTeam ? "rgba(59,130,246,0.04)" : "transparent")}
    >
      <td className="p-0 w-[3px]" style={{ backgroundColor: flagColor }} />
      <td className="px-3 py-2 text-xs tabular-nums" style={{ color: "var(--c-border)" }}>{rank}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {inTeam && (
            <span
              className="text-[9px] font-bold px-1 py-0.5 rounded"
              style={{ backgroundColor: "rgba(59,130,246,0.15)", color: "var(--c-blue)", border: "1px solid rgba(59,130,246,0.3)" }}
            >
              ✓
            </span>
          )}
          <span className="text-sm font-medium" style={{ color: "var(--c-text)" }}>{r.rider.full_name}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--c-blue)" }}>
          {fmtPrice(r.price)}
        </span>
      </td>
      <td className="px-3 py-2">
        <SpecialtyBadge label={r.top_specialty} />
      </td>
      <td className="px-3 py-2 text-center">
        <FreshnessBadge days={r.days_since_race} />
      </td>
      <td className="px-3 py-2 min-w-[120px]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums w-8 text-right shrink-0" style={{ color: r.total_score > 0 ? "var(--c-text)" : "var(--c-border)" }}>
            {r.total_score > 0 ? r.total_score.toFixed(1) : "—"}
          </span>
          <SegmentedScoreBar r={r} />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        {r.price > 0 && r.total_score > 0 ? (
          <span className="text-xs tabular-nums" style={{ color: "var(--c-muted)" }}>
            {(r.total_score / (r.price / 1_000_000)).toFixed(2)}
          </span>
        ) : (
          <span style={{ color: "var(--c-border)" }}>—</span>
        )}
      </td>
      {r.is_out && (
        <td className="px-3 py-2 text-center">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(239,68,68,0.12)", color: "var(--c-red)", border: "1px solid rgba(239,68,68,0.25)" }}>
            Ude
          </span>
        </td>
      )}
      {!r.is_out && <td className="px-3 py-2" />}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export default function StageRaceClient({ races }: { races: Race[] }) {
  const [selectedRace, setSelectedRace] = useState(races[0]?.slug ?? "");
  const [data, setData] = useState<StageRaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRaceObj = races.find((r) => r.slug === selectedRace);

  const fetchData = useCallback(async (race: string) => {
    if (!race) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/stage-race?race=${encodeURIComponent(race)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Ukendt fejl"); return; }
      setData(json);
    } catch {
      setError("Netværksfejl — kunne ikke hente data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedRace); }, [selectedRace, fetchData]);

  const teamIdSet = new Set(data?.teamIds ?? []);

  return (
    <div className="px-8 py-9 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>
            Stage Race
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>
            Budget-optimeret holdsammensætning
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedRaceObj?.profile && <ProfileBadge profile={selectedRaceObj.profile} />}
          <select
            value={selectedRace}
            onChange={(e) => setSelectedRace(e.target.value)}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
            style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-text)" }}
          >
            {races.map((r) => (
              <option key={r.slug} value={r.slug}>{r.name} ({r.year})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 py-16 justify-center text-sm" style={{ color: "var(--c-muted)" }}>
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Beregner budget-optimeret hold…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--c-red)" }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data?.message && data.riders.length === 0 && (
        <div className="py-16 text-center text-sm" style={{ color: "var(--c-muted)" }}>{data.message}</div>
      )}

      {/* Budget bar */}
      {!loading && data && data.budget > 0 && (
        <BudgetBar used={data.budgetUsed} total={data.budget} />
      )}

      {/* Suggested team */}
      {!loading && data && data.suggestedTeam.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>
              Foreslået hold ({data.suggestedTeam.length} ryttere)
            </p>
            <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--c-muted)" }}>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />Profil</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#22c55e" }} />Form</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />Value</span>
            </div>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {data.suggestedTeam
              .sort((a, b) => b.total_score - a.total_score)
              .map((r, i) => (
                <TeamRiderCard key={r.rider.id} r={r} rank={i + 1} />
              ))}
          </div>
        </div>
      )}

      {/* Full ranking table */}
      {!loading && data && data.riders.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>
            Alle ryttere ({data.riders.length})
          </p>
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {[
                    { label: "", width: "w-[3px]" },
                    { label: "#", width: "w-9" },
                    { label: "Rytter", width: "" },
                    { label: "Hold", width: "" },
                    { label: "Pris", width: "" },
                    { label: "Specialitet", width: "" },
                    { label: "Frisk.", width: "" },
                    { label: "Score", width: "min-w-[130px]" },
                    { label: "Effekt.", width: "" },
                    { label: "", width: "" },
                  ].map((col, i) => (
                    <th
                      key={i}
                      className={`px-3 py-2.5 text-left ${col.width}`}
                      style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)", backgroundColor: "var(--c-surface)" }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.riders.map((r, i) => (
                  <RiderRow key={r.rider.id} r={r} rank={i + 1} inTeam={teamIdSet.has(r.rider.id)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-5 text-xs pt-1" style={{ color: "var(--c-muted)" }}>
            <span className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: "rgba(59,130,246,0.15)", color: "var(--c-blue)", border: "1px solid rgba(59,130,246,0.3)" }}>✓</span>
              Indgår i foreslået hold
            </span>
            <span className="ml-auto flex items-center gap-3">
              <span>Score-bar:</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />Profil</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#22c55e" }} />Form</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />Value</span>
              <span className="flex items-center gap-3 ml-2" style={{ borderLeft: "1px solid var(--c-border)", paddingLeft: "0.75rem" }}>
                <span>Effektivitet = score / (pris / 1M)</span>
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
