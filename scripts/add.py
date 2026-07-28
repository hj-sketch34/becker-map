"""
add.py  —  THE EASY WAY to add one pin to the map

What this does, in plain English:
  You (or Claude, reading a link you pasted) run ONE command with the facts of a
  single accomplishment. This script:
    1. checks the category is one of the allowed ones,
    2. skips it only if the EXACT same pin is already on the map (same source
       link AND same title) — one URL can back several pins, because a single
       budget release often announces several separate projects,
    3. appends the row to  data/accomplishments.csv  (the database),
    4. finds its map coordinates — for FREE and with almost no computing:
         - if you passed --lat/--lon, it just uses those (no internet at all),
         - otherwise it looks up ONLY this one place (cached, so re-runs are instant),
    5. rebuilds  site/accomplishments.json  so the map shows the new pin.

  This is the lightweight path. It does NOT re-scrape the 220 press releases.
  Adding one pin from a link costs one tiny lookup (or zero, with --lat/--lon).

Typical use (Claude fills these in after reading the link you gave it):

  python3 scripts/add.py \
    --title "$3 million secured for a new Foster City library wing" \
    --category education \
    --year 2024 \
    --location "Foster City Library" \
    --address "1000 E Hillsdale Blvd" \
    --city "Foster City" \
    --summary "Becker secured $3 million in the state budget to help build ..." \
    --source "https://sd13.senate.ca.gov/news/press-release/..."

  Add --lat 37.55 --lon -122.27 to skip the internet lookup entirely.

The allowed categories (never invent a new one — ask Huck first):
  environment, energy, housing, education, health, transportation, jobs,
  public-safety, infrastructure, tech, legislation, community

Before it adds anything, this script now runs three guardrails so a bad pin
never reaches the map:
  1. SOURCE   — the link must be an official government site (*.gov /
     senate.ca.gov), Becker's official account/office, or a reputable local
     news outlet.                                    (scripts/content_guard.py)
  2. LANGUAGE — the wording must be professional, neutral, and easy to read,
     and must never speak negatively about the senator.  (content_guard.py)
  2b. SOURCE STANCE — if you pass --source-title, the source article's headline
     is checked for wording that's critical of the senator (e.g. "few appear to
     use them"). A critical source is refused even if the outlet is allowed, so
     the map never routes a constituent to a story that undercuts him.
  3. DISTRICT — the coordinates must fall INSIDE Senate District 13. This is
     the check that stops the "South SF pin landed in San Francisco" mistake.
                                                          (scripts/geo_guard.py)
"""

import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path

# The two guardrail modules live next to this script. Because we run this as
# `python3 scripts/add.py`, the scripts/ folder is already on the import path.
import geo_guard        # is this lat/lon actually inside Senate District 13?
import content_guard    # is the source link trustworthy? is the wording OK?

ROOT = Path(__file__).resolve().parent.parent
ACCOMPLISHMENTS_FILE = ROOT / "data" / "accomplishments.csv"
SCRIPTS = ROOT / "scripts"

# Must match the fixed list in build_site_data.py. No pin may use a category
# outside this list — that's a project rule, not a suggestion.
ALLOWED_CATEGORIES = {
    "environment", "energy", "housing", "education", "health", "transportation",
    "jobs", "public-safety", "infrastructure", "tech", "legislation",
    "recognition",  # shows of support / appreciation — ribbon-cuttings, food
                    # drives, and "___ of the Year" awards. Kept SEPARATE from
                    # the funding/legislative categories on purpose, so honoring
                    # a local business doesn't sit in the same bucket as a big
                    # legislative win. (Replaced the old "community" category.)
}

# The columns the database uses. accomplishments.csv has no 'place_hints' column
# (that one is only a review helper over in candidates.csv), so we don't write it.
COLUMNS = [
    "id", "source_type", "status", "title", "category", "year",
    "location_name", "address", "city", "latitude", "longitude",
    "summary", "source_url",
]


def make_id(source, title):
    """
    A pin's unique id = its source link + a short slug of its title.

    Why not just the source link? Because ONE press release often announces
    several different accomplishments (e.g. a budget release naming a park, a
    housing project, and a pier repair), and each of those deserves its own pin.
    Keying on link+title lets one URL carry many pins, while still catching a
    literal re-run of the exact same pin (same link AND same title).
    """
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")[:60]
    return f"{source.strip()}#{slug}"


