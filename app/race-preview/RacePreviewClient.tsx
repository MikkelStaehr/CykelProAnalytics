"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { Race, RiderAnalysis } from "@/lib/types";
import type { RiderDetails } from "@/app/api/race-preview/route";

type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Profile metadata
// ---------------------------------------------------------------------------

const PROFILE_LABELS: Record<string, string> = {
  flat: "Flad", cobbled: "Brosten", hilly: "Bakket", mixed: "Mixed", mountain: "Bjerg",
};

const PROFILE_COLORS: Record<string, string> = {
  flat: "#3b82f6", cobbled: "#f59e0b", hilly: "#22c55e", mixed: "#a78bfa", mountain: "#ef4444",
};

function ProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return null;
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: `${PROFILE_COLORS[profile] ?? "#6b6b80"}22`,
        color: PROFILE_COLORS[profile] ?? "var(--c-muted)",
        border: `1px solid ${PROFILE_COLORS[profile] ?? "#6b6b80"}44`,
      }}
    >
      {PROFILE_LABELS[profile] ?? profile}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form source badge
// ---------------------------------------------------------------------------

function FormSourceBadge({ source }: { source: RiderAnalysis["form_source"] }) {
  if (source !== "pcs") return null;
  return (
    <span
      className="inline-flex items-center text-[9px] font-semibold px-1 py-0.5 rounded ml-1"
      style={{
        backgroundColor: "rgba(107,107,128,0.2)",
        color: "var(--c-muted)",
        border: "1px solid rgba(107,107,128,0.3)",
      }}
      title="Form-score baseret på PCS seneste løb (ingen Holdet-data)"
    >
      PCS
    </span>
  );
}

// ---------------------------------------------------------------------------
// Segmented score bar
// ---------------------------------------------------------------------------

