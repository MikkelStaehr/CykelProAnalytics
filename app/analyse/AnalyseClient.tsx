"use client";

import { useState, useMemo } from "react";
import type { RiderAnalysis, Category } from "@/lib/types";

type SortDir = "asc" | "desc";

const TOTAL_CLASSICS = 13;

interface Column {
  key: string;
  label: string;
  title?: string;
  sortValue: (r: RiderAnalysis) => number | string;
  render: (r: RiderAnalysis) => React.ReactNode;
  align: "left" | "right" | "center";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLAG_SORT: Record<RiderAnalysis["form_flag"], number> = { new: 0, red: 1, yellow: 2, green: 3 };

const FLAG_BORDER: Record<RiderAnalysis["form_flag"], string> = {
  green:  "var(--c-green)",
  red:    "var(--c-red)",
  yellow: "transparent",
  new:    "transparent",
};

function formScoreStyle(flag: RiderAnalysis["form_flag"]): React.CSSProperties {
  if (flag === "green") return { color: "var(--c-green)", fontWeight: 600 };
  if (flag === "red")   return { color: "var(--c-red)" };
  return { color: "var(--c-text)" };
}

function fmt1(n: number) { return n === 0 ? "—" : n.toFixed(1); }
function fmt0(n: number) { return n === 0 ? "—" : String(Math.round(n)); }
function fmtPop(n: number) { return n === 0 ? "—" : (n * 100).toFixed(1) + "%"; }

const CAT_LABELS: Record<string, string> = {
  category_1: "Kat. 1", category_2: "Kat. 2", category_3: "Kat. 3", category_4: "Kat. 4",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SegmentedScoreBar({ r, compact = false }: { r: RiderAnalysis; compact?: boolean }) {
  const total = r.total_score;
  if (total <= 0) {
    return compact ? (
      <div className="w-16 h-1.5 rounded-full" style={{ backgroundColor: "var(--c-border)" }} />
    ) : (
      <div className="flex items-center gap-2 min-w-[80px]">
        <span className="text-sm tabular-nums w-8 text-right" style={{ color: "var(--c-border)" }}>—</span>
        <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: "var(--c-border)" }} />
      </div>
    );
  }
  const pPct = ((r.profile_score * 0.4) / total) * 100;
  const fPct = ((r.form_score_norm * 0.4) / total) * 100;
  const vPct = ((r.value_score * 0.2) / total) * 100;

