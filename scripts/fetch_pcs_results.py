"""
fetch_pcs_results.py — Scrape top-20 race results from PCS and store in form_results.

Usage:
    # One-day race (stage = NULL)
    python scripts/fetch_pcs_results.py --race strade-bianche --year 2025

    # GC classification (stage = 'overall')
    python scripts/fetch_pcs_results.py --race tour-de-france --year 2025 --type gc

    # Specific stage (stage = 'stage-1')
    python scripts/fetch_pcs_results.py --race tour-de-france --year 2025 --type stage --stage-nr 1

Flow:
    1. Fetch the results page from PCS
    2. Parse top-20 finishers (name, position)
    3. Match PCS names against Supabase riders table using normalization
    4. Ensure the race is registered in form_races (auto-creates a minimal entry)
    5. Upsert matched rows into form_results

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
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from supabase import create_client, Client
from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PCS_BASE = "https://www.procyclingstats.com"

PCS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Manual name overrides (same as parse_pcs.py)
MANUAL_OVERRIDES: dict[frozenset, int] = {
    frozenset({"HONORE", "MIKKEL", "FROLICH"}):      43023,
    frozenset({"JOHANNESSEN", "TOBIAS", "HALLAND"}): 43239,
}

TOP_N = 20   # how many finishers to store

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
# Name normalization (canonical form from CONTEXT.md)
# ---------------------------------------------------------------------------


def normalize(s: str) -> str:
    s = s.upper()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("-", " ").replace("Đ", "D")
    return " ".join(s.split())


def word_set(name: str) -> frozenset:
    return frozenset(normalize(name).split())


# ---------------------------------------------------------------------------
# PCS scraping
# ---------------------------------------------------------------------------


def build_results_url(slug: str, year: int, result_type: str, stage_nr: Optional[int]) -> str:
    """Construct the PCS URL for the requested result type."""
    if result_type == "result":
        return f"{PCS_BASE}/race/{slug}/{year}/result"
    elif result_type == "gc":
        return f"{PCS_BASE}/race/{slug}/{year}/gc"
    elif result_type == "stage" and stage_nr is not None:
        return f"{PCS_BASE}/race/{slug}/{year}/stage-{stage_nr}/result"
    else:
        return f"{PCS_BASE}/race/{slug}/{year}/result"


def stage_label(result_type: str, stage_nr: Optional[int]) -> Optional[str]:
    """Return the stage column value for form_results."""
    if result_type == "result":
        return None          # one-day race
    elif result_type == "gc":
        return "overall"
    elif result_type == "stage" and stage_nr is not None:
        return f"stage-{stage_nr}"
    return None


def scrape_results(url: str) -> list[dict]:
    """
    Fetch and parse a PCS results page.
    Returns list of {"position": int, "name": str} for top-20 finishers.
    """
    _log(f"  Fetching: {url}")
    try:
        resp = httpx.get(url, headers=PCS_HEADERS, timeout=30, follow_redirects=True)
        if resp.status_code == 404:
            _die(f"Results page not found (404): {url}")
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        _die(f"PCS returned HTTP {e.response.status_code} for {url}")
    except httpx.HTTPError as e:
        _die(f"HTTP error fetching results: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")
    return _parse_results_table(soup, url)


def _parse_results_table(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Parse a PCS results page.

    PCS results HTML structure (confirmed by inspection):
      <tr>
        <td>1</td>                    ← finishing position
        <td class="bibs">1</td>
        ...
        <td class="ridername">
          <div class="cont">
            <span class="flag xx"></span>
            <a href="rider/{slug}">   ← relative href, no leading slash
              <span class="uppercase">Lastname</span> Firstname
            </a>
          </div>
        </td>
        ...
      </tr>

    Name extraction: ' '.join(a.stripped_strings) → "Lastname Firstname"
    The normalization function handles accents + case, so word-set matching works.
    """
    # Rider links: relative href, exactly "rider/{slug}" (no path prefix)
    rider_re = re.compile(r"^rider/[\w-]+$")

    results: list[dict] = []
    seen_hrefs: set[str] = set()

    for a in soup.find_all("a", href=rider_re):
        href: str = a["href"]
        if href in seen_hrefs:
            continue
        seen_hrefs.add(href)

        # Extract name properly — the <a> contains <span>Lastname</span> Firstname
        name = " ".join(a.stripped_strings)
        if not name:
            continue

        # Get position from the first <td> in the parent <tr>
        row = a.find_parent("tr")
        position = len(results) + 1   # fallback: sequential order
        if row:
            first_td = row.find("td")
            if first_td:
                pos_text = re.sub(r"[^\d]", "", first_td.get_text(strip=True))
                if pos_text.isdigit():
                    position = int(pos_text)

        results.append({"position": position, "name": name})

        if len(results) >= TOP_N:
            break

    if not results:
        _warn(
            f"Could not parse results from {url}. "
            "The page may not have results yet, or PCS changed their markup."
        )

    return results


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------


def fetch_all_riders(supabase: Client) -> list[dict]:
    try:
        result = supabase.table("riders").select("id, full_name").execute()
    except APIError as e:
        _die(f"Supabase error fetching riders: {e}")
    return result.data or []


