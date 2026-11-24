// Google Mobile Ads reads gad_rdp from the platform's default preferences:
// https://developers.google.com/admob/android/privacy/us-states
// https://developers.google.com/admob/ios/privacy/us-states
// Use finalized mods so SDK 57's scene-support plugin sees its unmodified
// template first. Refuse to build if either native startup hook drifts.
const fs = require('node:fs');

const iosSignal = '    UserDefaults.standard.set(true, forKey: "gad_rdp")';
const androidSignal = '    android.preference.PreferenceManager.getDefaultSharedPreferences(this).edit().putInt("gad_rdp", 1).apply()';

function inject(contents, anchor, signal, platform) {
  const matches = [...contents.matchAll(anchor)];
  if (matches.length !== 1) throw Error('Pack One RDP: expected exactly one ' + platform + ' startup hook.');
  if (contents.includes('gad_rdp')) {
    if (contents.split('gad_rdp').length !== 2 || !contents.includes(matches[0][0] + '\n' + signal)) {
      throw Error('Pack One RDP: unexpected existing ' + platform + ' privacy signal.');
    }
    return contents;
  }
  return contents.replace(anchor, match => match + '\n' + signal);
}

function patchIos(contents) {
  const result = inject(contents, /didFinishLaunchingWithOptions[^\n]*\n\s*\) -> Bool \{/g, iosSignal, 'iOS');
  return /^import Foundation$/m.test(result) ? result : 'import Foundation\n' + result;
}

function patchAndroid(contents) {
  return inject(contents, /override fun onCreate\(\) \{\n\s*super\.onCreate\(\)/g, androidSignal, 'Android');
}

function withAdMobRdp(config) {
  const { withFinalizedMod, IOSConfig, AndroidConfig } = require('expo/config-plugins');
  config = withFinalizedMod(config, ['ios', mod => {
    const file = IOSConfig.Paths.getAppDelegate(mod.modRequest.projectRoot);
    if (file.language !== 'swift') throw Error('Pack One RDP: expected Swift AppDelegate.');
    fs.writeFileSync(file.path, patchIos(file.contents));
    return mod;
  }]);
  return withFinalizedMod(config, ['android', async mod => {
    const file = await AndroidConfig.Paths.getMainApplicationAsync(mod.modRequest.projectRoot);
    if (file.language !== 'kt') throw Error('Pack One RDP: expected Kotlin MainApplication.');
    fs.writeFileSync(file.path, patchAndroid(file.contents));
    return mod;
  }]);
}

module.exports = withAdMobRdp;
module.exports.patchIos = patchIos;
module.exports.patchAndroid = patchAndroid;
