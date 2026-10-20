#!/bin/sh
# Build, install into /Applications and relaunch: quits the running Flex, replaces the app, opens it again.
# Release by default (what you use day to day; a Debug build's target dirs grow by gigabytes).
#
#   scripts/package.sh               # Release
#   scripts/package.sh Debug         # a Debug build, for debugging the app itself
#   scripts/package.sh --no-build    # just reinstall dist/Flex.app and relaunch
set -eu
cd "$(dirname "$0")/.."
CONFIG=Release
BUILD=1
for a in "$@"; do
  case "$a" in
    Release|Debug) CONFIG=$a ;;
    --no-build) BUILD=0 ;;
    *) echo "usage: scripts/package.sh [Release|Debug] [--no-build]"; exit 2 ;;
  esac
done
[ "$BUILD" = 1 ] && scripts/build-app.sh "$CONFIG"
[ -d dist/Flex.app ] || { echo "dist/Flex.app missing; run without --no-build"; exit 1; }
if pgrep -x Flex > /dev/null; then
  echo "==> quitting the running Flex"
  osascript -e 'tell application "Flex" to quit' 2>/dev/null || true
  for _ in $(seq 1 100); do pgrep -x Flex > /dev/null || break; sleep 0.1; done
  pkill -x Flex 2>/dev/null || true
fi
rm -rf /Applications/Flex.app
cp -R dist/Flex.app /Applications/Flex.app
echo "==> installed /Applications/Flex.app ($CONFIG)"
open -g /Applications/Flex.app
