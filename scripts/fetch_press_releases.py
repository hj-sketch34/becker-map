"""
fetch_press_releases.py  —  STEP 1 of the pipeline: FIND

What this does, in plain English:
  It visits Senator Becker's press-release pages one by one and writes down
  the title, the web link, and the date of every press release it finds.
  It saves that list to  data/raw-press-releases.json  so the next step can
  read it. It does NOT decide what goes on the map yet — it just gathers.

Why save the raw list to a file? Because the rule in this project is
"capture the source first, then work from the saved copy." If the website
ever changes, we still have exactly what we pulled.

Run it with:   python3 scripts/fetch_press_releases.py
"""

import json
import re
import time
import html
import urllib.request
from pathlib import Path

# --- settings -------------------------------------------------------------

BASE = "https://sd13.senate.ca.gov"
LIST_URL = BASE + "/news/press-releases"

# A polite "who am I" label the website sees. Good manners for scraping.
USER_AGENT = "BeckerAchievementMap/0.1 (huck@jagerson.com; learning project)"

# Where the saved list goes. This path is relative to the project folder.
OUT_FILE = Path(__file__).resolve().parent.parent / "data" / "raw-press-releases.json"

# Safety cap so we never loop forever if something unexpected happens.
MAX_PAGES = 60

# --- the work -------------------------------------------------------------

# Every press-release link on the page looks like:
#   href="/news/press-release/june-29-2026/some-title-slug" hreflang="en">The Title Here
# This pattern pulls out three pieces: the date-slug, the rest of the link, and the title.
LINK_PATTERN = re.compile(
    r'href="(/news/press-release/([a-z]+-\d{1,2}-\d{4})/[^"]+)"\s+hreflang="en">([^<]+)'
)

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def fetch_html(url):
    """Download one web page and return its HTML as text."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_date_slug(slug):
    """Turn 'june-29-2026' into ('2026-06-29', 2026). Returns (date_string, year)."""
    month_name, day, year = slug.split("-")
    month = MONTHS[month_name]
    date_string = f"{year}-{month:02d}-{int(day):02d}"
    return date_string, int(year)


def main():
    seen_urls = set()
    items = []

    for page in range(MAX_PAGES):
        # Drupal pages are numbered ?page=0, ?page=1, ... The first page can omit it.
        url = LIST_URL if page == 0 else f"{LIST_URL}?page={page}"
        print(f"Fetching page {page} ...", end=" ", flush=True)

        page_html = fetch_html(url)
        matches = LINK_PATTERN.findall(page_html)

        # Keep only links we haven't already recorded (pages can overlap).
        new_on_this_page = 0
        for link_path, date_slug, raw_title in matches:
            full_url = BASE + link_path
            if full_url in seen_urls:
                continue
            seen_urls.add(full_url)

            date_string, year = parse_date_slug(date_slug)
            items.append({
                "title": html.unescape(raw_title).strip(),
                "url": full_url,
                "date": date_string,
                "year": year,
            })
            new_on_this_page += 1

        print(f"found {new_on_this_page} new (total {len(items)})")

        # If a page gave us nothing new, we've reached the end — stop.
        if new_on_this_page == 0:
            break

        time.sleep(0.5)  # be polite; don't hammer the server

    # Newest first.
    items.sort(key=lambda x: x["date"], reverse=True)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False))

    print(f"\nDone. Saved {len(items)} press releases to {OUT_FILE}")
    if items:
        print("Newest one:", items[0]["date"], "-", items[0]["title"])


if __name__ == "__main__":
    main()
