-- Migration 0003: rider_profiles
-- Stores per-rider data scraped from procyclingstats.com/rider/{pcs_slug}
-- One row per rider, refreshed when stale (> 7 days).

CREATE TABLE IF NOT EXISTS rider_profiles (
  rider_id         INTEGER PRIMARY KEY REFERENCES riders(id),
  pcs_slug         TEXT    NOT NULL,

  -- PCS career specialty points (raw totals from PCS rider page)
  -- These are cumulative career points, not normalized.
  pts_oneday       INTEGER NOT NULL DEFAULT 0,  -- One-day races
  pts_gc           INTEGER NOT NULL DEFAULT 0,  -- GC / stage race overall
  pts_tt           INTEGER NOT NULL DEFAULT 0,  -- Time trial
  pts_sprint       INTEGER NOT NULL DEFAULT 0,  -- Sprint
  pts_climber      INTEGER NOT NULL DEFAULT 0,  -- Climbing
  pts_hills        INTEGER NOT NULL DEFAULT 0,  -- Hilly one-day races

  -- Freshness signal (computed from most recent race result on PCS page)
  days_since_race  INTEGER,        -- NULL = no result found on page
  last_race_name   TEXT,
  last_race_pos    TEXT,           -- "1", "2", "DNF", "DNS", etc.
  last_race_date   DATE,

  fetched_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for freshness queries
CREATE INDEX IF NOT EXISTS idx_rider_profiles_fetched_at
  ON rider_profiles(fetched_at);

COMMENT ON TABLE rider_profiles IS
  'PCS rider page data: career specialty points and last-race freshness signal.
   Scraped by scripts/fetch_rider_profiles.py.
   Refresh if fetched_at < NOW() - INTERVAL ''7 days''.';
