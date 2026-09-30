#!/usr/bin/env python3
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID = "{http://schemas.android.com/apk/res/android}"

FORBIDDEN_PERMISSIONS = {
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.CALL_PHONE",
    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BODY_SENSORS",
    "android.permission.ACTIVITY_RECOGNITION",
    "com.android.vending.BILLING",
}

def attr(node, name):
    return node.attrib.get(ANDROID + name)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    root = ET.parse(manifest_path).getroot()
    permissions = sorted({
        attr(node, "name")
        for tag in ("uses-permission", "uses-permission-sdk-23")
        for node in root.findall(tag)
        if attr(node, "name")
    })
    features = sorted({
        attr(node, "name")
        for node in root.findall("uses-feature")
        if attr(node, "name")
    })

    application = root.find("application")
    components = []
    if application is not None:
        for tag in ("activity", "activity-alias", "service", "receiver", "provider"):
            for node in application.findall(tag):
                actions = sorted({
                    attr(action, "name")
                    for intent in node.findall("intent-filter")
                    for action in intent.findall("action")
                    if attr(action, "name")
                })
                categories = sorted({
                    attr(category, "name")
                    for intent in node.findall("intent-filter")
                    for category in intent.findall("category")
                    if attr(category, "name")
                })
                components.append({
                    "type": tag,
                    "name": attr(node, "name"),
                    "exported": attr(node, "exported"),
                    "permission": attr(node, "permission"),
                    "authorities": attr(node, "authorities"),
                    "actions": actions,
                    "categories": categories,
                })

    forbidden = sorted(set(permissions) & FORBIDDEN_PERMISSIONS)
    cleartext = attr(application, "usesCleartextTraffic") if application is not None else None
    report = {
        "manifest": str(manifest_path),
        "package": root.attrib.get("package"),
        "permissions": permissions,
        "forbidden_permissions_present": forbidden,
        "uses_cleartext_traffic": cleartext,
        "features": features,
        "components": sorted(components, key=lambda item: (item["type"], item["name"] or "")),
    }
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))

    if forbidden:
        print("Forbidden/unexpected Pack One permissions are present: " + ", ".join(forbidden), file=sys.stderr)
        return 1
    if cleartext == "true":
        print("Pack One release manifest unexpectedly enables cleartext traffic.", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
