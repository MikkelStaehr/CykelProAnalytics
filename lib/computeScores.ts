/**
 * computeScores.ts
 *
 * TypeScript mirror of score_riders.py scoring logic.
 * Mutates RiderAnalysis[] in-place to fill all score fields.
 *
 * Call order:
 *   1. computeAnalysis() per rider  → form_score (raw) is set
 *   2. computeScores(riders, formResults, validSlugs, riderProfiles?, raceProfile?)
 *      → normalizes + sets profile_score, specialty_score, form_score_norm,
 *        value_score, total_score, days_since_race
 */

import type { RiderAnalysis } from "./types";

// ---------------------------------------------------------------------------
// Profile groupings
// ---------------------------------------------------------------------------

export const PROFILE_GROUPS: Record<string, string[]> = {
  mixed:    ["mixed", "cobbled"],
  cobbled:  ["cobbled", "mixed"],
  hilly:    ["hilly"],
  flat:     ["flat"],
  mountain: ["mountain"],
};

export function relatedProfiles(profile: string | null | undefined): string[] {
  if (!profile) return [];
  return PROFILE_GROUPS[profile] ?? [profile];
}

// ---------------------------------------------------------------------------
// Rider profile data (mirrors rider_profiles table)
// ---------------------------------------------------------------------------

export interface RiderProfile {
  rider_id: number;
  pts_oneday: number;
  pts_gc: number;
  pts_tt: number;
  pts_sprint: number;
  pts_climber: number;
  pts_hills: number;
  days_since_race: number | null;
  last_race_pos: string | null;    // "1", "DNF", "DNS", etc. — from rider_profiles
  last_race_name: string | null;   // last race name — from rider_profiles
}

// Which specialty columns are relevant for each race profile.
type SpecialtyKey = "pts_oneday" | "pts_gc" | "pts_tt" | "pts_sprint" | "pts_climber" | "pts_hills";

const SPECIALTY_LABELS: Record<SpecialtyKey, string> = {
  pts_oneday:  "One-day",
  pts_gc:      "GC",
  pts_tt:      "TT",
  pts_sprint:  "Sprint",
  pts_climber: "Climber",
  pts_hills:   "Puncheur",
};

const ALL_SPECIALTY_KEYS: SpecialtyKey[] = [
  "pts_oneday", "pts_gc", "pts_tt", "pts_sprint", "pts_climber", "pts_hills",
];

function topSpecialty(profile: RiderProfile | undefined): string | null {
  if (!profile) return null;
  let best: SpecialtyKey | null = null;
  let bestVal = 0;
  for (const key of ALL_SPECIALTY_KEYS) {
    const val = profile[key] ?? 0;
    if (val > bestVal) { bestVal = val; best = key; }
  }
  return best ? SPECIALTY_LABELS[best] : null;
}

const PROFILE_SPECIALTY_MAP: Record<string, SpecialtyKey[]> = {
  flat:     ["pts_sprint", "pts_oneday"],
  cobbled:  ["pts_oneday"],
  hilly:    ["pts_hills", "pts_climber"],
  mountain: ["pts_gc", "pts_climber"],
  mixed:    ["pts_oneday", "pts_hills"],
};

// ---------------------------------------------------------------------------
// Year weights + position points
// ---------------------------------------------------------------------------

const YEAR_WEIGHTS: Record<number, number> = {
  2025: 1.0,
  2024: 0.7,
  2023: 0.5,
};

function positionPts(position: number): number {
  if (position <= 3)  return 100;
  if (position <= 5)  return  80;
  if (position <= 10) return  60;
  if (position <= 20) return  40;
  return 0;
}

// ---------------------------------------------------------------------------
// Freshness signal
// ---------------------------------------------------------------------------

function freshnessMult(days: number | null): number {
  if (days === null) return 1.0;  // no data → no penalty
  if (days >= 30)   return 0.60;  // very stale: -40%
  if (days >= 15)   return 0.80;  // slightly stale: -20%
  return 1.0;
}

// ---------------------------------------------------------------------------
// Specialty match signal
// ---------------------------------------------------------------------------

