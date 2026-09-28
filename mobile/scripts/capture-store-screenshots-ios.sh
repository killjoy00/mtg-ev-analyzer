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
  xcrun simctl io "$udid" screenshot "$out_root/$label/$name.png"
}

capture "01-daily-decision" "daily-decision"
capture "02-reveal-comparison" "reveal-comparison"
capture "03-daily-hub" "daily-hub"
capture "04-practice" "practice"
capture "05-career" "career"
capture "iap-review-membership" "membership"

python3 - "$out_root/$label" <<'PY'
from pathlib import Path
import struct
import sys

root = Path(sys.argv[1])
for path in sorted(root.glob("*.png")):
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    width, height = struct.unpack(">II", raw[16:24])
    if width < 1000 or height < 1000:
        raise SystemExit(f"{path} is unexpectedly small: {width}x{height}")
    print(f"{path.name}: {width}x{height}")
PY
