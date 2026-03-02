-- CykelPro Analytics — Initial Schema
-- Run this in the Supabase SQL editor or via `supabase db push`.

-- ============================================================
-- races — registry of all races in the season
-- ============================================================
CREATE TABLE IF NOT EXISTS races (
  slug            TEXT PRIMARY KEY,       -- e.g. "strade-bianche"
  name            TEXT NOT NULL,          -- e.g. "Strade Bianche"
  year            INTEGER NOT NULL,
  pcs_url         TEXT NOT NULL,
  holdet_game_id  INTEGER NOT NULL        -- e.g. 586
);

-- Seed the 2026 classics season
INSERT INTO races (slug, name, year, pcs_url, holdet_game_id) VALUES
  ('omloop-het-nieuwsblad', 'Omloop Het Nieuwsblad', 2026, 'https://www.procyclingstats.com/race/omloop-het-nieuwsblad/2026/startlist/startlist', 586),
  ('strade-bianche',        'Strade Bianche',        2026, 'https://www.procyclingstats.com/race/strade-bianche/2026/startlist/startlist',        586),
  ('milano-sanremo',        'Milano-Sanremo',        2026, 'https://www.procyclingstats.com/race/milano-sanremo/2026/startlist/startlist',        586),
  ('e3-harelbeke',          'E3 Classic',            2026, 'https://www.procyclingstats.com/race/e3-harelbeke/2026/startlist/startlist',          586),
  ('gent-wevelgem',         'Gent-Wevelgem',         2026, 'https://www.procyclingstats.com/race/gent-wevelgem/2026/startlist/startlist',         586),
  ('dwars-door-vlaanderen', 'Dwars door Vlaanderen', 2026, 'https://www.procyclingstats.com/race/dwars-door-vlaanderen/2026/startlist/startlist', 586),
  ('ronde-van-vlaanderen',  'Ronde van Vlaanderen',  2026, 'https://www.procyclingstats.com/race/ronde-van-vlaanderen/2026/startlist/startlist',  586),
  ('paris-roubaix',         'Paris-Roubaix',         2026, 'https://www.procyclingstats.com/race/paris-roubaix/2026/startlist/startlist',         586),
  ('amstel-gold-race',      'Amstel Gold Race',      2026, 'https://www.procyclingstats.com/race/amstel-gold-race/2026/startlist/startlist',      586),
  ('la-fleche-wallone',     'La Flèche Wallonne',    2026, 'https://www.procyclingstats.com/race/la-fleche-wallone/2026/startlist/startlist',     586),
  ('liege-bastogne-liege',  'Liège-Bastogne-Liège',  2026, 'https://www.procyclingstats.com/race/liege-bastogne-liege/2026/startlist/startlist',  586),
  ('gp-quebec',             'GP Québec',             2026, 'https://www.procyclingstats.com/race/gp-quebec/2026/startlist/startlist',             586),
  ('gp-montreal',           'GP Montréal',           2026, 'https://www.procyclingstats.com/race/gp-montreal/2026/startlist/startlist',           586)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- riders — master rider table (id = Holdet playerId)
-- ============================================================
CREATE TABLE IF NOT EXISTS riders (
  id           INTEGER PRIMARY KEY,   -- Holdet playerId
  person_id    INTEGER NOT NULL,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  team_name    TEXT NOT NULL,
  team_abbr    TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('category_1', 'category_2', 'category_3', 'category_4')),
  category_nr  INTEGER NOT NULL CHECK (category_nr BETWEEN 1 AND 4)
);

-- ============================================================
-- snapshots — one row per rider per race per before/after
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id          SERIAL PRIMARY KEY,
  rider_id    INTEGER NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  race        TEXT NOT NULL,       -- e.g. "StradeBianche2026"
  snapshot    TEXT NOT NULL CHECK (snapshot IN ('before', 'after')),
  points      INTEGER NOT NULL DEFAULT 0,
  popularity  FLOAT NOT NULL DEFAULT 0,
  price       INTEGER NOT NULL DEFAULT 0,
  fetched_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_rider_id ON snapshots(rider_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_race     ON snapshots(race);
CREATE INDEX IF NOT EXISTS idx_snapshots_snapshot ON snapshots(snapshot);

-- Prevent duplicate before/after entries per rider per race
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
  ON snapshots(rider_id, race, snapshot);

-- ============================================================
-- startlists — which riders are registered to start each race
-- ============================================================
CREATE TABLE IF NOT EXISTS startlists (
  race      TEXT NOT NULL,
  rider_id  INTEGER NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  PRIMARY KEY (race, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_startlists_race ON startlists(race);
