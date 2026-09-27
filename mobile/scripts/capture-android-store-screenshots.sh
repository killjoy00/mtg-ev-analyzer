#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?Pass the built Pack One APK path as the first argument.}"
package_id="${PACKONE_SCREENSHOT_ANDROID_PACKAGE:-pro.packone.preview}"
output_root="${PACKONE_SCREENSHOT_OUTPUT:-store-screenshots/android}"
mkdir -p "$output_root"

adb wait-for-device
adb install -r "$apk_path" >/dev/null

scenes=(
  "01-daily-decision|packone://draft-run?environment=mixed"
  "02-reveal-comparison|packone://draft-run?environment=mixed&screenshot=feedback"
  "03-daily-hub|packone://"
  "04-practice|packone://practice"
  "05-career|packone://career"
)

for item in "${scenes[@]}"; do
  name="${item%%|*}"
  url="${item#*|}"
  adb shell am force-stop "$package_id" >/dev/null 2>&1 || true
  adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$url" "$package_id" >/dev/null
  sleep 5
  adb exec-out screencap -p > "$output_root/android-$name.png"
  test -s "$output_root/android-$name.png"
done

echo "Generated Pack One Android store screenshots in $output_root"
