"""
stamp_assets.py — stop the browser from showing you a stale map.

The problem this solves (it bit us on 2026-07-29):
  The live site and localhost looked completely different — plain dots on one,
  icon pins on the other. The files were byte-for-byte IDENTICAL. The browser
  was just showing a cached copy of an older map.js and refusing to re-download
  it, because the filename never changes.

The fix, in plain English:
  A browser caches by URL. "map.js" is the same URL forever, so it reuses what
  it already has. But "map.js?v=8f3a1c" is a NEW url every time the file's
  contents change — so the browser is forced to fetch the new one. The "v" is a
  short fingerprint (hash) of the file's actual bytes.

  Change nothing -> the fingerprint is identical -> the cache is still used
  (fast). Change one character -> new fingerprint -> everyone gets the update
  immediately. It is automatic and there is nothing to remember to bump.

Run it any time; publish.sh runs it for you before every push:

    python3 scripts/stamp_assets.py
"""

import hashlib
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
INDEX = SITE / "index.html"

# Local files referenced by index.html that should be fingerprinted.
ASSETS = ["map.js"]


def short_hash(path: Path) -> str:
    """First 8 hex characters of the file's SHA-256 — its fingerprint."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def main() -> int:
    if not INDEX.exists():
        print(f"stamp_assets: {INDEX} not found", file=sys.stderr)
        return 1

    html = INDEX.read_text()
    original = html
    changed = []

    for asset in ASSETS:
        target = SITE / asset
        if not target.exists():
            print(f"stamp_assets: skipping {asset} (not found)")
            continue

        version = short_hash(target)

        # Match src="map.js" or src="map.js?v=anything" and rewrite the version.
        # re.escape keeps a dot in the filename from acting as a wildcard.
        pattern = re.compile(r'(src=")' + re.escape(asset) + r'(?:\?v=[0-9a-f]+)?(")')
        html, count = pattern.subn(rf'\1{asset}?v={version}\2', html)

        if count == 0:
            print(f"stamp_assets: WARNING — no <script src=\"{asset}\"> found in index.html")
        else:
            changed.append(f"{asset}?v={version}")

    if html != original:
        INDEX.write_text(html)
        print("stamp_assets: updated index.html ->", ", ".join(changed))
    else:
        print("stamp_assets: already current ->", ", ".join(changed) or "nothing to stamp")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
