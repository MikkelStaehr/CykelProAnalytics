import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import { computeScores, relatedProfiles } from "@/lib/computeScores";
import type { FormResult, RiderProfile } from "@/lib/computeScores";
import type { Rider, Snapshot, RiderAnalysis, Category } from "@/lib/types";

// ---------------------------------------------------------------------------
// Race calendar — must match page.tsx and CONTEXT.md
// ---------------------------------------------------------------------------

const RACE_CALENDAR = [
  { slug: "omloop-het-nieuwsblad", name: "Omloop Het Nieuwsblad" },
  { slug: "strade-bianche",        name: "Strade Bianche"        },
  { slug: "milano-sanremo",        name: "Milano-Sanremo"        },
  { slug: "e3-harelbeke",          name: "E3 Classic"            },
  { slug: "gent-wevelgem",         name: "Gent-Wevelgem"         },
  { slug: "dwars-door-vlaanderen", name: "Dwars door Vlaanderen" },
  { slug: "ronde-van-vlaanderen",  name: "Ronde van Vlaanderen"  },
  { slug: "paris-roubaix",         name: "Paris-Roubaix"         },
  { slug: "amstel-gold-race",      name: "Amstel Gold Race"      },
  { slug: "la-fleche-wallone",     name: "La Flèche Wallonne"    },
  { slug: "liege-bastogne-liege",  name: "Liège-Bastogne-Liège"  },
  { slug: "gp-quebec",             name: "GP Québec"             },
  { slug: "gp-montreal",           name: "GP Montréal"           },
] as const;

const PICKS: Record<Category, number> = {
  category_1: 2,
  category_2: 3,
  category_3: 3,
  category_4: 4,
};

const CAT_LABELS: Record<Category, string> = {
  category_1: "Kategori 1",
  category_2: "Kategori 2",
  category_3: "Kategori 3",
  category_4: "Kategori 4",
};

const CATEGORIES: Category[] = ["category_1", "category_2", "category_3", "category_4"];

// ---------------------------------------------------------------------------
// Pick logic — sort by total_score; fallback to popularity for new riders
// ---------------------------------------------------------------------------

function pickBest(riders: RiderAnalysis[], n: number): RiderAnalysis[] {
  return [...riders]
    .sort((a, b) => {
      const aHas = a.total_score > 0 || a.form_score > 0 || a.profile_score > 0;
      const bHas = b.total_score > 0 || b.form_score > 0 || b.profile_score > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) return b.total_score - a.total_score;
      return b.popularity - a.popularity;
    })
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FreshnessBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  const color =
    days <= 7  ? "var(--c-green)" :
    days <= 14 ? "var(--c-amber)" :
    "var(--c-red)";
  const hex = days <= 7 ? "#22c55e" : days <= 14 ? "#f59e0b" : "#ef4444";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{
        color,
        backgroundColor: `${hex}18`,
        border: `1px solid ${hex}40`,
      }}
      title={`${days} dage siden seneste løb`}
    >
      {days}d
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

function FormSourceBadge({ source }: { source: RiderAnalysis["form_source"] }) {
  if (source !== "pcs") return null;
  return (
    <span
      className="text-[9px] font-semibold px-1 py-0.5 rounded"
      style={{
        backgroundColor: "rgba(107,107,128,0.2)",
        color: "var(--c-muted)",
        border: "1px solid rgba(107,107,128,0.3)",
      }}
      title="Form-score baseret på PCS data (ingen Holdet-data)"
    >
      PCS
    </span>
  );
}

