"""
fetch_rider_profiles.py — Scrape PCS rider pages and store specialty/freshness data.

Usage:
    python scripts/fetch_rider_profiles.py --race strade-bianche
    python scripts/fetch_rider_profiles.py --race strade-bianche --force   # ignore 7-day cache

Flow:
    1. Fetch the PCS startlist for the given race to extract rider PCS slugs
    2. Match each PCS rider name to a Holdet rider ID
    3. Check rider_profiles table — skip riders with data fresher than 7 days
    4. For stale/missing riders: scrape procyclingstats.com/rider/{pcs_slug}
       - Extract career specialty points (Onedayraces, GC, TT, Sprint, Climber, Hills)
       - Extract most recent race result (date, position, race name)
       - Compute days_since_race
    5. Upsert into rider_profiles with 1.5s pause between requests

Requirements:
    pip install httpx beautifulsoup4 supabase

Environment variables (loaded from .env.local or shell):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import sys
import os
import re
import json
import time
import argparse
import unicodedata
from datetime import date, datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from supabase import create_client, Client
from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PCS_BASE = "https://www.procyclingstats.com"
CACHE_DAYS = 7        # re-scrape if older than this many days
PAUSE_S = 1.5         # pause between PCS requests

PCS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

MANUAL_OVERRIDES: dict[frozenset, int] = {
    frozenset({"HONORE", "MIKKEL", "FROLICH"}): 43023,
    frozenset({"JOHANNESSEN", "TOBIAS", "HALLAND"}): 43239,
}

# Riders absent from PCS startlist but present in Holdet — specify their PCS slug manually.
# Key: Holdet rider_id  Value: PCS slug (the path segment after /rider/)
# Add new entries whenever a rider is in Holdet but missing from the PCS startlist.
MANUAL_SLUG_OVERRIDES: dict[int, str] = {
    43231: "tim-wellens",  # Tim Wellens — not listed on PCS startlist for SB 2026
}

# Maps href suffix → rider_profiles column
SPECIALTY_HREF_MAP = {
    "career-points-one-day-races": "pts_oneday",
    "career-points-gc":            "pts_gc",
    "career-points-time-trial":    "pts_tt",
    "career-points-sprint":        "pts_sprint",
    "career-points-climbers":      "pts_climber",
    "career-points-hills":         "pts_hills",
}

# ---------------------------------------------------------------------------
# Environment / logging
# ---------------------------------------------------------------------------


def load_dotenv_local() -> None:
    env_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() and k.strip() not in os.environ:
                os.environ[k.strip()] = v.strip()


def require_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        _die(f"Missing required environment variable: {name}")
    return v  # type: ignore[return-value]


def _die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr)


def _log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Name normalization (same as parse_pcs.py / CONTEXT.md)
# ---------------------------------------------------------------------------


def normalize(s: str) -> str:
    s = s.upper()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("-", " ").replace("Đ", "D")
    return " ".join(s.split())


def word_set(name: str) -> frozenset:
    return frozenset(normalize(name).split())


def build_holdet_index(riders: list[dict]) -> dict[frozenset, int]:
    index: dict[frozenset, int] = {}
    for r in riders:
        key = word_set(r["full_name"])
        if key not in index:
            index[key] = r["id"]
    return index


def match_name(pcs_name: str, index: dict[frozenset, int]) -> Optional[int]:
    ws = word_set(pcs_name)
    if ws in MANUAL_OVERRIDES:
        return MANUAL_OVERRIDES[ws]
    if ws in index:
        return index[ws]
    candidates = [rid for hws, rid in index.items() if ws <= hws or hws <= ws]
    return candidates[0] if len(candidates) == 1 else None


# ---------------------------------------------------------------------------
# PCS startlist scraping — returns [{name, slug, team}]
# ---------------------------------------------------------------------------


def scrape_startlist(url: str) -> list[dict]:
    """Fetch PCS startlist and return rider names + PCS slugs."""
    try:
        resp = httpx.get(url, headers=PCS_HEADERS, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        _die(f"PCS returned HTTP {e.response.status_code} for {url}")
    except httpx.HTTPError as e:
        _die(f"PCS request failed: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")
    ul = soup.find("ul", class_="startlist_v4")
    if not ul:
        _die("Could not find <ul class='startlist_v4'>. Startlist not yet published?")

    riders: list[dict] = []
    for team_li in ul.find_all("li", recursive=False):
        rider_ul = team_li.find("ul")
        if not rider_ul:
            continue
        for rider_li in rider_ul.find_all("li", recursive=False):
            a = rider_li.find("a")
            if not a:
                continue
            name = a.get_text(strip=True)
            href = a.get("href", "")
            # href is like "rider/tadej-pogacar" (relative, no leading slash)
            slug = href.replace("rider/", "").strip().split("/")[0] if href.startswith("rider/") else ""
            if name and slug:
                riders.append({"name": name, "slug": slug})

    return riders


# ---------------------------------------------------------------------------
# PCS rider page scraping
# ---------------------------------------------------------------------------


def _infer_year(day: int, month: int, today: date) -> int:
    """Given DD.MM without year, infer the season year.

    If the race month is in the future relative to today → last year.
    Otherwise → this year.
    """
    if month > today.month or (month == today.month and day > today.day):
        return today.year - 1
    return today.year


def parse_specialties(soup: BeautifulSoup) -> dict:
    """Extract career specialty points from the rider page.

    Looks for <a> tags whose href contains 'career-points-{specialty}'.
    The score sits in the immediately enclosing <li> as plain text.
    """
    result: dict[str, int] = {col: 0 for col in SPECIALTY_HREF_MAP.values()}

    for href_part, col in SPECIALTY_HREF_MAP.items():
        link = soup.find("a", href=lambda h, p=href_part: h and p in h)
        if not link:
            continue
        # Walk up to the closest <li> and extract the first integer found
        container = link.find_parent("li") or link.parent
        if not container:
            continue
        # Collect only direct text (not link text) to avoid picking up link label
        direct_text = " ".join(
            t for t in container.find_all(string=True, recursive=False)
        )
        m = re.search(r"\d+", direct_text)
        if m:
            result[col] = int(m.group())
        else:
            # Fallback: any integer in the whole container before the link text
            full_text = container.get_text()
            link_text = link.get_text()
            before_link = full_text.split(link_text)[0]
            m2 = re.search(r"(\d+)\s*$", before_link)
            if m2:
                result[col] = int(m2.group(1))

    return result


def parse_last_race(soup: BeautifulSoup, today: date) -> dict:
    """Extract most recent race result from the rider results table.

    Returns dict with keys: last_race_name, last_race_pos, last_race_date, days_since_race
    """
    empty: dict = {
        "last_race_name": None,
        "last_race_pos": None,
        "last_race_date": None,
        "days_since_race": None,
    }

    # Find all tables with results — typically class="results"
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 3:
                continue

            # Try to parse first cell as a date in DD.MM format
            date_text = cells[0].get_text(strip=True)
            m = re.match(r"^(\d{1,2})\.(\d{1,2})$", date_text)
            if not m:
                continue

            day, month = int(m.group(1)), int(m.group(2))
            year = _infer_year(day, month, today)

            # Second cell: position (may be "1", "DNF", "DNS", etc.)
            pos_text = cells[1].get_text(strip=True)
            if not pos_text:
                pos_text = cells[2].get_text(strip=True)  # sometimes shifted

            # Third+ cell: race name via <a>
            race_link = None
            for cell in cells[2:]:
                race_link = cell.find("a")
                if race_link:
                    break
            race_name = race_link.get_text(strip=True) if race_link else None

            # Skip rows where position is empty or the race name is blank
            if not race_name:
                continue

            try:
                race_date = date(year, month, day)
            except ValueError:
                continue

            days_since = (today - race_date).days
            return {
                "last_race_name": race_name,
                "last_race_pos": pos_text,
                "last_race_date": race_date.isoformat(),
                "days_since_race": days_since,
            }

    return empty


def scrape_rider_profile(pcs_slug: str, today: date) -> Optional[dict]:
    """Scrape a single PCS rider page. Returns the profile dict or None on error."""
    url = f"{PCS_BASE}/rider/{pcs_slug}"
    try:
        resp = httpx.get(url, headers=PCS_HEADERS, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        _warn(f"PCS returned HTTP {e.response.status_code} for {url}")
        return None
    except httpx.HTTPError as e:
        _warn(f"PCS request failed for {pcs_slug}: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    specialties = parse_specialties(soup)
    last_race = parse_last_race(soup, today)

    return {**specialties, **last_race}


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------


def fetch_race_pcs_url(supabase: Client, slug: str) -> tuple[str, str]:
    """Return (pcs_url, year) for a race slug."""
    try:
        res = supabase.table("races").select("pcs_url, year").eq("slug", slug).single().execute()
    except APIError as e:
        _die(f"Supabase error fetching race '{slug}': {e}")
    if not res.data:
        _die(f"Race '{slug}' not found in races table.")
    # Build startlist URL from the race's pcs_url by stripping any known suffix.
    # Handles pcs_url values that end with /result, /gc, /stage-N,
    # or already /startlist/startlist (stored directly from the startlist page).
    base = re.sub(
        r"/(startlist/startlist|startlist|result|gc|stage[^/]*)$",
        "",
        res.data["pcs_url"],
    )
    startlist_url = f"{base}/startlist/startlist"
    return startlist_url, str(res.data["year"])


def fetch_existing_profiles(supabase: Client, rider_ids: list[int]) -> dict[int, dict]:
    """Return {rider_id: profile_row} for riders already in rider_profiles."""
    if not rider_ids:
        return {}
    try:
        res = supabase.table("rider_profiles").select("*").in_("rider_id", rider_ids).execute()
    except APIError as e:
        _die(f"Supabase error fetching rider_profiles: {e}")
    return {row["rider_id"]: row for row in (res.data or [])}


def fetch_all_riders(supabase: Client) -> list[dict]:
    try:
        res = supabase.table("riders").select("id, full_name").execute()
    except APIError as e:
        _die(f"Supabase error fetching riders: {e}")
    return res.data or []


def upsert_profiles(supabase: Client, rows: list[dict]) -> None:
    if not rows:
        return
    try:
        supabase.table("rider_profiles").upsert(rows, on_conflict="rider_id").execute()
    except APIError as e:
        _die(f"Supabase upsert failed: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape PCS rider profiles for all startlist riders."
    )
    parser.add_argument("--race", required=True, help="Race slug, e.g. strade-bianche")
    parser.add_argument(
        "--force", action="store_true",
        help="Ignore 7-day cache and re-scrape all riders"
    )
    args = parser.parse_args()

    load_dotenv_local()
    supabase_url = (
        os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    )
    if not supabase_url:
        _die("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
    service_key = require_env("SUPABASE_SERVICE_KEY")
    supabase = create_client(supabase_url, service_key)

    today = date.today()
    _log(f"→ Fetching startlist URL for race '{args.race}'...")
    startlist_url, _ = fetch_race_pcs_url(supabase, args.race)
    _log(f"✓ Startlist URL: {startlist_url}")

    # Scrape startlist to get PCS slugs
    _log("→ Scraping PCS startlist for rider slugs...")
    pcs_riders = scrape_startlist(startlist_url)
    _log(f"✓ Found {len(pcs_riders)} riders with PCS slugs")

    if not pcs_riders:
        _die("Startlist is empty or not yet published.")

    # Match PCS names → Holdet IDs
    holdet_riders = fetch_all_riders(supabase)
    index = build_holdet_index(holdet_riders)

    # Build list of (rider_id, pcs_slug) for matched riders
    matched: list[dict] = []
    unmatched: list[str] = []
    for entry in pcs_riders:
        rider_id = match_name(entry["name"], index)
        if rider_id is not None:
            matched.append({"rider_id": rider_id, "pcs_slug": entry["slug"]})
        else:
            unmatched.append(entry["name"])

    _log(f"✓ Matched {len(matched)} / {len(pcs_riders)} riders ({len(unmatched)} unmatched)")

    # Apply MANUAL_SLUG_OVERRIDES — add riders absent from PCS startlist
    matched_ids = {m["rider_id"] for m in matched}
    injected = 0
    for rider_id, pcs_slug in MANUAL_SLUG_OVERRIDES.items():
        if rider_id not in matched_ids:
            _log(f"  → Manual slug override: rider_id={rider_id} → {pcs_slug}")
            matched.append({"rider_id": rider_id, "pcs_slug": pcs_slug})
            injected += 1
    if injected:
        _log(f"✓ Injected {injected} manual override(s)")

    # Check which riders need refresh
    existing = fetch_existing_profiles(supabase, [m["rider_id"] for m in matched])
    cutoff = datetime.utcnow().isoformat()

    to_scrape: list[dict] = []
    skipped = 0
    for m in matched:
        rid = m["rider_id"]
        existing_row = existing.get(rid)
        if not args.force and existing_row:
            fetched_at_str = existing_row.get("fetched_at", "")
            try:
                fetched_at = datetime.fromisoformat(
                    fetched_at_str.replace("Z", "+00:00").replace("+00:00", "")
                )
                age_days = (datetime.utcnow() - fetched_at).days
                if age_days < CACHE_DAYS:
                    skipped += 1
                    continue
            except (ValueError, AttributeError):
                pass
        to_scrape.append(m)

    _log(f"→ {len(to_scrape)} riders to scrape ({skipped} skipped — data is fresh)")

    # Scrape each rider's PCS page
    upserted_count = 0
    failed_count = 0

    for i, entry in enumerate(to_scrape, 1):
        rider_id = entry["rider_id"]
        pcs_slug = entry["pcs_slug"]

        _log(f"  [{i}/{len(to_scrape)}] Scraping rider/{pcs_slug}...")
        profile = scrape_rider_profile(pcs_slug, today)

        if profile is None:
            _warn(f"  ⚠ Failed to scrape {pcs_slug}")
            failed_count += 1
        else:
            row = {
                "rider_id":       rider_id,
                "pcs_slug":       pcs_slug,
                "pts_oneday":     profile.get("pts_oneday", 0),
                "pts_gc":         profile.get("pts_gc", 0),
                "pts_tt":         profile.get("pts_tt", 0),
                "pts_sprint":     profile.get("pts_sprint", 0),
                "pts_climber":    profile.get("pts_climber", 0),
                "pts_hills":      profile.get("pts_hills", 0),
                "days_since_race": profile.get("days_since_race"),
                "last_race_name": profile.get("last_race_name"),
                "last_race_pos":  profile.get("last_race_pos"),
                "last_race_date": profile.get("last_race_date"),
                "fetched_at":     datetime.utcnow().isoformat(),
            }
            upsert_profiles(supabase, [row])
            days = profile.get("days_since_race")
            days_str = f"{days}d ago" if days is not None else "unknown"
            _log(
                f"  ✓ {pcs_slug}: oneday={profile.get('pts_oneday', 0)} "
                f"hills={profile.get('pts_hills', 0)} "
                f"climber={profile.get('pts_climber', 0)} "
                f"last_race={days_str}"
            )
            upserted_count += 1

        if i < len(to_scrape):
            time.sleep(PAUSE_S)

    _log(f"\n=== Done: {upserted_count} upserted, {failed_count} failed, {skipped} skipped (fresh) ===")

    result = {
        "ok": True,
        "race": args.race,
        "pcs_riders_found": len(pcs_riders),
        "matched": len(matched) - injected,
        "unmatched": len(unmatched),
        "injected_manual": injected,
        "skipped_fresh": skipped,
        "scraped": upserted_count,
        "failed": failed_count,
        "unmatched_names": unmatched,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
