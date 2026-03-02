#!/bin/sh
# Fix "Unable to load script" on physical Android device: forward port 8081 so the app can reach Metro.
# Run this when the device is connected over USB, then start Metro (npm start) and open the app.

set -e
echo "Restarting ADB server..."
adb kill-server 2>/dev/null || true
sleep 1
adb start-server
sleep 1
echo ""
echo "Connected devices:"
adb devices -l
echo ""
echo "Setting up port forward (device:8081 -> host:8081)..."
adb reverse tcp:8081 tcp:8081
echo "Done. Start Metro with: npm start (or npx expo start), then open/reload the app on the device."