def ensure_form_race(supabase: Client, slug: str, year: int) -> None:
    """
    Make sure an entry exists in form_races for this slug.
    If not, insert a minimal placeholder — profile data can be filled by
    fetch_pcs_races.py later.
    """
    # slug for form_races is "{slug_base}-{year}" per fetch_pcs_races convention
    form_slug = f"{slug}-{year}"
    try:
        existing = (
            supabase.table("form_races")
            .select("slug")
            .eq("slug", form_slug)
            .execute()
        )
        if existing.data:
            return

        # Doesn't exist yet — insert a minimal placeholder
        _log(f"  Creating placeholder form_races row for {form_slug}")
        supabase.table("form_races").insert({
            "slug":    form_slug,
            "name":    slug.replace("-", " ").title(),
            "year":    year,
            "pcs_url": f"{PCS_BASE}/race/{slug}/{year}",
        }).execute()
    except APIError as e:
        _die(f"Supabase error checking/creating form_race '{form_slug}': {e}")


def upsert_results(
    supabase: Client,
    rows: list[dict],
) -> int:
    """Upsert into form_results. Returns count."""
    if not rows:
        return 0
    try:
        supabase.table("form_results").upsert(
            rows,
            on_conflict="rider_id,race_slug,year,stage",
        ).execute()
    except APIError as e:
        _die(f"form_results upsert failed: {e}")
    return len(rows)


# ---------------------------------------------------------------------------
# Name matching (same logic as parse_pcs.py)
# ---------------------------------------------------------------------------


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
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape top-20 PCS race results and store in form_results."
    )
    parser.add_argument(
        "--race",
        required=True,
        help="PCS race slug, e.g. strade-bianche (matches form_races slug_base)",
    )
    parser.add_argument(
        "--year",
        type=int,
        required=True,
        help="Race year, e.g. 2025",
    )
    parser.add_argument(
        "--type",
        choices=["result", "gc", "stage"],
        default="result",
        dest="result_type",
        help=(
            "Result type: 'result' = one-day / stage result (default), "
            "'gc' = GC classification, 'stage' = single stage"
        ),
    )
    parser.add_argument(
        "--stage-nr",
        type=int,
        default=None,
        dest="stage_nr",
        help="Stage number (required when --type stage)",
    )
    args = parser.parse_args()

    if args.result_type == "stage" and args.stage_nr is None:
        _die("--stage-nr is required when --type stage")

    load_dotenv_local()
    supabase_url = require_env("SUPABASE_URL")
    service_key  = require_env("SUPABASE_SERVICE_KEY")
    supabase = create_client(supabase_url, service_key)

    form_slug = f"{args.race}-{args.year}"   # key in form_races table
    stage = stage_label(args.result_type, args.stage_nr)

    # --- Step 1: ensure form_races entry exists ---
    _log(f"→ Checking form_races entry for '{form_slug}'...")
    ensure_form_race(supabase, args.race, args.year)

    # --- Step 2: scrape PCS results ---
    url = build_results_url(args.race, args.year, args.result_type, args.stage_nr)
    _log(f"→ Scraping PCS results...")
    pcs_results = scrape_results(url)
    _log(f"✓ Parsed {len(pcs_results)} results from PCS")

    if not pcs_results:
        print(json.dumps({
            "ok": False, "race": args.race, "year": args.year,
            "error": "No results parsed from PCS page",
        }))
        return

    # --- Step 3: load Holdet riders and match ---
    _log("→ Loading riders from Supabase for name matching...")
    holdet_riders = fetch_all_riders(supabase)
    _log(f"✓ Loaded {len(holdet_riders)} riders")

    index = build_holdet_index(holdet_riders)
    rows: list[dict] = []
    unmatched: list[str] = []

    for entry in pcs_results:
        rider_id = match_name(entry["name"], index)
        if rider_id is None:
            unmatched.append(f"{entry['position']}. {entry['name']}")
            continue
        rows.append({
            "rider_id":  rider_id,
            "race_slug": form_slug,
            "year":      args.year,
            "position":  entry["position"],
            "stage":     stage,
        })

    _log(f"✓ Matched {len(rows)} / {len(pcs_results)} riders")

    # --- Step 4: upsert ---
    _log(f"→ Upserting {len(rows)} results into form_results...")
    upserted = upsert_results(supabase, rows)
    _log(f"✓ Upserted {upserted} rows")

    if unmatched:
        _warn(f"\n{len(unmatched)} rider(s) not matched to Holdet database:")
        for name in unmatched:
            _warn(f"  UNMATCHED: {name}")
        _warn("These riders are likely not in the Holdet fantasy game (domestiques etc.) — this is expected.")

    result = {
        "ok":               True,
        "race":             args.race,
        "year":             args.year,
        "result_type":      args.result_type,
        "stage":            stage,
        "pcs_results_found": len(pcs_results),
        "matched":          len(rows),
        "unmatched":        len(unmatched),
        "unmatched_names":  unmatched,
        "upserted":         upserted,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