def existing_keys():
    """
    The (source_url, title) pairs already in the database. We block a new pin
    only when BOTH match — so the same URL with a different accomplishment is
    fine, but adding the identical pin twice is not.
    """
    if not ACCOMPLISHMENTS_FILE.exists():
        return set()
    with ACCOMPLISHMENTS_FILE.open() as f:
        return {(row["source_url"].strip(), row["title"].strip())
                for row in csv.DictReader(f)}


def parse_args():
    p = argparse.ArgumentParser(description="Add one accomplishment pin to the map.")
    p.add_argument("--title", required=True, help="Headline for the pin, house style: '$X secured for ...'")
    p.add_argument("--category", required=True, help="One of the allowed categories.")
    p.add_argument("--year", required=True, help="Year it happened, e.g. 2024.")
    p.add_argument("--summary", required=True, help="2-3 plain sentences. Don't overstate.")
    p.add_argument("--source", required=True, help="Source link — bill, press release, or news story.")
    p.add_argument("--location", default="", help="Place name, e.g. 'Foster City Library'.")
    p.add_argument("--address", default="", help="Street address if there is one.")
    p.add_argument("--city", default="", help="District 13 city. Blank = goes to the statewide list, not a pin.")
    p.add_argument("--lat", default="", help="Latitude, if you already know it (skips the internet lookup).")
    p.add_argument("--lon", default="", help="Longitude, if you already know it.")
    p.add_argument("--source-type", default="manual", help="Where it came from (default: manual).")
    p.add_argument("--source-title", default="",
                   help="The headline/title of the source article. Checked for wording "
                        "that's critical of the Senator (e.g. 'few appear to use them'); "
                        "a critical source is refused even if the outlet is allowed.")
    p.add_argument("--allow-outside", action="store_true",
                   help="Override: add the pin even if it falls outside Senate District 13. "
                        "Use only when you are certain — the district check exists to catch mistakes.")
    return p.parse_args()


def coords_for_id(entry_id):
    """Read back the lat/lon the database now holds for THIS pin (by its unique id)."""
    if not ACCOMPLISHMENTS_FILE.exists():
        return "", ""
    with ACCOMPLISHMENTS_FILE.open() as f:
        for row in csv.DictReader(f):
            if row["id"].strip() == entry_id:
                return row["latitude"].strip(), row["longitude"].strip()
    return "", ""