function SegmentedScoreBar({ r }: { r: RiderAnalysis }) {
  const total = r.total_score;
  if (total <= 0) {
    return (
      <div className="flex items-center gap-2 min-w-[90px]">
        <span className="text-sm tabular-nums w-8 text-right" style={{ color: "var(--c-border)" }}>—</span>
        <div className="flex-1 h-3 rounded-full" style={{ backgroundColor: "var(--c-border)" }} />
      </div>
    );
  }
  const pContrib = r.profile_score * 0.4;
  const fContrib = r.form_score_norm * 0.4;
  const vContrib = r.value_score * 0.2;
  const pPct = (pContrib / total) * 100;
  const fPct = (fContrib / total) * 100;
  const vPct = (vContrib / total) * 100;

  return (
    <div
      className="flex items-center gap-2 min-w-[90px]"
      title={`Total: ${total.toFixed(1)} | Profil: ${r.profile_score.toFixed(1)} | Form: ${r.form_score_norm.toFixed(1)} | Value: ${r.value_score.toFixed(1)}`}
    >
      <span className="text-sm font-semibold tabular-nums w-8 text-right" style={{ color: "var(--c-text)" }}>
        {total.toFixed(1)}
      </span>
      <div
        className="flex-1 h-3 rounded-full overflow-hidden relative"
        style={{ backgroundColor: "var(--c-border)" }}
      >
        <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${total}%` }}>
          <div style={{ width: `${pPct}%`, backgroundColor: "#3b82f6", boxShadow: pPct > fPct && pPct > vPct ? "0 0 6px rgba(59,130,246,0.6)" : "none" }} />
          <div style={{ width: `${fPct}%`, backgroundColor: "#22c55e", boxShadow: fPct > pPct && fPct > vPct ? "0 0 6px rgba(34,197,94,0.6)" : "none" }} />
          <div style={{ width: `${vPct}%`, backgroundColor: "#f59e0b", boxShadow: vPct > pPct && vPct > fPct ? "0 0 6px rgba(245,158,11,0.6)" : "none" }} />
        </div>
      </div>
    </div>
  );
}

function FreshnessCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs" style={{ color: "var(--c-border)" }}>—</span>;
  const color = days <= 7 ? "var(--c-green)" : days <= 14 ? "var(--c-amber)" : "var(--c-red)";
  const hex = days <= 7 ? "#22c55e" : days <= 14 ? "#f59e0b" : "#ef4444";
  return (
    <span
      className="inline-flex items-center gap-1 text-xs tabular-nums font-medium px-1.5 py-0.5 rounded-full"
      style={{ color, backgroundColor: `${hex}18`, border: `1px solid ${hex}40` }}
      title={`${days} dage siden seneste løb`}
    >
      {days}d
    </span>
  );
}

function SpecialtyBadge({ label }: { label: string | null }) {
  if (!label) return <span style={{ color: "var(--c-border)" }} className="text-xs">—</span>;
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: "rgba(129,140,248,0.12)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.25)", whiteSpace: "nowrap" }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Specialty mini bar
// ---------------------------------------------------------------------------

function SpecialtyBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-14 shrink-0 text-right" style={{ color: "var(--c-muted)" }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--c-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "#818cf8" }} />
      </div>
      <span className="text-[10px] w-8 tabular-nums" style={{ color: "var(--c-muted)" }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded rider details panel
// ---------------------------------------------------------------------------

function RiderExpansionPanel({
  rider,
  details,
}: {
  rider: RiderAnalysis;
  details: RiderDetails | undefined;
}) {
  if (!details) {
    return (
      <div className="px-6 py-4 text-xs" style={{ color: "var(--c-muted)" }}>
        Ingen yderligere data
      </div>
    );
  }

  const spec = details.specialty;
  const specMax = spec
    ? Math.max(spec.pts_oneday, spec.pts_gc, spec.pts_tt, spec.pts_sprint, spec.pts_climber, spec.pts_hills, 1)
    : 1;

  const top10Results = details.historicalResults.filter((r) => r.position <= 10);
  const showResults = details.historicalResults.slice(0, 8);

  return (
    <div
      className="grid gap-5 px-6 py-5"
      style={{
        backgroundColor: "rgba(17,17,24,0.7)",
        borderTop: "1px solid var(--c-border)",
        gridTemplateColumns: "1fr 1fr 1fr",
      }}
    >
      {/* Historical results */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--c-muted)" }}>
          Historiske resultater
        </p>
        {showResults.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--c-muted)" }}>Ingen data</p>
        ) : (
          <div className="space-y-1">
            {showResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{
                    backgroundColor: r.position <= 3 ? "rgba(245,158,11,0.2)" : r.position <= 10 ? "rgba(59,130,246,0.15)" : "var(--c-border)",
                    color: r.position <= 3 ? "var(--c-amber)" : r.position <= 10 ? "var(--c-blue)" : "var(--c-muted)",
                  }}
                >
                  {r.position}
                </span>
                <span className="truncate" style={{ color: "var(--c-text)" }}>{r.race_name}</span>
                <span className="ml-auto shrink-0" style={{ color: "var(--c-muted)" }}>{r.year}</span>
              </div>
            ))}
            {top10Results.length > 0 && (
              <p className="text-[10px] mt-2" style={{ color: "var(--c-muted)" }}>
                {top10Results.length} top-10 resultater på dette profil
              </p>
            )}
          </div>
        )}
      </div>

      {/* PCS freshness + last race */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--c-muted)" }}>
          PCS form
        </p>
        <div className="space-y-2">
          {details.days_since_race !== null && (
            <div className="flex items-center gap-2">
              <FreshnessCell days={details.days_since_race} />
              <span className="text-xs" style={{ color: "var(--c-muted)" }}>siden seneste løb</span>
            </div>
          )}
          {details.last_race_name && (
            <div className="text-xs" style={{ color: "var(--c-text)" }}>
              <span style={{ color: "var(--c-muted)" }}>Seneste: </span>
              {details.last_race_name}
              {details.last_race_pos && (
                <span className="ml-1 font-semibold" style={{ color: "var(--c-blue)" }}>#{details.last_race_pos}</span>
              )}
            </div>
          )}
          <div className="text-xs flex items-center gap-2">
            <span style={{ color: "var(--c-muted)" }}>Form kilde:</span>
            {rider.form_source === "holdet" && (
              <span className="font-medium" style={{ color: "var(--c-green)" }}>Holdet</span>
            )}
            {rider.form_source === "pcs" && (
              <span className="font-medium" style={{ color: "var(--c-amber)" }}>PCS (fallback)</span>
            )}
            {rider.form_source === "none" && (
              <span style={{ color: "var(--c-muted)" }}>Ingen data</span>
            )}
          </div>
        </div>
      </div>

      {/* Specialty scores */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--c-muted)" }}>
          Specialiteter (PCS)
        </p>
        {spec ? (
          <div className="space-y-1.5">
            <SpecialtyBar label="One-day" value={spec.pts_oneday}  max={specMax} />
            <SpecialtyBar label="GC"      value={spec.pts_gc}       max={specMax} />
            <SpecialtyBar label="Sprint"  value={spec.pts_sprint}   max={specMax} />
            <SpecialtyBar label="Climber" value={spec.pts_climber}  max={specMax} />
            <SpecialtyBar label="Puncheur" value={spec.pts_hills}   max={specMax} />
            <SpecialtyBar label="TT"      value={spec.pts_tt}       max={specMax} />
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--c-muted)" }}>Ingen PCS-data</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flag helpers
// ---------------------------------------------------------------------------

const FLAG_SORT: Record<RiderAnalysis["form_flag"], number> = { new: 0, red: 1, yellow: 2, green: 3 };

const FLAG_BORDER: Record<RiderAnalysis["form_flag"], string> = {
  green: "var(--c-green)", red: "var(--c-red)", yellow: "transparent", new: "transparent",
};

function formScoreStyle(flag: RiderAnalysis["form_flag"]): React.CSSProperties {
  if (flag === "green") return { color: "var(--c-green)", fontWeight: 600 };
  if (flag === "red")   return { color: "var(--c-red)" };
  return { color: "var(--c-text)" };
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface Column {
  key: string;
  label: string;
  title?: string;
  sortValue: (r: RiderAnalysis) => number | string;
  render: (r: RiderAnalysis) => React.ReactNode;
  align: "left" | "right" | "center";
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Rytter",
    sortValue: (r) => r.rider.full_name,
    render: (r) => <span className="font-medium text-sm" style={{ color: "var(--c-text)" }}>{r.rider.full_name}</span>,
    align: "left",
  },
  {
    key: "team",
    label: "Hold",
    sortValue: (r) => r.rider.team_abbr,
    render: (r) => <span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr}</span>,
    align: "left",
  },
  {
    key: "category",
    label: "Kat.",
    title: "Kategori (1 = dyreste)",
    sortValue: (r) => r.rider.category_nr,
    render: (r) => <span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.rider.category_nr}</span>,
    align: "center",
  },
  {
    key: "total_score",
    label: "Score",
    title: "Total score = Profil×40% + Form×40% + Value×20% — farver: blå=profil, grøn=form, gul=value",
    sortValue: (r) => r.total_score,
    render: (r) => <SegmentedScoreBar r={r} />,
    align: "left",
  },
  {
    key: "specialty",
    label: "Specialitet",
    title: "Stærkeste PCS-specialitet for denne rytter",
    sortValue: (r) => r.top_specialty ?? "",
    render: (r) => <SpecialtyBadge label={r.top_specialty} />,
    align: "left",
  },
  {
    key: "days_since_race",
    label: "Frisk.",
    title: "Dage siden seneste løb (fra PCS). Grøn < 15d, amber 15-29d, rød 30+d.",
    sortValue: (r) => r.days_since_race ?? 999,
    render: (r) => <FreshnessCell days={r.days_since_race} />,
    align: "center",
  },
  {
    key: "form_score",
    label: "Form",
    title: "Holdet-formscore: seneste×3 + næstsidste×2 + tredje×1",
    sortValue: (r) => r.form_score_norm,
    render: (r) => (
      <span className="text-sm tabular-nums flex items-center" style={formScoreStyle(r.form_flag)}>
        {r.form_score_norm > 0 ? r.form_score_norm.toFixed(1) : (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-normal" style={{ backgroundColor: "var(--c-border)", color: "var(--c-muted)" }}>
            Ingen data
          </span>
        )}
        <FormSourceBadge source={r.form_source} />
      </span>
    ),
    align: "right",
  },
  {
    key: "latest_points",
    label: "Seneste",
    title: "Point i seneste after-snapshot",
    sortValue: (r) => r.latest_points,
    render: (r) => (
      <span className="text-sm tabular-nums" style={{ color: r.latest_points > 0 ? "var(--c-text)" : "var(--c-border)" }}>
        {r.latest_points > 0 ? r.latest_points : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "popularity",
    label: "Pop.",
    title: "% af fantasy-hold der ejer rytteren",
    sortValue: (r) => r.popularity,
    render: (r) => (
      <span className="text-xs tabular-nums" style={{ color: "var(--c-muted)" }}>
        {r.popularity > 0 ? (r.popularity * 100).toFixed(1) + "%" : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "ppp",
    label: "Pts/Pop",
    title: "Point per popularitetsenhed",
    sortValue: (r) => r.points_per_popularity,
    render: (r) => (
      <span className="text-xs tabular-nums" style={{ color: r.points_per_popularity > 0 ? "var(--c-green)" : "var(--c-border)" }}>
        {r.points_per_popularity > 0 ? r.points_per_popularity.toFixed(1) : "—"}
      </span>
    ),
    align: "right",
  },
  {
    key: "flag",
    label: "",
    title: "Formstatus",
    sortValue: (r) => FLAG_SORT[r.form_flag],
    render: (r) => {
      if (r.form_flag === "new") return <span className="text-xs" style={{ color: "var(--c-muted)" }}>Ny</span>;
      return <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: FLAG_BORDER[r.form_flag] || "var(--c-muted)" }} />;
    },
    align: "center",
  },
];

// ---------------------------------------------------------------------------
// Insight cards
// ---------------------------------------------------------------------------

function InsightCard({
  icon, label, riders, metric, color,
}: {
  icon: string;
  label: string;
  riders: RiderAnalysis[];
  metric: (r: RiderAnalysis) => string;
  color: string;
}) {
  return (
    <div
      className="flex-1 min-w-[200px] rounded-xl px-5 py-4 space-y-3"
      style={{ backgroundColor: "var(--c-surface)", border: `1px solid ${color}33` }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
        {icon} {label}
      </p>
      <div className="space-y-2.5">
        {riders.map((r, i) => (
          <div key={r.rider.id} className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="text-[11px] tabular-nums font-bold w-4 shrink-0 text-center"
                style={{ color: i === 0 ? color : "var(--c-muted)" }}
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--c-text)" }}>{r.rider.full_name}</p>
                <p className="text-[10px]" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr} · Kat. {r.rider.category_nr}</p>
              </div>
            </div>
            <span className="text-sm tabular-nums shrink-0 font-bold" style={{ color }}>{metric(r)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table header
// ---------------------------------------------------------------------------

function Th({ col, active, dir, onClick }: { col: Column; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th
      onClick={onClick}
      title={col.title}
      className="px-3 py-2.5 cursor-pointer select-none whitespace-nowrap transition-colors"
      style={{
        textAlign: col.align === "center" ? "center" : col.align === "right" ? "right" : "left",
        color: active ? "var(--c-blue)" : "var(--c-muted)",
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        backgroundColor: "var(--c-surface)",
      }}
    >
      {col.label}
      {active && <span className="ml-1 opacity-60">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RacePreviewClient({ races }: { races: Race[] }) {
  const [selectedRace, setSelectedRace] = useState(races[0]?.slug ?? "");
  const [riders, setRiders] = useState<RiderAnalysis[]>([]);
  const [riderDetails, setRiderDetails] = useState<Record<number, RiderDetails>>({});
  const [raceProfile, setRaceProfile] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("total_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedRiderId, setExpandedRiderId] = useState<number | null>(null);

  const selectedRaceObj = races.find((r) => r.slug === selectedRace) ?? null;

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const col = COLUMNS.find((c) => c.key === key);
      const sample = riders.length ? col?.sortValue(riders[0]) : 0;
      setSortDir(typeof sample === "number" ? "desc" : "asc");
    }
  }

  const col = COLUMNS.find((c) => c.key === sortKey);
  const sorted = col
    ? [...riders].sort((a, b) => {
        const va = col.sortValue(a), vb = col.sortValue(b);
        if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      })
    : riders;

  const fetchRiders = useCallback(async (race: string) => {
    if (!race) return;
    setLoading(true); setError(null); setMessage(null); setRiders([]); setRiderDetails({}); setExpandedRiderId(null);
    try {
      const res = await fetch(`/api/race-preview?race=${encodeURIComponent(race)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ukendt fejl"); return; }
      setRiders(data.riders ?? []);
      setRiderDetails(data.riderDetails ?? {});
      setRaceProfile(data.raceProfile ?? null);
      if (data.message) setMessage(data.message);
    } catch { setError("Netværksfejl — kunne ikke hente data."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRiders(selectedRace); }, [selectedRace, fetchRiders]);

  const withData = riders.filter((r) => r.total_score > 0);
  const topProfile = [...withData].sort((a, b) => b.profile_score - a.profile_score).slice(0, 3);
  const topForm    = [...withData].sort((a, b) => b.form_score_norm - a.form_score_norm).filter((r) => r.form_score_norm > 0).slice(0, 3);
  const topValue   = [...withData].sort((a, b) => b.points_per_popularity - a.points_per_popularity).filter((r) => r.points_per_popularity > 0).slice(0, 3);

  return (
    <div className="px-8 py-9 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>Race Preview</h1>
          <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>Startliste rangeret efter samlet model-score · klik en rytter for detaljer</p>
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
            {races.map((r) => <option key={r.slug} value={r.slug}>{r.name} ({r.year})</option>)}
          </select>
        </div>
      </div>

      {/* Race profile info strip */}
      {selectedRaceObj?.profile && !loading && (
        <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--c-muted)" }}>
          {selectedRaceObj.distance_km && (
            <span><span style={{ color: "var(--c-text)" }} className="font-medium">{selectedRaceObj.distance_km}</span> km</span>
          )}
          {selectedRaceObj.elevation_m && (
            <span><span style={{ color: "var(--c-text)" }} className="font-medium">{selectedRaceObj.elevation_m.toLocaleString("da-DK")}</span> m stigning</span>
          )}
          {raceProfile && (
            <span>Profil: <span style={{ color: "var(--c-text)" }} className="font-medium">{PROFILE_LABELS[raceProfile] ?? raceProfile}</span></span>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 py-16 justify-center text-sm" style={{ color: "var(--c-muted)" }}>
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Henter data…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--c-red)" }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && message && riders.length === 0 && (
        <div className="py-16 text-center text-sm" style={{ color: "var(--c-muted)" }}>{message}</div>
      )}

      {/* Insight cards */}
      {!loading && riders.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {topProfile.length > 0 && (
            <InsightCard icon="🏆" label="Bedste profil-match" riders={topProfile} metric={(r) => r.profile_score.toFixed(1)} color="var(--c-blue)" />
          )}
          {topForm.length > 0 && (
            <InsightCard icon="📈" label="Bedste aktuelle form" riders={topForm} metric={(r) => r.form_score_norm.toFixed(1)} color="var(--c-green)" />
          )}
          {topValue.length > 0 && (
            <InsightCard icon="💎" label="Bedste value" riders={topValue} metric={(r) => r.points_per_popularity.toFixed(1)} color="var(--c-amber)" />
          )}
        </div>
      )}

      {/* Stats bar */}
      {riders.length > 0 && !loading && (
        <div className="flex gap-5 text-xs" style={{ color: "var(--c-muted)" }}>
          <span><span style={{ color: "var(--c-text)" }} className="font-medium">{riders.length}</span> ryttere</span>
          <span>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: "var(--c-green)" }} />
            {riders.filter((r) => r.form_flag === "green").length} fremgang
          </span>
          <span>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: "var(--c-red)" }} />
            {riders.filter((r) => r.form_flag === "red").length} tilbagegang
          </span>
          <span>{riders.filter((r) => r.form_flag === "new").length} ingen Holdet-data</span>
          {riders.filter((r) => r.form_source === "pcs").length > 0 && (
            <span>{riders.filter((r) => r.form_source === "pcs").length} med PCS form-fallback</span>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-[3px] p-0" style={{ backgroundColor: "var(--c-surface)" }} />
                <th className="px-3 py-2.5 w-9 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)", backgroundColor: "var(--c-surface)" }}>#</th>
                {COLUMNS.map((c) => <Th key={c.key} col={c} active={sortKey === c.key} dir={sortDir} onClick={() => toggleSort(c.key)} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const isExpanded = expandedRiderId === r.rider.id;
                return (
                  <React.Fragment key={r.rider.id}>
                    <tr
                      className="transition-colors cursor-pointer"
                      style={{
                        borderTop: "1px solid var(--c-border)",
                        backgroundColor: isExpanded ? "rgba(59,130,246,0.06)" : "transparent",
                      }}
                      onClick={() => setExpandedRiderId(isExpanded ? null : r.rider.id)}
                      onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                      onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <td className="p-0 w-[3px]" style={{ backgroundColor: FLAG_BORDER[r.form_flag] }} />
                      <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: "var(--c-border)" }}>{i + 1}</td>
                      {COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className="px-3 py-2.5"
                          style={{
                            textAlign: c.align === "center" ? "center" : c.align === "right" ? "right" : "left",
                            backgroundColor: sortKey === c.key ? "rgba(59,130,246,0.04)" : undefined,
                          }}
                        >
                          {c.render(r)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr key={`${r.rider.id}-expanded`} style={{ borderTop: "none" }}>
                        <td colSpan={COLUMNS.length + 2} className="p-0">
                          <RiderExpansionPanel rider={r} details={riderDetails[r.rider.id]} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-5 text-xs pt-1" style={{ color: "var(--c-muted)" }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-[3px] h-3 rounded-sm" style={{ backgroundColor: "var(--c-green)" }} />
            Seneste ≥ snit × 1,5
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-[3px] h-3 rounded-sm" style={{ backgroundColor: "var(--c-red)" }} />
            Seneste = 0 (DNS)
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span>Score-bar:</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />Profil</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#22c55e" }} />Form</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />Value</span>
          </span>
        </div>
      )}
    </div>
  );
}
