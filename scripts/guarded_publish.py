"""
guarded_publish.py  —  auto-publish the map, but ONLY if every pin is safe.

What this does, in plain English:
  This is the safety gate behind automatic publishing. Before anything goes to
  the public web, it re-checks the WHOLE map:
    1. DISTRICT  — every pin's coordinates must fall inside Senate District 13.
    2. SOURCE    — every pin's link must be a trustworthy source (official gov,
                   Becker's office, or reputable local news).
  If anything fails, it STOPS and publishes nothing, printing exactly what's
  wrong. If everything passes, it rebuilds the map file and, when there are
  changes, commits and pushes them (GitHub then updates the live map ~1 min later).

  Run by hand:   python3 scripts/guarded_publish.py "optional commit note"
  Also run automatically by the Stop hook in .claude/settings.json.
"""
import csv, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geo_guard
import content_guard

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "accomplishments.csv"


def preflight():
    """Return a list of problems. Empty list == safe to publish."""
    problems = []
    for row in csv.DictReader(CSV.open()):
        if row["status"].strip() != "approved":
            continue
        lat, lon = row["latitude"].strip(), row["longitude"].strip()
        if lat and lon and not geo_guard.is_in_district(lat, lon):
            problems.append(f"OUT OF DISTRICT: ({lat},{lon}) — {row['title'][:60]}")
        _ok, level, msg = content_guard.check_source(row["source_url"].strip())
        if level == "reject":
            problems.append(f"BAD SOURCE: {row['title'][:50]} — {msg}")
    return problems


def main():
    note = sys.argv[1] if len(sys.argv) > 1 else "Auto-update map"

    problems = preflight()
    if problems:
        print("PUBLISH BLOCKED — the guardrails found problems, so nothing was pushed:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)

    # Guards passed. Rebuild the web file so it matches the database.
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_site_data.py")], check=True)

    # Publish only if git actually has changes.
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    if not dirty:
        print("Guards passed. Nothing to publish — no changes since last push.")
        return

    subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
    subprocess.run(["git", "commit", "-m", note], cwd=ROOT, check=True)
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    print("Guards passed. Pushed — the live map updates in about a minute.")


if __name__ == "__main__":
    main()
