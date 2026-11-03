const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.assetPlugins = [
  ...(config.transformer.assetPlugins || []),
  'expo-asset/tools/hashAssetFiles',
];

// expo-sqlite's web worker imports its wa-sqlite build as an asset.
config.resolver.assetExts.push('wasm');

// The Electron shell (its node_modules, the web export it serves, packaged
// builds) is not part of the app bundle.
config.resolver.blockList = [
  ...[config.resolver.blockList].flat().filter(Boolean),
  new RegExp(`^${path.join(__dirname, 'desktop').replace(/[/\\^$.*+?()[\]{}|-]/g, '\\$&')}[/\\\\]`),
];

module.exports = config;
