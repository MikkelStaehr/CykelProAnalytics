"""
parse_pcs.py — Scrape a PCS startlist and insert matched riders into Supabase.

Usage:
    python scripts/parse_pcs.py --race strade-bianche

Flow:
    1. Look up pcs_url and year from the Supabase races table
    2. Scrape the PCS startlist HTML
    3. Extract rider names in PCS format (LASTNAME Firstname)
    4. Match against riders table using normalized word-set matching
    5. Upsert matched rows into the startlists table
    6. Print a report of any unmatched names for manual review

Matching strategy:
    Both the PCS name ("VAN DER POEL Mathieu") and the Holdet full_name
    ("Mathieu van der Poel") are normalized and reduced to a frozenset of
    words. Sets are order-independent, so word-ordering differences between
    the two sources are handled automatically.

Requirements:
    pip install httpx beautifulsoup4 supabase

Environment variables (loaded from .env.local or shell):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import re
import sys
import os
import json
import unicodedata
import argparse
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from supabase import create_client, Client
from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Manual overrides for names that word-set matching cannot resolve.
# Key: frozenset of normalized words from the PCS name.
# Value: Holdet rider id.
# Add new entries here whenever a new unresolvable edge case is found.
MANUAL_OVERRIDES: dict[frozenset, int] = {
    # HONORÉ Mikkel Frølich — PCS word set differs from Holdet ordering
    frozenset({"HONORE", "MIKKEL", "FROLICH"}): 43023,
    # JOHANNESSEN Tobias Halland — compound last name reordered in Holdet
    frozenset({"JOHANNESSEN", "TOBIAS", "HALLAND"}): 43239,
}

UPSERT_CHUNK = 500

PCS_HEADERS = {
    # Use a real browser UA to avoid being blocked
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ---------------------------------------------------------------------------
# Environment helpers
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


# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------


def _die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr)


def _log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Name normalization (canonical form from CONTEXT.md)
# ---------------------------------------------------------------------------


def normalize(s: str) -> str:
    """Strip accents, uppercase, remove punctuation, collapse whitespace."""
    s = s.upper()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("-", " ").replace("Đ", "D")
    return " ".join(s.split())


def word_set(name: str) -> frozenset:
    """Return a frozenset of normalized words — order-independent key."""
    return frozenset(normalize(name).split())


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------


def fetch_race(supabase: Client, slug: str) -> dict:
    """Return the races row for the given slug, or die with a clear error."""
    try:
        result = (
            supabase.table("races")
            .select("slug, name, year, pcs_url")
            .eq("slug", slug)
            .single()
            .execute()
        )
    except APIError as e:
        _die(f"Supabase error fetching race '{slug}': {e}")

    if not result.data:
        _die(
            f"Race '{slug}' not found in the races table. "
            f"Check the slug matches exactly (e.g. 'strade-bianche')."
        )
    return result.data


def fetch_all_riders(supabase: Client) -> list[dict]:
    """Return all riders from the riders table (id + full_name only)."""
    try:
        result = supabase.table("riders").select("id, full_name").execute()
    except APIError as e:
        _die(f"Supabase error fetching riders: {e}")
    return result.data or []


def upsert_startlist(supabase: Client, race_slug: str, rider_ids: list[int]) -> int:
    """Upsert startlist rows. Safe to re-run — conflicts are ignored."""
    rows = [{"race": race_slug, "rider_id": rid} for rid in rider_ids]
    for i in range(0, len(rows), UPSERT_CHUNK):
        batch = rows[i : i + UPSERT_CHUNK]
        try:
            (
                supabase.table("startlists")
                .upsert(batch, on_conflict="race,rider_id")
                .execute()
            )
        except APIError as e:
            _die(f"Supabase startlists upsert failed: {e}")
    return len(rows)


# ---------------------------------------------------------------------------
# PCS scraping
# ---------------------------------------------------------------------------


def build_startlist_url(pcs_url: str) -> str:
    """Convert any PCS race URL to its /startlist/startlist canonical form.

    Strips trailing path segments (gc, result, stage-N, existing startlist suffixes)
    so we always land on the correct startlist page regardless of what was stored.

    Examples:
        .../race/paris-nice/2026/gc             → .../race/paris-nice/2026/startlist/startlist
        .../race/strade-bianche/2026/result      → .../race/strade-bianche/2026/startlist/startlist
        .../race/strade-bianche/2026/startlist   → .../race/strade-bianche/2026/startlist/startlist
    """
    base = re.sub(
        r"/(startlist/startlist|startlist|result|gc|stage[^/]*)$",
        "",
        pcs_url.rstrip("/"),
    )
    return f"{base}/startlist/startlist"


def scrape_startlist(url: str) -> list[dict]:
    """Fetch and parse a PCS startlist page.

    Returns a list of dicts: [{"name": "VAN DER POEL Mathieu", "team": "Alpecin"}, ...]
    """
    try:
        resp = httpx.get(url, headers=PCS_HEADERS, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        _die(f"PCS returned HTTP {e.response.status_code} for {url}")
    except httpx.HTTPError as e:
        _die(f"PCS request failed: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")

    startlist_ul = soup.find("ul", class_="startlist_v4")
    if not startlist_ul:
        _die(
            "Could not find <ul class='startlist_v4'> in PCS page. "
            "The page structure may have changed, or the startlist is not yet published."
        )

    riders: list[dict] = []

    # Each top-level <li> is a team block
    for team_li in startlist_ul.find_all("li", recursive=False):
        team_tag = team_li.find("a", class_="team")
        team_name: str = team_tag.get_text(strip=True) if team_tag else ""

        # Nested <ul> contains the rider <li> elements
        rider_ul = team_li.find("ul")
        if not rider_ul:
            continue

        for rider_li in rider_ul.find_all("li", recursive=False):
            rider_a = rider_li.find("a")
            if not rider_a:
                continue
            name = rider_a.get_text(strip=True)
            if name:
                riders.append({"name": name, "team": team_name})

    return riders


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------


def build_holdet_index(
    riders: list[dict],
) -> dict[frozenset, int]:
    """Build a word-set → rider_id lookup from all Holdet riders.

    When the same real-world rider appears in multiple Holdet games (e.g. classics
    ID 42xxx and stage race ID 44xxx), we always prefer the lowest (canonical) ID.
    This guarantees consistency with form_results, which are stored under the
    canonical ID regardless of which game was being processed at scrape time.
    """
    index: dict[frozenset, int] = {}
    for r in riders:
        key = word_set(r["full_name"])
        if key in index:
            existing_id = index[key]
            canonical_id = min(existing_id, r["id"])
            if canonical_id != existing_id:
                index[key] = canonical_id
        else:
            index[key] = r["id"]
    return index


def match_name(
    pcs_name: str,
    index: dict[frozenset, int],
) -> Optional[int]:
    """Try to match a single PCS name to a Holdet rider id.

    Matching order:
    1. Manual override (exact word-set match against known edge cases)
    2. Exact word-set match
    3. Subset match — one name's words are a strict subset of the other
       (handles middle-name inclusion/exclusion between sources)
    """
    ws = word_set(pcs_name)

    # 1. Manual override
    if ws in MANUAL_OVERRIDES:
        return MANUAL_OVERRIDES[ws]

    # 2. Exact word-set match
    if ws in index:
        return index[ws]

    # 3. Subset match — find a Holdet entry whose word-set contains all of
    #    the PCS words, or whose word-set is entirely contained in the PCS words.
    #    Only accept if exactly one candidate matches (otherwise ambiguous).
    candidates: list[int] = []
    for holdet_ws, rider_id in index.items():
        if ws <= holdet_ws or holdet_ws <= ws:
            candidates.append(rider_id)

    if len(candidates) == 1:
        return candidates[0]

    return None


def match_all(
    pcs_riders: list[dict],
    holdet_riders: list[dict],
) -> tuple[list[int], list[str]]:
    """Match all PCS riders against Holdet riders.

    Returns:
        matched_ids  — list of Holdet rider ids that were successfully matched
        unmatched    — list of PCS name strings that had no match
    """
    index = build_holdet_index(holdet_riders)
    matched_ids: list[int] = []
    unmatched: list[str] = []

    for entry in pcs_riders:
        rider_id = match_name(entry["name"], index)
        if rider_id is not None:
            matched_ids.append(rider_id)
        else:
            unmatched.append(entry["name"])

    return matched_ids, unmatched


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape a PCS startlist and store matched riders in Supabase."
    )
    parser.add_argument(
        "--race",
        required=True,
        help="Race slug matching races.slug, e.g. strade-bianche",
    )
    args = parser.parse_args()

    load_dotenv_local()

    supabase_url = require_env("SUPABASE_URL")
    service_key = require_env("SUPABASE_SERVICE_KEY")
    supabase = create_client(supabase_url, service_key)

    # --- Look up race ---
    _log(f"→ Looking up race '{args.race}' in Supabase...")
    race = fetch_race(supabase, args.race)
    _log(f"✓ Found: {race['name']} {race['year']} → {race['pcs_url']}")

    # --- Scrape PCS ---
    startlist_url = build_startlist_url(race["pcs_url"])
    _log(f"→ Scraping PCS startlist: {startlist_url}")
    pcs_riders = scrape_startlist(startlist_url)
    _log(f"✓ Found {len(pcs_riders)} riders on PCS startlist")

    if not pcs_riders:
        _die("Startlist is empty — it may not be published yet.")

    # --- Load Holdet riders ---
    _log("→ Loading riders from Supabase...")
    holdet_riders = fetch_all_riders(supabase)
    _log(f"✓ Loaded {len(holdet_riders)} riders from Holdet")

    # --- Match ---
    _log("→ Matching names...")
    matched_ids, unmatched = match_all(pcs_riders, holdet_riders)
    _log(f"✓ Matched {len(matched_ids)} / {len(pcs_riders)} riders")

    # --- Insert startlist ---
    _log(f"→ Upserting startlist (race={args.race!r})...")
    inserted = upsert_startlist(supabase, args.race, matched_ids)
    _log(f"✓ Upserted {inserted} startlist rows")

    # --- Unmatched report ---
    if unmatched:
        _warn(f"\n{len(unmatched)} rider(s) could not be matched:")
        for name in sorted(unmatched):
            _warn(f"  UNMATCHED: {name}")
        _warn(
            "\nTo fix: add an entry to MANUAL_OVERRIDES in parse_pcs.py "
            "mapping the normalized word-set to the correct Holdet rider id."
        )

    # JSON summary for the Next.js API route
    result = {
        "ok": True,
        "race": args.race,
        "pcs_riders_found": len(pcs_riders),
        "matched": len(matched_ids),
        "unmatched": len(unmatched),
        "unmatched_names": unmatched,
        "startlist_rows_inserted": inserted,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
