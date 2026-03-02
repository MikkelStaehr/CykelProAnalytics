"""
fetch_pcs_races.py — Scrape UCI WT + PRT races from PCS and store in form_races.

Usage:
    python scripts/fetch_pcs_races.py --year 2025
    python scripts/fetch_pcs_races.py --year 2025 --dry-run

Flow:
    1. Fetch https://www.procyclingstats.com/races.php?year={year}
    2. Parse all races, keep only WT (1.UWT, 2.UWT) and Pro Series (1.Pro, 2.Pro)
    3. For each race, fetch its main page to get distance, elevation, profile score
    4. Classify the race profile (flat / cobbled / hilly / mixed / mountain)
    5. Upsert into form_races table

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

import httpx
from bs4 import BeautifulSoup
from supabase import create_client, Client
from postgrest.exceptions import APIError
from typing import Optional

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
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# PCS race class strings that indicate WT or Pro Series status
WT_CLASSES = {"1.UWT", "2.UWT", "1.WT", "2.WT", "ME - 1.UWT", "ME - 2.UWT"}
PRT_CLASSES = {"1.Pro", "2.Pro", "ME - 1.Pro", "ME - 2.Pro"}
VALID_CLASSES = WT_CLASSES | PRT_CLASSES

# Hardcoded profile overrides for well-known races (slug keyword → profile).
# Checked before falling back to the scoring heuristic.
PROFILE_OVERRIDES: dict[str, str] = {
    "strade-bianche":        "mixed",
    "omloop":                "cobbled",
    "ronde-van-vlaanderen":  "cobbled",
    "paris-roubaix":         "cobbled",
    "parijs-roubaix":        "cobbled",
    "e3-harelbeke":          "cobbled",
    "e3-saxo-bank-classic":  "cobbled",
    "gent-wevelgem":         "cobbled",
    "dwars-door-vlaanderen": "cobbled",
    "kuurne":                "cobbled",
    "scheldeprijs":          "flat",
    "brugge-de-panne":       "flat",
    "milano-sanremo":        "flat",
    "milan-san-remo":        "flat",
    "amstel-gold-race":      "hilly",
    "la-fleche-wallonne":    "hilly",
    "fleche-wallonne":       "hilly",
    "liege-bastogne-liege":  "hilly",
    "gp-quebec":             "hilly",
    "gp-montreal":           "hilly",
}

REQUEST_DELAY = 1.5  # seconds between PCS requests (be polite)

# ---------------------------------------------------------------------------
# Environment helpers  (shared pattern from other scripts)
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
# Profile classification
# ---------------------------------------------------------------------------


def classify_profile(
    slug: str,
    name: str,
    elevation_m: Optional[int],
    profile_score: Optional[int],
) -> str:
    """Return one of: flat, cobbled, hilly, mixed, mountain."""
    # 1. Hardcoded overrides — most reliable
    slug_l = slug.lower()
    for keyword, profile in PROFILE_OVERRIDES.items():
        if keyword in slug_l:
            return profile

    # 2. Also check race name for known keywords
    name_l = name.lower()
    if "strade bianche" in name_l:
        return "mixed"
    if any(k in name_l for k in ("omloop", "ronde van vlaanderen", "paris-roubaix",
                                   "gent-wevelgem", "e3 ", "dwars door")):
        return "cobbled"

    # 3. Use PCS profile score if available
    if profile_score is not None:
        if profile_score >= 60:
            return "mountain"
        elif profile_score >= 35:
            return "hilly"
        elif profile_score >= 15:
            # Could be hilly or flat; use elevation as tie-breaker
            if elevation_m is not None and elevation_m > 2500:
                return "hilly"
            return "flat"
        else:
            return "flat"

    # 4. Fall back to elevation alone
    if elevation_m is not None:
        if elevation_m > 4500:
            return "mountain"
        elif elevation_m > 2000:
            return "hilly"
        else:
            return "flat"

    return "flat"  # final default


# ---------------------------------------------------------------------------
# PCS scraping helpers
# ---------------------------------------------------------------------------


def pcs_get(url: str, client: httpx.Client, retries: int = 2) -> BeautifulSoup:
    """Fetch a PCS URL and return a BeautifulSoup object, with retry on 5xx."""
    for attempt in range(retries + 1):
        try:
            resp = client.get(url, timeout=30, follow_redirects=True)
            if resp.status_code == 404:
                return BeautifulSoup("", "html.parser")
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except httpx.HTTPStatusError as e:
            if attempt < retries and e.response.status_code >= 500:
                _warn(f"HTTP {e.response.status_code} for {url} — retrying in 3s")
                time.sleep(3)
                continue
            _die(f"PCS returned HTTP {e.response.status_code} for {url}")
        except httpx.HTTPError as e:
            _die(f"HTTP error for {url}: {e}")
    return BeautifulSoup("", "html.parser")


def scrape_races_list(year: int, client: httpx.Client) -> list[dict]:
    """
    Fetch and parse procyclingstats.com/races.php for a given year.

    PCS renders the calendar as a simple <table> where each row has:
      Col 0: date range  Col 1: start date  Col 2: Race link  Col 3: Winner  Col 4: Class

    The race link href is /race/{slug}/{year}/{result|gc}.
    The class string (e.g. "1.UWT") is in the last <td> of the row.
    Riders are listed in finishing order — no explicit position numbers.
    """
    url = f"{PCS_BASE}/races.php?year={year}"
    _log(f"  Fetching race list: {url}")
    soup = pcs_get(url, client)
    time.sleep(REQUEST_DELAY)

    # PCS uses relative hrefs without leading slash:
    #   race/{slug}/{year}/result   or   race/{slug}/{year}/gc
    race_link_re = re.compile(r"^race/([\w-]+)/(\d{4})/(result|gc)$")

    races: list[dict] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=race_link_re):
        href: str = a["href"]
        m = race_link_re.match(href)
        if not m:
            continue

        slug_base = m.group(1)
        link_year = int(m.group(2))

        if link_year != year:
            continue

        # Avoid duplicates (some races link twice on the page)
        if slug_base in seen:
            continue

        # Class is in the last <td> of the parent <tr>
        row = a.find_parent("tr")
        if not row:
            continue

        cells = row.find_all("td")
        if not cells:
            continue

        race_class = cells[-1].get_text(strip=True)
        matched_class = next((c for c in VALID_CLASSES if c in race_class), None)
        if not matched_class:
            continue

        seen.add(slug_base)

        races.append({
            "slug":       f"{slug_base}-{link_year}",
            "slug_base":  slug_base,
            "name":       a.get_text(strip=True),
            "year":       link_year,
            "pcs_url":    f"{PCS_BASE}/{href}",
            "race_class": matched_class,
        })

    return races


def scrape_race_profile(slug_base: str, year: int, client: httpx.Client) -> dict:
    """
    Fetch the PCS race page and extract distance, elevation, profile score.
    Returns dict with keys: distance_km, elevation_m, profile_score (all may be None).
    """
    url = f"{PCS_BASE}/race/{slug_base}/{year}"
    soup = pcs_get(url, client)
    time.sleep(REQUEST_DELAY)

    result: dict = {"distance_km": None, "elevation_m": None, "profile_score": None}

    # PCS infolist: <ul class="infolist"> with <li> children containing
    # <div class="f1">Label</div><div class="f2">Value</div>
    infolist = soup.find("ul", class_="infolist")
    if not infolist:
        # Some pages use a different structure; fall back to text search
        return _parse_profile_from_text(soup.get_text())

    for li in infolist.find_all("li"):
        f1 = li.find(class_="f1")
        f2 = li.find(class_="f2")
        if not f1 or not f2:
            continue
        label = f1.get_text(strip=True).lower()
        value = f2.get_text(strip=True)

        if "distance" in label:
            m = re.search(r"(\d[\d,\.]*)", value)
            if m:
                result["distance_km"] = int(float(m.group(1).replace(",", "")))

        elif "vertical" in label or "elevation" in label or "metres" in label:
            m = re.search(r"(\d[\d,\.]*)", value)
            if m:
                result["elevation_m"] = int(float(m.group(1).replace(",", "")))

        elif "profile" in label and "score" in label:
            m = re.search(r"(\d+)", value)
            if m:
                result["profile_score"] = int(m.group(1))

    return result


def _parse_profile_from_text(text: str) -> dict:
    """Fallback: extract profile numbers from page text using regex."""
    result: dict = {"distance_km": None, "elevation_m": None, "profile_score": None}

    m = re.search(r"Distance[:\s]+(\d[\d,.]+)\s*km", text, re.I)
    if m:
        result["distance_km"] = int(float(m.group(1).replace(",", "")))

    m = re.search(r"(?:Vertical|Elevation)[^:]*:[^\d]*(\d[\d,]+)\s*m", text, re.I)
    if m:
        result["elevation_m"] = int(m.group(1).replace(",", ""))

    m = re.search(r"Profile\s+score[:\s]+(\d+)", text, re.I)
    if m:
        result["profile_score"] = int(m.group(1))

    return result


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------


def upsert_form_races(supabase: Client, rows: list[dict]) -> int:
    """Upsert rows into form_races. Returns count upserted."""
    if not rows:
        return 0
    try:
        supabase.table("form_races").upsert(rows, on_conflict="slug").execute()
    except APIError as e:
        _die(f"form_races upsert failed: {e}")
    return len(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape UCI WT+PRT races from PCS and store in form_races table."
    )
    parser.add_argument(
        "--year",
        type=int,
        default=2025,
        help="Season year to scrape (default: 2025)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print results without writing to Supabase",
    )
    args = parser.parse_args()

    load_dotenv_local()

    if not args.dry_run:
        supabase_url = require_env("SUPABASE_URL")
        service_key  = require_env("SUPABASE_SERVICE_KEY")
        supabase = create_client(supabase_url, service_key)
    else:
        supabase = None  # type: ignore[assignment]

    with httpx.Client(headers=PCS_HEADERS) as client:
        # --- Step 1: scrape race list ---
        _log(f"→ Scraping PCS race list for {args.year}...")
        races = scrape_races_list(args.year, client)
        _log(f"✓ Found {len(races)} WT/PRT races")

        if not races:
            _warn(
                "No races found. PCS page structure may have changed.\n"
                "Check the selectors in scrape_races_list() and "
                "_scrape_races_alternative()."
            )
            print(json.dumps({"ok": False, "year": args.year, "races_found": 0}))
            return

        # --- Step 2: enrich each race with profile data ---
        rows: list[dict] = []
        for i, race in enumerate(races, 1):
            _log(f"  [{i}/{len(races)}] {race['name']} ({race['year']}) ...")
            profile_data = scrape_race_profile(race["slug_base"], race["year"], client)

            profile_type = classify_profile(
                race["slug_base"],
                race["name"],
                profile_data.get("elevation_m"),
                profile_data.get("profile_score"),
            )

            row = {
                "slug":          race["slug"],
                "name":          race["name"],
                "year":          race["year"],
                "profile":       profile_type,
                "distance_km":   profile_data.get("distance_km"),
                "elevation_m":   profile_data.get("elevation_m"),
                "profile_score": profile_data.get("profile_score"),
                "pcs_url":       race["pcs_url"],
            }
            rows.append(row)

            _log(
                f"     profile={profile_type}  "
                f"dist={row['distance_km']}km  "
                f"elev={row['elevation_m']}m  "
                f"score={row['profile_score']}"
            )

        # --- Step 3: upsert ---
        if args.dry_run:
            _log("\n--- DRY RUN: would upsert these rows ---")
            for r in rows:
                _log(f"  {r}")
            upserted = 0
        else:
            _log(f"\n→ Upserting {len(rows)} rows into form_races...")
            upserted = upsert_form_races(supabase, rows)
            _log(f"✓ Upserted {upserted} rows")

    # JSON summary for Next.js API
    by_profile: dict[str, int] = {}
    for r in rows:
        p = r["profile"] or "unknown"
        by_profile[p] = by_profile.get(p, 0) + 1

    result = {
        "ok":          True,
        "year":        args.year,
        "races_found": len(races),
        "upserted":    upserted,
        "by_profile":  by_profile,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
