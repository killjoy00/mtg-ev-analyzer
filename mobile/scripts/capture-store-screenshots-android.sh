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
# Hosted Pixel emulators can surface a launcher ANR dialog after resizing.
adb shell settings put global hide_error_dialogs 1 >/dev/null
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
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
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  local hierarchy="/sdcard/packone-$name.xml"
  adb shell uiautomator dump "$hierarchy" >/dev/null 2>&1 || true
  if adb shell cat "$hierarchy" 2>/dev/null | grep -Eiq "isn't responding|Close app|App isn't responding|Process system isn't responding"; then
    echo "Android system error dialog is visible during $name capture." >&2
    exit 1
  fi
  adb shell rm -f "$hierarchy" >/dev/null 2>&1 || true
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
  bytes="$(stat -c%s "$path")"
  if (( bytes < 50000 )); then
    echo "$path is suspiciously small and may be blank: $bytes bytes" >&2
    exit 1
  fi
  count=$((count + 1))
  echo "$(basename "$path"): $dimensions"
done < <(find "$out_root/android" -maxdepth 1 -name '*.jpg' -type f -print | sort)
[[ "$count" == 5 ]]


# The reveal/comparison scene must differ materially from BOTH the
# pre-pick Daily decision and the Daily hub.
compare_ssim() {
  local left="$1"
  local right="$2"
  local label="$3"
  local output score
  output="$(ffmpeg -hide_banner -i "$left" -i "$right" -lavfi ssim -f null - 2>&1)"
  score="$(printf '%s\n' "$output" | sed -n 's/.* All:\([0-9.]*\) .*/\1/p' | tail -n 1)"
  if [[ -z "$score" ]]; then
    echo "Could not calculate SSIM for $label." >&2
    exit 1
  fi
  python3 - "$score" "$label" <<'PY'
import sys
score=float(sys.argv[1])
label=sys.argv[2]
if score >= 0.98:
    raise SystemExit(f'Android screenshots are too similar for {label} (SSIM={score:.6f}).')
print(f'Android {label} SSIM: {score:.6f}')
PY
}
compare_ssim "$out_root/android/01-daily-decision.jpg" "$out_root/android/02-reveal-comparison.jpg" "decision-vs-reveal"
compare_ssim "$out_root/android/02-reveal-comparison.jpg" "$out_root/android/03-daily-hub.jpg" "reveal-vs-hub"
