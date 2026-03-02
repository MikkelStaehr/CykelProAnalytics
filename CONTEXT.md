# Fantasy Cycling Tracker — Project Context

## Vision
A web application for analyzing fantasy cycling data from Holdet.dk across a full classics season and multiple stage races. The app fetches data automatically via API/scraping, stores it in Supabase, and presents analytical insights to help with team selection. The architecture should be reusable for a future football scouting tool.

Holdet.dk runs two types of fantasy games:
- **Classics** (game ID 586) — category-based team selection (2/3/3/4), one team per race
- **Stage races** (Paris-Nice: 589, others TBD) — budget-based team selection (50,000,000 budget), transfers between stages

## Tech Stack
- **Frontend + API routes:** Next.js (App Router)
- **Database:** Supabase (Postgres)
- **Scraping/Analysis:** Python scripts called from Next.js API routes
- **Hosting:** Vercel

---

## Data Sources

### 1. Holdet.dk — Player Data
**Endpoint:**
```
GET https://nexus-app-fantasy-fargate.holdet.dk/api/games/586/players
```
Returns ~874 riders with:
```json
{
  "items": [
    {
      "playerId": 42962,
      "personId": 4551,
      "teamId": 192,
      "positionId": 261,
      "startPrice": 0,
      "priceChange": 0,
      "pointsChange": 0,
      "price": 0,
      "points": 0,
      "popularity": 0.1526,
      "trend": 0
    }
  ]
}
```

**Note:** Snapshots include `_embedded.persons` with rider names:
```json
{
  "_embedded": {
    "persons": {
      "4551": { "id": 4551, "firstName": "Mathieu", "lastName": "van der Poel" }
    },
    "teams": {
      "192": { "id": 192, "name": "Alpecin-Premier Tech", "abbreviation": "APT" }
    }
  }
}
```

**Category mapping (positionId) — classics only:**
- 260 = category_1 (top stars, highest price)
- 261 = category_2
- 262 = category_3
- 263 = category_4 (cheapest)

**Holdet team rules (classics):**
- Category 1: 2 riders
- Category 2: 3 riders
- Category 3: 3 riders
- Category 4: 4 riders
- Total: 12 riders

**Holdet team rules (stage races):**
- Budget: 50,000,000 (prices stored as integers, e.g. 4,000,000)
- No category restrictions — pick any riders within budget
- Transfers allowed between stages
- Value metric: expected points / price
-  — rider has abandoned, exclude from team

**Known game IDs:**
- 586 = Classics Manager 2026
- 589 = Paris-Nice 2026

**Important field difference:**
- Before-snapshots use 
- After-snapshots use 
- Always handle both: 
- Stage race snapshots include  and  fields

**Authentication:**
Holdet.dk uses NextAuth (authjs). Auth flow:
1. POST login credentials to `https://www.holdet.dk`
2. Receive `__Secure-authjs.session-token` cookie
3. Pass cookie on all subsequent calls to `nexus-app-fantasy-fargate.holdet.dk`

Session token expires after ~30 days. Store credentials in environment variables only.

**Important field difference:**
- Before-snapshots use `item.id`
- After-snapshots use `item.playerId`
- Always handle both: `id: item.id || item.playerId`

---

### 2. ProCyclingStats (PCS) — Startlists & Results

**Startlist URL pattern:**
```
https://www.procyclingstats.com/race/{race-slug}/{year}/startlist/startlist
```

**Results URL pattern:**
```
https://www.procyclingstats.com/race/{race-slug}/{year}/result         ← one-day race
https://www.procyclingstats.com/race/{race-slug}/{year}/gc             ← stage race GC
https://www.procyclingstats.com/race/{race-slug}/{year}/stage-{n}      ← individual stage
```

**Race catalogue:**
```
https://www.procyclingstats.com/races.php?year={year}
```
Filter for WorldTour (WT) and Pro Series (PRT) only.

**HTML parsing notes:**
- Rider links use relative paths without leading slash: `rider/tadej-pogacar`
- Rider names in `<span class="uppercase">LASTNAME</span> Firstname` format
- Stage race names vary — always normalize before matching

---

## Name Matching Logic
PCS names must be matched against Holdet.dk names using normalization:

```python
import unicodedata

def normalize(s):
    s = s.upper()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.replace("'", "").replace("-", " ").replace("Đ", "D")
    return ' '.join(s.split())
```

**Known manual overrides:**
- HONORÉ Mikkel Frølich → holdetId: 43023
- JOHANNESSEN Tobias Halland → holdetId: 43239

---

## Database Schema (Supabase)

