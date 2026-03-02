/**
 * GET /api/profil?race=strade-bianche
 *
 * Returns:
 *   race        — race row (slug, name, profile, distance_km, elevation_m, profile_score)
 *   topRiders   — top 10 historical performers on this profile type, grouped by rider
 *                 (top10_count, best_position, raw_score, profile_score)
 *   startlist   — current startlist riders ranked by profile_score (if available)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { relatedProfiles, rawProfileScore } from "@/lib/computeScores";
import type { FormResult } from "@/lib/computeScores";
import type { Rider } from "@/lib/types";

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
    slug: string; name: string; profile: string | null;
    distance_km: number | null; elevation_m: number | null; profile_score: number | null;
  };
  const raceProfile: string | null = raceRow.profile ?? null;

  if (!raceProfile) {
    return NextResponse.json({
      race: raceRow, topRiders: [], startlist: [],
      message: "Ingen profil sat for dette løb — kør SQL-migration 0002.",
    });
  }

  // 2. Related form_race slugs
  const related = relatedProfiles(raceProfile);
  const { data: formRaceRows } = await supabase
    .from("form_races").select("slug").in("profile", related);

  const formRaceSlugs = (formRaceRows ?? []).map((r: { slug: string }) => r.slug);
  const validSlugs = new Set(formRaceSlugs);

  if (formRaceSlugs.length === 0) {
    return NextResponse.json({
      race: raceRow, topRiders: [], startlist: [],
      message: "Ingen historiske løb med denne profil i databasen.",
    });
  }

  // 3. All form_results for these form_races
  const { data: allFormResultRows } = await supabase
    .from("form_results")
    .select("rider_id, race_slug, year, position")
    .in("race_slug", formRaceSlugs);

  const allFormResults: FormResult[] = (allFormResultRows ?? []) as FormResult[];

  // 4. Group by rider: count top-10 finishes, best position, raw_score
  const riderStats = new Map<number, { top10_count: number; best_position: number; raw_score: number }>();
  for (const fr of allFormResults) {
    if (!riderStats.has(fr.rider_id)) {
      riderStats.set(fr.rider_id, { top10_count: 0, best_position: 999, raw_score: 0 });
    }
    const stats = riderStats.get(fr.rider_id)!;
    if (fr.position <= 10) stats.top10_count++;
    if (fr.position < stats.best_position) stats.best_position = fr.position;
  }

  // Compute raw_score for each rider
  for (const rid of riderStats.keys()) {
    riderStats.get(rid)!.raw_score = rawProfileScore(rid, allFormResults, validSlugs);
  }

  // 5. Sort: top10_count desc → best_position asc, take top 10
  const sortedRiderIds = [...riderStats.keys()]
    .filter((rid) => (riderStats.get(rid)?.top10_count ?? 0) > 0)
    .sort((a, b) => {
      const sa = riderStats.get(a)!;
      const sb = riderStats.get(b)!;
      if (sb.top10_count !== sa.top10_count) return sb.top10_count - sa.top10_count;
      return sa.best_position - sb.best_position;
    })
    .slice(0, 10);

  // 6. Fetch rider names
  const { data: riderRows } = await supabase
    .from("riders").select("id, full_name, team_abbr, category, category_nr")
    .in("id", sortedRiderIds);

  const riderMap = new Map<number, Pick<Rider, "id" | "full_name" | "team_abbr" | "category" | "category_nr">>();
  for (const r of (riderRows ?? []) as Pick<Rider, "id" | "full_name" | "team_abbr" | "category" | "category_nr">[]) {
    riderMap.set(r.id, r);
  }

  const topRiders = sortedRiderIds.map((rid) => {
    const r = riderMap.get(rid);
    const stats = riderStats.get(rid)!;
    return {
      rider_id: rid,
      name: r?.full_name ?? `Rytter #${rid}`,
      team: r?.team_abbr ?? "—",
      category_nr: r?.category_nr ?? 0,
      top10_count: stats.top10_count,
      best_position: stats.best_position,
      raw_score: stats.raw_score,
      profile_score: 0, // populated below
    };
  });

  // Normalize profile scores
  const normScores = normalizeToHundred(topRiders.map((r) => r.raw_score));
  topRiders.forEach((r, i) => { r.profile_score = Math.round(normScores[i] * 10) / 10; });

  // 7. Current startlist
  const { data: startlistRows } = await supabase
    .from("startlists").select("rider_id").eq("race", raceSlug);
  const startlistIds = (startlistRows ?? []).map((r: { rider_id: number }) => r.rider_id);

  let startlist: Array<{
    rider_id: number; name: string; team: string; category_nr: number;
    raw_score: number; profile_score: number; popularity: number;
  }> = [];

  if (startlistIds.length > 0) {
    const [slRiderRes, slSnapRes, slFrRes] = await Promise.all([
      supabase.from("riders").select("id, full_name, team_abbr, category, category_nr").in("id", startlistIds),
      supabase.from("snapshots").select("rider_id, popularity, fetched_at").in("rider_id", startlistIds).order("fetched_at", { ascending: false }),
      supabase.from("form_results").select("rider_id, race_slug, year, position").in("rider_id", startlistIds).in("race_slug", formRaceSlugs),
    ]);

    const latestPop = new Map<number, number>();
    for (const s of (slSnapRes.data ?? []) as { rider_id: number; popularity: number }[]) {
      if (!latestPop.has(s.rider_id)) latestPop.set(s.rider_id, s.popularity);
    }

    const slFormResults: FormResult[] = (slFrRes.data ?? []) as FormResult[];
    const slRiders = (slRiderRes.data ?? []) as Pick<Rider, "id" | "full_name" | "team_abbr" | "category" | "category_nr">[];
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

  return NextResponse.json({ race: raceRow, topRiders, startlist });
}
