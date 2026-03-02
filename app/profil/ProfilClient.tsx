"use client";

import { useState, useEffect, useCallback } from "react";
import type { Race } from "@/lib/types";

const PROFILE_LABELS: Record<string, string> = {
  flat: "Flad", cobbled: "Brosten", hilly: "Bakket", mixed: "Mixed", mountain: "Bjerg",
};

const PROFILE_COLORS: Record<string, string> = {
  flat: "#3b82f6", cobbled: "#f59e0b", hilly: "#22c55e", mixed: "#a78bfa", mountain: "#ef4444",
};

const PROFILE_DESCRIPTIONS: Record<string, string> = {
  flat:     "Spurterløb, minimal stigning. Milano-Sanremo, flad GT-etaper.",
  cobbled:  "Belgiske klassikere med brosten og korte stigninger. Omloop, RVV, E3, Roubaix.",
  hilly:    "Kuperet terræn, ingen langvarige stigninger. Amstel, Flèche, LBL, GP Québec.",
  mixed:    "Grus/grusveje + korte hårde stigninger. Strade Bianche.",
  mountain: "Langvarige stigninger, GT bjergetaper.",
};

interface TopRiderRow {
  rider_id: number;
  name: string;
  team: string;
  category_nr: number;
  top10_count: number;
  best_position: number;
  raw_score: number;
  profile_score: number;
}

interface StartlistRiderRow {
  rider_id: number;
  name: string;
  team: string;
  category_nr: number;
  raw_score: number;
  profile_score: number;
  popularity?: number;
}

interface ProfilData {
  race: {
    slug: string; name: string; profile: string | null;
    distance_km: number | null; elevation_m: number | null; profile_score: number | null;
  };
  topRiders: TopRiderRow[];
  startlist: StartlistRiderRow[];
  message?: string;
}

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

