import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import { computeScores, relatedProfiles } from "@/lib/computeScores";
import type { FormResult, RiderProfile } from "@/lib/computeScores";
import type { Rider, Snapshot, RiderAnalysis } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const race = searchParams.get("race");

  if (!race) {
    return NextResponse.json({ error: "Missing query param: race" }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Rider IDs on this race's startlist
  const { data: startlistRows, error: slError } = await supabase
    .from("startlists")
    .select("rider_id")
    .eq("race", race);

  if (slError) return NextResponse.json({ error: slError.message }, { status: 500 });

  if (!startlistRows || startlistRows.length === 0) {
    return NextResponse.json({
      riders: [],
      message: "Ingen startliste for dette løb — kør 'Fetch PCS Startlist' i Admin.",
    });
  }

  const riderIds = (startlistRows as { rider_id: number }[]).map((r) => r.rider_id);

  // 2. Fetch race profile + rider info + snapshots + rider_profiles in parallel
  const [raceRes, ridersRes, snapsRes, profilesRes] = await Promise.all([
    supabase.from("races").select("profile").eq("slug", race).single(),
    supabase.from("riders").select("*").in("id", riderIds),
    supabase.from("snapshots").select("*").in("rider_id", riderIds).limit(50000),
    supabase
      .from("rider_profiles")
      .select("rider_id, pts_oneday, pts_gc, pts_tt, pts_sprint, pts_climber, pts_hills, days_since_race")
      .in("rider_id", riderIds),
  ]);

  if (ridersRes.error) return NextResponse.json({ error: ridersRes.error.message }, { status: 500 });
  if (snapsRes.error)  return NextResponse.json({ error: snapsRes.error.message  }, { status: 500 });

  const raceProfile = (raceRes.data as { profile: string | null } | null)?.profile ?? null;

  // 3. Group snapshots by rider_id
  const snapshotsByRider = new Map<number, Snapshot[]>();
  for (const snap of (snapsRes.data ?? []) as Snapshot[]) {
    if (!snapshotsByRider.has(snap.rider_id)) snapshotsByRider.set(snap.rider_id, []);
    snapshotsByRider.get(snap.rider_id)!.push(snap);
  }

  // 4. Build rider profiles map (rider_id → RiderProfile)
  const riderProfileMap = new Map<number, RiderProfile>();
  for (const p of (profilesRes.data ?? []) as RiderProfile[]) {
    riderProfileMap.set(p.rider_id, p);
  }

  // 5. Base analysis (Holdet metrics)
  const analyses: RiderAnalysis[] = (ridersRes.data as Rider[] ?? []).map((rider) =>
    computeAnalysis(rider, snapshotsByRider.get(rider.id) ?? [])
  );

  // 6. Fetch form data for the race profile
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

  // 7. Compute scores (with rider profiles for freshness + specialty signals)
  computeScores(
    analyses,
    formResults,
    validSlugs,
    riderProfileMap.size > 0 ? riderProfileMap : undefined,
    raceProfile,
  );

  // 8. Sort by total_score descending
  analyses.sort((a, b) => b.total_score - a.total_score);

  return NextResponse.json({
    riders: analyses,
    raceProfile,
    riderProfilesLoaded: riderProfileMap.size,
  });
}
