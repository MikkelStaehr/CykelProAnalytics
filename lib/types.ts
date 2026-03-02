// TypeScript types matching the Supabase database schema exactly.
// Do not rename or add fields without updating CONTEXT.md and the SQL schema.

export type Category = "category_1" | "category_2" | "category_3" | "category_4";

export type SnapshotType = "before" | "after";

// riders table — master rider record (id = Holdet playerId)
export interface Rider {
  id: number;          // Holdet playerId — primary key
  person_id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  team_name: string;
  team_abbr: string;
  category: Category;
  category_nr: number; // 1–4
}

// snapshots table — one row per rider per race snapshot
export interface Snapshot {
  id: number;          // serial primary key
  rider_id: number;    // FK → riders.id
  race: string;        // e.g. "strade-bianche"
  snapshot: SnapshotType;
  points: number;
  popularity: number;
  price: number;       // rider price in stage races (e.g. 4000000); 0 for classics
  is_out: boolean;     // rider has abandoned (stage races only)
  fetched_at: string;  // ISO timestamp from DB
}

// startlists table — which riders are registered to start a race
export interface StartlistEntry {
  race: string;        // composite PK part 1
  rider_id: number;    // composite PK part 2 — FK → riders.id
}

// races table — race registry
export interface Race {
  slug: string;        // primary key, e.g. "strade-bianche"
  name: string;        // e.g. "Strade Bianche"
  year: number;
  pcs_url: string;
  holdet_game_id: number; // e.g. 586 (classics) or 589 (Paris-Nice)
  game_type: "classics" | "stage_race"; // defaults to "classics" until migration runs
  budget: number | null;               // 50000000 for stage races, null for classics
  profile: string | null;
  distance_km: number | null;
  elevation_m: number | null;
  profile_score: number | null;
}

// Computed analysis metrics — not stored in DB, calculated from snapshots + form_results
export interface RiderAnalysis {
  rider: Rider;
  total_points: number;
  races_with_data: number;       // count of after-snapshots where points > 0
  avg_points_per_race: number;
  best_race: { race: string; points: number } | null;
  latest_race: { race: string; points: number } | null;
  latest_points: number;         // most recent after-snapshot points (may be 0)
  trend: number;                 // avg of last 3 races with points > 0
  popularity: number;            // from most recent snapshot (any type)
  points_per_popularity: number; // latest participated points / popularity
  form_score: number;            // latest×3 + second×2 + third×1 (raw)
  form_flag: "green" | "red" | "yellow" | "new";
  // Score model (0-100 normalized, computed by computeScores — 0 by default)
  profile_score: number;         // 80% historical results + 20% specialty match
  specialty_score: number;       // PCS career specialty match for race profile, 0-100
  top_specialty: string | null;  // strongest PCS specialty label ("Sprint", "Climber", etc.)
  form_score_norm: number;       // form_score normalized 0-100 within startlist
  value_score: number;           // points_per_popularity, normalized within category
  total_score: number;           // profile×0.4 + form×0.4 + value×0.2
  days_since_race: number | null; // from rider_profiles; null = no PCS data
}

// Holdet API response shape (raw)
export interface HoldetPlayer {
  playerId: number;
  personId: number;
  teamId: number;
  positionId: number;
  startPrice: number;
  priceChange: number;
  pointsChange: number;
  price: number;
  points: number;
  popularity: number;
  trend: number;
}

export interface HoldetPerson {
  id: number;
  firstName: string;
  lastName: string;
}

export interface HoldetTeam {
  id: number;
  name: string;
  abbreviation: string;
}

export interface HoldetApiResponse {
  items: HoldetPlayer[];
  _embedded?: {
    persons?: Record<string, HoldetPerson>;
    teams?: Record<string, HoldetTeam>;
  };
}