```sql
-- Master rider table
CREATE TABLE riders (
  id          INTEGER PRIMARY KEY,  -- Holdet playerId
  person_id   INTEGER,
  first_name  TEXT,
  last_name   TEXT,
  full_name   TEXT,
  team_name   TEXT,
  team_abbr   TEXT,
  category    TEXT,
  category_nr INTEGER
);

-- One row per rider per race snapshot
CREATE TABLE snapshots (
  id          SERIAL PRIMARY KEY,
  rider_id    INTEGER REFERENCES riders(id),
  race        TEXT,      -- e.g. "strade-bianche"
  snapshot    TEXT,      -- "before" or "after"
  points      INTEGER,
  popularity  FLOAT,
  price       INTEGER,   -- rider price (stage races: e.g. 4000000, classics: 0)
  is_out      BOOLEAN,   -- rider abandoned (stage races only)
  fetched_at  TIMESTAMP DEFAULT NOW()
);

-- Which riders start which Holdet race
CREATE TABLE startlists (
  race        TEXT,
  rider_id    INTEGER REFERENCES riders(id),
  PRIMARY KEY (race, rider_id)
);

-- Holdet race registry (classics + stage races)
CREATE TABLE races (
  slug           TEXT PRIMARY KEY,
  name           TEXT,
  year           INTEGER,
  pcs_url        TEXT,
  holdet_game_id INTEGER,
  game_type      TEXT,   -- "classics" or "stage_race"
  budget         INTEGER, -- NULL for classics, 50000000 for stage races
  profile        TEXT,
  distance_km    INTEGER,
  elevation_m    INTEGER,
  profile_score  INTEGER
);

-- All WT/PRT races used for form data (not just Holdet races)
CREATE TABLE form_races (
  slug          TEXT PRIMARY KEY,
  name          TEXT,
  year          INTEGER,
  profile       TEXT,
  race_type     TEXT,      -- 'one_day' or 'stage_race'
  distance_km   INTEGER,
  elevation_m   INTEGER,
  profile_score INTEGER,
  pcs_url       TEXT
);

-- Top 20 results per race/stage
CREATE TABLE form_results (
  id            SERIAL PRIMARY KEY,
  rider_id      INTEGER REFERENCES riders(id),
  race_slug     TEXT REFERENCES form_races(slug),
  year          INTEGER,
  position      INTEGER,
  stage         TEXT,         -- NULL = one-day, 'overall' = GC, 'stage-1' etc.
  stage_profile TEXT,         -- profile of this specific stage
  fetched_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(rider_id, race_slug, year, stage)
);
```

---

## Race Profile System

### Profile Categories
```
flat      — sprinter races, minimal elevation (Milano-Sanremo, flat GT stages)
cobbled   — Belgian classics, cobblestones + punchy climbs (Omloop, RVV, E3, Roubaix)
hilly     — punchy climbs, no sustained gradients (Amstel, Flèche, LBL, GP Québec)
mixed     — gravel/dirt roads + climbs (Strade Bianche)
mountain  — sustained climbs, GC races (GT mountain stages)
```

### PROFILE_GROUPS (Cross-profile matching)
Profiles that share similar rider types are grouped for scoring:
```python
PROFILE_GROUPS = {
    "mixed":    ["mixed", "cobbled"],
    "cobbled":  ["cobbled", "mixed"],
    "hilly":    ["hilly"],
    "flat":     ["flat"],
    "mountain": ["mountain"]
}
```

### Stage Race Handling
Both GC and individual stages are tracked:
- `stage = NULL` → one-day race
- `stage = 'overall'` → GC classification
- `stage = 'stage-1'` etc. → individual stage
- `stage_profile` → profile of that specific stage

A mountain stage win in Tirreno counts toward `mountain` profile score even if Tirreno overall is classified differently.

### Rider Scoring Model
```
total_score = (profile_score × 0.40) + (form_score × 0.40) + (value_score × 0.20)
```

**Profile score (0-100):**
- Uses PROFILE_GROUPS to find relevant form_races
- Top 3 = 100pts, top 5 = 80pts, top 10 = 60pts, top 20 = 40pts
- Year weights: 2025 × 1.0, 2024 × 0.7, 2023 × 0.5
- Normalized to 0-100 within the startlist

**Form score (0-100):**
- Holdet points from current season
- Weighted: latest × 3 + second latest × 2 + third latest × 1
- Normalized to 0-100 within the startlist

**Value score (0-100):**
- Point per popularity unit, normalized within category
- Rewards low-owned riders who deliver

---

## Key Business Logic

### A rider "participated" in a race if:
- `points > 0` in the after-snapshot
- Popularity alone does NOT indicate participation

