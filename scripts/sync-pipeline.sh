#!/bin/sh
# Copy the pipeline (fancy-e2e-videos) into pipeline/, re-apply Flex's patches, install its packages.
#
#   scripts/sync-pipeline.sh [source]     default: ~/Documents/web/fancy-e2e-videos
#
# Flex runs a project through its own copy of the pipeline, so it needs no fancy-e2e-videos checkout and
# never edits one (another agent works there). Nothing in pipeline/ is edited by hand: a change is a patch in
# pipeline-patches/ (applied here, in name order; one that no longer applies fails the sync), or a fix in
# fancy-e2e-videos followed by a re-sync. pipeline/SOURCE says what was copied.
set -eu
cd "$(dirname "$0")/.."
SRC=${1:-$HOME/Documents/web/fancy-e2e-videos}
[ -f "$SRC/lib/sequence.ts" ] || { echo "no pipeline at $SRC"; exit 1; }

DST=pipeline
mkdir -p "$DST"
# the code, the looks, the sound library and its files (music, sfx, b-roll), the package manifest
for d in lib looks; do rsync -a --delete --exclude .DS_Store "$SRC/$d/" "$DST/$d/"; done
mkdir -p "$DST/assets"
rsync -a --delete --exclude .DS_Store --exclude studio "$SRC/assets/" "$DST/assets/"
# tracks made for one product stay in the pipeline's own library, not Flex's (Flex ships to anyone): their files and entries
EXCLUDE_MUSIC="circles-count-me-in-1 circles-count-me-in-2"
for k in $EXCLUDE_MUSIC; do rm -f "$DST/assets/music/$k".*; done
node -e 'const f=process.argv[1], ks=process.argv.slice(2), fs=require("fs"), j=JSON.parse(fs.readFileSync(f,"utf8")); for (const k of ks) delete j.music[k]; fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n")' "$DST/assets/library.json" $EXCLUDE_MUSIC
cp "$SRC/package.json" "$SRC/tsconfig.json" "$DST/"
[ -f "$SRC/package-lock.json" ] && cp "$SRC/package-lock.json" "$DST/"

# Flex's patches
for p in pipeline-patches/*.patch; do
  [ -e "$p" ] || continue
  if ! git apply --directory="$DST" --check "$p" 2>/dev/null; then
    echo "!! $p no longer applies to the copied pipeline: update the patch (the pipeline changed under it)"
    git apply --directory="$DST" --check -v "$p" || true
    exit 1
  fi
  git apply --directory="$DST" "$p"
  echo "   patched: $p"
done

# what was copied
COMMIT=$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)
DIRTY=$(git -C "$SRC" status --porcelain -- lib looks assets 2>/dev/null | wc -l | tr -d ' ')
{
  echo "source: $(echo "$SRC" | sed "s|^$HOME|~|")"
  echo "commit: $COMMIT"
  echo "uncommitted files copied (lib, looks, assets): $DIRTY"
  echo "synced: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "patches: $(ls pipeline-patches/*.patch 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
} > "$DST/SOURCE"

# its packages (sharp, tsx, dotenv, …), only when the manifest changed
if [ ! -d "$DST/node_modules" ] || ! cmp -s "$DST/package.json" "$DST/node_modules/.flex-package.json"; then
  (cd "$DST" && npm install --no-audit --no-fund --loglevel=error)
  cp "$DST/package.json" "$DST/node_modules/.flex-package.json"
fi
echo "==> pipeline/ from $COMMIT (+$DIRTY uncommitted), $(du -sh "$DST" | cut -f1)"
