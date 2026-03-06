// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Stable port for release bundle (APK build) so Gradle/export:embed can connect
config.server = config.server || {};
config.server.port = Number(process.env.RCT_METRO_PORT) || 8081;

module.exports = config;