### Analysis metrics per rider:
- **Total points** — sum of all after-snapshots where points > 0
- **Races with data** — count of after-snapshots where points > 0
- **Avg points/race** — total / races with data
- **Best race** — race name + points of highest scoring race
- **Latest race** — most recent race where points > 0
- **Trend** — avg of last 3 races with points > 0
- **Popularity** — latest snapshot value
- **Point per popularity** — latest points / latest popularity
- **Form score** — weighted Holdet points
- **Profile score** — historical PCS results on similar race profiles
- **Total score** — combined model score

### Form flag:
- 🟢 Latest points >= avg × 1.5 (over-performed)
- 🔴 Latest points = 0 but has prior race data (under-performed)
- 🟡 Normal
- 🆕 No Holdet data yet — use profile score only

### Stage race value metric:
- Classic value = points / popularity
- Stage race value = expected points / (price / 1,000,000)

### Budget optimizer (stage races):
- Triggered automatically by `score_riders.py` when `races.game_type = 'stage_race'`
- Can also be forced with `--budget 50000000 --team-size 9`
- Algorithm:
  1. Filter out riders with `is_out = TRUE` or `price = 0`
  2. Sort by efficiency = `total_score / (price / 1,000,000)`
  3. Greedy pick until budget or team_size exhausted
  4. Single-swap refinement: replace any team member if a higher-scoring non-member fits within remaining budget
- Output includes `suggested_team` list alongside full `riders` ranking
- Riders with `isOut = true` are excluded from suggested team

---

## Python Scripts

| Script | Purpose |
|--------|---------|
| `fetch_holdet.py` | Login + fetch players, upsert riders + snapshots. Accepts `--game-id` (auto-detected from races table if omitted). |
| `parse_pcs.py` | Scrape PCS startlist, match riders, insert startlists |
| `fetch_pcs_races.py` | Scrape races.php, classify profiles, store in form_races |
| `fetch_pcs_results.py` | Scrape race results, match riders, store in form_results |
| `fetch_all_results.py` | Batch runner — all form_races with 1.5s pause between requests |
| `fetch_all_results.sh` | Shell wrapper — supports profile filter: `bash fetch_all_results.sh cobbled mixed` |
| `fetch_rider_profiles.py` | Scrape PCS rider profile for each rider on a startlist (with 7-day cache) |
| `score_riders.py` | Calculate total_score for all startlist riders. For stage races: runs budget optimizer if race has a budget set. |

---

## Rider Profile Scraping

### Purpose
Fetch current form signals from each rider's PCS profile page shortly before a race. This adds real-time context that historical results alone cannot provide.

### PCS Rider Profile URL
```
https://www.procyclingstats.com/rider/{rider-slug}
```

### Data to extract per rider
- **PCS form rating** — current form score shown on profile
- **Speciality scores** — one-day, GC, TT, sprint, climb, cobbles ratings
- **Recent results** — last 5 races: name, date, position
- **Days since last race** — calculated from most recent result date

### Database Extension
```sql
CREATE TABLE rider_profiles (
  id                   SERIAL PRIMARY KEY,
  rider_id             INTEGER REFERENCES riders(id),
  pcs_slug             TEXT,
  form_rating          INTEGER,
  speciality_one_day   INTEGER,
  speciality_gc        INTEGER,
  speciality_tt        INTEGER,
  speciality_sprint    INTEGER,
  speciality_climb     INTEGER,
  speciality_cobbles   INTEGER,
  last_race_name       TEXT,
  last_race_date       DATE,
  last_race_pos        INTEGER,
  days_since_race      INTEGER,
  recent_results       JSONB,
  fetched_at           TIMESTAMP DEFAULT NOW()
);
```

### Smart Caching Logic
Only fetches if existing data is older than 7 days:
- Fresh data (< 7 days) → skip
- Stale data (7+ days) → scrape and upsert

### When to fetch
- **One-day classics** → fetch all ~60 startlist riders day before race
- **Stage races** → fetch before stage 1 only. Stages 2+ reuse existing data since same riders and stage 1 IS their most recent race. Exception: re-fetch if a rider has abandoned.

### Impact on scoring model
**Freshness signal:**
- Raced within 7 days → no penalty
- 8-14 days → slight uncertainty flag
- 15+ days → show “unknown form” warning in UI

**Speciality match bonus:**
- cobbled race + high cobbles speciality → boost profile_score
- hilly race + high climb speciality → boost profile_score
- Adds nuance beyond just historical top-20 finishes

---

## UX & Design Principles

### Core philosophy: "One screen, one decision"
Every page answers exactly one question. The most important information is always at the top. The user should never have to search for what matters.

### Color palette (dark theme)
```
Background:   #0a0a0f
Surface/card: #111118
Border:       #1e1e2e
Text primary: #e8e8f0
Text muted:   #6b6b80
Accent blue:  #3b82f6
Green:        #22c55e  (good form, over-performance)
Amber:        #f59e0b  (neutral)
Red:          #ef4444  (bad form, under-performance)
```

