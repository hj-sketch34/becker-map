"""
build_site_data.py  —  STEP 5a: package approved data for the web page

What this does, in plain English:
  The web page can't easily read a spreadsheet, so this script reads
  data/accomplishments.csv and writes a tidy  site/accomplishments.json  that
  the map loads. It only includes APPROVED rows, and it splits them into:
    - "pins":     rows that have coordinates  -> shown as map pins
    - "statewide": approved rows with no place -> shown in a side list
  The spreadsheet stays the thing humans edit; this file is just for the map.

Run it with:   python3 scripts/build_site_data.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACCOMPLISHMENTS_FILE = ROOT / "data" / "accomplishments.csv"
OUT_FILE = ROOT / "site" / "accomplishments.json"

# One color per category (kept to the tight list we agreed on).
CATEGORY_COLORS = {
    "environment": "#2e7d32",
    "energy": "#f9a825",
    "housing": "#6a1b9a",
    "education": "#1565c0",
    "health": "#c62828",
    "transportation": "#00838f",
    "jobs": "#ef6c00",
    "public-safety": "#4e342e",
    "infrastructure": "#455a64",
    "tech": "#00695c",
    "legislation": "#757575",
    "recognition": "#ad1457",  # shows of support / appreciation — ribbon-cuttings,
                               # food drives, and "___ of the Year" awards. Kept as
                               # its own color so honors don't blend into the funding
                               # and legislative pins. (Replaced "community".)
}


def main():
    pins, statewide = [], []
    with ACCOMPLISHMENTS_FILE.open() as f:
        for row in csv.DictReader(f):
            if row["status"].strip() != "approved":
                continue
            entry = {
                "title": row["title"],
                "category": row["category"],
                "year": row["year"],
                "location_name": row["location_name"],
                "city": row["city"],
                "summary": row["summary"],
                "source_url": row["source_url"],
            }
            if row["latitude"].strip() and row["longitude"].strip():
                entry["lat"] = float(row["latitude"])
                entry["lon"] = float(row["longitude"])
                pins.append(entry)
            else:
                statewide.append(entry)

    pins.sort(key=lambda e: e["year"], reverse=True)
    statewide.sort(key=lambda e: e["year"], reverse=True)

    OUT_FILE.write_text(json.dumps(
        {"pins": pins, "statewide": statewide, "colors": CATEGORY_COLORS},
        indent=2, ensure_ascii=False,
    ))
    print(f"Wrote {len(pins)} pins and {len(statewide)} statewide items to {OUT_FILE}")


if __name__ == "__main__":
    main()
