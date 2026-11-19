// Share the exact server/web card-art URL allowlist with the native viewer.
// Expo's default projectRoot is mobile/, which otherwise makes imports from
// ../card-image-policy.mjs invisible to Metro even when tsc accepts them.
// This is a JavaScript resolver-only change; it does not generate native files.
const path=require('node:path');
const {getDefaultConfig}=require('expo/metro-config');
const config=getDefaultConfig(__dirname);
const repoRoot=path.resolve(__dirname,'..');
config.watchFolders=[...new Set([...(config.watchFolders||[]),repoRoot])];
module.exports=config;
