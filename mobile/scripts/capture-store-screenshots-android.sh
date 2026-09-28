#!/usr/bin/env bash
set -euo pipefail

out_root="${1:-store-screenshots}"
package_name="pro.packone.preview"

mkdir -p "$out_root/android"

capture() {
  local name="$1"
  local url="$2"
  adb shell am force-stop "$package_name" >/dev/null 2>&1 || true
  # adb shell reconstructs a remote shell command. Quote the URI inside that
  # remote command so query separators such as '&' are not parsed by /system/bin/sh.
  adb shell "am start -W -a android.intent.action.VIEW -d '$url' -p '$package_name'" >/dev/null
  sleep 8
  adb exec-out screencap -p > "$out_root/android/$name.png"
}

capture "01-daily-decision" "packone://draft-run?environment=mixed"
capture "02-reveal-comparison" "packone://draft-run?environment=mixed&screenshot=feedback"
capture "03-daily-hub" "packone://"
capture "04-practice" "packone://practice"
capture "05-career" "packone://career"

python3 - "$out_root/android" <<'PY'
from pathlib import Path
import struct
import sys

root = Path(sys.argv[1])
for path in sorted(root.glob("*.png")):
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    width, height = struct.unpack(">II", raw[16:24])
    if width < 1080 or height < 1080:
        raise SystemExit(f"{path} is unexpectedly small: {width}x{height}")
    print(f"{path.name}: {width}x{height}")
PY
