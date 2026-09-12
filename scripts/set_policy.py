"""Permanent source retirement, applied before any source request or reporting."""
import hashlib
import json
from pathlib import Path

POLICY=json.loads((Path(__file__).resolve().parents[1]/'data/selection-policy.json').read_text())

def supported_set(value):
    return hashlib.sha256(str(value).strip().lower().encode()).hexdigest() not in POLICY['retired_set_fingerprints']

def require_supported_set(value):
    if not supported_set(value):
        raise ValueError('This environment is permanently retired.')
    return value
