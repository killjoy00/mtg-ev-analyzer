"""Capture real Pack One native Android tablet screens; never publish from this job.

The emulator is a real tablet AVD, with an explicitly sized 16:9 landscape
viewport and the profile's native density. The APK uses isolated preview-only
fixtures and cannot write to the production API. Save unmodified screencaps and
accessibility evidence; no generated card art, simulated UI, captions or numbering.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = "pro.packone.preview"
size = os.environ["TABLET_SIZE"]
profile = os.environ["TABLET_PROFILE"]
display = os.environ["TABLET_DISPLAY"]
expected = tuple(reversed(tuple(map(int, display.split("x")))))
out = Path("tablet-store-captures") / size
screens = out / "screenshots"
evidence = out / "evidence"
screens.mkdir(parents=True, exist_ok=True)
evidence.mkdir(parents=True, exist_ok=True)


def adb(*args, check=True):
    result = subprocess.run(["adb", *args], capture_output=True, text=True,
                            check=check, timeout=90)
    return result.stdout.strip()


def hierarchy():
    for _ in range(4):
        adb("shell", "rm", "-f", "/sdcard/packone-tablet.xml", check=False)
        adb("shell", "uiautomator", "dump", "/sdcard/packone-tablet.xml", check=False)
        xml = adb("shell", "cat", "/sdcard/packone-tablet.xml", check=False)
        try:
            root = ET.fromstring(xml)
            if re.search(r"isn.t responding|Close app|Unfortunately", xml, re.I):
                raise RuntimeError("System error dialog visible")
            if not any(n.get("package") == PACKAGE for n in root.iter("node")):
                raise RuntimeError("Pack One not in foreground")
            return xml, root
        except ET.ParseError:
            time.sleep(2)
    raise RuntimeError("No valid current native accessibility hierarchy")


def find(root, label, exact=False):
    for n in root.iter("node"):
        vals = (n.get("text", ""), n.get("content-desc", ""))
        if any(v == label if exact else label.lower() in v.lower() for v in vals):
            bounds = list(map(int, re.findall(r"\d+", n.get("bounds", ""))))
            if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                return bounds
    return None


def swipe(up=True):
    w, h = expected
    y1, y2 = (int(h * .77), int(h * .30)) if up else (int(h * .30), int(h * .77))
    adb("shell", "input", "swipe", str(w // 2), str(y1), str(w // 2), str(y2), "450")
    time.sleep(.5)


def tap(label, exact=False):
    for _ in range(8):
        _, root = hierarchy()
        box = find(root, label, exact)
        if box:
            adb("shell", "input", "tap", str((box[0] + box[2]) // 2),
                str((box[1] + box[3]) // 2))
            time.sleep(2)
            return
        swipe()
    raise RuntimeError(f"No visible native control: {label}")


def launch(uri, reset=False):
    adb("shell", "am", "force-stop", PACKAGE)
    if reset:
        adb("shell", "pm", "clear", PACKAGE)
    adb("shell", f"am start -W -a android.intent.action.VIEW -d '{uri}' -p '{PACKAGE}'")
    time.sleep(12)
    adb("shell", "am", "broadcast", "-a", "android.intent.action.CLOSE_SYSTEM_DIALOGS", check=False)


manifest = {
    "source_sha": os.environ["ACCEPTANCE_SOURCE_SHA"],
    "tested_checkout_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "device_family": size, "avd_profile": profile, "package": PACKAGE,
    "backend": "isolated native preview fixtures", "physical_device": False,
    "requested_display": display, "orientation": "landscape",
    "scenes": [],
}


def save_manifest():
    (evidence / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def capture(name, required):
    for _ in range(4):
        xml, root = hierarchy()
        if all(find(root, label) for label in required):
            break
        time.sleep(3)
    else:
        (evidence / f"{name}-missing.xml").write_text(xml)
        raise RuntimeError(f"{name}: expected native controls {required}")
    data = subprocess.check_output(["adb", "exec-out", "screencap", "-p"], timeout=45)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("Not a native PNG screenshot")
    dims = struct.unpack(">II", data[16:24])
    if dims != expected or dims[0] * 9 != dims[1] * 16 or min(dims) < 1080:
        raise RuntimeError(f"Wrong screenshot viewport: {dims} (expected {expected})")
    if not 50_000 < len(data) <= 8_000_000:
        raise RuntimeError(f"Invalid screenshot size: {len(data)}")
    (screens / f"{name}.png").write_bytes(data)
    (evidence / f"{name}.xml").write_text(xml)
    manifest["scenes"].append({"name": name, "dimensions": dims,
                              "sha256": hashlib.sha256(data).hexdigest(),
                              "required_native_labels": required})
    save_manifest()


apk, = Path("preview-apk").rglob("*.apk")
manifest["apk_sha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
adb("wait-for-device")
for _ in range(6):
    if "Service package: found" in adb("shell", "service", "check", "package", check=False):
        break
    time.sleep(5)
else:
    raise RuntimeError("Package manager never became ready")
adb("install", "-r", str(apk))
manifest["physical_display_before_override"] = adb("shell", "wm", "size")
manifest["native_density"] = adb("shell", "wm", "density")
density = int(re.findall(r"(?:Physical|Override) density:\s*(\d+)", manifest["native_density"])[-1])
if min(expected) * 160 / density < 600:
    raise RuntimeError("Viewport is not tablet class (smallest width below 600dp)")
adb("shell", "wm", "size", display)
adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
adb("shell", "settings", "put", "system", "user_rotation", "1")
adb("shell", "wm", "user-rotation", "lock", "1")
adb("shell", "settings", "put", "system", "font_scale", "1.0")
adb("shell", "cmd", "uimode", "night", "no")
adb("shell", "settings", "put", "global", "hide_error_dialogs", "1")
adb("shell", "cmd", "overlay", "enable-exclusive", "--category",
    "com.android.internal.systemui.navbar.gestural")
manifest["effective_display"] = adb("shell", "wm", "size")
manifest["android_api"] = adb("shell", "getprop", "ro.build.version.sdk")
manifest["emulator_model"] = adb("shell", "getprop", "ro.product.model")
save_manifest()

try:
    launch("packone://draft-run?environment=mixed&screenshot=decision", reset=True)
    capture("01-real-trophy-drafts", ["Draft Run", "Hero in Training", "Web Up"])
    launch("packone://store-screenshot-feedback")
    capture("02-see-the-trophy-pick", ["Web Up", "Hero in Training"])
    # Complete a genuine eight-pick run via actual native accessibility controls.
    launch("packone://native-acceptance?scenario=guest&destination=home", reset=True)
    tap("How to Play", exact=True)
    tap("Play Daily Draft Run", exact=True)
    for pick in range(8):
        for _ in range(3):
            swipe(up=False)
        tap("Pick Hero in Training")
        tap("Confirm pick", exact=True)
        xml, _ = hierarchy()
        if "You picked" not in xml:
            raise RuntimeError(f"No native feedback after pick {pick + 1}")
        tap("See result" if pick == 7 else "Next pick", exact=True)
    capture("03-eight-picks-one-score", ["Review pick 1"])
    launch("packone://", reset=True)
    capture("04-three-new-dailies", ["Daily Draft Run", "Daily Powered Cube", "Daily Latest Set"])
    launch("packone://native-acceptance?scenario=store-leaderboard&destination=leaders")
    capture("05-same-picks-for-everyone", ["ManaCurve", "TrophyChaser"])
    launch("packone://native-acceptance?scenario=elite&destination=practice&screenshot=store")
    capture("06-keep-practicing", ["Regular Draft Run", "Powered Cube"])
    if len(manifest["scenes"]) != 6 or len({s["sha256"] for s in manifest["scenes"]}) != 6:
        raise RuntimeError("Expected six distinct native screenshot scenes")
    manifest["capture_passed"] = True
finally:
    save_manifest()
    adb("shell", "wm", "size", "reset", check=False)
    adb("shell", "wm", "user-rotation", "free", check=False)
