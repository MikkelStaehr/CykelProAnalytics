import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import { computeScores, relatedProfiles } from "@/lib/computeScores";
import type { FormResult, RiderProfile } from "@/lib/computeScores";
import type { Rider, Snapshot, RiderAnalysis } from "@/lib/types";

export interface HistoricalResult {
  race_name: string;
  race_slug: string;
  year: number;
  position: number;
}

export interface RiderDetails {
  historicalResults: HistoricalResult[];
  days_since_race: number | null;
  last_race_name: string | null;
  last_race_pos: string | null;
  specialty: {
    pts_oneday: number;
    pts_gc: number;
    pts_tt: number;
    pts_sprint: number;
    pts_climber: number;
    pts_hills: number;
  } | null;
}

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
      .select("rider_id, pts_oneday, pts_gc, pts_tt, pts_sprint, pts_climber, pts_hills, days_since_race, last_race_name, last_race_pos")
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
  const raceNameMap = new Map<string, string>();

  if (raceProfile) {
    const related = relatedProfiles(raceProfile);

    const { data: formRaceRows } = await supabase
      .from("form_races")
      .select("slug, name")
      .in("profile", related);

    const formRaceSlugs = (formRaceRows ?? []).map((r: { slug: string; name: string }) => {
      raceNameMap.set(r.slug, r.name);
      return r.slug;
    });
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

  // 9. Build per-rider details (historical results + profile data)
  const riderDetails: Record<number, RiderDetails> = {};

  for (const rid of riderIds) {
    const prof = riderProfileMap.get(rid);
    const riderFormResults = formResults
      .filter((fr) => fr.rider_id === rid)
      .map((fr) => ({
        race_name: raceNameMap.get(fr.race_slug) ?? fr.race_slug,
        race_slug: fr.race_slug,
        year: fr.year,
        position: fr.position,
      }))
      .sort((a, b) => b.year - a.year || a.position - b.position);

    riderDetails[rid] = {
      historicalResults: riderFormResults,
      days_since_race: prof?.days_since_race ?? null,
      last_race_name: prof?.last_race_name ?? null,
      last_race_pos: prof?.last_race_pos ?? null,
      specialty: prof
        ? {
            pts_oneday:  prof.pts_oneday,
            pts_gc:      prof.pts_gc,
            pts_tt:      prof.pts_tt,
            pts_sprint:  prof.pts_sprint,
            pts_climber: prof.pts_climber,
            pts_hills:   prof.pts_hills,
          }
        : null,
    };
  }

  return NextResponse.json({
    riders: analyses,
    raceProfile,
    riderProfilesLoaded: riderProfileMap.size,
    riderDetails,
  });
}