  const bar = (
    <div
      className={`flex-1 rounded-full overflow-hidden relative ${compact ? "h-1.5" : "h-2"}`}
      style={{ backgroundColor: "var(--c-border)" }}
    >
      <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${total}%` }}>
        <div style={{ width: `${pPct}%`, backgroundColor: "#3b82f6" }} />
        <div style={{ width: `${fPct}%`, backgroundColor: "#22c55e" }} />
        <div style={{ width: `${vPct}%`, backgroundColor: "#f59e0b" }} />
      </div>
    </div>
  );

  if (compact) return <div className="w-16">{bar}</div>;

  return (
    <div
      className="flex items-center gap-2 min-w-[80px]"
      title={`Total: ${total.toFixed(1)} | Profil: ${r.profile_score.toFixed(1)} | Form: ${r.form_score_norm.toFixed(1)} | Value: ${r.value_score.toFixed(1)}`}
    >
      <span className="text-sm font-semibold tabular-nums w-8 text-right" style={{ color: "var(--c-text)" }}>
        {total.toFixed(1)}
      </span>
      {bar}
    </div>
  );
}

function SpecialtyBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-xs" style={{ color: "var(--c-border)" }}>—</span>;
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{
        backgroundColor: "rgba(129,140,248,0.12)",
        color: "#818cf8",
        border: "1px solid rgba(129,140,248,0.25)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function RacesDots({ count }: { count: number }) {
  return (
    <div
      className="flex items-center gap-0.5"
      title={`${count} af ${TOTAL_CLASSICS} løb med point`}
    >
      <span className="text-xs tabular-nums mr-1" style={{ color: "var(--c-text)" }}>{count}</span>
      <div className="flex gap-[2px]">
        {Array.from({ length: TOTAL_CLASSICS }).map((_, i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full"
            style={{ backgroundColor: i < count ? "var(--c-green)" : "var(--c-border)" }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Rytter",
    sortValue: (r) => r.rider.full_name,
    render: (r) => <span className="font-medium whitespace-nowrap text-sm" style={{ color: "var(--c-text)" }}>{r.rider.full_name}</span>,
    align: "left",
  },
  {
    key: "team",
    label: "Hold",
    sortValue: (r) => r.rider.team_abbr,
    render: (r) => <span className="text-xs whitespace-nowrap" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr}</span>,
    align: "left",
  },
  {
    key: "category",
    label: "Kat.",
    title: "Kategori — 1 er dyreste",
    sortValue: (r) => r.rider.category_nr,
    render: (r) => <span className="text-xs" style={{ color: "var(--c-muted)" }}>{r.rider.category_nr}</span>,
    align: "center",
  },
  {
    key: "races",
    label: "Løb",
    title: `Antal løb med point > 0 ud af ${TOTAL_CLASSICS}`,
    sortValue: (r) => r.races_with_data,
    render: (r) => <RacesDots count={r.races_with_data} />,
    align: "left",
  },
  {
    key: "total_score",
    label: "Score",
    title: "Total score: blå=Profil, grøn=Form, gul=Value",
    sortValue: (r) => r.total_score,
    render: (r) => <SegmentedScoreBar r={r} />,
    align: "left",
  },
  {
    key: "specialty",
    label: "Specialitet",
    title: "Stærkeste PCS-specialitet",
    sortValue: (r) => r.top_specialty ?? "",
    render: (r) => <SpecialtyBadge label={r.top_specialty} />,
    align: "left",
  },
  {
    key: "form_score",
    label: "Form",
    title: "Seneste×3 + næstsidste×2 + tredje×1",
    sortValue: (r) => r.form_score,
    render: (r) => (
      <span className="text-sm tabular-nums" style={formScoreStyle(r.form_flag)}>
        {r.form_score > 0 ? r.form_score : (
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--c-border)", color: "var(--c-muted)" }}>
            —
          </span>
        )}
      </span>
    ),
    align: "right",
  },
  {
    key: "latest_points",
    label: "Seneste",
    title: "Point i det seneste after-snapshot",
    sortValue: (r) => r.latest_points,
    render: (r) => (
      <span className="text-sm tabular-nums" style={{ color: r.latest_points > 0 ? "var(--c-text)" : "var(--c-border)" }}>
        {fmt0(r.latest_points)}
      </span>
    ),
    align: "right",
  },
  {
    key: "avg",
    label: "Gns.",
    title: "Gns. point pr. løb (kun > 0)",
    sortValue: (r) => r.avg_points_per_race,
    render: (r) => <span className="text-sm tabular-nums" style={{ color: "var(--c-muted)" }}>{fmt1(r.avg_points_per_race)}</span>,
    align: "right",
  },
  {
    key: "total",
    label: "Total",
    title: "Samlede point på sæsonen",
    sortValue: (r) => r.total_points,
    render: (r) => <span className="text-sm tabular-nums" style={{ color: "var(--c-muted)" }}>{fmt0(r.total_points)}</span>,
    align: "right",
  },
  {
    key: "trend",
    label: "Trend",
    title: "Gns. af 3 seneste løb med point > 0",
    sortValue: (r) => r.trend,
    render: (r) => <span className="text-sm tabular-nums" style={{ color: "var(--c-muted)" }}>{fmt1(r.trend)}</span>,
    align: "right",
  },
  {
    key: "popularity",
    label: "Pop.",
    title: "% af hold der ejer rytteren",
    sortValue: (r) => r.popularity,
    render: (r) => <span className="text-xs tabular-nums" style={{ color: "var(--c-muted)" }}>{fmtPop(r.popularity)}</span>,
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
    sortValue: (r) => FLAG_SORT[r.form_flag],
    render: (r) => {
      if (r.form_flag === "new") return <span className="text-xs" style={{ color: "var(--c-muted)" }}>Ny</span>;
      return (
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: FLAG_BORDER[r.form_flag] || "var(--c-muted)" }}
        />
      );
    },
    align: "center",
  },
];

// ---------------------------------------------------------------------------
// Table header cell
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
// Season Leaders card
// ---------------------------------------------------------------------------

function SeasonLeadersCard({
  title,
  accent,
  riders,
  metric,
  metricLabel,
}: {
  title: string;
  accent: string;
  riders: RiderAnalysis[];
  metric: (r: RiderAnalysis) => string;
  metricLabel: string;
}) {
  return (
    <div
      className="flex-1 min-w-[180px] rounded-xl p-4 space-y-3"
      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}
    >
      <div className="flex items-center gap-2">
        <span className="w-[3px] h-3.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>
          {title}
        </p>
      </div>
      {riders.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>Ikke nok data</p>
      ) : (
        <div className="space-y-3">
          {riders.map((r, i) => (
            <div key={r.rider.id}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] w-4 text-right shrink-0 tabular-nums" style={{ color: "var(--c-border)" }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--c-text)" }}>{r.rider.full_name}</p>
                  <p className="text-[10px] truncate" style={{ color: "var(--c-muted)" }}>{r.rider.team_abbr}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold tabular-nums" style={{ color: accent }}>{metric(r)}</p>
                  <p className="text-[10px]" style={{ color: "var(--c-muted)" }}>{metricLabel}</p>
                </div>
              </div>
              <SegmentedScoreBar r={r} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function AnalyseClient({
  initialRiders,
  startlistIds,
}: {
  initialRiders: RiderAnalysis[];
  startlistIds: number[];
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | "alle">("alle");
  const [sortKey, setSortKey] = useState("form_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterStartlist, setFilterStartlist] = useState(false);

  const startlistSet = useMemo(() => new Set(startlistIds), [startlistIds]);

  // Season Leaders — computed from all riders regardless of filter
  const topFremgang = useMemo(() =>
    [...initialRiders]
      .filter((r) => r.races_with_data >= 2)
      .map((r) => ({ r, delta: r.trend - r.avg_points_per_race }))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map(({ r }) => r),
    [initialRiders]
  );

  const topTilbagegang = useMemo(() =>
    [...initialRiders]
      .filter((r) => r.races_with_data >= 2)
      .sort((a, b) => (a.latest_points - a.avg_points_per_race) - (b.latest_points - b.avg_points_per_race))
      .slice(0, 3),
    [initialRiders]
  );

  const topValue = useMemo(() =>
    [...initialRiders]
      .filter((r) => r.points_per_popularity > 0)
      .sort((a, b) => b.points_per_popularity - a.points_per_popularity)
      .slice(0, 3),
    [initialRiders]
  );

  // Filtered + sorted table data
  const col = COLUMNS.find((c) => c.key === sortKey);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return initialRiders.filter((r) => {
      if (filterStartlist && !startlistSet.has(r.rider.id)) return false;
      if (category !== "alle" && r.rider.category !== category) return false;
      if (q && !r.rider.full_name.toLowerCase().includes(q) && !r.rider.team_abbr.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialRiders, search, category, filterStartlist, startlistSet]);

  const sorted = useMemo(() => {
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = col.sortValue(a), vb = col.sortValue(b);
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [filtered, col, sortDir]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const c = COLUMNS.find((cc) => cc.key === key);
      const sample = initialRiders.length ? c?.sortValue(initialRiders[0]) : 0;
      setSortDir(typeof sample === "number" ? "desc" : "asc");
    }
  }

  const cats: Array<Category | "alle"> = ["alle", "category_1", "category_2", "category_3", "category_4"];
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: initialRiders.length };
    for (const r of initialRiders) {
      counts[r.rider.category] = (counts[r.rider.category] ?? 0) + 1;
    }
    return counts;
  }, [initialRiders]);

  return (
    <div className="px-8 py-9 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>Analyse</h1>
        <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>
          {initialRiders.length} ryttere med mindst ét after-snapshot med points &gt; 0
        </p>
      </div>

      {/* Season Leaders */}
      {(topFremgang.length > 0 || topValue.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--c-muted)" }}>
            Sæsonledere
          </p>
          <div className="flex gap-3 flex-wrap">
            {topFremgang.length > 0 && (
              <SeasonLeadersCard
                title="Størst fremgang"
                accent="var(--c-green)"
                riders={topFremgang}
                metric={(r) => {
                  const d = r.trend - r.avg_points_per_race;
                  return (d >= 0 ? "+" : "") + d.toFixed(1);
                }}
                metricLabel="vs snit"
              />
            )}
            {topTilbagegang.length > 0 && (
              <SeasonLeadersCard
                title="Størst tilbagegang"
                accent="var(--c-red)"
                riders={topTilbagegang}
                metric={(r) => {
                  const d = r.latest_points - r.avg_points_per_race;
                  return (d >= 0 ? "+" : "") + d.toFixed(1);
                }}
                metricLabel="vs snit"
              />
            )}
            {topValue.length > 0 && (
              <SeasonLeadersCard
                title="Bedste value"
                accent="var(--c-blue)"
                riders={topValue}
                metric={(r) => r.points_per_popularity.toFixed(1)}
                metricLabel="pts/pop"
              />
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <input
          type="text"
          placeholder="Søg rytter eller hold…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm outline-none w-64"
          style={{
            backgroundColor: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            color: "var(--c-text)",
          }}
        />

        {/* Category buttons */}
        <div className="flex gap-1.5 flex-wrap">
          {cats.map((cat) => {
            const active = category === cat;
            const label = cat === "alle" ? "Alle" : CAT_LABELS[cat];
            const count = catCounts[cat] ?? 0;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: active ? "rgba(59,130,246,0.15)" : "var(--c-surface)",
                  border: `1px solid ${active ? "rgba(59,130,246,0.4)" : "var(--c-border)"}`,
                  color: active ? "var(--c-blue)" : "var(--c-muted)",
                }}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Startlist toggle */}
        {startlistIds.length > 0 && (
          <button
            onClick={() => setFilterStartlist((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              backgroundColor: filterStartlist ? "rgba(34,197,94,0.15)" : "var(--c-surface)",
              border: `1px solid ${filterStartlist ? "rgba(34,197,94,0.4)" : "var(--c-border)"}`,
              color: filterStartlist ? "var(--c-green)" : "var(--c-muted)",
            }}
          >
            {filterStartlist ? "Kun startliste" : "Alle ryttere"}
            {filterStartlist && <span className="ml-1 opacity-60">{startlistIds.length}</span>}
          </button>
        )}

        {/* Result count */}
        <span className="text-xs ml-auto" style={{ color: "var(--c-muted)" }}>
          {sorted.length} ryttere
        </span>
      </div>

      {/* Table */}
      {sorted.length > 0 ? (
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-[3px] p-0" style={{ backgroundColor: "var(--c-surface)" }} />
                <th
                  className="px-3 py-2.5 w-9 text-left"
                  style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-muted)", backgroundColor: "var(--c-surface)" }}
                >
                  #
                </th>
                {COLUMNS.map((c) => (
                  <Th key={c.key} col={c} active={sortKey === c.key} dir={sortDir} onClick={() => toggleSort(c.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.rider.id}
                  className="transition-colors"
                  style={{ borderTop: "1px solid var(--c-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <td className="p-0 w-[3px]" style={{ backgroundColor: FLAG_BORDER[r.form_flag] }} />
                  <td className="px-3 py-2 text-xs tabular-nums" style={{ color: "var(--c-border)" }}>{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-3 py-2"
                      style={{
                        textAlign: c.align === "center" ? "center" : c.align === "right" ? "right" : "left",
                        backgroundColor: sortKey === c.key ? "rgba(59,130,246,0.04)" : undefined,
                      }}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-16 text-center text-sm" style={{ color: "var(--c-muted)" }}>
          {initialRiders.length === 0 ? "Ingen ryttere med data endnu." : "Ingen ryttere matcher søgningen."}
        </div>
      )}

      {/* Legend */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-5 text-xs" style={{ color: "var(--c-muted)" }}>
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
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />Profil</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#22c55e" }} />Form</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />Value</span>
          </span>
        </div>
      )}
    </div>
  );
}
