#!/usr/bin/env bash
set -euo pipefail

udid="${1:?simulator UDID is required}"
label="${2:?output label is required}"
out_root="${3:-store-screenshots}"
bundle_id="pro.packone.preview"

mkdir -p "$out_root/$label"

capture() {
  local name="$1"
  local scene="$2"
  local launch_output=""

  xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true

  # Avoid custom-URL handoff entirely. In the isolated screenshot fixture
  # build, React Native Settings reads this iOS NSArgumentDomain launch value
  # and the real Expo Router layout redirects to the requested real screen.
  launch_output="$(xcrun simctl launch "$udid" "$bundle_id" -packoneScreenshotScene "$scene")"
  if [[ "$launch_output" != "$bundle_id:"* ]]; then
    echo "Unexpected Simulator launch output for $scene: $launch_output" >&2
    exit 1
  fi

  sleep 12
  local raw="$out_root/$label/$name.raw.png"
  xcrun simctl io "$udid" screenshot "$raw"
  # App Store Connect rejects images with alpha. Convert Simulator PNG output
  # to JPEG while preserving the exact native simulator dimensions.
  sips -s format jpeg "$raw" --out "$out_root/$label/$name.jpg" >/dev/null
  rm -f "$raw"
}

capture "01-daily-decision" "daily-decision"
capture "02-reveal-comparison" "reveal-comparison"
capture "03-daily-hub" "daily-hub"
capture "04-practice" "practice"
capture "05-career" "career"
capture "iap-review-membership" "membership"

count=0
while IFS= read -r path; do
  width="$(sips -g pixelWidth "$path" | awk '/pixelWidth:/{print $2}')"
  height="$(sips -g pixelHeight "$path" | awk '/pixelHeight:/{print $2}')"
  dimensions="${width}x${height}"
  case "$label:$dimensions" in
    iphone:1320x2868|iphone:1290x2796|iphone:1260x2736) ;;
    ipad:2064x2752|ipad:2048x2732) ;;
    *)
      echo "$path has an App Store-incompatible size for $label: $dimensions" >&2
      exit 1
      ;;
  esac
  count=$((count + 1))
  echo "$(basename "$path"): $dimensions"
done < <(find "$out_root/$label" -maxdepth 1 -name '*.jpg' -type f -print | sort)
[[ "$count" == 6 ]]
