#!/usr/bin/env python3
import argparse
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path



def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--slug",required=True)
    parser.add_argument("--root",default=".")
    args=parser.parse_args()
    root=Path(args.root).resolve()
    registry=json.loads((root/"creator-challenges.json").read_text())
    matches=[entry for entry in registry if entry.get("slug")==args.slug]
    if len(matches)!=1:
        raise SystemExit(f"expected exactly one creator registry entry for {args.slug}")
    entry=matches[0]
    card=root/"creator"/args.slug/"creator-card.png"
    if entry.get("status")=="retired":
        if card.exists():
            raise SystemExit(f"retired creator route retains social card: creator/{args.slug}/creator-card.png")
        print(f"Retired creator card is absent for {args.slug}.")
        return
    if entry.get("status")!="published":
        raise SystemExit(f"unsupported creator publication status for {args.slug}")
    if not card.is_file():
        raise SystemExit(f"published creator card is missing: creator/{args.slug}/creator-card.png")
    raw=card.read_bytes()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SystemExit(f"creator social card is not a PNG: creator/{args.slug}/creator-card.png")
    offset=8
    chunk_types=[]
    while offset<len(raw):
        if offset+12>len(raw):
            raise SystemExit(f"creator social card has a truncated PNG chunk: creator/{args.slug}/creator-card.png")
        length=struct.unpack(">I",raw[offset:offset+4])[0]
        chunk_type=raw[offset+4:offset+8]
        chunk_types.append(chunk_type)
        offset+=12+length
    if offset!=len(raw) or chunk_types not in ([b"IHDR",b"IDAT",b"IEND"],):
        raise SystemExit(f"creator social card contains unexpected PNG metadata/chunks: creator/{args.slug}/creator-card.png")
    from PIL import Image, ImageChops
    with tempfile.TemporaryDirectory(prefix="packone-creator-card-") as tmp:
        expected=Path(tmp)/"expected.png"
        subprocess.run([
            sys.executable,str(root/"scripts/generate-creator-social-card.py"),
            "--output",str(expected),
            "--creator",str(entry["creator_name"]),
            "--score",str(entry["score"]),
            "--environment",str(entry["environment"]),
            "--source-type",str(entry["source_type"]),
            "--source-day",str(entry.get("source_day") or ""),
        ],check=True,cwd=root)
        with Image.open(card) as actual_image, Image.open(expected) as expected_image:
            actual=actual_image.convert("RGB")
            wanted=expected_image.convert("RGB")
            if actual.size!=wanted.size or ImageChops.difference(actual,wanted).getbbox() is not None:
                raise SystemExit(f"creator social card is stale or nondeterministic: creator/{args.slug}/creator-card.png")
    print(f"Creator social card matches deterministic output for {args.slug}.")


if __name__=="__main__":
    main()
