"""
build_candidates.py  —  STEP 3 of the pipeline: DRAFT a review list

What this does, in plain English:
  It reads the saved releases + their full text and, for each one, makes its
  BEST GUESS at: a category, which district place (if any) is named, a draft
  summary, and the year. It writes all this to  data/candidates.csv .

  These are only guesses for a human to check — nothing here goes on the map
  automatically. You (with Claude) read the list, fix what's wrong, and mark
  which ones are real. That's the "I approve" rule.

  It DEDUPES: releases already in candidates.csv or accomplishments.csv are
  skipped, so re-running only adds brand-new releases.

Run it with:   python3 scripts/build_candidates.py
"""

import json
import csv
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INDEX_FILE = DATA_DIR / "raw-press-releases.json"
BODIES_FILE = DATA_DIR / "release-bodies.json"
CANDIDATES_FILE = DATA_DIR / "candidates.csv"
ACCOMPLISHMENTS_FILE = DATA_DIR / "accomplishments.csv"

# The columns every row has (candidates.csv and accomplishments.csv share these).
# 'place_hints' is a review helper — it lists district places the script spotted.
COLUMNS = [
    "id", "source_type", "status", "title", "category", "year",
    "location_name", "address", "city", "latitude", "longitude",
    "summary", "source_url", "place_hints",
]

# District cities/towns. Longer names first so "East Palo Alto" wins over "Palo Alto".
DISTRICT_PLACES = [
    "East Palo Alto", "South San Francisco", "Half Moon Bay", "Redwood City",
    "Foster City", "Palo Alto", "Menlo Park", "San Carlos", "San Mateo",
    "San Bruno", "Mountain View", "Los Altos", "Daly City", "Portola Valley",
    "Burlingame", "Millbrae", "Hillsborough", "Atherton", "Woodside",
    "Pacifica", "Brisbane", "Colma",
]

# Category keywords. The category with the most keyword hits wins.
CATEGORY_KEYWORDS = {
    "energy": ["electricity", "utility", "utilities", "solar", "grid", "power",
               "clean energy", "pg&e", "ratepayer", "energy"],
    "environment": ["climate", "coastal", "bayside", "sea level", "water",
                    "creek", "wildfire", "conservation", "emissions", "environment"],
    "housing": ["housing", "homeless", "tenant", "rent", "affordable housing",
                "builder's remedy", "builders remedy", "adu", "shelter"],
    "education": ["school", "college", "student", "university", "community college",
                  "classroom", "education"],
    "health": ["health", "mental health", "hospital", "clinic", "hygiene",
               "medical", "care"],
    "transportation": ["transit", "rail", "caltrain", "grade separation",
                        "highway", "roadway", "bike", "pedestrian", "transportation"],
    "jobs": ["jobs", "workforce", "worker", "employment", "wages", "earn and learn"],
    "public-safety": ["justice", "jail", "prison", "reentry", "crime", "police",
                      "fire station", "gun", "public safety"],
    "tech": ["broadband", "digital", "internet", "technology", "artificial intelligence"],
}

BYLINE = re.compile(r"\(\s*D-?\s*Menlo Park\s*\)")


def guess_category(text):
    lowered = text.lower()
    best_category, best_score = "legislation", 0
    for category, words in CATEGORY_KEYWORDS.items():
        score = sum(lowered.count(word) for word in words)
        if score > best_score:
            best_category, best_score = category, score
    return best_category


def find_places(body):
    """Return district places named in the body, ignoring the (D-Menlo Park) byline."""
    text = BYLINE.sub(" ", body)
    found = []
    for place in DISTRICT_PLACES:
        if place in text and place not in found:
            found.append(place)
    return found


def draft_summary(body):
    """First two sentences of the body as a placeholder summary."""
    body = body.strip()
    sentences = re.split(r"(?<=[.!?])\s+", body)
    return " ".join(sentences[:2]).strip()


def load_existing_ids():
    ids = set()
    for path in (CANDIDATES_FILE, ACCOMPLISHMENTS_FILE):
        if path.exists():
            with path.open() as f:
                for row in csv.DictReader(f):
                    ids.add(row["id"])
    return ids


def main():
    index = json.loads(INDEX_FILE.read_text())
    bodies = json.loads(BODIES_FILE.read_text())
    existing = load_existing_ids()

    new_rows = []
    for item in index:
        url = item["url"]
        if url in existing:
            continue
        body = bodies.get(url, "")
        places = find_places(body)
        new_rows.append({
            "id": url,
            "source_type": "press_release",
            "status": "new",
            "title": item["title"],
            "category": guess_category(item["title"] + " " + body),
            "year": item["year"],
            "location_name": "",
            "address": "",
            "city": places[0] if places else "",   # best guess; blank = looks statewide
            "latitude": "",
            "longitude": "",
            "summary": draft_summary(body),
            "source_url": url,
            "place_hints": "; ".join(places),
        })

    # Append to candidates.csv (write header if the file is new).
    file_is_new = not CANDIDATES_FILE.exists()
    with CANDIDATES_FILE.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        if file_is_new:
            writer.writeheader()
        writer.writerows(new_rows)

    with_place = sum(1 for r in new_rows if r["place_hints"])
    print(f"Added {len(new_rows)} new candidates ({with_place} name a district place).")
    print(f"Saved to {CANDIDATES_FILE}")


if __name__ == "__main__":
    main()
