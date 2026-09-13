#!/usr/bin/env bash
# Capture the immutable uploaded source before the package manager or build
# tools can touch it, then install exactly what package-lock.json describes.
set -euo pipefail

BRANCH="${VERCEL_GIT_COMMIT_REF:-claude/gurukul-platform}"
TARBALL="https://codeload.github.com/raghavsharma2003/html-portfolio/tar.gz/refs/heads/$BRANCH"

# Thin API-driven deployments carry the build contract but not the complete
# repository. Materialise that source before hashing it. Full and Git-connected
# deployments already have src/ and skip this branch.
if [ ! -d src ]; then
  curl -fsSL "$TARBALL" -o /tmp/meera-src.tgz
  mkdir -p /tmp/meera-src
  tar -xzf /tmp/meera-src.tgz -C /tmp/meera-src --strip-components=1
  cp -Rn /tmp/meera-src/. .
fi

# The authenticated deploy client (scripts/deploy-vercel.mjs) passes the
# uploaded-source commitment as VYAKTI_SOURCE_* build metadata and the marker
# is written here, before npm ci can touch the tree. A build started by
# Vercel's own GitHub integration carries no such metadata: its source
# identity is the commit Vercel cloned (VERCEL_GIT_COMMIT_SHA), and the build
# phase computes the release marker from that checkout instead
# (scripts/vercel-build.sh, deploy-commitment.mjs). Running the strict marker
# writer without the metadata failed every git-connected deploy from
# 2026-09-09 (eight ERROR deployments in a row on codex/handoff206).
if [ -n "${VYAKTI_SOURCE_COMMITMENT:-}" ]; then
  node scripts/write-deploy-marker.mjs
elif [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  echo "git-connected deploy of ${VERCEL_GIT_COMMIT_REF:-?} at ${VERCEL_GIT_COMMIT_SHA}: release marker is computed at build time"
else
  node scripts/write-deploy-marker.mjs
fi

# npm ci refuses a package.json/package-lock mismatch and never reconciles or
# rewrites the lockfile. The marker above remains the uploaded-source identity
# even if a future package manager or build tool mutates its working tree.
npm ci --no-audit --no-fund
