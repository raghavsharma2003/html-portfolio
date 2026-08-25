#!/usr/bin/env bash
set -euo pipefail

# Malware signatures are intentionally current, unlike identity models. A
# failed update must not silently turn malware scanning into a fake green gate.
freshclam --config-file=/srv/worker/services/replica-processing-worker/freshclam.conf --stdout
clamd --config-file=/srv/worker/services/replica-processing-worker/clamd.conf --foreground=false

for _ in $(seq 1 30); do
  if clamdscan --config-file=/srv/worker/services/replica-processing-worker/clamd.conf --version >/dev/null 2>&1; then
    exec node /srv/worker/services/replica-processing-worker/run-once.js
  fi
  sleep 1
done

echo '{"error":"clamav_not_ready"}' >&2
exit 1

