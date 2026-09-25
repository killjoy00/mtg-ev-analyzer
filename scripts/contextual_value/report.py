"""Immutable JSON report helpers for contextual-value-v1."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping


def write_json(payload: Mapping[str, object], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
