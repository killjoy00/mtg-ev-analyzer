#!/usr/bin/env python3
import argparse
import json
import plistlib
import re
import sys
from pathlib import Path

USAGE_KEY = re.compile(r"^NS.*UsageDescription$")

def load_plist(path):
    with path.open("rb") as handle:
        return plistlib.load(handle)

def privacy_summary(path):
    try:
        data = load_plist(path)
    except Exception as error:
        return {"path": str(path), "parse_error": str(error)}
    return {
        "path": str(path),
        "accessed_api_types": data.get("NSPrivacyAccessedAPITypes", []),
        "collected_data_types": data.get("NSPrivacyCollectedDataTypes", []),
        "tracking": data.get("NSPrivacyTracking", False),
        "tracking_domains": data.get("NSPrivacyTrackingDomains", []),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    archive = Path(args.archive)
    apps = list((archive / "Products" / "Applications").glob("*.app"))
    if len(apps) != 1:
        raise SystemExit(f"Expected exactly one archived app, found {len(apps)}")
    app = apps[0]
    info_path = app / "Info.plist"
    info = load_plist(info_path)

    usage_keys = sorted(
        key for key in info
        if USAGE_KEY.match(key) or key == "NSUserTrackingUsageDescription"
    )
    url_schemes = []
    for item in info.get("CFBundleURLTypes", []) or []:
        url_schemes.extend(item.get("CFBundleURLSchemes", []) or [])

    privacy_files = sorted(app.rglob("PrivacyInfo.xcprivacy"))
    frameworks = sorted(path.name for path in (app / "Frameworks").glob("*.framework")) if (app / "Frameworks").exists() else []
    plugins = sorted(path.name for path in (app / "PlugIns").iterdir()) if (app / "PlugIns").exists() else []

    report = {
        "archive": str(archive),
        "app": str(app),
        "bundle_identifier": info.get("CFBundleIdentifier"),
        "bundle_version": info.get("CFBundleVersion"),
        "marketing_version": info.get("CFBundleShortVersionString"),
        "uses_non_exempt_encryption": info.get("ITSAppUsesNonExemptEncryption"),
        "privacy_usage_description_keys": usage_keys,
        "background_modes": info.get("UIBackgroundModes", []) or [],
        "url_schemes": sorted(set(url_schemes)),
        "privacy_manifests": [privacy_summary(path) for path in privacy_files],
        "frameworks": frameworks,
        "plugins": plugins,
    }
    Path(args.output).write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, default=str))

    failures = []
    if info.get("ITSAppUsesNonExemptEncryption") is not False:
        failures.append("ITSAppUsesNonExemptEncryption must remain false")
    # ATT is the only permitted usage-description permission in this app.
    # Its existence does NOT authorize ads by itself: JavaScript gates SDK
    # initialization behind UMP and membership eligibility. The SDK excludes
    # IDFA for ATT-denied users while permitting non-personalized requests.
    unexpected_usage = [key for key in usage_keys if key != "NSUserTrackingUsageDescription"]
    if unexpected_usage:
        failures.append("unexpected privacy usage-description keys: " + ", ".join(unexpected_usage))
    att_usage = info.get("NSUserTrackingUsageDescription")
    if att_usage is not None and (not isinstance(att_usage, str) or not att_usage.strip()):
        failures.append("NSUserTrackingUsageDescription must be a meaningful nonempty string")
    if info.get("UIBackgroundModes"):
        failures.append("unexpected iOS background modes: " + ", ".join(info.get("UIBackgroundModes") or []))
    if any(item.get("tracking") for item in report["privacy_manifests"] if "tracking" in item):
        failures.append("a bundled privacy manifest declares tracking")
    # Google Mobile Ads declares tracked Device ID in its bundled manifest
    # even when the bundle's top-level tracking flag is false. A blanket
    # rejection hides this nuance and prevents consent-gated TestFlight QA.
    # Allow ONLY this reviewed type from THIS SDK, with ATT declared in Info.plist.
    # Any extra tracked SDK/type remains a release-blocking audit failure.
    tracked_data_types = [
        {
            "path": item.get("path", "unknown"),
            "data_type": data_type.get("NSPrivacyCollectedDataType", "unknown"),
        }
        for item in report["privacy_manifests"]
        for data_type in item.get("collected_data_types", [])
        if isinstance(data_type, dict) and data_type.get("NSPrivacyCollectedDataTypeTracking") is True
    ]
    report["tracking_data_types"] = [
        f"{item['path']}: {item['data_type']}" for item in tracked_data_types
    ]
    unapproved_tracking = [
        item for item in tracked_data_types
        if "GoogleMobileAdsResources" not in item["path"]
        or item["data_type"] != "NSPrivacyCollectedDataTypeDeviceID"
    ]
    if unapproved_tracking:
        failures.append("unreviewed tracked data in bundled SDK manifests: "
                        + ", ".join(f"{item['path']}: {item['data_type']}"
                                    for item in unapproved_tracking))
    if tracked_data_types and (not isinstance(att_usage, str) or not att_usage.strip()):
        failures.append("Google Mobile Ads tracks Device ID; the signed app must "
                        "declare NSUserTrackingUsageDescription and honor ATT for IDFA")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
