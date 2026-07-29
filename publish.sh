#!/usr/bin/env bash
# Publish the current map to the web — and PROVE the live site matches local.
#
# Everyday use: after the local map looks right, run this from inside the
# senator-map folder:
#
#     ./publish.sh "added Foster City library funding pin"
#
# What it does, in order:
#   1. refuses to run from any branch except main (Pages deploys from main only)
#   2. commits + pushes everything
#   3. waits for the GitHub deploy, then hashes every file in site/ and compares
#      it to the same file fetched live. Identical hashes = byte-exact copy.
#
# Nothing is auto-published. This only runs when you run it.

set -e
cd "$(dirname "$0")"

msg="${1:-Update map}"

# --- guard: Pages deploys from main ONLY. Work on a side branch has silently
# --- stalled the live site before; refuse rather than let it happen again.
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "Refusing to publish: you are on branch '$branch', but GitHub Pages"
  echo "deploys from 'main' only. Nothing would go live."
  echo "Switch with:  git checkout main"
  exit 1
fi

# Fingerprint map.js into index.html so browsers can't serve a stale copy.
python3 scripts/stamp_assets.py

if [ -z "$(git status --porcelain)" ]; then
  echo "No local changes to commit."
  git fetch -q origin 2>/dev/null || true
  if [ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ]; then
    echo "Already pushed. Verifying the live site still matches local…"
    echo
    exec ./scripts/verify_sync.sh
  fi
else
  git add -A
  git commit -m "$msg"
fi

git push

repo="$(git config --get remote.origin.url | sed -E 's#.*[:/]([^/]+/[^/]+)(\.git)?$#\1#')"
echo
echo "Pushed. Deploy: https://github.com/$repo/actions"
echo "Waiting for the live site to catch up, then verifying it is an exact copy…"
echo

# The real check. Exits non-zero if live is not byte-identical to local.
./scripts/verify_sync.sh --wait
