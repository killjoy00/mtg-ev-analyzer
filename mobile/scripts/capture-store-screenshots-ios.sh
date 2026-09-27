#!/usr/bin/env bash
set -euo pipefail

udid="${1:?simulator UDID is required}"
label="${2:?output label is required}"
out_root="${3:-store-screenshots}"
bundle_id="pro.packone.preview"
scheme="packone"

mkdir -p "$out_root/$label"

# iOS Simulator treats a custom URL opened through CoreSimulatorBridge as an
# untrusted cross-app handoff the first time and can display an "Open in …?"
# confirmation sheet. Store screenshots must never capture SpringBoard or that
# sheet. Register the installed app once, then pre-approve only the preview
# scheme for CoreSimulatorBridge in this disposable simulator.
xcrun simctl launch "$udid" "$bundle_id" >/dev/null
sleep 3
xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true

python3 - "$udid" "$bundle_id" "$scheme" <<'PY'
from pathlib import Path
import plistlib
import sys

udid, bundle_id, scheme = sys.argv[1:]
path = (
    Path.home()
    / "Library/Developer/CoreSimulator/Devices"
    / udid
    / "data/Library/Preferences/com.apple.launchservices.schemeapproval.plist"
)
path.parent.mkdir(parents=True, exist_ok=True)
data = {}
if path.exists():
    try:
        with path.open("rb") as handle:
            data = plistlib.load(handle)
    except (plistlib.InvalidFileException, EOFError):
        data = {}
data[f"com.apple.CoreSimulator.CoreSimulatorBridge-->{scheme}"] = bundle_id
with path.open("wb") as handle:
    plistlib.dump(data, handle, fmt=plistlib.FMT_BINARY)
print(f"Pre-approved {scheme}:// for {bundle_id} on {udid}.")
PY

# LaunchServices may already have cached the pre-approval state from the
# registration launch above. Restarting lsd is scoped to this disposable
# simulator and forces the updated approval plist to be observed.
xcrun simctl spawn "$udid" killall lsd >/dev/null 2>&1 || true
sleep 2

capture() {
  local name="$1"
  local url="$2"
  local running=0
  xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
  xcrun simctl openurl "$udid" "$url"

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if xcrun simctl spawn "$udid" launchctl print system 2>/dev/null | grep -Fq "UIKitApplication:$bundle_id"; then
      running=1
      break
    fi
    sleep 1
  done
  if [[ "$running" != "1" ]]; then
    echo "Preview app did not launch for screenshot URL: $url" >&2
    exit 1
  fi

  sleep 7
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
