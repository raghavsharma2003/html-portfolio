#!/usr/bin/env bash
# Vercel build for the Meera website. The MCP deploy payload carries source
# text only, so binary assets (her photos) are pulled from the GitHub branch
# before the Vite build. Locally this script is a no-op fetch (files exist).
set -euo pipefail

RAW="https://raw.githubusercontent.com/raghavsharma2003/html-portfolio/claude/ai-companion-app-rkt1lv"

fetch() { # fetch <repo-path> — skips files already present (local builds)
  local p="$1"
  if [ ! -s "$p" ]; then
    mkdir -p "$(dirname "$p")"
    curl -fsSL "$RAW/$p" -o "$p"
  fi
}

fetch src/assets/meera.jpg
for m in sunset chai night rain lights diya selfie1 selfie2 selfie3 \
         meera-walk meera-beach meera-reading meera-sketch; do
  fetch "src/assets/moments/$m.jpg"
done

npx vite build

# / is the landing page, /chat is the app (see vercel.json rewrite)
mv dist/index.html dist/chat.html
cp site/index.html dist/index.html
cp site/styles.css dist/styles.css
