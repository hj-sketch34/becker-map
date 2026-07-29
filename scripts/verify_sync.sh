#!/usr/bin/env bash
# verify_sync.sh — prove the LIVE site is a byte-exact copy of the LOCAL site.
#
# Why this exists: on 2026-07-29 the live map and localhost *looked* different
# (plain dots vs. icon pins). The files were actually identical — it was browser
# /CDN cache. Eyeballing two tabs cannot tell those two cases apart. Hashing can.
#
# It compares the SHA-256 of every file in site/ against the same file fetched
# from the live URL. Same hash = same bytes = genuinely an exact copy.
#
#   ./scripts/verify_sync.sh          # check, exit 1 if out of sync
#   ./scripts/verify_sync.sh --wait   # retry for ~3 min while the deploy lands
#
# Exit 0 = live is an exact copy. Exit 1 = it is not (details printed).

set -uo pipefail
cd "$(dirname "$0")/.."

LIVE="https://hj-sketch34.github.io/becker-map"
FILES=(index.html map.js accomplishments.json sd13.geojson)

WAIT=0
[ "${1:-}" = "--wait" ] && WAIT=1

hash_local() { shasum -a 256 "site/$1" 2>/dev/null | awk '{print $1}'; }
# Cache-busting query + no-cache headers so we compare what GitHub actually
# stores, not whatever a CDN edge happens to be holding onto.
hash_live() {
  curl -sL --max-time 45 \
       -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
       "$LIVE/$1?cachebust=$(date +%s)$RANDOM" 2>/dev/null | shasum -a 256 | awk '{print $1}'
}

check_once() {
  local ok=1
  for f in "${FILES[@]}"; do
    local l r
    l="$(hash_local "$f")"
    if [ -z "$l" ]; then
      printf '  MISSING LOCALLY  %s\n' "$f"; ok=0; continue
    fi
    r="$(hash_live "$f")"
    if [ "$l" = "$r" ]; then
      printf '  exact copy       %s\n' "$f"
    else
      printf '  OUT OF SYNC      %s\n     local %s\n     live  %s\n' "$f" "${l:0:16}…" "${r:0:16}…"
      ok=0
    fi
  done
  return $((1 - ok))
}

echo "Verifying the live site is an exact copy of local…"
echo "  local: $(pwd)/site"
echo "  live:  $LIVE"
echo

# --- git-side checks: local must be committed and pushed ---------------------
git_ok=1
if [ -n "$(git status --porcelain)" ]; then
  echo "  UNCOMMITTED local changes — these are NOT on GitHub yet:"
  git status --porcelain | sed 's/^/     /'
  git_ok=0
fi
git fetch -q origin 2>/dev/null
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "  WRONG BRANCH: on '$branch'. GitHub Pages deploys from 'main' ONLY."
  git_ok=0
fi
if [ "$(git rev-parse main 2>/dev/null)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
  echo "  main and origin/main differ — local commits are not pushed."
  git_ok=0
fi
[ $git_ok -eq 1 ] && echo "  git: committed, on main, pushed."
echo

# --- byte-for-byte content check --------------------------------------------
if [ $WAIT -eq 1 ]; then
  for attempt in $(seq 1 12); do
    if check_once; then
      echo
      echo "VERIFIED: the live site is a byte-exact copy of local."
      [ $git_ok -eq 1 ] && exit 0 || exit 1
    fi
    echo "  …deploy not live yet (attempt $attempt/12), waiting 15s"
    sleep 15
    echo
  done
  echo
  echo "NOT VERIFIED: still out of sync after ~3 minutes."
  exit 1
fi

if check_once && [ $git_ok -eq 1 ]; then
  echo
  echo "VERIFIED: the live site is a byte-exact copy of local."
  exit 0
fi

echo
echo "NOT VERIFIED: the live site is not an exact copy of local (see above)."
echo "If a deploy just ran, retry with:  ./scripts/verify_sync.sh --wait"
exit 1
