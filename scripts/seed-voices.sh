#!/bin/sh
# Fill Flex's narration cache from a fancy-e2e-videos checkout's, so lines already spoken aren't spoken again
# (the cache is keyed by the line's text hash, so the files are interchangeable).
#   scripts/seed-voices.sh [checkout]     default: ~/Documents/web/fancy-e2e-videos
set -eu
SRC=${1:-$HOME/Documents/web/fancy-e2e-videos}/.cache/voice
DST=${FLEX_VOICE_CACHE:-${FLEX_SUPPORT:-$HOME/Library/Application Support/Flex}/voice}
[ -d "$SRC" ] || { echo "no voice cache at $SRC"; exit 1; }
mkdir -p "$DST"
rsync -a --ignore-existing "$SRC/" "$DST/"
echo "==> $(ls "$DST" | wc -l | tr -d ' ') lines in $DST"
