#!/bin/sh
# Build the app end to end: Rust core -> XCFramework -> Xcode project -> dist/Flex.app
#
#   scripts/build-app.sh            # Debug
#   scripts/build-app.sh Release
set -eu
cd "$(dirname "$0")/.."
CONFIG=${1:-Debug}
if [ "$CONFIG" = "Release" ]; then scripts/build-core.sh; else scripts/build-core.sh --debug; fi
command -v xcodegen >/dev/null || { echo "xcodegen missing: brew install xcodegen"; exit 1; }
( cd app && xcodegen generate -q )
# A stable signing identity keeps macOS from re-asking for folder access after each build.
IDENTITY=${FLEX_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)}
xcodebuild -project app/Flex.xcodeproj -scheme Flex -configuration "$CONFIG" \
  -destination 'platform=macOS' -derivedDataPath app/build/DerivedData -quiet build
rm -rf dist/Flex.app && mkdir -p dist
cp -R "app/build/DerivedData/Build/Products/$CONFIG/Flex.app" dist/
# Flex's own copy of the pipeline (scripts/sync-pipeline.sh) ships inside the app: the engine finds it at
# Contents/Resources/pipeline, so an installed Flex needs no fancy-e2e-videos checkout
[ -d pipeline/node_modules ] || { echo "pipeline/ isn't installed: run scripts/sync-pipeline.sh"; exit 1; }
rsync -a --delete --exclude .cache --exclude .DS_Store pipeline/ dist/Flex.app/Contents/Resources/pipeline/
if [ -n "$IDENTITY" ]; then
  echo "==> signing as $IDENTITY"
  # the pipeline's native modules (sharp's .node and libvips) are signed first, so the bundle's signature covers them
  find dist/Flex.app/Contents/Resources/pipeline \( -name "*.node" -o -name "*.dylib" \) -type f -exec codesign --force --sign "$IDENTITY" --timestamp=none {} \; 2>/dev/null
  codesign --force --sign "$IDENTITY" --timestamp=none dist/Flex.app/Contents/Helpers/flex
  codesign --force --sign "$IDENTITY" --timestamp=none dist/Flex.app
fi
echo "==> dist/Flex.app ($CONFIG)"
