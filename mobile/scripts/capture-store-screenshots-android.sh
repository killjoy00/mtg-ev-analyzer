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
capture "02-reveal-comparison" "packone:///store-screenshot-feedback"
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


# The reveal/comparison scene must be materially different from the pre-pick
# Daily decision. Run 36392125277 proved that comparing reveal to the hub was
# insufficient: 01 and 02 were byte-for-byte identical while 02 and 03 differed.
# SSIM is deterministic here because both images come from the same emulator
# and fixture build.
ssim_output="$(
  ffmpeg -hide_banner -i "$out_root/android/01-daily-decision.jpg"     -i "$out_root/android/02-reveal-comparison.jpg"     -lavfi ssim -f null - 2>&1
)"
ssim_score="$(printf '%s\n' "$ssim_output" | sed -n 's/.* All:\([0-9.]*\) .*/\1/p' | tail -n 1)"
if [[ -z "$ssim_score" ]]; then
  echo "Could not calculate SSIM for Android reveal vs hub screenshots." >&2
  exit 1
fi
python3 - "$ssim_score" <<'PY'
import sys
score=float(sys.argv[1])
if score >= 0.98:
    raise SystemExit(f'Android reveal screenshot is too similar to the pre-pick Daily decision (SSIM={score:.6f}).')
print(f'Android decision-vs-reveal SSIM: {score:.6f}')
PY
