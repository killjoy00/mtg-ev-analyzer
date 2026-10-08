#!/usr/bin/env python3
"""Verify committed creator social images are deterministic Pack One render outputs."""

import argparse
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate-creator-social-card.py"
ASSETS = {
    "creator-card.png": (1200, 630),
    "creator-card-square.png": (1080, 1080),
}
REQUIRED_BRAND_ASSETS = (
    ROOT / "mobile/assets/images/header-mark.png",
    ROOT / "assets/fonts/barlow-condensed-600.woff2",
    ROOT / "assets/fonts/barlow-condensed-700.woff2",
    ROOT / "assets/fonts/source-sans-3-400.woff2",
    ROOT / "assets/fonts/source-sans-3-600.woff2",
    ROOT / "assets/fonts/source-sans-3-700.woff2",
)


def png_chunks(path: Path):
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path} is not a PNG")
    chunks, offset = [], 8
    while offset < len(raw):
        length = struct.unpack(">I", raw[offset : offset + 4])[0]
        name = raw[offset + 4 : offset + 8]
        chunks.append(name)
        offset += 12 + length
    if offset != len(raw):
        raise AssertionError(f"{path} has malformed PNG chunks")
    return chunks


def check_png_shape(path: Path, expected_size):
    from PIL import Image

    chunks = png_chunks(path)
    if not chunks or chunks[0] != b"IHDR" or chunks[-1] != b"IEND" or b"IDAT" not in chunks:
        raise AssertionError(f"{path} has an invalid PNG chunk structure: {chunks}")
    if any(chunk not in {b"IHDR", b"IDAT", b"IEND"} for chunk in chunks):
        raise AssertionError(f"{path} contains nondeterministic PNG metadata chunks: {chunks}")
    with Image.open(path) as image:
        if image.size != expected_size:
            raise AssertionError(f"{path} is {image.size}, expected {expected_size}")
        if image.mode != "RGB":
            raise AssertionError(f"{path} is {image.mode}, expected RGB")


def check_repo_brand_inputs():
    source = GENERATOR.read_text(encoding="utf-8")
    for stale in ("/usr/share/fonts", "DejaVuSans", "LiberationSans"):
        if stale in source:
            raise AssertionError(f"creator renderer still contains host-font fallback: {stale}")
    for asset in REQUIRED_BRAND_ASSETS:
        if not asset.is_file():
            raise AssertionError(f"missing Pack One renderer asset: {asset.relative_to(ROOT)}")
    if "mobile/assets/images/header-mark.png" not in source:
        raise AssertionError("creator renderer must use the canonical Pack One P¹ header mark")
    for name in (
        "barlow-condensed-600.woff2",
        "barlow-condensed-700.woff2",
        "source-sans-3-400.woff2",
        "source-sans-3-600.woff2",
        "source-sans-3-700.woff2",
    ):
        if name not in source:
            raise AssertionError(f"creator renderer must use repo-owned font asset {name}")


def generator_command(entry, og_path: Path, square_path: Path):
    return [
        sys.executable,
        str(GENERATOR),
        "--output",
        str(og_path),
        "--square-output",
        str(square_path),
        "--creator",
        entry["creator_name"],
        "--headline",
        entry["headline"],
        "--score",
        str(entry["score"]),
        "--environment",
        entry["environment"],
        "--source-type",
        entry["source_type"],
        "--source-day",
        entry.get("source_day") or "",
    ]


def compare_pixels(actual: Path, expected: Path):
    from PIL import Image, ImageChops

    with Image.open(actual) as left, Image.open(expected) as right:
        diff = ImageChops.difference(left.convert("RGB"), right.convert("RGB"))
        if diff.getbbox() is not None:
            raise AssertionError(f"{actual} does not match deterministic creator renderer output")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", required=True)
    args = parser.parse_args()

    check_repo_brand_inputs()
    registry = json.loads((ROOT / "creator-challenges.json").read_text(encoding="utf-8"))
    entry = next((row for row in registry if row.get("slug") == args.slug), None)
    if entry is None:
        raise SystemExit(f"creator challenge {args.slug} is not in creator-challenges.json")

    route = ROOT / "creator" / args.slug
    paths = {name: route / name for name in ASSETS}
    if entry["status"] == "retired":
        retained = [str(path.relative_to(ROOT)) for path in paths.values() if path.exists()]
        if retained:
            raise SystemExit("retired creator challenge retains social assets: " + ", ".join(retained))
        print(f"Retired creator challenge {args.slug} has no social images.")
        return

    for name, expected_size in ASSETS.items():
        path = paths[name]
        if not path.is_file():
            raise SystemExit(f"published creator challenge is missing {path.relative_to(ROOT)}")
        check_png_shape(path, expected_size)

    with tempfile.TemporaryDirectory(prefix="packone-creator-card-check-") as tmp:
        expected_og = Path(tmp) / "creator-card.png"
        expected_square = Path(tmp) / "creator-card-square.png"
        subprocess.run(generator_command(entry, expected_og, expected_square), cwd=ROOT, check=True)
        for name, expected in (
            ("creator-card.png", expected_og),
            ("creator-card-square.png", expected_square),
        ):
            check_png_shape(expected, ASSETS[name])
            compare_pixels(paths[name], expected)

    print(
        f"Creator social images for {args.slug} match Pack One renderer "
        f"({ASSETS['creator-card.png'][0]}x{ASSETS['creator-card.png'][1]} + "
        f"{ASSETS['creator-card-square.png'][0]}x{ASSETS['creator-card-square.png'][1]})."
    )


if __name__ == "__main__":
    main()
