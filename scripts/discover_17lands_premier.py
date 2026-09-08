#!/usr/bin/env python3
"""Discover 17Lands public Premier Draft draft-data archives.

The public datasets page is the source of truth. We extract only the documented
bulk S3 draft-data links and never call the unsupported card-ratings API.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from datetime import datetime, timezone
from typing import Iterable

PUBLIC_DATASETS_URL = "https://www.17lands.com/public_datasets"
DRAFT_URL_RE = re.compile(
    r"https://17lands-public\.s3\.amazonaws\.com/analysis_data/draft_data/"
    r"draft_data_public\.([A-Za-z0-9]+)\.PremierDraft\.csv\.gz"
)


def discover(html: str) -> list[dict]:
    seen = set()
    rows = []
    for match in DRAFT_URL_RE.finditer(html):
        set_id = match.group(1).upper()
        if set_id in seen:
            continue
        seen.add(set_id)
        rows.append({"set_id": set_id, "url": match.group(0)})
    return rows


def fetch_html(url: str = PUBLIC_DATASETS_URL) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "PackOne/1.0 public-dataset discovery"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def head_last_modified(url: str) -> str | None:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PackOne/1.0 public-dataset discovery"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = response.headers.get("Last-Modified")
    except Exception:
        return None
    if not value:
        return None
    try:
        parsed = datetime.strptime(value, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
        return parsed.date().isoformat()
    except ValueError:
        return None


def with_dates(rows: Iterable[dict]) -> list[dict]:
    return [{**row, "source_date": head_last_modified(row["url"])} for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--with-dates", action="store_true")
    args = parser.parse_args()
    rows = discover(fetch_html())
    if args.with_dates:
        rows = with_dates(rows)
    if not rows:
        raise SystemExit("No Premier Draft draft-data links found on the 17Lands public datasets page.")
    payload = {"count": len(rows), "sets": rows}
    text = json.dumps(payload, indent=2) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
