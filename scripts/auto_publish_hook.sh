#!/usr/bin/env bash
# Stop-hook wrapper: runs the guarded auto-publish and reports the result back
# to Claude Code as a systemMessage. Registered in .claude/settings.json.
#
# It NEVER blocks work — whatever happens, it prints a JSON systemMessage and
# exits 0. The real safety (district + source checks) lives in guarded_publish.py,
# which refuses to push anything if a pin is out-of-district or badly sourced.

cd "$(dirname "$0")/.." || exit 0

out="$(python3 scripts/guarded_publish.py "Auto-update map" 2>&1)"
status=$?

# Take the last meaningful line as the summary for the notification.
last="$(printf '%s' "$out" | tail -1)"

if [ "$status" -ne 0 ]; then
  msg="Becker map — auto-publish BLOCKED by guardrails, nothing pushed. $last"
else
  msg="Becker map — $last"
fi

# Emit a systemMessage so Huck sees what happened. Escape quotes/backslashes.
esc="$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
printf '{"systemMessage": %s, "suppressOutput": true}\n' "$esc"
exit 0
