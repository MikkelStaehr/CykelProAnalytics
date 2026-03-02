-- Migration 0004: Stage race support
-- Adds is_out to snapshots, game_type + budget to races,
-- and inserts the Paris-Nice 2026 stage race row.

-- snapshots: track rider abandonment (stage races only)
ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS is_out BOOLEAN NOT NULL DEFAULT FALSE;

-- races: distinguish classics vs stage races and store budget
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'classics';

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS budget INTEGER;

-- Paris-Nice 2026 (stage race, game ID 589)
-- pcs_url points to GC classification — the canonical results URL for a stage race
INSERT INTO races (slug, name, year, pcs_url, holdet_game_id, game_type, budget, profile)
VALUES (
  'paris-nice',
  'Paris-Nice',
  2026,
  'https://www.procyclingstats.com/race/paris-nice/2026/gc',
  589,
  'stage_race',
  50000000,
  'mountain'
)
ON CONFLICT (slug) DO UPDATE SET
  name           = EXCLUDED.name,
  year           = EXCLUDED.year,
  pcs_url        = EXCLUDED.pcs_url,
  holdet_game_id = EXCLUDED.holdet_game_id,
  game_type      = EXCLUDED.game_type,
  budget         = EXCLUDED.budget,
  profile        = EXCLUDED.profile;

COMMENT ON COLUMN snapshots.is_out   IS 'TRUE if rider has abandoned (stage races only). Riders with is_out=TRUE must be excluded from suggested team.';
COMMENT ON COLUMN races.game_type    IS '"classics" (category-based) or "stage_race" (budget-based).';
COMMENT ON COLUMN races.budget       IS 'Total budget for team selection (stage races). NULL for classics.';
