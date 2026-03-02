"""
score_riders.py — Score all riders on a startlist for the upcoming race.

Usage:
    python scripts/score_riders.py --race strade-bianche
    python scripts/score_riders.py --race strade-bianche --top 30

Scoring formula (from CONTEXT.md):
    total_score = (profile_score × 0.40) + (form_score × 0.40) + (value_score × 0.20)

    profile_score (0-100, normalized within startlist):
        Find all form_races with same profile as upcoming race.
        For each result: top-3 = 100pts, top-5 = 80pts, top-10 = 60pts, top-20 = 40pts
        Weight by year: 2025 × 1.0, 2024 × 0.7, 2023 × 0.5
        Raw score → normalized 0-100 relative to startlist.

    form_score (0-100, normalized within startlist):
        Holdet weighted form: latest×3 + second×2 + third×1.
        Normalized 0-100 relative to startlist.

    value_score (0-100, normalized within category):
        points_per_popularity (latest participated pts / latest popularity).
        Normalized per category so low-cost riders can shine.

Returns JSON: ranked list of riders with all component scores.

Requirements:
    pip install supabase

Environment variables (loaded from .env.local or shell):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import sys
import os
import json
import argparse
from typing import Optional

from supabase import create_client, Client
from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Environment / logging helpers
# ---------------------------------------------------------------------------


def load_dotenv_local() -> None:
    env_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", ".env.local")
    )
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k and k not in os.environ:
                os.environ[k] = v.strip()


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        _die(f"Missing required environment variable: {name}")
    return value  # type: ignore[return-value]


def _die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr)


def _log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Holdet form score logic (mirrors computeAnalysis.ts business rules)
# ---------------------------------------------------------------------------

YEAR_WEIGHTS = {2025: 1.0, 2024: 0.7, 2023: 0.5}
POSITION_POINTS = [
    (3,  100),
    (5,   80),
    (10,  60),
    (20,  40),
]


def position_pts(position: int) -> int:
    """Return raw profile points for a finishing position."""
    for threshold, pts in POSITION_POINTS:
        if position <= threshold:
            return pts
    return 0


def calc_holdet_form_score(snapshots: list[dict]) -> int:
    """
    Weighted Holdet form score: latest×3 + second×2 + third×1.
    Only after-snapshots with points > 0 count as "participated".
    """
    participated = sorted(
        [s for s in snapshots if s["snapshot"] == "after" and s["points"] > 0],
        key=lambda s: s["fetched_at"],
    )
    if not participated:
        return 0
    last3 = participated[-3:][::-1]  # newest first
    p1 = last3[0]["points"] if len(last3) > 0 else 0
    p2 = last3[1]["points"] if len(last3) > 1 else 0
    p3 = last3[2]["points"] if len(last3) > 2 else 0
    return p1 * 3 + p2 * 2 + p3 * 1


def calc_popularity(snapshots: list[dict]) -> float:
    """Latest popularity figure from any snapshot type."""
    if not snapshots:
        return 0.0
    latest = sorted(snapshots, key=lambda s: s["fetched_at"], reverse=True)[0]
    return latest.get("popularity") or 0.0


def calc_points_per_popularity(snapshots: list[dict]) -> float:
    """Latest participated points divided by latest popularity."""
    participated = sorted(
        [s for s in snapshots if s["snapshot"] == "after" and s["points"] > 0],
        key=lambda s: s["fetched_at"],
    )
    if not participated:
        return 0.0
    latest_pts = participated[-1]["points"]
    pop = calc_popularity(snapshots)
    return latest_pts / pop if pop > 0 else 0.0


def calc_form_flag(snapshots: list[dict]) -> str:
    participated = sorted(
        [s for s in snapshots if s["snapshot"] == "after" and s["points"] > 0],
        key=lambda s: s["fetched_at"],
    )
    after_all = sorted(
        [s for s in snapshots if s["snapshot"] == "after"],
        key=lambda s: s["fetched_at"],
    )
    if not participated:
        return "new"
    total = sum(s["points"] for s in participated)
    avg = total / len(participated)
    latest_after = after_all[-1] if after_all else None
    latest_pts = latest_after["points"] if latest_after else 0
    if latest_pts == 0:
        return "red"
    elif latest_pts >= avg * 1.5:
        return "green"
    else:
        return "yellow"


# ---------------------------------------------------------------------------
# Normalization helper
# ---------------------------------------------------------------------------


def normalize_to_100(values: list[float]) -> list[float]:
    """
    Linearly scale a list of values so the max maps to 100 and min maps to 0.
    If all values are equal (including all-zero), returns 50 for everyone.
    """
    if not values:
        return []
    mn, mx = min(values), max(values)
    if mx == mn:
        return [50.0] * len(values)
    return [(v - mn) / (mx - mn) * 100.0 for v in values]


def normalize_within_groups(
    values: list[float],
    groups: list[str],
) -> list[float]:
    """
    Normalize values within groups (e.g. per category).
    Returns a list of normalized scores in the same order as input.
    """
    # Collect indices per group
    group_indices: dict[str, list[int]] = {}
    for i, g in enumerate(groups):
        group_indices.setdefault(g, []).append(i)

    result = [0.0] * len(values)
    for g, indices in group_indices.items():
        sub_values = [values[i] for i in indices]
        normed = normalize_to_100(sub_values)
        for idx, normed_val in zip(indices, normed):
            result[idx] = normed_val
    return result


# ---------------------------------------------------------------------------
# Supabase data fetching
# ---------------------------------------------------------------------------


def fetch_race(supabase: Client, slug: str) -> dict:
    try:
        res = (
            supabase.table("races")
            .select("slug, name, profile, game_type, budget, holdet_game_id")
            .eq("slug", slug)
            .single()
            .execute()
        )
    except APIError as e:
        _die(f"Supabase error fetching race '{slug}': {e}")
    if not res.data:
        _die(
            f"Race '{slug}' not found in races table. "
            "Run fetch_holdet.py first or check the slug."
        )
    return res.data


def fetch_startlist_rider_ids(supabase: Client, race_slug: str) -> list[int]:
    try:
        res = supabase.table("startlists").select("rider_id").eq("race", race_slug).execute()
    except APIError as e:
        _die(f"Supabase error fetching startlist: {e}")
    return [row["rider_id"] for row in (res.data or [])]


def fetch_riders(supabase: Client, rider_ids: list[int]) -> list[dict]:
    if not rider_ids:
        return []
    try:
        res = supabase.table("riders").select("*").in_("id", rider_ids).execute()
    except APIError as e:
        _die(f"Supabase error fetching riders: {e}")
    return res.data or []


def fetch_snapshots(supabase: Client, rider_ids: list[int]) -> list[dict]:
    if not rider_ids:
        return []
    try:
        res = supabase.table("snapshots").select("*").in_("rider_id", rider_ids).execute()
    except APIError as e:
        _die(f"Supabase error fetching snapshots: {e}")
    return res.data or []


# Profiles that are treated as equivalent for scoring purposes.
# A race of profile X also uses historical results from its related profiles.
PROFILE_GROUPS: dict[str, list[str]] = {
    "mixed":    ["mixed", "cobbled"],
    "cobbled":  ["cobbled", "mixed"],
    "hilly":    ["hilly", "mountain"],
    "mountain": ["mountain", "hilly"],
    "flat":     ["flat"],
}

# Which PCS specialty columns are relevant for each race profile.
# Used to compute the specialty-match bonus in profile_score.
PROFILE_SPECIALTY_MAP: dict[str, list[str]] = {
    "flat":     ["pts_sprint", "pts_oneday"],
    "cobbled":  ["pts_oneday"],
    "hilly":    ["pts_hills", "pts_climber"],
    "mountain": ["pts_gc", "pts_climber"],
    "mixed":    ["pts_oneday", "pts_hills"],
}


def fetch_form_races_by_profile(supabase: Client, profile: str) -> list[dict]:
    related = PROFILE_GROUPS.get(profile, [profile])
    try:
        res = (
            supabase.table("form_races")
            .select("slug, name, year, profile")
            .in_("profile", related)
            .execute()
        )
    except APIError as e:
        _die(f"Supabase error fetching form_races: {e}")
    return res.data or []


def fetch_rider_profiles(supabase: Client, rider_ids: list[int]) -> dict[int, dict]:
    """Return {rider_id: profile_row} from rider_profiles table."""
    if not rider_ids:
        return {}
    try:
        res = (
            supabase.table("rider_profiles")
            .select("rider_id, pts_oneday, pts_gc, pts_tt, pts_sprint, pts_climber, pts_hills, days_since_race, last_race_pos, last_race_name")
            .in_("rider_id", rider_ids)
            .execute()
        )
    except APIError as e:
        _warn(f"Could not fetch rider_profiles: {e}")
        return {}
    return {row["rider_id"]: row for row in (res.data or [])}


def fetch_form_results(supabase: Client, race_slugs: list[str], rider_ids: list[int]) -> list[dict]:
    """Fetch form_results filtered by a list of race slugs and rider ids."""
    if not race_slugs or not rider_ids:
        return []
    try:
        # Supabase Python client doesn't support .in_() on multiple columns in one call,
        # so we filter rider_ids only — then filter race_slugs in Python.
        res = (
            supabase.table("form_results")
            .select("rider_id, race_slug, year, position, stage")
            .in_("rider_id", rider_ids)
            .in_("race_slug", race_slugs)
            .execute()
        )
    except APIError as e:
        _die(f"Supabase error fetching form_results: {e}")
    return res.data or []


# ---------------------------------------------------------------------------
# Scoring logic
# ---------------------------------------------------------------------------


def calc_raw_profile_score(
    rider_id: int,
    same_profile_slugs: set[str],
    form_results: list[dict],
) -> float:
    """
    Raw (pre-normalization) profile score for a rider.
    Higher = better historical results in races of the same profile type.
    """
    rider_results = [
        fr for fr in form_results
        if fr["rider_id"] == rider_id and fr["race_slug"] in same_profile_slugs
    ]
    raw = 0.0
    for result in rider_results:
        pts = position_pts(result["position"])
        if pts == 0:
            continue
        weight = YEAR_WEIGHTS.get(result["year"], 0.3)
        raw += pts * weight
    return raw


def freshness_multiplier(days_since_race: Optional[int]) -> float:
    """
    Penalty for riders who haven't raced recently.
    Applied as a multiplier to raw_profile before normalization.
    - < 15 days: no penalty (1.0)
    - 15-29 days: 20% penalty (0.80)
    - 30+ days: 40% penalty (0.60)
    - None (no data): no penalty (1.0) — benefit of the doubt
    """
    if days_since_race is None:
        return 1.0
    if days_since_race >= 30:
        return 0.60
    if days_since_race >= 15:
        return 0.80
    return 1.0


def specialty_raw_score(
    profile_data: Optional[dict],
    race_profile: Optional[str],
) -> float:
    """
    Raw specialty score for a rider based on PCS career specialty points.
    Returns the mean of the relevant specialty columns for this race profile type.
    Returns 0 if no profile data or no mapping exists.
    """
    if not profile_data or not race_profile:
        return 0.0
    cols = PROFILE_SPECIALTY_MAP.get(race_profile, [])
    if not cols:
        return 0.0
    values = [float(profile_data.get(col, 0) or 0) for col in cols]
    return sum(values) / len(values) if values else 0.0


def pcs_form_proxy(days_since_race: int, last_race_pos: Optional[str]) -> float:
    """
    Estimate a form score (0-75) from PCS freshness data for riders with no Holdet form.
    Mirrors the pcsFormProxy() function in lib/computeScores.ts.
    - days <= 7: base 55 (very fresh)
    - days 8-14: base 40 (somewhat fresh)
    - bonus for good last position: ≤5 → +15 (capped at 75), ≤10 → +8 (capped at 65)
    """
    base = 55.0 if days_since_race <= 7 else 40.0
    if last_race_pos is not None:
        try:
            pos = int(last_race_pos)
            if pos <= 5:
                base = min(75.0, base + 15.0)
            elif pos <= 10:
                base = min(65.0, base + 8.0)
        except ValueError:
            pass  # "DNF", "DNS", etc. — no bonus
    return base


# ---------------------------------------------------------------------------
# Budget optimizer (stage races)
# ---------------------------------------------------------------------------


def build_price_map(
    snapshots: list[dict],
    race_slug: str,
) -> tuple[dict[int, int], dict[int, bool]]:
    """Build {rider_id: price} and {rider_id: is_out} from snapshots for a race.

    Uses the most recent snapshot for the race to get the latest is_out status.
    Price comes from the before-snapshot (or any snapshot with price > 0).
    """
    price_map: dict[int, int]  = {}
    is_out_map: dict[int, bool] = {}

    race_snaps = sorted(
        [s for s in snapshots if s.get("race") == race_slug],
        key=lambda s: s.get("fetched_at") or "",
    )
    for snap in race_snaps:
        rid = snap["rider_id"]
        price = snap.get("price", 0) or 0
        if price > 0:
            price_map[rid] = price
        # Most recent snapshot determines is_out status
        is_out_map[rid] = bool(snap.get("is_out", False))

    return price_map, is_out_map


def budget_optimizer(
    scored: list[dict],
    price_map: dict[int, int],
    is_out_map: dict[int, bool],
    budget: int,
    team_size: int,
) -> list[dict]:
    """Greedy budget optimizer for stage races.

    Selects up to team_size riders maximising total_score within budget.
    Excludes riders with is_out=True or price=0 (not in game).

    Algorithm:
      1. Sort eligible riders by efficiency (total_score per million spent).
      2. Greedily pick until budget or team_size is exhausted.
      3. Refinement: single-swap pass to improve total_score if budget allows.
    """
    # Annotate each rider with price + efficiency
    eligible: list[dict] = []
    for r in scored:
        rid   = r["rider_id"]
        price = price_map.get(rid, 0)
        if is_out_map.get(rid, False) or price <= 0:
            continue
        price_m    = price / 1_000_000
        efficiency = r["total_score"] / price_m if price_m > 0 else 0.0
        eligible.append({**r, "price": price, "efficiency": round(efficiency, 3)})

    # Sort by efficiency descending for greedy pass
    eligible.sort(key=lambda r: r["efficiency"], reverse=True)

    team: list[dict]  = []
    remaining_budget  = budget

    for rider in eligible:
        if len(team) >= team_size:
            break
        if rider["price"] <= remaining_budget:
            team.append(rider)
            remaining_budget -= rider["price"]

    # --- Single-swap refinement ---
    # For each team slot, try substituting a higher-scoring non-team rider
    # if the budget difference allows it.
    team_ids  = {r["rider_id"] for r in team}
    non_team  = [r for r in eligible if r["rider_id"] not in team_ids]

    improved = True
    while improved:
        improved = False
        for i, picked in enumerate(team):
            for candidate in non_team:
                if candidate["total_score"] <= picked["total_score"]:
                    break  # non_team not sorted by score — but early exit if no gain
                price_delta = candidate["price"] - picked["price"]
                if remaining_budget - price_delta >= 0:
                    team[i]          = candidate
                    remaining_budget -= price_delta
                    non_team         = [
                        r for r in non_team
                        if r["rider_id"] != candidate["rider_id"]
                    ]
                    non_team.append(picked)
                    non_team.sort(key=lambda r: r["total_score"], reverse=True)
                    team_ids = {r["rider_id"] for r in team}
                    improved = True
                    break
            if improved:
                break

    # Sort team by total_score for display
    team.sort(key=lambda r: r["total_score"], reverse=True)
    return team


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score startlist riders for an upcoming race."
    )
    parser.add_argument(
        "--race",
        required=True,
        help="Race slug from the races table, e.g. strade-bianche or paris-nice",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=None,
        help="Only include top N riders in output (default: all)",
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=None,
        help=(
            "Budget for stage race team optimizer (e.g. 50000000). "
            "If omitted, auto-detected from races.budget for stage races."
        ),
    )
    parser.add_argument(
        "--team-size",
        type=int,
        default=9,
        dest="team_size",
        help="Max riders in suggested stage race team (default: 9)",
    )
    args = parser.parse_args()

    load_dotenv_local()
    supabase_url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    )
    if not supabase_url:
        _die("Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
    service_key  = require_env("SUPABASE_SERVICE_KEY")
    supabase = create_client(supabase_url, service_key)

    # --- Step 1: fetch race + validate ---
    _log(f"→ Fetching race '{args.race}'...")
    race = fetch_race(supabase, args.race)
    race_profile: Optional[str] = race.get("profile")
    game_type: str = race.get("game_type") or "classics"

    # Resolve budget: explicit arg → DB value → None
    effective_budget: Optional[int] = args.budget or race.get("budget")
    is_stage_race = game_type == "stage_race"

    _log(
        f"✓ Race: {race['name']} | Profile: {race_profile or 'NOT SET'} "
        f"| Type: {game_type}"
        + (f" | Budget: {effective_budget:,}" if effective_budget else "")
    )

    if not race_profile:
        _warn(
            f"Race '{args.race}' has no profile set in the races table. "
            "Profile score component will be 0 for all riders. "
            "Run the SQL migration 0002_race_profile.sql to populate profiles."
        )

    # --- Step 2: fetch startlist ---
    _log("→ Fetching startlist...")
    rider_ids = fetch_startlist_rider_ids(supabase, args.race)
    if not rider_ids:
        _die(
            f"No startlist found for race '{args.race}'. "
            "Run parse_pcs.py first to populate the startlists table."
        )
    _log(f"✓ {len(rider_ids)} riders on startlist")

    # --- Step 3: fetch rider details + snapshots + rider profiles ---
    _log("→ Fetching riders, snapshots, and rider profiles...")
    riders        = fetch_riders(supabase, rider_ids)
    snapshots     = fetch_snapshots(supabase, rider_ids)
    rider_profiles_map = fetch_rider_profiles(supabase, rider_ids)
    _log(
        f"✓ {len(riders)} riders, {len(snapshots)} snapshots, "
        f"{len(rider_profiles_map)} rider profiles"
    )

    # --- Step 4: fetch form data for same-profile races ---
    form_results: list[dict] = []
    same_profile_slugs: set[str] = set()

    if race_profile:
        related_profiles = PROFILE_GROUPS.get(race_profile, [race_profile])
        _log(f"→ Fetching form_races for profiles {related_profiles}...")
        form_races = fetch_form_races_by_profile(supabase, race_profile)
        same_profile_slugs = {r["slug"] for r in form_races}
        _log(f"✓ Found {len(form_races)} matching form_races")

        if same_profile_slugs:
            _log("→ Fetching form_results...")
            form_results = fetch_form_results(
                supabase,
                list(same_profile_slugs),
                rider_ids,
            )
            _log(f"✓ {len(form_results)} form_results loaded")
    else:
        _log("  Skipping form data fetch (no profile set)")

    # --- Step 5: calculate raw scores per rider ---
    _log("→ Calculating scores...")

    riders_by_id = {r["id"]: r for r in riders}
    snaps_by_rider: dict[int, list[dict]] = {}
    for s in snapshots:
        snaps_by_rider.setdefault(s["rider_id"], []).append(s)

    scored: list[dict] = []
    for rider_id in rider_ids:
        rider = riders_by_id.get(rider_id)
        if not rider:
            continue

        rider_snaps = snaps_by_rider.get(rider_id, [])

        holdet_form  = calc_holdet_form_score(rider_snaps)
        popularity   = calc_popularity(rider_snaps)
        ppp          = calc_points_per_popularity(rider_snaps)
        flag         = calc_form_flag(rider_snaps)
        raw_profile  = calc_raw_profile_score(rider_id, same_profile_slugs, form_results)

        # Rider profile signals (from fetch_rider_profiles.py)
        profile_data    = rider_profiles_map.get(rider_id)
        days_since_race = profile_data.get("days_since_race") if profile_data else None
        last_race_pos   = profile_data.get("last_race_pos") if profile_data else None
        last_race_name  = profile_data.get("last_race_name") if profile_data else None
        freshness_mult  = freshness_multiplier(days_since_race)
        raw_specialty   = specialty_raw_score(profile_data, race_profile)

        # form_source: where the form score comes from
        form_source = "holdet" if holdet_form > 0 else "none"

        # Apply freshness penalty to historical profile score
        raw_profile_adj = raw_profile * freshness_mult

        scored.append({
            "rider_id":       rider_id,
            "name":           rider.get("full_name", ""),
            "team":           rider.get("team_abbr", ""),
            "category":       rider.get("category", ""),
            "category_nr":    rider.get("category_nr", 0),
            "form_flag":      flag,
            "popularity":     round(popularity * 100, 2),
            "days_since_race": days_since_race,
            "last_race_name": last_race_name,
            "freshness_mult": freshness_mult,
            # raw scores (pre-normalization)
            "_raw_profile":   raw_profile_adj,
            "_raw_form":      float(holdet_form),
            "_raw_value":     ppp,
            "_raw_specialty": raw_specialty,
            # PCS fallback data (used in step 7)
            "_form_source":   form_source,
            "_last_race_pos": last_race_pos,
        })

    if not scored:
        _die("No riders could be scored. Check riders and snapshots tables.")

    # --- Step 6: normalize scores ---

    raw_profiles   = [r["_raw_profile"]   for r in scored]
    raw_forms      = [r["_raw_form"]      for r in scored]
    raw_values     = [r["_raw_value"]     for r in scored]
    raw_specialties= [r["_raw_specialty"] for r in scored]
    categories     = [r["category"]       for r in scored]

    norm_profiles   = normalize_to_100(raw_profiles)
    norm_forms      = normalize_to_100(raw_forms)
    norm_values     = normalize_within_groups(raw_values, categories)
    norm_specialties= normalize_to_100(raw_specialties)

    # --- Step 7: combine into total_score ---
    # profile_score = 80% historical results + 20% PCS specialty match
    # total_score   = profile_score × 0.40 + form_score × 0.40 + value_score × 0.20
    has_profiles = bool(rider_profiles_map)
    for i, rider in enumerate(scored):
        ps_hist = norm_profiles[i]
        ps_spec = norm_specialties[i]
        ps = ps_hist * 0.80 + ps_spec * 0.20   # blended profile score

        fs = norm_forms[i]
        vs = norm_values[i]

        # PCS form fallback: if no Holdet data and rider raced recently, use proxy
        form_source = rider["_form_source"]
        if form_source != "holdet" and has_profiles:
            days = rider.get("days_since_race")
            if days is not None and days <= 14:
                fs = pcs_form_proxy(days, rider["_last_race_pos"])
                form_source = "pcs"
            else:
                form_source = "none"

        total = ps * 0.40 + fs * 0.40 + vs * 0.20

        rider["profile_score"]   = round(ps, 1)
        rider["specialty_score"] = round(ps_spec, 1)
        rider["form_score"]      = round(fs, 1)
        rider["value_score"]     = round(vs, 1)
        rider["total_score"]     = round(total, 1)
        rider["form_source"]     = form_source

        # Clean up raw/temp keys
        del rider["_raw_profile"]
        del rider["_raw_form"]
        del rider["_raw_value"]
        del rider["_raw_specialty"]
        del rider["_form_source"]
        del rider["_last_race_pos"]

    # --- Step 8: sort and output ---
    scored.sort(key=lambda r: r["total_score"], reverse=True)

    # Add rank
    for rank, rider in enumerate(scored, 1):
        rider["rank"] = rank

    top = scored[: args.top] if args.top else scored

    _log(f"\n=== Top {min(10, len(top))} riders ===")
    for r in top[:10]:
        days = r.get("days_since_race")
        freshness = f"{days}d" if days is not None else "?"
        mult = r.get("freshness_mult", 1.0)
        penalty = f" ⚠ {mult:.0%}" if mult < 1.0 else ""
        _log(
            f"  #{r['rank']:>3} {r['name']:<30}  "
            f"total={r['total_score']:>5.1f}  "
            f"(profile={r['profile_score']:>5.1f} "
            f"spec={r.get('specialty_score', 0):>5.1f} "
            f"form={r['form_score']:>5.1f} "
            f"value={r['value_score']:>5.1f})  "
            f"{r['form_flag']}  last={freshness}{penalty}"
        )

    profiles_available = sum(1 for r in scored if r.get("days_since_race") is not None)
    penalized          = sum(1 for r in scored if r.get("freshness_mult", 1.0) < 1.0)
    pcs_fallback_count = sum(1 for r in scored if r.get("form_source") == "pcs")
    if pcs_fallback_count:
        _log(f"  ℹ {pcs_fallback_count} riders using PCS form proxy (no Holdet data)")

    # --- Step 9: budget optimizer (stage races) ---
    suggested_team: list[dict] = []
    price_map: dict[int, int]  = {}
    is_out_map: dict[int, bool] = {}

    if is_stage_race or effective_budget:
        price_map, is_out_map = build_price_map(snapshots, args.race)
        priced_count  = sum(1 for p in price_map.values() if p > 0)
        is_out_count  = sum(1 for v in is_out_map.values() if v)
        _log(
            f"\n→ Budget optimizer: budget={effective_budget:,}  "
            f"team_size={args.team_size}  "
            f"riders_with_price={priced_count}  "
            f"is_out={is_out_count}"
        )

        if effective_budget and priced_count > 0:
            suggested_team = budget_optimizer(
                scored,
                price_map,
                is_out_map,
                effective_budget,
                args.team_size,
            )
            total_price = sum(r["price"] for r in suggested_team)
            total_score = sum(r["total_score"] for r in suggested_team)
            _log(f"\n=== Suggested team (budget {effective_budget:,}) ===")
            _log(
                f"  Total cost: {total_price:,}  "
                f"| Remaining budget: {effective_budget - total_price:,}"
            )
            for i, r in enumerate(suggested_team, 1):
                price_m = r["price"] / 1_000_000
                _log(
                    f"  {i:>2}. {r['name']:<30}  "
                    f"score={r['total_score']:>5.1f}  "
                    f"eff={r.get('efficiency', 0):>5.2f}  "
                    f"price={price_m:.1f}M"
                )
            _log(f"  Combined score: {total_score:.1f}")
        else:
            _log("  Skipping optimizer — no price data or no budget set.")

    # Annotate ranked list with price/is_out (even without optimizer)
    for r in scored:
        rid = r["rider_id"]
        r["price"]  = price_map.get(rid, 0)
        r["is_out"] = is_out_map.get(rid, False)

    result = {
        "ok":                    True,
        "race":                  args.race,
        "race_name":             race["name"],
        "race_profile":          race_profile,
        "game_type":             game_type,
        "budget":                effective_budget,
        "riders_scored":         len(scored),
        "profile_races_used":    len(same_profile_slugs),
        "rider_profiles_loaded": profiles_available,
        "freshness_penalized":   penalized,
        "pcs_form_fallback":     pcs_fallback_count,
        "riders":                top,
        "suggested_team":        suggested_team,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
