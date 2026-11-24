const test = require('node:test');
const assert = require('node:assert/strict');
const { patchIos, patchAndroid } = require('../plugins/with-admob-rdp.cjs');

test('native RDP is installed before SDK or React startup and is idempotent', () => {
  const swift = 'import Expo\nclass AppDelegate {\n  public override func application(\n    _ application: UIApplication,\n    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n  ) -> Bool {\n    let delegate = ReactNativeDelegate()\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n  }\n}';
  const kotlin = 'class MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n    loadReactNative(this)\n  }\n}';
  const ios = patchIos(swift);
  const android = patchAndroid(kotlin);
  assert.ok(ios.indexOf('UserDefaults.standard.set(true, forKey: "gad_rdp")') < ios.indexOf('let delegate'));
  assert.ok(android.indexOf('putInt("gad_rdp", 1).apply()') < android.indexOf('loadReactNative'));
  assert.match(android, /attachBaseContext\(base: android\.content\.Context\) \{\n    super\.attachBaseContext\(base\)\n[^\n]+putInt\("gad_rdp", 1\)\.apply\(\)\n  \}\n\n  override fun onCreate/);
  assert.match(ios, /import Foundation/);
  assert.equal(patchIos(ios), ios);
  assert.equal(patchAndroid(android), android);
  assert.throws(() => patchIos('missing startup hook'), /startup hook/);
  assert.throws(() => patchAndroid('missing startup hook'), /startup hook/);
  assert.throws(() => patchIos(ios.replace('set(true', 'set(false')), /unexpected existing/);
  assert.throws(() => patchAndroid(android.replace('gad_rdp", 1', 'gad_rdp", 0')), /unexpected existing/);
});
