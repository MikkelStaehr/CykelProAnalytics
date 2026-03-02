import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import AnalyseClient from "./AnalyseClient";
import type { Rider, Snapshot, RiderAnalysis } from "@/lib/types";

const RACE_CALENDAR_SLUGS = [
  "omloop-het-nieuwsblad", "strade-bianche", "milano-sanremo",
  "e3-harelbeke", "gent-wevelgem", "dwars-door-vlaanderen",
  "ronde-van-vlaanderen", "paris-roubaix", "amstel-gold-race",
  "la-fleche-wallone", "liege-bastogne-liege", "gp-quebec", "gp-montreal",
];

export default async function AnalysePage() {
  const supabase = createServerClient();

  // 1. Find rider_ids with at least one after-snapshot where points > 0
  const { data: scoringSnaps, error: err1 } = await supabase
    .from("snapshots")
    .select("rider_id")
    .eq("snapshot", "after")
    .gt("points", 0);

  if (err1) {
    return (
      <div className="px-6 py-10 text-red-400 text-sm">
        Databasefejl: {err1.message}
      </div>
    );
  }

  if (!scoringSnaps || scoringSnaps.length === 0) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-100">Analyse</h1>
        <p className="mt-4 text-gray-500 text-sm">
          Ingen ryttere har data endnu. Kør &quot;Fetch Holdet Snapshot (after)&quot; i Admin
          efter et løb er kørt.
        </p>
      </div>
    );
  }

  const riderIds = [
    ...new Set((scoringSnaps as { rider_id: number }[]).map((s) => s.rider_id)),
  ];

  // 2. Fetch rider records
  const { data: riderRows, error: err2 } = await supabase
    .from("riders")
    .select("*")
    .in("id", riderIds);

  if (err2) {
    return (
      <div className="px-6 py-10 text-red-400 text-sm">
        Databasefejl: {err2.message}
      </div>
    );
  }

  // 3. Fetch all snapshots for those riders (full history)
  const { data: snapshotRows, error: err3 } = await supabase
    .from("snapshots")
    .select("*")
    .in("rider_id", riderIds)
    .limit(50000);

  if (err3) {
    return (
      <div className="px-6 py-10 text-red-400 text-sm">
        Databasefejl: {err3.message}
      </div>
    );
  }

  // 4. Group snapshots by rider_id
  const snapshotsByRider = new Map<number, Snapshot[]>();
  for (const snap of (snapshotRows ?? []) as Snapshot[]) {
    if (!snapshotsByRider.has(snap.rider_id)) {
      snapshotsByRider.set(snap.rider_id, []);
    }
    snapshotsByRider.get(snap.rider_id)!.push(snap);
  }

  // 5. Compute metrics and sort by form_score desc
  const analyses: RiderAnalysis[] = (riderRows as Rider[] ?? [])
    .map((rider) => computeAnalysis(rider, snapshotsByRider.get(rider.id) ?? []))
    .sort((a, b) => b.form_score - a.form_score);

  // 6. Find next race startlist (first calendar race with startlist but no after-snapshot)
  const { data: startlistRaceRows } = await supabase.from("startlists").select("race");
  const startlistSlugs = new Set((startlistRaceRows ?? []).map((r: { race: string }) => r.race));
  const { data: afterRows } = await supabase.from("snapshots").select("race").eq("snapshot", "after");
  const afterSlugs = new Set((afterRows ?? []).map((r: { race: string }) => r.race));
  const nextRaceSlug = RACE_CALENDAR_SLUGS.find((s) => startlistSlugs.has(s) && !afterSlugs.has(s)) ?? null;

  let startlistIds: number[] = [];
  if (nextRaceSlug) {
    const { data: slRows } = await supabase
      .from("startlists").select("rider_id").eq("race", nextRaceSlug);
    startlistIds = (slRows ?? []).map((r: { rider_id: number }) => r.rider_id);
  }

  return <AnalyseClient initialRiders={analyses} startlistIds={startlistIds} />;
}
