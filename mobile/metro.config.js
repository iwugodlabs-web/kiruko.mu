const path = require("path");
const { withNativeWind: withNativeWind } = require("nativewind/metro");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push("sql");
config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = withNativeWind(config, {
  input: "./global.css",
});
