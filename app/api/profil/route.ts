/**
 * GET /api/profil?race=strade-bianche
 *
 * Returns:
 *   race        — race row (slug, name, profile, distance_km, elevation_m, profile_score)
 *   topRiders   — all-time top performers on this profile (normalized profile_score 0-100)
 *   startlist   — current startlist riders ranked by profile_score (if available)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { relatedProfiles, rawProfileScore } from "@/lib/computeScores";
import type { FormResult } from "@/lib/computeScores";
import type { Rider } from "@/lib/types";

// ---- normalize helper (same as computeScores) ----
function normalizeToHundred(values: number[]): number[] {
  if (values.length === 0) return [];
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  if (mx === mn) return values.map(() => 50);
  return values.map((v) => ((v - mn) / (mx - mn)) * 100);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raceSlug = searchParams.get("race");

  if (!raceSlug) {
    return NextResponse.json({ error: "Missing query param: race" }, { status: 400 });
  }

  const supabase = createServerClient();

  // 1. Race info
  const { data: raceRows, error: raceErr } = await supabase
    .from("races")
    .select("slug, name, profile, distance_km, elevation_m, profile_score")
    .eq("slug", raceSlug)
    .limit(1);

  if (raceErr || !raceRows || raceRows.length === 0) {
    return NextResponse.json({ error: "Løb ikke fundet" }, { status: 404 });
  }

  const raceRow = raceRows[0] as {
    slug: string;
    name: string;
    profile: string | null;
    distance_km: number | null;
    elevation_m: number | null;
    profile_score: number | null;
  };
  const raceProfile: string | null = raceRow.profile ?? null;

  if (!raceProfile) {
    return NextResponse.json({
      race: raceRow,
      topRiders: [],
      startlist: [],
      message: "Ingen profil sat for dette løb — kør SQL-migration 0002.",
    });
  }

  // 2. Related form_race slugs
  const related = relatedProfiles(raceProfile);

  const { data: formRaceRows } = await supabase
    .from("form_races")
    .select("slug")
    .in("profile", related);

  const formRaceSlugs = (formRaceRows ?? []).map((r: { slug: string }) => r.slug);
  const validSlugs = new Set(formRaceSlugs);

  if (formRaceSlugs.length === 0) {
    return NextResponse.json({
      race: raceRow,
      topRiders: [],
      startlist: [],
      message: "Ingen historiske løb med denne profil i databasen.",
    });
  }

  // 3. All form_results for these form_races (for historic top-performer view)
  const { data: allFormResultRows } = await supabase
    .from("form_results")
    .select("rider_id, race_slug, year, position")
    .in("race_slug", formRaceSlugs);

  const allFormResults: FormResult[] = (allFormResultRows ?? []) as FormResult[];

  // 4. All riders who appear in these form_results
  const riderIdsInResults = [...new Set(allFormResults.map((r) => r.rider_id))];

  const { data: riderRows } = await supabase
    .from("riders")
    .select("id, full_name, team_abbr, category, category_nr")
    .in("id", riderIdsInResults);

  const riders = (riderRows ?? []) as Pick<Rider, "id" | "full_name" | "team_abbr" | "category" | "category_nr">[];

  // 5. Compute raw profile scores for all riders
  const rawScores = riders.map((r) => rawProfileScore(r.id, allFormResults, validSlugs));
  const normScores = normalizeToHundred(rawScores);

  const topRiders = riders
    .map((r, i) => ({
      rider_id: r.id,
      name: r.full_name,
      team: r.team_abbr,
      category_nr: r.category_nr,
      raw_score: rawScores[i],
      profile_score: Math.round(normScores[i] * 10) / 10,
    }))
    .sort((a, b) => b.raw_score - a.raw_score)
    .slice(0, 30);

  // 6. Current startlist for this race (if it exists)
  const { data: startlistRows } = await supabase
    .from("startlists")
    .select("rider_id")
    .eq("race", raceSlug);

  const startlistIds = (startlistRows ?? []).map((r: { rider_id: number }) => r.rider_id);

  let startlist: typeof topRiders = [];

  if (startlistIds.length > 0) {
    const { data: slRiderRows } = await supabase
      .from("riders")
      .select("id, full_name, team_abbr, category, category_nr")
      .in("id", startlistIds);

    const { data: slSnapRows } = await supabase
      .from("snapshots")
      .select("rider_id, popularity, fetched_at")
      .in("rider_id", startlistIds)
      .order("fetched_at", { ascending: false });

    // Latest popularity per rider
    const latestPop = new Map<number, number>();
    for (const s of (slSnapRows ?? []) as { rider_id: number; popularity: number; fetched_at: string }[]) {
      if (!latestPop.has(s.rider_id)) latestPop.set(s.rider_id, s.popularity);
    }

    // form_results for startlist riders
    const { data: slFrRows } = await supabase
      .from("form_results")
      .select("rider_id, race_slug, year, position")
      .in("rider_id", startlistIds)
      .in("race_slug", formRaceSlugs);

    const slFormResults: FormResult[] = (slFrRows ?? []) as FormResult[];

    const slRiders = (slRiderRows ?? []) as Pick<Rider, "id" | "full_name" | "team_abbr" | "category" | "category_nr">[];
    const slRaw = slRiders.map((r) => rawProfileScore(r.id, slFormResults, validSlugs));
    const slNorm = normalizeToHundred(slRaw);

    startlist = slRiders
      .map((r, i) => ({
        rider_id: r.id,
        name: r.full_name,
        team: r.team_abbr,
        category_nr: r.category_nr,
        raw_score: slRaw[i],
        profile_score: Math.round(slNorm[i] * 10) / 10,
        popularity: latestPop.get(r.id) ?? 0,
      }))
      .sort((a, b) => b.raw_score - a.raw_score);
  }

  return NextResponse.json({
    race: raceRow,
    topRiders,
    startlist,
  });
}
