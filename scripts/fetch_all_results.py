"""
fetch_all_results.py — Run fetch_pcs_results.py for every entry in form_races.

Usage:
    python3 scripts/fetch_all_results.py                    # all profiles
    python3 scripts/fetch_all_results.py --profile cobbled mixed
    python3 scripts/fetch_all_results.py --profile hilly

Reads slugs and pcs_urls live from Supabase so the list stays in sync
with the DB without editing this script.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent

# ── Load .env.local ───────────────────────────────────────────────────────────
env_path = ROOT / ".env.local"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase package not installed. Run: pip install supabase")
    sys.exit(1)

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch-fetch PCS results for all form_races")
    parser.add_argument(
        "--profile",
        nargs="*",
        default=[],
        help="Profile filter(s): cobbled mixed hilly flat mountain (empty = all)",
    )
    args = parser.parse_args()
    profile_filter = set(args.profile)

    sb = create_client(url, key)
    res = sb.table("form_races").select("slug,pcs_url,profile").order("profile,slug").execute()
    races = res.data

    filtered = [
        r for r in races
        if not profile_filter or r["profile"] in profile_filter
    ]

    print(f"=== fetch_all_results starting ===")
    print(f"Profile filter: {', '.join(profile_filter) if profile_filter else 'ALL'}")
    print(f"Races to process: {len(filtered)}")
    print()

    ok = 0
    fail = 0

    for r in filtered:
        slug    = r["slug"]      # e.g. "strade-bianche-2025"
        pcs_url = r["pcs_url"]
        profile = r["profile"]

        m = re.match(r"^(.+)-(\d{4})$", slug)
        if not m:
            print(f"  SKIP  {slug!r} — unexpected slug format")
            continue
        race_slug, year = m.group(1), m.group(2)
        result_type = "gc" if pcs_url.rstrip("/").endswith("/gc") else "result"

        print(f"→ {profile:8s}  {race_slug}  {year}  ({result_type})", flush=True)

        cmd = [
            sys.executable,
            str(ROOT / "scripts" / "fetch_pcs_results.py"),
            "--race", race_slug,
            "--year", year,
            "--type", result_type,
        ]
        result = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)

        if result.returncode == 0:
            lines = [l for l in result.stdout.splitlines() if l.strip()]
            summary = lines[-1] if lines else "(no output)"
            print(f"  OK    {summary}")
            ok += 1
        else:
            err_lines = result.stderr.strip().splitlines()
            err = err_lines[-1] if err_lines else "(unknown error)"
            print(f"  FAIL  {err}")
            fail += 1

        time.sleep(1.5)

    print()
    print(f"=== Done: {ok} OK, {fail} failed ===")


if __name__ == "__main__":
    main()
