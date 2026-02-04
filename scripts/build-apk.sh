#!/bin/bash

# Build script for Greencore React Native APK
# This ensures the JavaScript bundle is properly embedded

set -e

echo "🚀 Building Greencore APK..."

# Navigate to project root
cd "$(dirname "$0")/.."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
cd android
./gradlew clean
cd ..

# Pre-bundle JavaScript for release
echo "📦 Pre-bundling JavaScript..."
npx expo export --platform android --output-dir android/app/src/main/assets

# Build release APK
echo "🔨 Building release APK..."
cd android
./gradlew assembleRelease

echo "✅ Build complete!"
echo "📱 APK location: android/app/build/outputs/apk/release/app-release.apk"
