-- Migration 0002: Race Profile System
-- Run this in the Supabase SQL Editor after 0001_initial_schema.sql

-- ---------------------------------------------------------------------------
-- Extend races table with profile columns
-- ---------------------------------------------------------------------------

ALTER TABLE races ADD COLUMN IF NOT EXISTS profile       TEXT;
ALTER TABLE races ADD COLUMN IF NOT EXISTS distance_km   INTEGER;
ALTER TABLE races ADD COLUMN IF NOT EXISTS elevation_m   INTEGER;
ALTER TABLE races ADD COLUMN IF NOT EXISTS profile_score INTEGER;

-- Seed known profiles for the 2026 classics season
UPDATE races SET profile = 'cobbled' WHERE slug = 'omloop-het-nieuwsblad';
UPDATE races SET profile = 'mixed'   WHERE slug = 'strade-bianche';
UPDATE races SET profile = 'flat'    WHERE slug = 'milano-sanremo';
UPDATE races SET profile = 'cobbled' WHERE slug = 'e3-harelbeke';
UPDATE races SET profile = 'cobbled' WHERE slug = 'gent-wevelgem';
UPDATE races SET profile = 'cobbled' WHERE slug = 'dwars-door-vlaanderen';
UPDATE races SET profile = 'cobbled' WHERE slug = 'ronde-van-vlaanderen';
UPDATE races SET profile = 'cobbled' WHERE slug = 'paris-roubaix';
UPDATE races SET profile = 'hilly'   WHERE slug = 'amstel-gold-race';
UPDATE races SET profile = 'hilly'   WHERE slug = 'la-fleche-wallone';
UPDATE races SET profile = 'hilly'   WHERE slug = 'liege-bastogne-liege';
UPDATE races SET profile = 'hilly'   WHERE slug = 'gp-quebec';
UPDATE races SET profile = 'hilly'   WHERE slug = 'gp-montreal';

-- ---------------------------------------------------------------------------
-- form_races: catalog of all UCI WT + PRT races used for form data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS form_races (
  slug          TEXT PRIMARY KEY,
  name          TEXT        NOT NULL,
  year          INTEGER     NOT NULL,
  profile       TEXT,
  distance_km   INTEGER,
  elevation_m   INTEGER,
  profile_score INTEGER,
  pcs_url       TEXT
);

-- Profile values are constrained to known types
ALTER TABLE form_races
  ADD CONSTRAINT form_races_profile_check
  CHECK (profile IN ('flat', 'cobbled', 'hilly', 'mixed', 'mountain') OR profile IS NULL);

-- ---------------------------------------------------------------------------
-- form_results: top-20 finishes per race used for profile scoring
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS form_results (
  id         SERIAL PRIMARY KEY,
  rider_id   INTEGER     REFERENCES riders(id),
  race_slug  TEXT        REFERENCES form_races(slug),
  year       INTEGER     NOT NULL,
  position   INTEGER     NOT NULL CHECK (position >= 1),
  stage      TEXT,                     -- NULL = one-day, 'overall' = GC, 'stage-N' = stage
  fetched_at TIMESTAMP   DEFAULT NOW(),
  UNIQUE (rider_id, race_slug, year, stage)
);

CREATE INDEX IF NOT EXISTS form_results_rider_idx    ON form_results (rider_id);
CREATE INDEX IF NOT EXISTS form_results_race_idx     ON form_results (race_slug, year);
CREATE INDEX IF NOT EXISTS form_results_position_idx ON form_results (race_slug, year, position);