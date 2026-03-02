import type { Rider, Snapshot, RiderAnalysis } from "./types";

/**
 * Compute all analysis metrics for a single rider from their snapshots.
 *
 * Business rules (from CONTEXT.md):
 * - A rider "participated" in a race ONLY if points > 0 in the after-snapshot.
 * - Form score = latest × 3 + second latest × 2 + third latest × 1
 * - Trend = avg of last 3 races where points > 0
 * - Popularity = from the most recent snapshot (any type)
 * - Points per popularity = latest participated points / popularity
 */
export function computeAnalysis(rider: Rider, snapshots: Snapshot[]): RiderAnalysis {
  // All after-snapshots, sorted oldest → newest by fetched_at (chronological order).
  const afterAll = snapshots
    .filter((s) => s.snapshot === "after")
    .sort(
      (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
    );

  // Participated = after-snapshots where points > 0.
  const participated = afterAll.filter((s) => s.points > 0);

  // Most recent after-snapshot (may have points = 0 — e.g. DNS).
  const latestAfter = afterAll[afterAll.length - 1] ?? null;

  // Most recent snapshot of any type — used for current popularity figure.
  const latestAny = snapshots
    .slice()
    .sort(
      (a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
    )[0] ?? null;

  // --- Basic metrics ---
  const total_points = participated.reduce((sum, s) => sum + s.points, 0);
  const races_with_data = participated.length;
  const avg_points_per_race =
    races_with_data > 0 ? total_points / races_with_data : 0;

  const best = participated.reduce<Snapshot | null>(
    (b, s) => (b === null || s.points > b.points ? s : b),
    null
  );

  const latestParticipated = participated[participated.length - 1] ?? null;
  const latest_points = latestAfter?.points ?? 0;

  // --- Trend: avg of last 3 participated races ---
  const last3 = participated.slice(-3);
  const trend =
    last3.length > 0
      ? last3.reduce((sum, s) => sum + s.points, 0) / last3.length
      : 0;

  // --- Form score: latest×3 + second×2 + third×1 ---
  const [p1, p2, p3] = participated.slice(-3).reverse();
  const form_score =
    (p1?.points ?? 0) * 3 + (p2?.points ?? 0) * 2 + (p3?.points ?? 0) * 1;

  // --- Popularity & value ---
  const popularity = latestAny?.popularity ?? 0;
  const latestParticipatedPoints = latestParticipated?.points ?? 0;
  const points_per_popularity =
    popularity > 0 ? latestParticipatedPoints / popularity : 0;

  // --- Form flag ---
  let form_flag: RiderAnalysis["form_flag"];
  if (races_with_data === 0) {
    form_flag = "new";
  } else if (latest_points === 0) {
    form_flag = "red";
  } else if (latest_points >= avg_points_per_race * 1.5) {
    form_flag = "green";
  } else {
    form_flag = "yellow";
  }

  return {
    rider,
    total_points,
    races_with_data,
    avg_points_per_race,
    best_race: best ? { race: best.race, points: best.points } : null,
    latest_race: latestParticipated
      ? { race: latestParticipated.race, points: latestParticipated.points }
      : null,
    latest_points,
    trend,
    popularity,
    points_per_popularity,
    form_score,
    form_flag,
    form_source: form_score > 0 ? "holdet" : "none",
    // Score model — populated later by computeScores(); 0 / null until then
    profile_score: 0,
    specialty_score: 0,
    top_specialty: null,
    form_score_norm: 0,
    value_score: 0,
    total_score: 0,
    days_since_race: null,
  };
}
