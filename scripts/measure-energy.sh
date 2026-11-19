#!/usr/bin/env bash
# Energy check (T9): CPU %, idle wakeups/s and macOS "energy impact" per terminal app, summed over all its processes
# (Electron helpers, shells, CLIs under it are separate processes: only the app's own processes are counted).
#
#   scripts/measure-energy.sh                      # Aquila Agents, Terminal, Ghostty, iTerm2 — whichever run
#   scripts/measure-energy.sh "Aquila Agents" Terminal
#   SAMPLES=12 INTERVAL=5 scripts/measure-energy.sh
#   POWERMETRICS=1 scripts/measure-energy.sh       # also `sudo powermetrics --samplers tasks` (asks for a password)
#
# Set every app up the same way first (see docs/en/ENERGY.md: 5 Claude sessions, 1 streaming), then run.
set -euo pipefail

SAMPLES=${SAMPLES:-6}
INTERVAL=${INTERVAL:-5}
apps=("$@")
[ ${#apps[@]} -eq 0 ] && apps=("Aquila Agents" "Terminal" "Ghostty" "iTerm2")

# pids of an app: the processes whose executable lives inside its .app bundle (main + helpers).
# Dev builds run as "Electron" with the repo path in their arguments.
pids_for() {
  local app=$1
  case "$app" in
    "Aquila Agents") pgrep -f "Aquila Agents.app/|Electron.app/.*aquila-agents|aquila-agents/node_modules/electron" ;;
    Terminal) pgrep -f "/System/Applications/Utilities/Terminal.app/" ;;
    *) pgrep -f "/$app.app/" ;;
  esac | paste -sd, - || true
}

printf '%-16s %8s %8s %12s %10s\n' app procs "cpu %" "wakeups/s" "power"
for app in "${apps[@]}"; do
  pids=$(pids_for "$app")
  if [ -z "$pids" ]; then
    printf '%-16s %8s\n' "$app" "not running"
    continue
  fi
  # top's first sample has no CPU delta: average CPU and POWER over the rest. IDLEW is a running total per process,
  # so wakeups/s = (last - first) / elapsed. Columns: pid cpu idlew power.
  top -l $((SAMPLES + 1)) -s "$INTERVAL" -stats pid,cpu,idlew,power 2>/dev/null |
    awk -v pids="$pids" -v app="$app" -v secs=$((SAMPLES * INTERVAL)) '
      BEGIN { n = split(pids, p, ","); for (i = 1; i <= n; i++) want[p[i]] = 1 }
      /^Processes:/ { sample++; next }
      ($1 in want) {
        if (!($1 in first)) first[$1] = $3
        last[$1] = $3
        if (sample > 1) { cpu += $2; pow += $4 }
      }
      END {
        s = sample - 1; if (s < 1) s = 1
        procs = 0; wake = 0
        for (k in first) { procs++; wake += last[k] - first[k] }
        printf "%-16s %8d %8.1f %12.1f %10.1f\n", app, procs, cpu / s, wake / secs, pow / s
      }'
done

if [ "${POWERMETRICS:-0}" = 1 ]; then
  echo
  echo "powermetrics (tasks, ${SAMPLES}×${INTERVAL}s): look for the same apps' rows (wakeups/s = intr + pkg idle)"
  sudo powermetrics --samplers tasks -i $((INTERVAL * 1000)) -n "$SAMPLES" --show-process-energy |
    grep -E "Name|Aquila|Electron|Terminal|ghostty|iTerm" || true
fi

cat <<'EOF'

Ctrl-C test (by hand, in each app): run `yes`, wait 3 s, press Ctrl-C, note how long until the prompt is back.
For Aquila Agents the automated version is `npm run perf`.
EOF
