import Link from "next/link";
import { Suspense } from "react";
import { createServerClient } from "@/lib/supabase";
import SuggestedTeam from "./SuggestedTeam";

const RACE_CALENDAR = [
  { slug: "omloop-het-nieuwsblad", name: "Omloop Het Nieuwsblad", short: "Omloop",   date: new Date("2026-03-01"), profile: "cobbled" },
  { slug: "strade-bianche",        name: "Strade Bianche",        short: "Strade",   date: new Date("2026-03-08"), profile: "mixed"   },
  { slug: "milano-sanremo",        name: "Milano-Sanremo",        short: "MSR",      date: new Date("2026-03-22"), profile: "flat"    },
  { slug: "e3-harelbeke",          name: "E3 Classic",            short: "E3",       date: new Date("2026-03-27"), profile: "cobbled" },
  { slug: "gent-wevelgem",         name: "Gent-Wevelgem",         short: "G-W",      date: new Date("2026-03-30"), profile: "cobbled" },
  { slug: "dwars-door-vlaanderen", name: "Dwars door Vlaanderen", short: "DdV",      date: new Date("2026-04-01"), profile: "cobbled" },
  { slug: "ronde-van-vlaanderen",  name: "Ronde van Vlaanderen",  short: "RvV",      date: new Date("2026-04-05"), profile: "cobbled" },
  { slug: "paris-roubaix",         name: "Paris-Roubaix",         short: "Roubaix",  date: new Date("2026-04-13"), profile: "cobbled" },
  { slug: "amstel-gold-race",      name: "Amstel Gold Race",      short: "Amstel",   date: new Date("2026-04-20"), profile: "hilly"   },
  { slug: "la-fleche-wallone",     name: "La Flèche Wallonne",    short: "Flèche",   date: new Date("2026-04-23"), profile: "hilly"   },
  { slug: "liege-bastogne-liege",  name: "Liège-Bastogne-Liège",  short: "LBL",      date: new Date("2026-04-27"), profile: "hilly"   },
  { slug: "gp-quebec",             name: "GP Québec",             short: "Québec",   date: new Date("2026-09-12"), profile: "hilly"   },
  { slug: "gp-montreal",           name: "GP Montréal",           short: "Montréal", date: new Date("2026-09-14"), profile: "hilly"   },
] as const;

const TOTAL_RACES = RACE_CALENDAR.length;

const PROFILE_COLORS: Record<string, string> = {
  flat: "#3b82f6", cobbled: "#f59e0b", hilly: "#22c55e", mixed: "#a78bfa", mountain: "#ef4444",
};

const PROFILE_LABELS: Record<string, string> = {
  flat: "Flad", cobbled: "Brosten", hilly: "Bakket", mixed: "Mixed", mountain: "Bjerg",
};

function ProfileBadge({ profile }: { profile: string }) {
  const color = PROFILE_COLORS[profile] ?? "#6b6b80";
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {PROFILE_LABELS[profile] ?? profile}
    </span>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString("da-DK", { day: "numeric", month: "long" });
}

