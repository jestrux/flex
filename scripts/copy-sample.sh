#!/bin/sh
# Copy the sample film into samples/circles-overview (KinPay product content: kept out of git), with its takes.
#
#   scripts/copy-sample.sh [source] [takes]
#     source: the project, default ~/Documents/web/release-videos/circles/overview (the Kinpay-Me/release-videos repo)
#     takes:  where its screen recordings live, default ~/Documents/web/fancy-e2e-videos/takes (copied into the
#             sample's own takes/, so the sample is self-contained)
set -eu
cd "$(dirname "$0")/.."
SRC=${1:-$HOME/Documents/web/release-videos/circles/overview}
TAKES=${2:-$HOME/Documents/web/fancy-e2e-videos/takes}
[ -f "$SRC/project.ts" ] || { echo "no project.ts in $SRC"; exit 1; }
mkdir -p samples
rsync -a --delete --exclude node_modules --exclude .DS_Store --exclude takes "$SRC/" samples/circles-overview/
# the takes its scenes use (take: "…")
mkdir -p samples/circles-overview/takes
for t in $(grep -ho 'take: "[^"]*"' samples/circles-overview/scenes/*.ts | sed 's/take: "\(.*\)"/\1/' | sort -u); do
  if [ -d "$TAKES/$t" ]; then rsync -a --delete --exclude video.mp4 "$TAKES/$t/" "samples/circles-overview/takes/$t/"; echo "   take $t"
  else echo "!! take $t not found in $TAKES"; fi
done
echo "==> samples/circles-overview ($(du -sh samples/circles-overview | cut -f1))"
