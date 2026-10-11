#!/bin/bash
# WS-R181. Waits for the machine to be quiet AND the gate's own fixed ports
# to be free, then runs the release gate exactly once. Never pattern-matches
# a process and never kills anything -- it only waits, the same posture
# scripts/merge-tools/gate-retry.sh already has for the port half of this
# problem. What this adds: gate-retry.sh checks ports before EVERY attempt
# and retries on an EADDRINUSE it finds in the log AFTER a run; this script
# checks load BEFORE the one run it makes, so a genuinely busy machine never
# gets a run at all whose own timing findings (performance budgets) could
# not have been trusted in the first place (see evals/lib/bounded-wait.mjs
# and scripts/check-performance.mjs's own load-ceiling refusal, which this
# script's threshold deliberately matches).
#
#   scripts/merge-tools/quiet-gate.sh              # default: load < 8, 240 x 5s port polls
#   LOAD_CEILING=4 scripts/merge-tools/quiet-gate.sh
#   GATE_ARGS="--mp" scripts/merge-tools/quiet-gate.sh
#
# Exit code is the gate's own; this script adds no interpretation of a real
# failure -- only of "did I ever get to run it".
cd /home/user/html-portfolio || exit 2

# The SAME number evals/lib/bounded-wait.mjs's DEFAULT_LOAD_CEILING uses and
# ws-common.md's own gate instructions name ("when the load average is under
# 8") -- one number three callers agree on, not three independently chosen.
LOAD_CEILING=${LOAD_CEILING:-8}
LOAD_WAIT_ATTEMPTS=${LOAD_WAIT_ATTEMPTS:-240}   # 240 x 5s = 20 minutes, the same shape gate-retry.sh's own port wait already uses
PORT_WAIT_ATTEMPTS=${PORT_WAIT_ATTEMPTS:-240}
GATE_ARGS=${GATE_ARGS:-}
S=${S:-/tmp/vyakti-quiet-gate}
mkdir -p "$S"

read_load1() {
  # /proc/loadavg's first field, portable to any shell that can read the file
  # -- no external `uptime` dependency, and no process spawned per poll.
  awk '{print $1}' /proc/loadavg
}

load_under_ceiling() {
  # Pure integer/decimal compare via awk (bash has no float comparison).
  awk -v l="$1" -v c="$2" 'BEGIN { exit !(l < c) }'
}

echo "quiet-gate: waiting for load average under $LOAD_CEILING (ceiling; same number the gate's own load-ceiling refusal uses)"
waited_for_load=0
for i in $(seq 1 "$LOAD_WAIT_ATTEMPTS"); do
  load1=$(read_load1)
  if load_under_ceiling "$load1" "$LOAD_CEILING"; then
    echo "quiet-gate: load average $load1 is under $LOAD_CEILING after ${waited_for_load}s"
    break
  fi
  if [ "$i" -eq "$LOAD_WAIT_ATTEMPTS" ]; then
    echo "quiet-gate: gave up waiting for a quiet machine after ${waited_for_load}s (load average still $load1, ceiling $LOAD_CEILING)"
    exit 3
  fi
  sleep 5
  waited_for_load=$((waited_for_load + 5))
done

echo "quiet-gate: waiting for the gate's own fixed ports to be free (8931-8935, 8940, 8941, 8945, 8946)"
waited_for_ports=0
for i in $(seq 1 "$PORT_WAIT_ATTEMPTS"); do
  busy=0
  for p in 8931 8932 8933 8934 8935 8940 8941 8945 8946; do
    if (echo > "/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      busy=1
      break
    fi
  done
  if [ "$busy" -eq 0 ]; then
    echo "quiet-gate: every gate port is free after ${waited_for_ports}s"
    break
  fi
  if [ "$i" -eq "$PORT_WAIT_ATTEMPTS" ]; then
    echo "quiet-gate: gave up waiting for a free port after ${waited_for_ports}s (port $p still answers)"
    exit 3
  fi
  sleep 5
  waited_for_ports=$((waited_for_ports + 5))
done

L="$S/gate-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
echo "quiet-gate: machine quiet, ports free, running the gate once -> $L"
# shellcheck disable=SC2086
node scripts/verify-release.mjs $GATE_ARGS > "$L" 2>&1
rc=$?
echo "EXIT $rc" >> "$L"
tail -n 20 "$L"
echo "quiet-gate: full log at $L"
exit $rc