function daysUntil(date: Date, today: Date) {
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

export default async function DashboardPage() {
  const supabase = createServerClient();
  const today = new Date();

  // Race completion data
  const { data: completedSnaps } = await supabase
    .from("snapshots").select("race").eq("snapshot", "after").gt("points", 0);

  // All after-snapshots for stat computation
  const { data: afterSnaps } = await supabase
    .from("snapshots")
    .select("rider_id, points, popularity, race, fetched_at")
    .eq("snapshot", "after")
    .gt("points", 0)
    .order("fetched_at", { ascending: true });

  const completedSlugs = new Set((completedSnaps ?? []).map((s: { race: string }) => s.race));
  const completedCount = RACE_CALENDAR.filter((r) => completedSlugs.has(r.slug)).length;
  const nextRace = RACE_CALENDAR.find((r) => r.date >= today && !completedSlugs.has(r.slug)) ?? null;
  const progressPct = Math.round((completedCount / TOTAL_RACES) * 100);

  // Build snapsByRider for form/season computations
  type MoverSnap = { rider_id: number; points: number; popularity: number; race: string; fetched_at: string };
  const snapsByRider = new Map<number, MoverSnap[]>();
  for (const s of (afterSnaps ?? []) as MoverSnap[]) {
    if (!snapsByRider.has(s.rider_id)) snapsByRider.set(s.rider_id, []);
    snapsByRider.get(s.rider_id)!.push(s);
  }

  // Sæsonleder: rider with highest total points
  let topTotalId: number | null = null;
  let topTotalPts = 0;
  for (const [rid, snaps] of snapsByRider.entries()) {
    const total = snaps.reduce((s, x) => s + x.points, 0);
    if (total > topTotalPts) { topTotalPts = total; topTotalId = rid; }
  }

  // Varmeste rytter: highest form_score (latest*3 + second*2 + third*1)
  let topFormId: number | null = null;
  let topFormScore = 0;
  for (const [rid, snaps] of snapsByRider.entries()) {
    const [p1, p2, p3] = snaps.slice(-3).reverse();
    const fs = (p1?.points ?? 0) * 3 + (p2?.points ?? 0) * 2 + (p3?.points ?? 0);
    if (fs > topFormScore) { topFormScore = fs; topFormId = rid; }
  }

  // Bedste value: highest pts/pop (latest points / latest popularity)
  let topValueId: number | null = null;
  let topValueRatio = 0;
  for (const [rid, snaps] of snapsByRider.entries()) {
    const latest = snaps[snaps.length - 1];
    if (latest && latest.popularity > 0) {
      const ratio = latest.points / latest.popularity;
      if (ratio > topValueRatio) { topValueRatio = ratio; topValueId = rid; }
    }
  }

  // Fetch rider names for stat cards + top movers
  const statIds = [...new Set([topTotalId, topFormId, topValueId].filter((id): id is number => id !== null))];
  const statRiders: Record<number, string> = {};
  if (statIds.length > 0) {
    const { data: statRows } = await supabase
      .from("riders").select("id, full_name").in("id", statIds);
    for (const r of (statRows ?? []) as { id: number; full_name: string }[]) {
      statRiders[r.id] = r.full_name;
    }
  }

  // Top movers
  const moverScores: Array<{ rider_id: number; delta: number; latest: number; race: string }> = [];
  for (const [rid, snaps] of snapsByRider.entries()) {
    if (snaps.length < 2) continue;
    const avg = snaps.reduce((s, x) => s + x.points, 0) / snaps.length;
    const last = snaps[snaps.length - 1];
    moverScores.push({ rider_id: rid, delta: last.points - avg, latest: last.points, race: last.race });
  }
  moverScores.sort((a, b) => b.delta - a.delta);
  const topMoverIds = moverScores.slice(0, 3).map((m) => m.rider_id);

  const moverRiders: Record<number, string> = {};
  if (topMoverIds.length > 0) {
    const { data: moverRows } = await supabase
      .from("riders").select("id, full_name").in("id", topMoverIds);
    for (const r of (moverRows ?? []) as { id: number; full_name: string }[]) {
      moverRiders[r.id] = r.full_name;
    }
  }

  const topMovers = moverScores.slice(0, 3).map((m) => ({
    ...m, name: moverRiders[m.rider_id] ?? statRiders[m.rider_id] ?? `Rytter #${m.rider_id}`,
  }));

  const hasSeasonData = snapsByRider.size > 0;

  return (
    <div className="px-8 py-9 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>
          Fantasy Cycling Tracker
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>
          Sæson 2026 · {TOTAL_RACES} klassikere
        </p>
      </div>

      {/* Meaningful stat cards (or fallback generic cards) */}
      <div className="grid grid-cols-3 gap-3">
        {hasSeasonData ? (
          <>
            <div className="rounded-xl px-5 py-4 space-y-1" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-muted)" }}>Sæsonleder</p>
              <p className="text-xs font-bold leading-snug truncate" style={{ color: "var(--c-text)" }}>
                {topTotalId ? statRiders[topTotalId] ?? "—" : "—"}
              </p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--c-blue)" }}>{Math.round(topTotalPts)}</p>
              <p className="text-xs" style={{ color: "var(--c-muted)" }}>sæsonpoints</p>
            </div>
            <div className="rounded-xl px-5 py-4 space-y-1" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-muted)" }}>Bedste value</p>
              <p className="text-xs font-bold leading-snug truncate" style={{ color: "var(--c-text)" }}>
                {topValueId ? statRiders[topValueId] ?? "—" : "—"}
              </p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--c-amber)" }}>{topValueRatio.toFixed(1)}</p>
              <p className="text-xs" style={{ color: "var(--c-muted)" }}>pts/pop</p>
            </div>
            <div className="rounded-xl px-5 py-4 space-y-1" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-muted)" }}>Varmeste rytter</p>
              <p className="text-xs font-bold leading-snug truncate" style={{ color: "var(--c-text)" }}>
                {topFormId ? statRiders[topFormId] ?? "—" : "—"}
              </p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--c-green)" }}>{Math.round(topFormScore)}</p>
              <p className="text-xs" style={{ color: "var(--c-muted)" }}>form-score</p>
            </div>
          </>
        ) : (
          <>
            {[
              { label: "Sæson fremgang", value: `${completedCount}/${TOTAL_RACES}`, sub: "løb afsluttet", color: "var(--c-blue)" },
              { label: "Status", value: `${progressPct}%`, sub: "af sæsonen", color: "var(--c-green)" },
              { label: "Klassikere", value: TOTAL_RACES, sub: "løb i alt", color: "var(--c-amber)" },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded-xl px-5 py-4" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-muted)" }}>{label}</p>
                <p className="text-3xl font-bold mt-1.5 tabular-nums" style={{ color }}>{value}</p>
                <p className="text-xs mt-1" style={{ color: "var(--c-muted)" }}>{sub}</p>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Next race card */}
      {nextRace ? (
        <div className="rounded-xl px-6 py-5" style={{ backgroundColor: "var(--c-surface)", border: "1px solid rgba(59,130,246,0.2)" }}>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--c-blue)" }}>Næste løb</p>
            <ProfileBadge profile={nextRace.profile} />
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-bold" style={{ color: "var(--c-text)" }}>{nextRace.name}</h2>
              <p className="text-sm mt-1" style={{ color: "var(--c-muted)" }}>{formatDate(nextRace.date)}</p>
            </div>
            <div className="text-right">
              {daysUntil(nextRace.date, today) <= 0 ? (
                <span className="text-lg font-bold" style={{ color: "var(--c-blue)" }}>I dag</span>
              ) : daysUntil(nextRace.date, today) === 1 ? (
                <span className="text-lg font-bold" style={{ color: "var(--c-blue)" }}>I morgen</span>
              ) : (
                <div>
                  <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--c-blue)" }}>
                    {daysUntil(nextRace.date, today)}
                  </span>
                  <span className="text-sm ml-1.5" style={{ color: "var(--c-muted)" }}>dage</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid var(--c-border)" }}>
            <span className="text-xs" style={{ color: "var(--c-muted)" }}>
              Løb #{RACE_CALENDAR.findIndex((r) => r.slug === nextRace.slug) + 1} af {TOTAL_RACES}
            </span>
            <Link
              href="/race-preview"
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{ backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "var(--c-blue)" }}
            >
              Se Race Preview →
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl px-6 py-5 text-center text-sm" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-muted)" }}>
          Alle {TOTAL_RACES} løb gennemført
        </div>
      )}

      {/* Suggested team */}
      <Suspense
        fallback={
          <div className="rounded-xl px-6 py-5 flex items-center gap-2 text-sm" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-muted)" }}>
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
            Beregner foreslået hold…
          </div>
        }
      >
        <SuggestedTeam />
      </Suspense>

      {/* Season timeline */}
      <div className="rounded-xl px-6 py-5 space-y-4" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>Sæsontidslinje</p>
          <p className="text-xs" style={{ color: "var(--c-muted)" }}>{completedCount} / {TOTAL_RACES} afsluttet</p>
        </div>
        <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--c-border)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: "var(--c-green)" }} />
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))" }}>
          {RACE_CALENDAR.map((race) => {
            const done = completedSlugs.has(race.slug);
            const isNext = nextRace?.slug === race.slug;
            const profileColor = PROFILE_COLORS[race.profile] ?? "#6b6b80";
            return (
              <div
                key={race.slug}
                className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-center"
                style={{
                  backgroundColor: isNext ? "rgba(59,130,246,0.06)" : "transparent",
                  border: isNext ? "1px solid rgba(59,130,246,0.2)" : "1px solid transparent",
                }}
                title={`${race.name} — ${formatDate(race.date)}`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: done ? profileColor : isNext ? "var(--c-blue)" : "var(--c-border)",
                    boxShadow: isNext ? "0 0 0 3px rgba(59,130,246,0.2)" : done ? `0 0 0 2px ${profileColor}30` : "none",
                  }}
                />
                <span
                  className="text-[9px] leading-tight font-medium"
                  style={{ color: isNext ? "var(--c-blue)" : done ? "var(--c-muted)" : "var(--c-border)" }}
                >
                  {race.short}
                </span>
                {isNext && (
                  <span className="text-[8px]" style={{ color: "var(--c-blue)" }}>
                    {daysUntil(race.date, today) <= 0 ? "Nu!" : `${daysUntil(race.date, today)}d`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top movers */}
      {topMovers.length > 0 && (
        <div className="rounded-xl px-6 py-5 space-y-4" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>Top movers</p>
          <div className="space-y-3">
            {topMovers.map((m, i) => (
              <div key={m.rider_id} className="flex items-center gap-3">
                <span className="text-[10px] tabular-nums w-4 text-right shrink-0" style={{ color: "var(--c-border)" }}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--c-text)" }}>{m.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--c-muted)" }}>{m.race}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--c-green)" }}>
                    {m.delta >= 0 ? "+" : ""}{m.delta.toFixed(0)} pts
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--c-muted)" }}>vs snit</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed races */}
      {completedCount > 0 && (
        <div className="rounded-xl px-6 py-5 space-y-3" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>Gennemførte løb</p>
          <div className="space-y-2.5">
            {RACE_CALENDAR.filter((r) => completedSlugs.has(r.slug)).map((race) => (
              <div key={race.slug} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PROFILE_COLORS[race.profile] ?? "var(--c-green)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--c-text)" }}>{race.name}</span>
                <ProfileBadge profile={race.profile} />
                <span className="text-xs ml-auto" style={{ color: "var(--c-muted)" }}>{formatDate(race.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
