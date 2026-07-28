# How to run the Becker map

Plain-English guide. All commands run from inside the `senator-map` folder.

## See the map

```
python3 -m http.server 8000 --directory site
```

Then open **http://localhost:8000** in your browser. Press `Ctrl+C` in the
terminal to stop the server when you're done.

## The easy way: add one pin from a link

This is the everyday path. **You give Claude a link about something the senator
did; Claude reads it and runs one command.** No heavy scraping, no running the
whole pipeline — adding a single pin costs one tiny map lookup (or zero).

What Claude runs (filling in the facts from the link):

```
python3 scripts/add.py \
  --title "$3 million secured for a new Foster City library wing" \
  --category education \
  --year 2024 \
  --location "Foster City Library" \
  --address "1000 E Hillsdale Blvd" \
  --city "Foster City" \
  --summary "Becker secured $3 million in the state budget to help ..." \
  --source "https://..."
```

`add.py` does everything in one shot: checks the category is a real one, refuses
duplicates (same link), adds the row to the database, finds the map coordinates
(cached — one lookup, or none if Claude passes `--lat`/`--lon`), and rebuilds the
map file. Refresh the browser and the pin is there.

The rules still apply. A pin can be **either** a concrete accomplishment (funding,
legislation, a project) **or** a show of support — the senator showing up in person
and helping a community here (category `community`). Either way: no pin without a
source link, don't overstate, District 13 places only (coordinates inside SD13),
past accomplishments only.

## The full pipeline (how a big batch gets found and added)

Use this only when you want to sweep ALL of the senator's press releases at once.
For a single link, use the easy way above instead.


Each script does one job. Run them in this order when you want fresh data:

| Step | Command | What it does |
|------|---------|--------------|
| 1 | `python3 scripts/fetch_press_releases.py` | Gets the list of every press release (title, link, date) → `data/raw-press-releases.json` |
| 2 | `python3 scripts/fetch_bodies.py` | Downloads the full text of each release (cached) → `data/release-bodies.json` |
| 3 | `python3 scripts/build_candidates.py` | Drafts a review list with best-guess category + place → `data/candidates.csv` |
| — | **You + Claude review** | Pick the real ones, fix wording, put them in `data/accomplishments.csv` |
| 4 | `python3 scripts/geocode.py` | Turns addresses into map coordinates (cached) |
| 5 | `python3 scripts/build_site_data.py` | Packages approved pins for the web page → `site/accomplishments.json` |

Steps 1–3 are safe to re-run anytime; they only add **new** releases (they skip
anything already seen).

## The important files

- `data/accomplishments.csv` — **the database.** Approved pins live here. This is the file to edit by hand.
- `data/candidates.csv` — the review list of everything the finder drafted (not on the map).
- `site/` — the web page (`index.html`, `map.js`, and the generated `accomplishments.json`).

## The rules that never change

- A pin is either a concrete accomplishment (funding, legislation, a project) or a
  show of support — the senator showing up in person and materially helping a
  district community (category `community`). Same rules either way.
- No pin without a source link. Source links must point to an official government
  site (`*.gov` / `senate.ca.gov`), Becker's official accounts/office, or a
  reputable local news outlet — nothing else. `scripts/content_guard.py` checks this.
- Real category only: environment, energy, housing, education, health,
  transportation, jobs, public-safety, infrastructure, tech, legislation, community.
- Coordinates must fall inside SD13. `scripts/geo_guard.py` verifies every lat/lon
  against the district shape — fix out-of-district pins, don't publish them (one
  once landed in San Francisco, outside the district).
- Language stays professional, plain, neutral, and factual — never negative or
  controversial about the senator. `content_guard.py` lints the wording too.
- Don't overstate — "secured funds," not "built it."
- Past accomplishments only. No upcoming events (shows of support are past events too).
