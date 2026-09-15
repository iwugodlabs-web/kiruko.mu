const path = require("path");
const { withNativeWind: withNativeWind } = require("nativewind/metro");
// getPostHogExpoConfig returns a standard Expo metro config with PostHog's
// source-map injection (so JS crash stacks are readable in PostHog error
// tracking). Use it in place of getDefaultConfig, then layer our own resolver
// tweaks and NativeWind on top.
const { getPostHogExpoConfig } = require("posthog-react-native/metro");

const config = getPostHogExpoConfig(__dirname);
config.resolver.sourceExts.push("sql");
config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = withNativeWind(config, {
  input: "./global.css",
});