def remove_id_row(entry_id):
    """Take ONE row back out of the database (by its unique id) — used when a pin
    fails a guardrail. Matching on id means we remove only this pin, not every
    other pin that happens to share the same source link."""
    with ACCOMPLISHMENTS_FILE.open() as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if r["id"].strip() != entry_id]
        columns = reader.fieldnames
    with ACCOMPLISHMENTS_FILE.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main():
    args = parse_args()

    category = args.category.strip().lower()
    if category not in ALLOWED_CATEGORIES:
        sys.exit(
            f"ERROR: '{category}' is not an allowed category.\n"
            f"Allowed: {', '.join(sorted(ALLOWED_CATEGORIES))}\n"
            f"Never invent a category — ask Huck which one fits (or whether to add a new one)."
        )

    source = args.source.strip()
    title = args.title.strip()
    entry_id = make_id(source, title)
    # One URL can back several pins (a budget release often names many projects),
    # so we only refuse an EXACT duplicate: same source link AND same title.
    if (source, title) in existing_keys():
        sys.exit("Already on the map (same source link AND same title) — nothing "
                 f"added:\n  {title}\n  {source}\n"
                 "If this is a DIFFERENT accomplishment from the same page, give it "
                 "a distinct title and it'll be added.")

    # --- Guardrail 1: is the source link trustworthy? ---
    # Official gov, Becker's official accounts/office, or reputable local news only.
    _ok, level, message = content_guard.check_source(source)
    if level == "reject":
        sys.exit(
            f"REFUSED — that source link is not an allowed source:\n  {source}\n  {message}\n"
            "Links must be an official government site (*.gov / senate.ca.gov), "
            "Becker's official account/office, or a reputable local news outlet."
        )
    if level == "warn":
        print(f"NOTE (source): {message}")

    # --- Guardrail 2: is the wording professional, neutral, and easy to read? ---
    # The map must never speak negatively or controversially about the senator.
    lang_ok, warnings = content_guard.check_language(f"{args.title.strip()} {args.summary.strip()}")
    if not lang_ok:
        print("NOTE (language) — review the wording before this goes public:")
        for warning in warnings:
            print(f"  - {warning}")

    # --- Guardrail 2b: is the SOURCE ITSELF critical of the Senator? ---
    # An allowed outlet can still run a story that undercuts the accomplishment.
    # If the source headline reads as critical, refuse it — we never route a
    # constituent from a proud pin to a story that swipes at the Senator.
    stance_ok, stance_hits = content_guard.check_source_stance(args.source_title)
    if not stance_ok:
        sys.exit(
            f"REFUSED — the source article's headline reads as critical of the "
            f"Senator ({', '.join(stance_hits)}):\n  {args.source_title.strip()}\n"
            "Even though the outlet is allowed, don't cite a source that swipes at "
            "him. Find a neutral or supportive source for this accomplishment."
        )
    if not args.source_title.strip():
        print("NOTE (source framing): no --source-title given, so the source's tone "
              "wasn't auto-checked. Make sure the article isn't critical of the Senator.")

    # --- Guardrail 3a: if coordinates were passed in, check the district NOW,
    # before we write anything, so a bad pin never even reaches the database. ---
    if args.lat.strip() and args.lon.strip():
        if not geo_guard.is_in_district(args.lat, args.lon) and not args.allow_outside:
            sys.exit(
                f"REFUSED — those coordinates ({args.lat}, {args.lon}) are OUTSIDE "
                "Senate District 13, so the pin would land in the wrong place.\n"
                "Double-check the location. (Pass --allow-outside only if you are certain.)"
            )

    row = {
        "id": entry_id,  # source link + title slug, so one URL can carry many pins
        "source_type": args.source_type.strip(),
        "status": "approved",
        "title": args.title.strip(),
        "category": category,
        "year": args.year.strip(),
        "location_name": args.location.strip(),
        "address": args.address.strip(),
        "city": args.city.strip(),
        "latitude": args.lat.strip(),
        "longitude": args.lon.strip(),
        "summary": args.summary.strip(),
        "source_url": source,
    }

    file_is_new = not ACCOMPLISHMENTS_FILE.exists()
    with ACCOMPLISHMENTS_FILE.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        if file_is_new:
            writer.writeheader()
        writer.writerow(row)
    print(f"Added to the database: {row['title']}")

    # Geocode (only if we don't already have coordinates and there's a place to find).
    # geocode.py is cache-first and skips rows that already have lat/lon, so this
    # does at most ONE tiny lookup — the new row — and nothing if --lat/--lon given.
    if not (row["latitude"] and row["longitude"]) and row["city"]:
        print("Looking up coordinates for the new place (one cached lookup)...")
        subprocess.run([sys.executable, str(SCRIPTS / "geocode.py")], check=True)

    # --- Guardrail 3b: after geocoding, verify the pin actually landed inside
    # Senate District 13. If it didn't, take the row back out — we never publish
    # an out-of-district pin. (This is exactly the bug that once put a South San
    # Francisco pin up in San Francisco, miles outside the district.) ---
    lat, lon = coords_for_id(entry_id)
    if lat and lon and not geo_guard.is_in_district(lat, lon) and not args.allow_outside:
        remove_id_row(entry_id)
        sys.exit(
            f"REFUSED — after looking it up, this pin landed at ({lat}, {lon}), which is "
            "OUTSIDE Senate District 13. The row was removed so nothing wrong shows on the map.\n"
            "Fix the address/place, or re-run with the correct --lat/--lon inside the district. "
            "(Pass --allow-outside only if you are certain.)"
        )

    # Rebuild the file the web page reads.
    subprocess.run([sys.executable, str(SCRIPTS / "build_site_data.py")], check=True)
    print("\nDone. Refresh the map to see the new pin.")


if __name__ == "__main__":
    main()
