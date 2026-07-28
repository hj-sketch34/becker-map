# senator-map — what this is

## The project, in Huck's words

A **public-facing map of what the senator has already done** — a map full of pins, each one a real place he made a difference. Click a pin, get the story: "he passed legislation that protected this creek," "he helped fund this public soccer field." People can see his record in the places they actually live.

**This replaced an earlier idea** (a live map of his *upcoming* events). Huck pivoted deliberately: publishing a public official's future locations is a safety risk. Past-tense is the whole point now. Don't drift back toward upcoming events.

## Who you are here

The builder. Huck supplies the real-world knowledge (which accomplishments are real, what actually matters about them); you handle the code and explain what you're doing as you go.

## The one thing to understand about this project

**The map is the easy part. The data is the hard part.** Anyone can drop pins on a map in an afternoon. Writing accurate, sourced, plain-English accomplishment entries is the actual work. So the data comes first — always.

## The second thing: every pin is a claim

"The senator protected this creek" is a political statement, and this map is public. Every pin needs a **source link** — a bill number, a press release, a news story. No source, no pin. This isn't bureaucracy; it's what makes the map credible instead of debatable.

Related: **don't overstate.** "Co-sponsored the bill that funded it" and "built it" are different things. Write what's true. Huck decides the wording — he knows the politics; you flag when a phrasing is doing more work than the source supports.

**Two kinds of pins.** A pin is either a **concrete accomplishment** (funding, legislation, a project he delivered) *or* a **show of support** — an in-person, sourced action where the senator showed up and materially helped a community in the district (e.g., he helped distribute food to underpaid farm workers in Pescadero). Shows of support use the `community` category. Both kinds follow the same rules: a real source link, inside District 13, past-tense only, no overstating. A show of support is still a *past* event — never an upcoming appearance.

## Build order

**Step 1 — Fix the data shape before collecting anything.** One row per accomplishment, these columns:

```
title, category, year, location_name, address, city, latitude, longitude, summary, source_url
```

- `category` — a small fixed list: environment, energy, housing, education, health, transportation, jobs, public-safety, infrastructure, tech, legislation, community. This is what lets you color the pins and add filters later. Keep the list short and stable. Most categories are concrete accomplishments; `community` is for *shows of support* (see the second thing, below).
- `year` — when it happened. Just a year is fine; a full date is better when known.
- `summary` — 2–3 plain sentences a normal person understands. This is the text in the popup. It's the whole product.
- `latitude` / `longitude` — filled in during Step 3, left blank at first.

Lives in `data/accomplishments.csv`. **This file is the database.** Don't overthink it — a plain file Huck can open and edit *is* a real database at this scale.

**Step 2 — Get real data flowing by hand.** 3–5 actual accomplishments from Huck (his boss, the senator's site, press releases, local news), typed into the CSV with sources. **Do not automate collection yet.** A handful of real rows unblocks the whole map and reveals which fields actually matter before investing in anything fancy.

**Step 3 — Turn addresses into map coordinates.** Pins need latitude/longitude; converting a street address into those is *geocoding* (Nominatim is free). Note the wrinkle: some accomplishments aren't street addresses — a creek, a stretch of highway, a whole district. Those get a hand-picked coordinate. Fine. Just pick a sensible point and move on.

**Step 4 — Build the map on that file.** Plain HTML + JavaScript reading the CSV, one pin per accomplishment, click for a popup with the title, summary, and source link. **Leaflet + OpenStreetMap** — free, no API key, no credit card. Ship a map with a few real pins before polishing anything.

**Step 5 — Only then, the nice-to-haves.** Filter by category, color-coded pins, photos, a timeline slider, search. All of that is **v2** and none of it matters until real pins exist.

Why this order: the map is worthless without data, and hand-entering a few entries teaches you the exact shape the real pipeline has to produce. Front-loading the boring part makes the rest easy.

## Where things live

- [todo.md](todo.md) — source of truth for tasks in this folder
- `data/accomplishments.csv` — the database (once Step 2 starts)
- `notes/` — verbatim pasted source material (once there is any)

## Capture-verbatim

If Huck pastes a press release, a bill summary, a news article, or an email about something the senator did — save it to `notes/` in its **original wording** first, then write the plain-English summary from the saved copy. He should never have to go re-find the source, and the original wording is the receipt behind the pin.

## Rules

- Mark a task done only when Huck confirms it.
- **Ask before publishing or deploying.** This is meant to be public eventually — that's a deliberate decision, not a default.
- **No pin without a source link.** A pin is either a concrete accomplishment or a show of support — either way it needs one.
- **Source links must be trustworthy.** Only an official government site (`*.gov` / `senate.ca.gov`), Becker's official accounts/office, or a reputable local news outlet — nothing else. `scripts/content_guard.py` checks this automatically.
- **Pins must sit inside District 13.** A pin's coordinates have to fall inside the SD13 boundary. `scripts/geo_guard.py` verifies every lat/lon against the district shape (a pin once landed in San Francisco, which is outside SD13). Out-of-district coordinates get fixed, not published.
- **Language stays professional and neutral.** Every summary should be plain, easy to read, and factual — and must **never** speak negatively or controversially about the senator. `content_guard.py` also lints the wording for this.
- **Never invent a category.** The allowed list is environment, energy, housing, education, health, transportation, jobs, public-safety, infrastructure, tech, legislation, community. If an accomplishment doesn't fit one, stop and ask Huck — he decides whether to bend it into an existing one or add a new one. Don't quietly create a new category or force a bad fit.
- **No upcoming events, no future locations.** That's the thing this project deliberately isn't. (Shows of support are *past* events only.)
- Accuracy over volume. Ten sourced pins beat fifty vague ones.
