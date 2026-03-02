"""
analyse.py — Calculate per-rider analytics from snapshot data.

Usage:
    python scripts/analyse.py

Reads from Supabase and outputs computed metrics as JSON.

Metrics calculated:
    - total_points: sum of points across all races with points > 0
    - avg_points_per_race: total / number of races participated in
    - best_race: race with highest points
    - latest_race: most recent race with points > 0
    - trend: avg of last 3 races with points > 0
    - popularity: from latest snapshot
    - points_per_popularity: latest points / latest popularity
    - form_score: latest×3 + second_latest×2 + third_latest×1
    - form_flag: green / red / yellow / new

A rider "participated" in a race ONLY if points > 0 in the after-snapshot.
"""

import sys
import json


def main() -> None:
    # TODO: implement full analysis logic
    print(json.dumps({"error": "Not implemented yet"}), file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