function RiderCard({ r }: { r: RiderAnalysis }) {
  const isGreen  = r.form_flag === "green";
  const isRed    = r.form_flag === "red";
  const total    = r.total_score;
  const hasScore = total > 0;

  const pPct = hasScore ? ((r.profile_score * 0.4) / total) * 100 : 0;
  const fPct = hasScore ? ((r.form_score_norm * 0.4) / total) * 100 : 0;
  const vPct = hasScore ? ((r.value_score * 0.2) / total) * 100 : 0;

  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        backgroundColor: "var(--c-bg)",
        border: "1px solid var(--c-border)",
        borderLeft: isGreen
          ? "3px solid var(--c-green)"
          : isRed
          ? "3px solid var(--c-red)"
          : "1px solid var(--c-border)",
      }}
    >
      <p className="text-sm font-medium leading-tight truncate" style={{ color: "var(--c-text)" }}>
        {r.rider.full_name}
      </p>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        <p className="text-[11px] truncate" style={{ color: "var(--c-muted)" }}>
          {r.rider.team_abbr}
        </p>
        {r.top_specialty && <SpecialtyBadge label={r.top_specialty} />}
      </div>

      {/* Freshness + form source + score row */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {r.days_since_race !== null && <FreshnessBadge days={r.days_since_race} />}
        <FormSourceBadge source={r.form_source} />
        <span className="ml-auto text-[11px] tabular-nums" style={{ color: "var(--c-muted)" }}>
          {r.popularity > 0 ? (r.popularity * 100).toFixed(1) + "%" : "—"}
        </span>
      </div>

      {/* Segmented score bar */}
      <div className="mt-2">
        {hasScore ? (
          <div
            className="flex items-center gap-1.5"
            title={`Total: ${total.toFixed(1)} | Profil: ${r.profile_score.toFixed(1)} | Form: ${r.form_score_norm.toFixed(1)} | Value: ${r.value_score.toFixed(1)}`}
          >
            <span className="text-sm font-semibold tabular-nums w-7 shrink-0" style={{ color: "var(--c-blue)" }}>
              {total.toFixed(1)}
            </span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--c-border)" }}>
              <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${total}%` }}>
                <div style={{ width: `${pPct}%`, backgroundColor: "#3b82f6" }} />
                <div style={{ width: `${fPct}%`, backgroundColor: "#22c55e" }} />
                <div style={{ width: `${vPct}%`, backgroundColor: "#f59e0b" }} />
              </div>
            </div>
          </div>
        ) : (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "var(--c-border)", color: "var(--c-muted)" }}
          >
            Ingen data
          </span>
        )}
      </div>
    </div>
  );
}

function CategoryColumn({ cat, riders }: { cat: Category; riders: RiderAnalysis[] }) {
  return (
    <div className="flex-1 min-w-0 space-y-2">
      <p
        className="text-[10px] font-semibold uppercase tracking-widest pb-1"
        style={{ color: "var(--c-muted)", borderBottom: "1px solid var(--c-border)" }}
      >
        {CAT_LABELS[cat]}
      </p>
      {riders.length > 0 ? (
        riders.map((r) => <RiderCard key={r.rider.id} r={r} />)
      ) : (
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>Ingen data</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main server component
// ---------------------------------------------------------------------------

export default async function SuggestedTeam() {
  const supabase = createServerClient();

  // --- Step 1: find races with a startlist ---
  const { data: startlistRaceRows } = await supabase.from("startlists").select("race");
  const startlistSlugs = new Set((startlistRaceRows ?? []).map((r: { race: string }) => r.race));
  if (startlistSlugs.size === 0) return null;

  // --- Step 2: find races with an after-snapshot ---
  const { data: afterRows } = await supabase.from("snapshots").select("race").eq("snapshot", "after");
  const afterSlugs = new Set((afterRows ?? []).map((r: { race: string }) => r.race));

  // --- Step 3: target race = first in calendar with startlist but no after-snap ---
  const target = RACE_CALENDAR.find((r) => startlistSlugs.has(r.slug) && !afterSlugs.has(r.slug));
  if (!target) return null;

  // --- Step 4: fetch rider IDs for this race's startlist ---
  const { data: startlistRows } = await supabase
    .from("startlists").select("rider_id").eq("race", target.slug);
  const riderIds = (startlistRows as { rider_id: number }[] ?? []).map((r) => r.rider_id);
  if (riderIds.length === 0) return null;

  // --- Step 5: fetch race profile + riders + snapshots + rider_profiles ---
  const [raceRes, ridersRes, snapsRes, profilesRes] = await Promise.all([
    supabase.from("races").select("profile").eq("slug", target.slug).single(),
    supabase.from("riders").select("*").in("id", riderIds),
    supabase.from("snapshots").select("*").in("rider_id", riderIds),
    supabase
      .from("rider_profiles")
      .select("rider_id, pts_oneday, pts_gc, pts_tt, pts_sprint, pts_climber, pts_hills, days_since_race")
      .in("rider_id", riderIds),
  ]);

  const raceProfile = (raceRes.data as { profile: string | null } | null)?.profile ?? null;
  const riders  = (ridersRes.data as Rider[]    ?? []);
  const snaps   = (snapsRes.data  as Snapshot[] ?? []);

  const riderProfileMap = new Map<number, RiderProfile>();
  for (const p of (profilesRes.data ?? []) as RiderProfile[]) {
    riderProfileMap.set(p.rider_id, p);
  }

  // --- Step 6: base analysis ---
  const snapshotsByRider = new Map<number, Snapshot[]>();
  for (const s of snaps) {
    if (!snapshotsByRider.has(s.rider_id)) snapshotsByRider.set(s.rider_id, []);
    snapshotsByRider.get(s.rider_id)!.push(s);
  }

  const analyses: RiderAnalysis[] = riders.map((rider) =>
    computeAnalysis(rider, snapshotsByRider.get(rider.id) ?? [])
  );

  // --- Step 7: fetch form data for scoring ---
  let validSlugs = new Set<string>();
  let formResults: FormResult[] = [];

  if (raceProfile) {
    const related = relatedProfiles(raceProfile);
    const { data: formRaceRows } = await supabase
      .from("form_races").select("slug").in("profile", related);
    const formRaceSlugs = (formRaceRows ?? []).map((r: { slug: string }) => r.slug);
    validSlugs = new Set(formRaceSlugs);

    if (formRaceSlugs.length > 0) {
      const { data: frRows } = await supabase
        .from("form_results")
        .select("rider_id, race_slug, year, position")
        .in("rider_id", riderIds)
        .in("race_slug", formRaceSlugs);
      formResults = (frRows ?? []) as FormResult[];
    }
  }

  // --- Step 8: compute scores (with freshness + specialty signals) ---
  computeScores(
    analyses,
    formResults,
    validSlugs,
    riderProfileMap.size > 0 ? riderProfileMap : undefined,
    raceProfile,
  );

  // --- Step 9: pick best per category ---
  const picks: Record<Category, RiderAnalysis[]> = {
    category_1: [],
    category_2: [],
    category_3: [],
    category_4: [],
  };

  for (const cat of CATEGORIES) {
    picks[cat] = pickBest(
      analyses.filter((r) => r.rider.category === cat),
      PICKS[cat]
    );
  }

  const allPicks = CATEGORIES.flatMap((c) => picks[c]);
  const totalScore = allPicks.reduce((sum, r) => sum + r.total_score, 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="rounded-xl px-6 py-5 space-y-4"
      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--c-muted)" }}>
          Foreslået Hold
        </p>
        <span className="text-xs font-medium" style={{ color: "var(--c-text)" }}>
          {target.name}
        </span>
      </div>

      {/* Legend for bars */}
      {totalScore > 0 && (
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--c-muted)" }}>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />Profil</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded-sm" style={{ backgroundColor: "#22c55e" }} />Form</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />Value</span>
        </div>
      )}

      {/* Category columns */}
      <div className="flex gap-3">
        {CATEGORIES.map((cat) => (
          <CategoryColumn key={cat} cat={cat} riders={picks[cat]} />
        ))}
      </div>

      {/* Footer */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 pt-3"
        style={{ borderTop: "1px solid var(--c-border)" }}
      >
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          Baseret på historisk data — ingen garanti 😉
        </p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--c-muted)" }}>
            Model total
          </span>
          <span className="text-lg font-bold tabular-nums" style={{ color: "var(--c-blue)" }}>
            {totalScore.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
