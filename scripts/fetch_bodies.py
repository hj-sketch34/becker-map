"""
fetch_bodies.py  —  STEP 2 of the pipeline: read the full story of each release

What this does, in plain English:
  Step 1 gave us the title, link, and date of every press release.
  But the *place* (a city, a park, a school) lives inside the full text.
  This script visits each release's page, pulls out the real article text,
  and saves it to  data/release-bodies.json  (keyed by the release's link).

  It CACHES: if we already have a release's text saved, it skips it. So the
  first run fetches all 220 (~2 minutes), and every run after that is instant
  except for brand-new releases. That's what makes weekly re-runs cheap.

Run it with:   python3 scripts/fetch_bodies.py
"""

import json
import re
import time
import html
import urllib.request
from pathlib import Path

USER_AGENT = "BeckerAchievementMap/0.1 (huck@jagerson.com; learning project)"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INDEX_FILE = DATA_DIR / "raw-press-releases.json"
BODIES_FILE = DATA_DIR / "release-bodies.json"

# The article text sits inside a block with this Drupal class. A page has a few
# of these; the real story is the longest one, so we grab them all and keep the
# longest after stripping the HTML tags.
BODY_BLOCK = re.compile(
    r'field--name-body[^>]*field__item"\s*>(.*?)(?=<div class="|</article|<footer|<aside)',
    re.S,
)


def fetch_html(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_body_text(page_html):
    """Return the longest clean text block from a release page (the real story)."""
    best = ""
    for block in BODY_BLOCK.findall(page_html):
        text = re.sub(r"<[^>]+>", " ", block)          # remove HTML tags
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()  # tidy whitespace
        if len(text) > len(best):
            best = text
    return best


def main():
    index = json.loads(INDEX_FILE.read_text())

    # Load what we already have, so we only fetch new ones.
    if BODIES_FILE.exists():
        bodies = json.loads(BODIES_FILE.read_text())
    else:
        bodies = {}

    to_fetch = [it for it in index if it["url"] not in bodies]
    print(f"{len(index)} releases total, {len(bodies)} already saved, "
          f"{len(to_fetch)} to fetch.\n")

    for i, item in enumerate(to_fetch, start=1):
        url = item["url"]
        print(f"[{i}/{len(to_fetch)}] {item['date']}  {item['title'][:55]}", flush=True)
        try:
            body = extract_body_text(fetch_html(url))
        except Exception as error:
            print(f"    (skipped — error: {error})")
            continue
        bodies[url] = body
        time.sleep(0.5)  # be polite

        # Save progress every 20 so a stop mid-run doesn't lose work.
        if i % 20 == 0:
            BODIES_FILE.write_text(json.dumps(bodies, indent=2, ensure_ascii=False))

    BODIES_FILE.write_text(json.dumps(bodies, indent=2, ensure_ascii=False))
    print(f"\nDone. {len(bodies)} release bodies saved to {BODIES_FILE}")


if __name__ == "__main__":
    main()
