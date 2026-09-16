"""Permanent source retirement, applied before any source request or reporting."""
import hashlib
import json
import re
from pathlib import Path

POLICY=json.loads((Path(__file__).resolve().parents[1]/'data/selection-policy.json').read_text())

def supported_set(value):
    return hashlib.sha256(str(value).strip().lower().encode()).hexdigest() not in POLICY['retired_set_fingerprints']

def require_supported_set(value):
    if not supported_set(value):
        raise ValueError('This environment is permanently retired.')
    return value


# The corpus version lives in draft-run.mjs and is READ from there, not copied.
# It is hashed into every puzzle id, so a bump that lands in one language and
# not the other produces puzzles the server cannot resolve - and, worse, lets
# import_all_trophies reuse old payloads under a new label, silently mixing two
# models in one corpus. Deriving it removes that failure mode by construction.
_VERSION_PATTERN = re.compile(
    r"export\s+const\s+DRAFT_RUN_CORPUS_VERSION\s*=\s*['\"]([^'\"]+)['\"]")


def corpus_version(root: Path = None) -> str:
    source = (root or Path(__file__).resolve().parents[1]) / 'draft-run.mjs'
    match = _VERSION_PATTERN.search(source.read_text(encoding='utf-8'))
    if not match:
        raise ValueError(f'{source}: no DRAFT_RUN_CORPUS_VERSION to read')
    return match.group(1)
