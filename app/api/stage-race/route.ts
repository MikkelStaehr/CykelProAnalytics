import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import { computeScores, relatedProfiles } from "@/lib/computeScores";
import type { FormResult, RiderProfile } from "@/lib/computeScores";
import type { Rider, Snapshot, RiderAnalysis } from "@/lib/types";

// ---------------------------------------------------------------------------
// Budget optimizer — greedy knapsack with single-swap refinement
// ---------------------------------------------------------------------------

interface ScoredRider extends RiderAnalysis {
  price: number;
  is_out: boolean;
}

function budgetOptimizer(
  riders: ScoredRider[],
  budget: number,
  teamSize: number,
): ScoredRider[] {
  const eligible = riders
    .filter((r) => !r.is_out && r.price > 0 && r.total_score > 0)
    .map((r) => ({
      ...r,
      efficiency: r.total_score / (r.price / 1_000_000),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);

  // Greedy fill
  const team: ScoredRider[] = [];
  let spent = 0;
  for (const r of eligible) {
    if (team.length >= teamSize) break;
    if (spent + r.price <= budget) {
      team.push(r);
      spent += r.price;
    }
  }

  // Single-swap refinement
  const teamSet = new Set(team.map((r) => r.rider.id));
  const nonTeam = eligible.filter((r) => !teamSet.has(r.rider.id));

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < team.length; i++) {
      const out = team[i];
      const budgetAfterRemove = spent - out.price;
      for (const candidate of nonTeam) {
        if (teamSet.has(candidate.rider.id)) continue;
        if (budgetAfterRemove + candidate.price > budget) continue;
        if (candidate.total_score > out.total_score) {
          teamSet.delete(out.rider.id);
          teamSet.add(candidate.rider.id);
          team[i] = candidate;
          spent = budgetAfterRemove + candidate.price;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return team;
}

// ---------------------------------------------------------------------------
// GET /api/stage-race?race={slug}
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const race = searchParams.get("race");

  if (!race) {
    return NextResponse.json({ error: "Missing query param: race" }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Fetch race info (budget, profile, game_type)
  const { data: raceData, error: raceError } = await supabase
    .from("races")
    .select("slug, name, profile, budget, game_type")
    .eq("slug", race)
    .single();

  if (raceError || !raceData) {
    return NextResponse.json({ error: "Løb ikke fundet" }, { status: 404 });
  }

  const raceRow = raceData as { slug: string; name: string; profile: string | null; budget: number | null; game_type: string };
  const raceProfile: string | null = raceRow.profile ?? null;
  const budget: number = raceRow.budget ?? 50_000_000;

  // 2. Rider IDs on startlist
  const { data: startlistRows, error: slError } = await supabase
    .from("startlists")
    .select("rider_id")
    .eq("race", race);

  if (slError) return NextResponse.json({ error: slError.message }, { status: 500 });

  if (!startlistRows || startlistRows.length === 0) {
    return NextResponse.json({
      riders: [],
      suggestedTeam: [],
      budget,
      message: "Ingen startliste for dette løb — kør 'Fetch PCS Startlist' i Admin.",
    });
  }

  const riderIds = (startlistRows as { rider_id: number }[]).map((r) => r.rider_id);

  // 3. Fetch riders + all snapshots + rider_profiles
  const [ridersRes, snapsRes, profilesRes] = await Promise.all([
    supabase.from("riders").select("*").in("id", riderIds),
    supabase.from("snapshots").select("*").in("rider_id", riderIds).limit(50000),
    supabase
      .from("rider_profiles")
      .select("rider_id, pts_oneday, pts_gc, pts_tt, pts_sprint, pts_climber, pts_hills, days_since_race")
      .in("rider_id", riderIds),
  ]);

  if (ridersRes.error) return NextResponse.json({ error: ridersRes.error.message }, { status: 500 });
  if (snapsRes.error)  return NextResponse.json({ error: snapsRes.error.message  }, { status: 500 });

  const allSnaps = (snapsRes.data ?? []) as Snapshot[];

  // 4. Build per-rider snapshot groups + extract latest price/is_out from stage race snaps
  const snapshotsByRider = new Map<number, Snapshot[]>();
  const raceSnapsByRider = new Map<number, Snapshot[]>();

  for (const snap of allSnaps) {
    if (!snapshotsByRider.has(snap.rider_id)) snapshotsByRider.set(snap.rider_id, []);
    snapshotsByRider.get(snap.rider_id)!.push(snap);

    if (snap.race === race) {
      if (!raceSnapsByRider.has(snap.rider_id)) raceSnapsByRider.set(snap.rider_id, []);
      raceSnapsByRider.get(snap.rider_id)!.push(snap);
    }
  }

  // Latest price + is_out for this stage race (from most recent snapshot for this race)
  const priceMap = new Map<number, number>();
  const isOutMap = new Map<number, boolean>();
  for (const [riderId, snaps] of raceSnapsByRider.entries()) {
    const latest = snaps.sort(
      (a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
    )[0];
    priceMap.set(riderId, latest.price ?? 0);
    isOutMap.set(riderId, latest.is_out ?? false);
  }

  // 5. Rider profiles map
  const riderProfileMap = new Map<number, RiderProfile>();
  for (const p of (profilesRes.data ?? []) as RiderProfile[]) {
    riderProfileMap.set(p.rider_id, p);
  }

  // 6. Base analysis
  const analyses: RiderAnalysis[] = (ridersRes.data as Rider[] ?? []).map((rider) =>
    computeAnalysis(rider, snapshotsByRider.get(rider.id) ?? [])
  );

  // 7. Fetch form data for profile scoring
  let validSlugs = new Set<string>();
  let formResults: FormResult[] = [];

  if (raceProfile) {
    const related = relatedProfiles(raceProfile);
    const { data: formRaceRows } = await supabase
      .from("form_races")
      .select("slug")
      .in("profile", related);

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

  // 8. Compute scores
  computeScores(
    analyses,
    formResults,
    validSlugs,
    riderProfileMap.size > 0 ? riderProfileMap : undefined,
    raceProfile,
  );

  // 9. Attach price + is_out to each analysis for budget optimizer
  const scoredRiders: ScoredRider[] = analyses.map((r) => ({
    ...r,
    price: priceMap.get(r.rider.id) ?? 0,
    is_out: isOutMap.get(r.rider.id) ?? false,
  }));

  // Sort all riders by total_score desc
  scoredRiders.sort((a, b) => b.total_score - a.total_score);

  // 10. Run budget optimizer
  const suggestedTeam = budgetOptimizer(scoredRiders, budget, 9);
  const teamIds = new Set(suggestedTeam.map((r) => r.rider.id));
  const teamBudgetUsed = suggestedTeam.reduce((s, r) => s + r.price, 0);

  return NextResponse.json({
    riders: scoredRiders,
    suggestedTeam: suggestedTeam.map((r) => ({ ...r, inTeam: true })),
    budget,
    budgetUsed: teamBudgetUsed,
    teamIds: [...teamIds],
    raceProfile,
    riderProfilesLoaded: riderProfileMap.size,
  });
}
