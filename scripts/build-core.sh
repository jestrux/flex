#!/bin/sh
# Build the Rust engine as an XCFramework plus generated Swift bindings for the app.
#
#   scripts/build-core.sh            # release, universal (arm64 + x86_64 when installed)
#   scripts/build-core.sh --debug    # debug, host arch only (fast iteration)
#
# Outputs:
#   app/Frameworks/FlexCore.xcframework
#   app/Generated/FlexCore.swift
#   app/Frameworks/bin/flex   (the CLI, bundled into the app's Contents/Helpers)
set -eu
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

PROFILE=release
CARGO_FLAGS="--release"
if [ "${1:-}" = "--debug" ]; then PROFILE=debug; CARGO_FLAGS=""; fi

HOST_TARGET=$(rustc -vV | sed -n 's/^host: //p')
TARGETS="$HOST_TARGET"
if [ "$PROFILE" = "release" ]; then
  for t in aarch64-apple-darwin x86_64-apple-darwin; do
    if [ "$t" != "$HOST_TARGET" ] && rustup target list --installed | grep -q "^$t$"; then
      TARGETS="$TARGETS $t"
    fi
  done
fi

LIBS=""
BINS=""
for t in $TARGETS; do
  echo "==> cargo build ($PROFILE, $t)"
  cargo build -p flex-ffi -p flex-cli $CARGO_FLAGS --target "$t" --quiet
  LIBS="$LIBS target/$t/$PROFILE/libflex_ffi.a"
  BINS="$BINS target/$t/$PROFILE/flex"
done
HOST_DYLIB="target/$HOST_TARGET/$PROFILE/libflex_ffi.dylib"

echo "==> uniffi-bindgen (swift)"
cargo build -p uniffi-bindgen --quiet
GEN=app/Generated
rm -rf "$GEN" && mkdir -p "$GEN"
target/debug/uniffi-bindgen generate --library "$HOST_DYLIB" --language swift --out-dir "$GEN" --no-format

echo "==> xcframework"
OUT=app/Frameworks
BUILD=target/xcframework
rm -rf "$BUILD" "$OUT/FlexCore.xcframework"
mkdir -p "$BUILD/include" "$OUT"
cp "$GEN/FlexCoreFFI.h" "$BUILD/include/"
cp "$GEN/FlexCoreFFI.modulemap" "$BUILD/include/module.modulemap"
rm "$GEN/FlexCoreFFI.h" "$GEN/FlexCoreFFI.modulemap"
if [ "$(echo $LIBS | wc -w)" -gt 1 ]; then
  lipo -create $LIBS -output "$BUILD/libflex_ffi.a"
else
  cp $LIBS "$BUILD/libflex_ffi.a"
fi
xcodebuild -create-xcframework \
  -library "$BUILD/libflex_ffi.a" -headers "$BUILD/include" \
  -output "$OUT/FlexCore.xcframework" > /dev/null
mkdir -p "$OUT/bin"
if [ "$(echo $BINS | wc -w)" -gt 1 ]; then lipo -create $BINS -output "$OUT/bin/flex"; else cp $BINS "$OUT/bin/flex"; fi
echo "==> done: $OUT/FlexCore.xcframework, $OUT/bin/flex, $GEN/FlexCore.swift"
