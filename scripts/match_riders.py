"""
match_riders.py — Match PCS rider names to Holdet player IDs.

Usage:
    python scripts/match_riders.py --race <race_slug>

Reads PCS names from stdin (JSON array of strings) and outputs a mapping:
    { "LASTNAME Firstname": <holdet_player_id>, ... }

Uses fuzzy normalization + manual overrides for known edge cases.
"""

import sys
import json
import unicodedata
import argparse


# Manual overrides for names that can't be matched automatically.
# Key: normalized PCS name, Value: Holdet playerId
MANUAL_OVERRIDES: dict[str, int] = {
    "FROLICH HONORE MIKKEL": 43023,       # HONORÉ Mikkel Frølich
    "HALLAND JOHANNESSEN TOBIAS": 43239,  # JOHANNESSEN Tobias Halland
}


def normalize(s: str) -> str:
    """Normalize a rider name for fuzzy matching.

    Uppercases, strips accents, removes hyphens/apostrophes,
    and collapses whitespace. See CONTEXT.md for specification.
    """
    s = s.upper()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("-", " ").replace("Đ", "D")
    return " ".join(s.split())


def main() -> None:
    parser = argparse.ArgumentParser(description="Match PCS names to Holdet IDs")
    parser.add_argument("--race", required=True, help="Race slug for context")
    args = parser.parse_args()  # noqa: F841 — race used for logging later

    # TODO: implement full matching logic against Supabase riders table
    print(json.dumps({"error": "Not implemented yet"}), file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
