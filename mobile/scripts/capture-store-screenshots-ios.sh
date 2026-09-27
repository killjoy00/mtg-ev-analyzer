#!/usr/bin/env bash
set -euo pipefail

udid="${1:?simulator UDID is required}"
label="${2:?output label is required}"
out_root="${3:-store-screenshots}"
bundle_id="pro.packone.preview"

mkdir -p "$out_root/$label"

capture() {
  local name="$1"
  local url="$2"
  xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
  xcrun simctl openurl "$udid" "$url"
  sleep 8
  xcrun simctl io "$udid" screenshot "$out_root/$label/$name.png"
}

capture "01-daily-decision" "packone://draft-run?environment=mixed"
capture "02-reveal-comparison" "packone://draft-run?environment=mixed&screenshot=feedback"
capture "03-daily-hub" "packone://"
capture "04-practice" "packone://practice"
capture "05-career" "packone://career"
capture "iap-review-membership" "packone://membership"

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