function ScoreBar({ value, maxRaw }: { value: number; maxRaw: number }) {
  const pct = maxRaw > 0 ? (value / maxRaw) * 100 : value;
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--c-border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(pct, 100)}%`, backgroundColor: "#a78bfa",
            boxShadow: pct > 70 ? "0 0 6px rgba(167,139,250,0.5)" : "none",
          }}
        />
      </div>
      <span className="text-xs tabular-nums w-8 text-right" style={{ color: "var(--c-muted)" }}>{value.toFixed(1)}</span>
    </div>
  );
}

function PositionBadge({ pos }: { pos: number }) {
  const bg = pos === 1 ? "rgba(245,158,11,0.2)" : pos <= 3 ? "rgba(59,130,246,0.15)" : "var(--c-border)";
  const color = pos === 1 ? "var(--c-amber)" : pos <= 3 ? "var(--c-blue)" : "var(--c-muted)";
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold shrink-0" style={{ backgroundColor: bg, color }}>
      {pos}
    </span>
  );
}

export default function ProfilClient({ races }: { races: Race[] }) {
  const [selectedRace, setSelectedRace] = useState(races[0]?.slug ?? "");
  const [data, setData] = useState<ProfilData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (race: string) => {
    if (!race) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`/api/profil?race=${encodeURIComponent(race)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Ukendt fejl"); return; }
      setData(json);
    } catch { setError("Netværksfejl — kunne ikke hente data."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(selectedRace); }, [selectedRace, fetchData]);

  const profile = data?.race.profile ?? null;

  return (
    <div className="px-8 py-9 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>Løbsprofil</h1>
          <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>Hvad slags rytter vinder dette løb?</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {profile && <ProfileBadge profile={profile} />}
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

      {loading && (
        <div className="flex items-center gap-2 py-20 justify-center text-sm" style={{ color: "var(--c-muted)" }}>
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Henter profil-data…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--c-red)" }}>
          {error}
        </div>
      )}

      {!loading && data?.message && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-muted)" }}>
          {data.message}
        </div>
      )}

      {/* Race info card */}
      {!loading && data && profile && (
        <div className="rounded-xl px-6 py-5 space-y-4" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--c-text)" }}>{data.race.name}</h2>
              <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>{PROFILE_DESCRIPTIONS[profile] ?? ""}</p>
            </div>
            <ProfileBadge profile={profile} />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            {data.race.distance_km && (
              <div>
                <span className="text-[10px] uppercase tracking-wider block" style={{ color: "var(--c-muted)" }}>Distance</span>
                <span className="font-semibold" style={{ color: "var(--c-text)" }}>{data.race.distance_km} km</span>
              </div>
            )}
            {data.race.elevation_m && (
              <div>
                <span className="text-[10px] uppercase tracking-wider block" style={{ color: "var(--c-muted)" }}>Stigning</span>
                <span className="font-semibold" style={{ color: "var(--c-text)" }}>{data.race.elevation_m.toLocaleString("da-DK")} m</span>
              </div>
            )}
            {data.race.profile_score && (
              <div>
                <span className="text-[10px] uppercase tracking-wider block" style={{ color: "var(--c-muted)" }}>Profil-score</span>
                <span className="font-semibold" style={{ color: "var(--c-text)" }}>{data.race.profile_score} / 100</span>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wider block" style={{ color: "var(--c-muted)" }}>Historiske ryttere</span>
              <span className="font-semibold" style={{ color: "var(--c-text)" }}>
                {data.topRiders.length > 0 ? `${data.topRiders.length} med top-10 finishes` : "Ingen endnu"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Top historical performers grouped by rider */}
      {!loading && data && data.topRiders.length > 0 && (
        <div>
          <div className="flex items-end justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>
              Historiske top-ryttere på dette profil (2023-2025)
            </p>
            <p className="text-[10px]" style={{ color: "var(--c-muted)" }}>Sorteret: antal top-10 finishes + bedste placering</p>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--c-surface)" }}>
                  <th className="px-3 py-2.5 w-9 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>#</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Rytter</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Hold</th>
                  <th className="px-3 py-2.5 text-center" title="Antal top-10 finishes på dette profil" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Top-10</th>
                  <th className="px-3 py-2.5 text-center" title="Bedste historiske placering" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Bedste</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Profil-score</th>
                </tr>
              </thead>
              <tbody>
                {data.topRiders.map((r, i) => (
                  <tr
                    key={r.rider_id}
                    className="transition-colors"
                    style={{ borderTop: "1px solid var(--c-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: "var(--c-border)" }}>{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium" style={{ color: "var(--c-text)" }}>{r.name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.team}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold"
                        style={{
                          backgroundColor: r.top10_count >= 3 ? "rgba(34,197,94,0.2)" : "rgba(59,130,246,0.12)",
                          color: r.top10_count >= 3 ? "var(--c-green)" : "var(--c-blue)",
                        }}
                      >
                        {r.top10_count}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <PositionBadge pos={r.best_position} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBar value={r.profile_score} maxRaw={100} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Startlist ranked by profile score */}
      {!loading && data && data.startlist.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--c-muted)" }}>
            Startliste — Rangeret efter profil score
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--c-surface)" }}>
                  <th className="px-3 py-2.5 w-9 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>#</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Rytter</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Hold</th>
                  <th className="px-3 py-2.5 text-center" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Kat.</th>
                  <th className="px-3 py-2.5 text-left" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Profil score</th>
                  <th className="px-3 py-2.5 text-right" style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)" }}>Pop.</th>
                </tr>
              </thead>
              <tbody>
                {data.startlist.map((r, i) => (
                  <tr
                    key={r.rider_id}
                    className="transition-colors"
                    style={{ borderTop: "1px solid var(--c-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: "var(--c-border)" }}>{i + 1}</td>
                    <td className="px-3 py-2.5"><span className="text-sm font-medium" style={{ color: "var(--c-text)" }}>{r.name}</span></td>
                    <td className="px-3 py-2.5"><span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.team}</span></td>
                    <td className="px-3 py-2.5 text-center"><span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.category_nr}</span></td>
                    <td className="px-3 py-2.5">
                      {r.raw_score > 0 ? (
                        <ScoreBar value={r.raw_score} maxRaw={data.startlist[0]?.raw_score ?? 1} />
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--c-border)", color: "var(--c-muted)" }}>Ingen data</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs tabular-nums" style={{ color: "var(--c-muted)" }}>
                        {(r.popularity ?? 0) > 0 ? ((r.popularity ?? 0) * 100).toFixed(1) + "%" : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data && data.startlist.length === 0 && !data.message && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-muted)" }}>
          Ingen startliste endnu — kør &apos;Fetch PCS Startlist&apos; i Admin.
        </div>
      )}
    </div>
  );
}
