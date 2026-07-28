#!/usr/bin/env bash
# Publish the current map to the web.
#
# Everyday use: after you (or Claude) add/edit pins and the site rebuilds,
# run this from inside the senator-map folder:
#
#     ./publish.sh
#
# It saves your changes and pushes them to GitHub. GitHub then rebuilds the
# live map automatically — it's usually updated within about a minute.
# You can pass a short note describing the change:
#
#     ./publish.sh "added Foster City library funding pin"

set -e
cd "$(dirname "$0")"

msg="${1:-Update map}"

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to publish — no changes since the last push."
  exit 0
fi

git add -A
git commit -m "$msg"
git push

echo
echo "Pushed. The live map will update in about a minute."
echo "Watch the deploy finish at: https://github.com/$(git config --get remote.origin.url | sed -E 's#.*[:/]([^/]+/[^/]+)\.git#\1#')/actions"
