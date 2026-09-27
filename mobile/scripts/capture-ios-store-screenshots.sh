#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?Pass the built Pack One .app path as the first argument.}"
bundle_id="${PACKONE_SCREENSHOT_BUNDLE_ID:-pro.packone.preview}"
output_root="${PACKONE_SCREENSHOT_OUTPUT:-store-screenshots/ios}"
mkdir -p "$output_root"

runtime_id="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys,re; d=json.load(sys.stdin); rs=[r for r in d["runtimes"] if r.get("isAvailable") and ".iOS-" in r.get("identifier","")]; rs.sort(key=lambda r: tuple(map(int,re.findall(r"\d+",r.get("version","0")))), reverse=True); print(rs[0]["identifier"] if rs else "")')"
test -n "$runtime_id" || { echo "No available iOS simulator runtime." >&2; exit 1; }

pick_device_type() {
  python3 - "$@" <<'PY'
import json, subprocess, sys
preferred=sys.argv[1:]
data=json.loads(subprocess.check_output(["xcrun","simctl","list","devicetypes","-j"], text=True))
by_name={d["name"]:d["identifier"] for d in data["devicetypes"]}
for name in preferred:
    if name in by_name:
        print(by_name[name])
        raise SystemExit(0)
raise SystemExit("No supported store screenshot simulator type found. Tried: "+", ".join(preferred))
PY
}

phone_type="$(pick_device_type "iPhone 17 Pro Max" "iPhone 16 Pro Max" "iPhone 15 Pro Max" "iPhone 14 Pro Max")"
ipad_type="$(pick_device_type "iPad Pro 13-inch (M5)" "iPad Pro 13-inch (M4)" "iPad Pro 12.9-inch (6th generation)")"

capture_device() {
  local kind="$1"
  local type_id="$2"
  local allowed="$3"
  local udid
  udid="$(xcrun simctl create "Pack One Store Screenshot $kind" "$type_id" "$runtime_id")"
  xcrun simctl boot "$udid"
  open -gj -a Simulator || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4 >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$app_path"

  local scenes=(
    "01-daily-decision|packone://draft-run?environment=mixed"
    "02-reveal-comparison|packone://draft-run?environment=mixed&screenshot=feedback"
    "03-daily-hub|packone://"
    "04-practice|packone://practice"
    "05-career|packone://career"
  )
  if [[ "$kind" == "iphone" ]]; then
    scenes+=("review-subscription|packone://membership")
  fi

  for item in "${scenes[@]}"; do
    local name="${item%%|*}"
    local url="${item#*|}"
    xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
    xcrun simctl openurl "$udid" "$url"
    sleep 5
    local path="$output_root/$kind-$name.png"
    xcrun simctl io "$udid" screenshot --type=png "$path" >/dev/null
    local width height dimensions
    width="$(sips -g pixelWidth "$path" | awk '/pixelWidth/{print $2}')"
    height="$(sips -g pixelHeight "$path" | awk '/pixelHeight/{print $2}')"
    dimensions="${width}x${height}"
    case " $allowed " in
      *" $dimensions "*) ;;
      *) echo "Unexpected $kind screenshot size $dimensions for $path. Allowed: $allowed" >&2; exit 1 ;;
    esac
  done
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
}

capture_device iphone "$phone_type" "1320x2868 1290x2796 1260x2736"
capture_device ipad "$ipad_type" "2064x2752 2048x2732"

echo "Generated Pack One iPhone, iPad, and Apple subscription-review screenshots in $output_root"
