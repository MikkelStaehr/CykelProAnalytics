import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeAnalysis } from "@/lib/computeAnalysis";
import type { Rider, Snapshot, RiderAnalysis } from "@/lib/types";

/**
 * GET /api/analyse
 *
 * Returns RiderAnalysis[] for every rider that has at least one
 * after-snapshot with points > 0 — i.e. has actual race data.
 * Sorted by form_score descending.
 */
export async function GET() {
  const supabase = createServerClient();

  // 1. Find all rider_ids with at least one after-snapshot where points > 0
  const { data: scoringSnaps, error: snapErr1 } = await supabase
    .from("snapshots")
    .select("rider_id")
    .eq("snapshot", "after")
    .gt("points", 0);

  if (snapErr1) {
    return NextResponse.json({ error: snapErr1.message }, { status: 500 });
  }

  if (!scoringSnaps || scoringSnaps.length === 0) {
    return NextResponse.json({ riders: [], message: "Ingen ryttere har data endnu." });
  }

  const riderIds = [
    ...new Set((scoringSnaps as { rider_id: number }[]).map((s) => s.rider_id)),
  ];

  // 2. Fetch rider records for those IDs
  const { data: riderRows, error: riderErr } = await supabase
    .from("riders")
    .select("*")
    .in("id", riderIds);

  if (riderErr) {
    return NextResponse.json({ error: riderErr.message }, { status: 500 });
  }

  // 3. Fetch ALL snapshots for those riders (all races, both types)
  //    Needed for full history, popularity, and form score.
  const { data: snapshotRows, error: snapErr2 } = await supabase
    .from("snapshots")
    .select("*")
    .in("rider_id", riderIds)
    .limit(50000);

  if (snapErr2) {
    return NextResponse.json({ error: snapErr2.message }, { status: 500 });
  }

  // 4. Group snapshots by rider_id
  const snapshotsByRider = new Map<number, Snapshot[]>();
  for (const snap of (snapshotRows ?? []) as Snapshot[]) {
    if (!snapshotsByRider.has(snap.rider_id)) {
      snapshotsByRider.set(snap.rider_id, []);
    }
    snapshotsByRider.get(snap.rider_id)!.push(snap);
  }

  // 5. Compute metrics and sort
  const analyses: RiderAnalysis[] = (riderRows as Rider[] ?? []).map((rider) =>
    computeAnalysis(rider, snapshotsByRider.get(rider.id) ?? [])
  );

  analyses.sort((a, b) => b.form_score - a.form_score);

  return NextResponse.json({ riders: analyses });
}
