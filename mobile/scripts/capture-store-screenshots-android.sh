#!/usr/bin/env bash
set -euo pipefail

out_root="${1:-store-screenshots}"
package_name="pro.packone.preview"

mkdir -p "$out_root/android"

# Google Play requires the long screenshot edge to be no more than 2x the short
# edge. Capture at a recommendation-friendly 9:16 viewport instead of the
# Pixel 7 Pro hardware resolution (1440x3120).
adb shell wm size 1080x1920 >/dev/null
adb shell wm density 420 >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

capture() {
  local name="$1"
  local url="$2"
  adb shell am force-stop "$package_name" >/dev/null 2>&1 || true
  # adb shell reconstructs a remote shell command. Quote the URI inside that
  # remote command so query separators such as '&' are not parsed by /system/bin/sh.
  adb shell "am start -W -a android.intent.action.VIEW -d '$url' -p '$package_name'" >/dev/null
  sleep 12
  local raw="$out_root/android/$name.raw.png"
  adb exec-out screencap -p > "$raw"
  ffmpeg -hide_banner -loglevel error -y -i "$raw" -frames:v 1 "$out_root/android/$name.jpg"
  rm -f "$raw"
}

capture "01-daily-decision" "packone://draft-run?environment=mixed"
capture "02-reveal-comparison" "packone://store-screenshot-feedback"
capture "03-daily-hub" "packone://"
capture "04-practice" "packone://practice"
capture "05-career" "packone://career"

expected="1080x1920"
count=0
while IFS= read -r path; do
  dimensions="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$path")"
  if [[ "$dimensions" != "$expected" ]]; then
    echo "$path has unexpected dimensions: $dimensions (expected $expected)" >&2
    exit 1
  fi
  count=$((count + 1))
  echo "$(basename "$path"): $dimensions"
done < <(find "$out_root/android" -maxdepth 1 -name '*.jpg' -type f -print | sort)
[[ "$count" == 5 ]]
