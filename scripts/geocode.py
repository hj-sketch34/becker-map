"""
geocode.py  —  STEP 4: turn addresses into map coordinates

What this does, in plain English:
  The map needs a latitude/longitude to drop a pin. This script reads
  data/accomplishments.csv, and for any approved row that has a place but no
  coordinates yet, it asks OpenStreetMap's free "Nominatim" service for the
  lat/long, then writes it back into the CSV.

  - It tries the most specific address first, then falls back to just the city,
    so every located pin lands *somewhere* sensible even without a street number.
  - It CACHES every lookup in data/geocode-cache.json, so re-runs are instant
    and we never ask the free service the same question twice (their rule).
  - It waits 1 second between new lookups (also their rule).

Run it with:   python3 scripts/geocode.py
"""

import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "BeckerAchievementMap/0.1 (huck@jagerson.com; learning project)"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ACCOMPLISHMENTS_FILE = DATA_DIR / "accomplishments.csv"
CACHE_FILE = DATA_DIR / "geocode-cache.json"

NOMINATIM = "https://nominatim.openstreetmap.org/search"


def load_cache():
    return json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}


def save_cache(cache):
    CACHE_FILE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


def geocode_query(query, cache):
    """Look up one place string. Returns (lat, lon) or None. Uses/updates the cache."""
    if query in cache:
        result = cache[query]
        return (result["lat"], result["lon"]) if result else None

    params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    request = urllib.request.Request(
        f"{NOMINATIM}?{params}", headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        print(f"    (lookup error: {error})")
        data = []

    time.sleep(1)  # Nominatim rule: max 1 request per second

    if data:
        hit = {"lat": data[0]["lat"], "lon": data[0]["lon"]}
        cache[query] = hit
        return hit["lat"], hit["lon"]
    else:
        cache[query] = None  # remember the miss too, so we don't retry it forever
        return None


def build_queries(row):
    """Most-specific-first list of place strings to try for one accomplishment."""
    city = row["city"].strip()
    queries = []
    if row["address"].strip() and city:
        queries.append(f"{row['address']}, {city}, CA, USA")
    if row["location_name"].strip() and city:
        queries.append(f"{row['location_name']}, {city}, CA, USA")
    if city:
        queries.append(f"{city}, CA, USA")
    return queries


def main():
    with ACCOMPLISHMENTS_FILE.open() as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        columns = reader.fieldnames

    cache = load_cache()
    located = 0

    for row in rows:
        if row["latitude"].strip() and row["longitude"].strip():
            continue  # already has coordinates
        if not row["city"].strip():
            continue  # no place at all -> stays in the statewide list, not a pin

        for query in build_queries(row):
            result = geocode_query(query, cache)
            save_cache(cache)
            if result:
                row["latitude"], row["longitude"] = result
                located += 1
                print(f"  OK  {row['city']:16s} <- \"{query}\"")
                break
        else:
            print(f"  --  could not locate: {row['title'][:50]}")

    with ACCOMPLISHMENTS_FILE.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone. Added coordinates to {located} pin(s).")


if __name__ == "__main__":
    main()
