"""
fetch_holdet.py — Log into Holdet.dk, fetch player snapshot, store in Supabase.

Usage:
    python scripts/fetch_holdet.py --race <race-slug> --snapshot <before|after>
    python scripts/fetch_holdet.py --race paris-nice   --snapshot before --game-id 589

If --game-id is omitted the script looks up holdet_game_id from the races table.

Examples:
    python scripts/fetch_holdet.py --race strade-bianche --snapshot before
    python scripts/fetch_holdet.py --race paris-nice     --snapshot before

Requirements:
    pip install httpx supabase

Environment variables (loaded from .env.local or shell):
    HOLDET_EMAIL, HOLDET_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import sys
import os
import json
import argparse
from typing import Optional

import httpx
from supabase import create_client, Client
from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HOLDET_BASE     = "https://www.holdet.dk"
HOLDET_API_BASE = "https://nexus-app-fantasy-fargate.holdet.dk/api"

# positionId → (category string, category number) — classics only
# Stage races do not use categories; positionId falls through to the default.
POSITION_TO_CATEGORY: dict[int, tuple[str, int]] = {
    260: ("category_1", 1),
    261: ("category_2", 2),
    262: ("category_3", 3),
    263: ("category_4", 4),
}

# Batch size for Supabase upserts (PostgREST limit)
UPSERT_CHUNK = 500

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------


def load_dotenv_local() -> None:
    """Load .env.local from the project root into os.environ (if present)."""
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
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        _die(f"Missing required environment variable: {name}")
    return value  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Error helpers
# ---------------------------------------------------------------------------


def _die(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def _warn(message: str) -> None:
    print(f"WARNING: {message}", file=sys.stderr)


def _log(message: str) -> None:
    print(message, flush=True)


# ---------------------------------------------------------------------------
# Holdet authentication
# ---------------------------------------------------------------------------


def login(email: str, password: str) -> httpx.Client:
    """Log into Holdet.dk using the NextAuth (authjs) credentials flow.

    Flow:
      1. GET /api/auth/csrf → get csrfToken + AWSALB routing cookie
      2. POST /api/auth/signin/credentials → accumulate session cookies

    Returns the authenticated httpx.Client so its full cookie jar
    (AWSALB, session token, etc.) is reused for subsequent API calls.
    The caller is responsible for closing the client.
    """
    client = httpx.Client(follow_redirects=True, timeout=30)

    try:
        resp = client.get(f"{HOLDET_BASE}/api/auth/csrf")
        resp.raise_for_status()
    except httpx.HTTPError as e:
        client.close()
        _die(f"Failed to fetch CSRF token: {e}")

    csrf_token: Optional[str] = resp.json().get("csrfToken")
    if not csrf_token:
        client.close()
        _die(f"No csrfToken in response: {resp.text[:200]}")

    try:
        client.post(
            f"{HOLDET_BASE}/api/auth/signin/credentials",
            data={
                "csrfToken": csrf_token,
                "email": email,
                "password": password,
                "callbackUrl": HOLDET_BASE,
                "json": "true",
            },
        )
    except httpx.HTTPError as e:
        client.close()
        _die(f"Login request failed: {e}")

    cookie_names = list(client.cookies.keys())
    _log(f"  Cookies received: {', '.join(cookie_names) or 'none'}")

    return client


# ---------------------------------------------------------------------------
# Game ID lookup
# ---------------------------------------------------------------------------


def resolve_game_id(supabase: Client, race_slug: str, explicit: Optional[int]) -> int:
    """Return the Holdet game ID to use.

    If --game-id was supplied explicitly, that value takes precedence.
    Otherwise, look up holdet_game_id from the races table.
    """
    if explicit is not None:
        return explicit

    try:
        res = (
            supabase.table("races")
            .select("holdet_game_id")
            .eq("slug", race_slug)
            .single()
            .execute()
        )
    except APIError as e:
        _die(f"Could not look up holdet_game_id for race '{race_slug}': {e}")

    game_id = res.data.get("holdet_game_id") if res.data else None
    if not game_id:
        _die(
            f"No holdet_game_id found for race '{race_slug}'. "
            "Either add the race to the races table or pass --game-id explicitly."
        )
    return int(game_id)


# ---------------------------------------------------------------------------
# Holdet API
# ---------------------------------------------------------------------------


def fetch_players(client: httpx.Client, game_id: int) -> dict:
    """Fetch all players for the given Holdet game using the authenticated client."""
    url = f"{HOLDET_API_BASE}/games/{game_id}/players"
    try:
        resp = client.get(url, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status == 401:
            _die(
                "401 Unauthorized from Holdet API. "
                "Try running the script again to refresh the login session."
            )
        _die(f"Holdet API returned HTTP {status}: {e}")
    except httpx.HTTPError as e:
        _die(f"Holdet API request failed: {e}")

    return resp.json()


def _item_id(item: dict) -> Optional[int]:
    """Return the rider ID from a player item.

    Before-snapshots use item['id'], after-snapshots use item['playerId'].
    Always handles both.
    """
    return item.get("id") or item.get("playerId")


# ---------------------------------------------------------------------------
# Supabase writes
# ---------------------------------------------------------------------------


def build_person_id_map(supabase: Client, person_ids: list[int]) -> dict[int, int]:
    """Return {person_id: existing_rider_id} for person_ids already in the DB.

    Used to avoid creating duplicate rider entries when the same real-world
    rider appears in multiple Holdet games with different playerId values.
    The first game's ID becomes the canonical rider_id for all subsequent games.
    """
    if not person_ids:
        return {}
    try:
        res = (
            supabase.table("riders")
            .select("id, person_id")
            .in_("person_id", person_ids)
            .execute()
        )
    except APIError as e:
        _warn(f"Could not fetch existing person_ids: {e}")
        return {}
    return {row["person_id"]: row["id"] for row in (res.data or [])}


def upsert_riders(
    supabase: Client,
    items: list[dict],
    persons: dict[str, dict],
    teams: dict[str, dict],
) -> tuple[int, dict[int, int]]:
    """Upsert rider rows into the riders table.

    Returns (count_upserted, game_id_to_canonical_id).

    The second return value maps each item's game playerId → canonical DB rider_id.
    This is used by upsert_snapshots so that all snapshots share the same rider_id
    regardless of which Holdet game they came from — preventing duplicates when
    the same real-world rider appears in multiple games (classics + stage races).
    """
    if not persons:
        _warn(
            "No _embedded.persons in API response — "
            "rider names will not be updated. Snapshots will still be inserted."
        )
        return 0, {}

    # Collect all person_ids in this batch so we can look up existing DB entries.
    # If a person already has a rider row (from a different game), we reuse that
    # row's id instead of creating a new one.
    all_person_ids = [
        item["personId"]
        for item in items
        if item.get("personId")
    ]
    existing_map = build_person_id_map(supabase, all_person_ids)
    reused = 0

    rows: list[dict] = []
    game_to_canonical: dict[int, int] = {}  # game_player_id → canonical rider_id

    for item in items:
        game_player_id = _item_id(item)
        if not game_player_id:
            continue

        person_id = item.get("personId")
        person = persons.get(str(person_id)) if person_id else None
        if not person:
            continue

        # Use existing canonical ID if person already exists in DB
        canonical_id = existing_map.get(person_id, game_player_id)
        if canonical_id != game_player_id:
            reused += 1
        game_to_canonical[game_player_id] = canonical_id

        team = teams.get(str(item.get("teamId", "")), {})
        category, category_nr = POSITION_TO_CATEGORY.get(
            item.get("positionId", 0), ("category_4", 4)
        )

        first_name = person.get("firstName", "")
        last_name  = person.get("lastName", "")

        rows.append(
            {
                "id":          canonical_id,
                "person_id":   person_id,
                "first_name":  first_name,
                "last_name":   last_name,
                "full_name":   f"{first_name} {last_name}".strip(),
                "team_name":   team.get("name", ""),
                "team_abbr":   team.get("abbreviation", ""),
                "category":    category,
                "category_nr": category_nr,
            }
        )

    if not rows:
        _warn("No riders to upsert (persons dict present but no matches found).")
        return 0, {}

    if reused:
        _log(f"  → Reusing existing rider IDs for {reused} riders (person_id match)")

    for i in range(0, len(rows), UPSERT_CHUNK):
        batch = rows[i : i + UPSERT_CHUNK]
        try:
            supabase.table("riders").upsert(batch, on_conflict="id").execute()
        except APIError as e:
            _die(f"Supabase riders upsert failed: {e}")

    return len(rows), game_to_canonical


def upsert_snapshots(
    supabase: Client,
    items: list[dict],
    race: str,
    snapshot_type: str,
    game_to_canonical: Optional[dict[int, int]] = None,
) -> int:
    """Upsert one snapshot row per rider into the snapshots table.

    Conflicts on (rider_id, race, snapshot) are resolved by updating the row.
    Includes price and is_out fields for stage race support.

    game_to_canonical: mapping from game playerId → canonical DB rider_id.
    When provided (stage races), snapshots are stored with the canonical ID so
    they match the startlist and form_results rows.

    Returns the count of snapshot rows sent to Supabase.
    """
    id_map = game_to_canonical or {}
    rows: list[dict] = []
    for item in items:
        game_id = _item_id(item)
        if not game_id:
            continue
        canonical_id = id_map.get(game_id, game_id)
        rows.append(
            {
                "rider_id":   canonical_id,
                "race":       race,
                "snapshot":   snapshot_type,
                "points":     item.get("points", 0),
                "popularity": item.get("popularity", 0.0),
                "price":      item.get("price", 0),
                "is_out":     bool(item.get("isOut", False)),
            }
        )

    if not rows:
        return 0

    for i in range(0, len(rows), UPSERT_CHUNK):
        batch = rows[i : i + UPSERT_CHUNK]
        try:
            (
                supabase.table("snapshots")
                .upsert(batch, on_conflict="rider_id,race,snapshot")
                .execute()
            )
        except APIError as e:
            if "violates foreign key constraint" in str(e):
                _die(
                    "Snapshot insert failed: some rider IDs don't exist in the riders table. "
                    "Run the script once with a response that includes _embedded.persons "
                    "to populate riders first, then retry."
                )
            _die(f"Supabase snapshots upsert failed: {e}")

    return len(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a Holdet.dk player snapshot and store it in Supabase."
    )
    parser.add_argument(
        "--race",
        required=True,
        help="Race slug matching races.slug, e.g. strade-bianche or paris-nice",
    )
    parser.add_argument(
        "--snapshot",
        required=True,
        choices=["before", "after"],
        help="Whether this is a pre-race or post-race snapshot",
    )
    parser.add_argument(
        "--game-id",
        type=int,
        default=None,
        dest="game_id",
        help=(
            "Holdet game ID override (e.g. 589 for Paris-Nice). "
            "If omitted, looked up from the races table."
        ),
    )
    args = parser.parse_args()

    load_dotenv_local()

    email        = require_env("HOLDET_EMAIL")
    password     = require_env("HOLDET_PASSWORD")
    supabase_url = require_env("SUPABASE_URL")
    service_key  = require_env("SUPABASE_SERVICE_KEY")

    supabase = create_client(supabase_url, service_key)

    # Resolve which game ID to use (explicit arg → DB lookup)
    game_id = resolve_game_id(supabase, args.race, args.game_id)
    _log(f"→ Using Holdet game ID: {game_id}")

    # --- Auth ---
    _log(f"→ Logging in as {email}...")
    client = login(email, password)
    _log("✓ Login successful")

    # --- Fetch ---
    _log(f"→ Fetching players (game {game_id})...")
    try:
        data = fetch_players(client, game_id)
    finally:
        client.close()

    items: list[dict]      = data.get("items", [])
    embedded: dict         = data.get("_embedded", {})
    persons: dict[str, dict] = embedded.get("persons", {})
    teams: dict[str, dict]   = embedded.get("teams", {})

    _log(
        f"✓ Got {len(items)} players, "
        f"{len(persons)} persons, "
        f"{len(teams)} teams"
    )

    if not items:
        _die("API returned 0 players — response may be malformed or auth failed.")

    # --- Count is_out riders (stage races) ---
    is_out_count = sum(1 for item in items if item.get("isOut", False))
    if is_out_count:
        _log(f"  → {is_out_count} rider(s) marked isOut (abandoned)")

    # --- Supabase ---
    _log("→ Upserting riders...")
    rider_count, game_to_canonical = upsert_riders(supabase, items, persons, teams)
    if rider_count > 0:
        _log(f"✓ Upserted {rider_count} riders")
    else:
        _log("  (Skipped rider upsert — no person data in this response)")

    _log(
        f"→ Upserting snapshots "
        f"(race={args.race!r}, snapshot={args.snapshot!r})..."
    )
    snapshot_count = upsert_snapshots(
        supabase, items, args.race, args.snapshot, game_to_canonical
    )
    _log(f"✓ Upserted {snapshot_count} snapshots")

    result = {
        "ok":                True,
        "race":              args.race,
        "snapshot":          args.snapshot,
        "game_id":           game_id,
        "players_fetched":   len(items),
        "riders_upserted":   rider_count,
        "snapshots_upserted": snapshot_count,
        "is_out_count":      is_out_count,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
