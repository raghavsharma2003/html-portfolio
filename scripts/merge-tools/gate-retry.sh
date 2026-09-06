#!/bin/bash
# Runs the release gate on the main tree, retrying only when a sibling's gate
# collided on a port. Never pattern-matches processes.
cd /home/user/html-portfolio || exit 2
S=${S:-/tmp/vyakti-gate}; mkdir -p "$S"
for attempt in 1 2 3 4 5; do
  L=$S/gate-w11a-$attempt.log
  for i in $(seq 1 240); do
    if ! (echo > /dev/tcp/127.0.0.1/8931) 2>/dev/null && ! (echo > /dev/tcp/127.0.0.1/8932) 2>/dev/null && ! (echo > /dev/tcp/127.0.0.1/8933) 2>/dev/null; then break; fi
    sleep 5
  done
  node scripts/verify-release.mjs > "$L" 2>&1; rc=$?
  echo "EXIT $rc" >> "$L"
  if [ $rc -eq 0 ]; then echo "PASS attempt $attempt $L"; exit 0; fi
  if grep -q EADDRINUSE "$L"; then echo "collision attempt $attempt"; sleep 60; continue; fi
  echo "REAL FAILURE attempt $attempt $L"; exit 1
done
echo "gave up after 5 collisions"; exit 3