### Form indicators
- 🟢 → slim green left border on row + green form score text
- 🔴 → slim red left border + red form score text
- 🟡 → no special styling
- 🆕 → muted grey "Ingen data" badge

### Table design
- No zebra striping — subtle hover highlight instead
- Sticky header when scrolling
- Column headers: muted uppercase, small font
- Sort indicator: small arrow icon
- Click column header to sort ascending/descending
- Tight rows, clear typography hierarchy

### Score visualization
- Total score: shown as a number + thin progress bar (0-100)
- Profile score, form score, value score: shown as three small colored bars or pills
- Makes it immediately obvious what drives a rider's ranking

---

## App Pages

### `/` — Dashboard
**Question: "What should my team look like for the next race?"**
- Season progress: X of 13 races completed
- Next race card: name, date, profile badge
- Suggested team split by category (2/3/3/4):
  - Each rider card: name, team abbr, total score, profile score, form score, popularity
  - Riders with 🟢 flag get green left border
- Quick stat cards: top scorer this season, best value pick, biggest form riser

### `/race-preview` — Race Preview
**Question: "Who should I consider for this race?"**
- Race dropdown + profile badge
- Three insight cards above table:
  - 🏆 Best profile match (historically dominates this race type)
  - 📈 Best current form (highest Holdet form score on startlist)
  - 💎 Best value (highest point per popularity on startlist)
- Full sortable table:
  - Rytter, Hold, Kat, Total Score, Profil Score, Form Score, Value, Pop, Flag
- Filter by category

### `/analyse` — Full Season Analysis
**Question: "Who is trending up or down across the season?"**
- Three insight cards:
  - Størst fremgang: top 3 riders with biggest positive trend vs average
  - Størst tilbagegang: top 3 riders with biggest negative trend
  - Bedste value: top 3 riders with highest point per popularity
- Full sortable table: all riders with Holdet data
- Filter by category, search by name
- Row coloring: green tint for 🟢, red tint for 🔴

### `/profil` — Race Profile Explorer
**Question: "What kind of rider wins this type of race?"**
- Select any race → see its profile and characteristics
- Historical top performers on this profile type (all years)
- Current startlist ranked by profile score
- Useful early in season before Holdet form data exists

### `/admin` — Data Management
**Question: "Is my data up to date?"**
- Status cards: last fetch time for Holdet snapshot, PCS startlist, form results
- Fetch Holdet snapshot: race dropdown + Before / After buttons
- Fetch PCS startlist: race dropdown + Fetch button
- Fetch PCS races: year input + Fetch button
- Fetch all form results: profile filter + Run button
- Live scrolling log output from each script

---

## Races (2026 Holdet Season)

### Classics (game ID: 586)
| Race | PCS slug | Date | Profile |
|------|----------|------|---------|
| Omloop Het Nieuwsblad | omloop-het-nieuwsblad | Mar 1 | cobbled |
| Strade Bianche | strade-bianche | Mar 8 | mixed |
| Milano-Sanremo | milano-sanremo | Mar 22 | flat |
| E3 Classic | e3-harelbeke | Mar 27 | cobbled |
| Gent-Wevelgem | gent-wevelgem | Mar 30 | cobbled |
| Dwars door Vlaanderen | dwars-door-vlaanderen | Apr 1 | cobbled |
| Ronde van Vlaanderen | ronde-van-vlaanderen | Apr 5 | cobbled |
| Paris-Roubaix | paris-roubaix | Apr 13 | cobbled |
| Amstel Gold Race | amstel-gold-race | Apr 20 | hilly |
| La Flèche Wallonne | la-fleche-wallone | Apr 23 | hilly |
| Liège-Bastogne-Liège | liege-bastogne-liege | Apr 27 | hilly |
| GP Québec | gp-quebec | Sep 12 | hilly |
| GP Montréal | gp-montreal | Sep 14 | hilly |

### Stage Races (budget: 50,000,000)
| Race | PCS slug | Date | Game ID | Status |
|------|----------|------|---------|--------|
| Paris-Nice | paris-nice | Mar 8-15 | 589 | ✅ confirmed |
| Volta a Catalunya | volta-a-catalunya | Mar 23-29 | TBD | ⏳ not yet available |
| Giro d'Italia | giro-d-italia | May-Jun | TBD | ⏳ not yet available |
| Tour de France | tour-de-france | Jul | TBD | ⏳ not yet available |
| Vuelta a España | vuelta-a-espana | Aug-Sep | TBD | ⏳ not yet available |

---

## Environment Variables
```
HOLDET_EMAIL=
HOLDET_PASSWORD=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```