function specialtyRaw(
  profile: RiderProfile | undefined,
  raceProfile: string | null | undefined,
): number {
  if (!profile || !raceProfile) return 0;
  const cols = PROFILE_SPECIALTY_MAP[raceProfile];
  if (!cols || cols.length === 0) return 0;
  const vals = cols.map((c) => profile[c] ?? 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ---------------------------------------------------------------------------
// PCS form proxy (for riders with no Holdet data)
// ---------------------------------------------------------------------------

/**
 * Compute a 0-100 form proxy from PCS recency data.
 * Only called for riders with no Holdet form data (form_source = "none").
 * Uses days_since_race + last_race_pos to estimate current form.
 */
function pcsFormProxy(days: number, lastRacePos: string | null): number {
  // Base score from recency
  let base = days <= 7 ? 55 : 40;
  // Bonus for strong recent result
  if (lastRacePos !== null) {
    const pos = parseInt(lastRacePos, 10);
    if (!isNaN(pos)) {
      if (pos <= 5)  base = Math.min(75, base + 15);
      else if (pos <= 10) base = Math.min(65, base + 8);
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeToHundred(values: number[]): number[] {
  if (values.length === 0) return [];
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  if (mx === mn) return values.map(() => 50);
  return values.map((v) => ((v - mn) / (mx - mn)) * 100);
}

function normalizeWithinGroups(values: number[], groups: string[]): number[] {
  const groupIndices: Record<string, number[]> = {};
  groups.forEach((g, i) => {
    if (!groupIndices[g]) groupIndices[g] = [];
    groupIndices[g].push(i);
  });

  const result = new Array<number>(values.length).fill(0);
  for (const indices of Object.values(groupIndices)) {
    const sub = indices.map((i) => values[i]);
    const normed = normalizeToHundred(sub);
    indices.forEach((idx, j) => {
      result[idx] = normed[j];
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface FormResult {
  rider_id: number;
  race_slug: string;
  year: number;
  position: number;
}

// ---------------------------------------------------------------------------
// Raw profile score (exposed for /profil page)
// ---------------------------------------------------------------------------

export function rawProfileScore(
  riderId: number,
  formResults: FormResult[],
  validSlugs: Set<string>,
): number {
  return formResults
    .filter((fr) => fr.rider_id === riderId && validSlugs.has(fr.race_slug))
    .reduce((sum, fr) => {
      const pts = positionPts(fr.position);
      const weight = YEAR_WEIGHTS[fr.year] ?? 0.3;
      return sum + pts * weight;
    }, 0);
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Mutates each RiderAnalysis in the array to fill:
 *   profile_score, specialty_score, form_score_norm, value_score, total_score, days_since_race
 *
 * When riderProfiles is supplied:
 *   - freshness penalty applied to raw historical profile score
 *   - specialty-match score (PCS career points for this race type) blended in
 *   - days_since_race set on each RiderAnalysis
 *
 * When riderProfiles is omitted (backward-compatible), scores are computed
 * from historical results only — same as before.
 */
export function computeScores(
  riders: RiderAnalysis[],
  formResults: FormResult[],
  validSlugs: Set<string>,
  riderProfiles?: Map<number, RiderProfile>,
  raceProfile?: string | null,
): void {
  if (riders.length === 0) return;

  // --- Step 1: raw profile score (with optional freshness penalty) ---
  const rawProfile = riders.map((r) => {
    const raw  = rawProfileScore(r.rider.id, formResults, validSlugs);
    const prof = riderProfiles?.get(r.rider.id);
    const days = prof?.days_since_race ?? null;
    // Write days_since_race + top_specialty onto the analysis object so UI can read it
    r.days_since_race = days;
    r.top_specialty   = topSpecialty(prof);
    return raw * freshnessMult(days);
  });

  // --- Step 2: specialty match score ---
  const rawSpecialty = riders.map((r) => {
    const prof = riderProfiles?.get(r.rider.id);
    return specialtyRaw(prof, raceProfile);
  });

  // --- Step 3: normalize all components ---
  const normProfile   = normalizeToHundred(rawProfile);
  const normSpecialty = normalizeToHundred(rawSpecialty);
  const normForm      = normalizeToHundred(riders.map((r) => r.form_score));
  const normValue     = normalizeWithinGroups(
    riders.map((r) => r.points_per_popularity),
    riders.map((r) => r.rider.category),
  );

  // --- Step 4: blend + assign ---
  // profile_score = 80% historical (with freshness) + 20% specialty match
  // total_score   = profile×0.40 + form×0.40 + value×0.20
  riders.forEach((r, i) => {
    const hasProfiles = !!riderProfiles;
    // Only blend specialty if we actually have rider profile data
    const ps = hasProfiles
      ? normProfile[i] * 0.80 + normSpecialty[i] * 0.20
      : normProfile[i];
    let fs = normForm[i];
    const vs = normValue[i];

    r.profile_score   = Math.round(ps * 10) / 10;
    r.specialty_score = Math.round(normSpecialty[i] * 10) / 10;
    r.value_score     = Math.round(vs * 10) / 10;

    // PCS form fallback: for riders with no Holdet form data (form_source = "none"),
    // check if they have recent race data in rider_profiles and use it as a proxy.
    if (r.form_source !== "holdet" && hasProfiles) {
      const prof = riderProfiles!.get(r.rider.id);
      const days = prof?.days_since_race ?? null;
      if (days !== null && days <= 14) {
        fs = pcsFormProxy(days, prof?.last_race_pos ?? null);
        r.form_source = "pcs";
      } else {
        r.form_source = "none";
      }
    }

    r.form_score_norm = Math.round(fs * 10) / 10;
    r.total_score     = Math.round((ps * 0.4 + fs * 0.4 + vs * 0.2) * 10) / 10;
  });
}
