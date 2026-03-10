#!/bin/bash
# Build standalone APK without Metro (avoids "Unable to load script" on device).
# 1) Pre-bundle JS into android/app/src/main/assets/index.android.bundle
# 2) Run Gradle with -PusePrebuiltBundle so it skips the bundle task and uses that file.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PROJECT_ROOT/android/app/src/main/assets"
BUNDLE_PATH="$ASSETS_DIR/index.android.bundle"

cd "$PROJECT_ROOT"

echo "Building standalone APK (no Metro required)..."

# 1. Pre-bundle JavaScript for release (no Metro server; one-off bundle)
echo "Pre-bundling JavaScript..."
mkdir -p "$ASSETS_DIR"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export CI=true
# Use project Metro config so Expo resolvers and transformers are applied
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.ts \
  --bundle-output "$BUNDLE_PATH" \
  --assets-dest "$ASSETS_DIR" \
  --config "$PROJECT_ROOT/metro.config.js"

if [ ! -f "$BUNDLE_PATH" ]; then
  echo "Error: Bundle was not created at $BUNDLE_PATH"
  exit 1
fi
echo "Bundle created."

# 2. Build release APK using pre-built bundle (skip Metro bundle task)
echo "Building release APK..."
cd "$PROJECT_ROOT/android"
./gradlew assembleRelease -PusePrebuiltBundle

echo ""
echo "APK built successfully (standalone, no Metro needed)."
echo "Location: android/app/build/outputs/apk/release/app-release.apk"
echo "Install: adb install -r android/app/build/outputs/apk/release/app-release.apk"
