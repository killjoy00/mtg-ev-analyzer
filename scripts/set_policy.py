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


# Writing shares the reader's pattern deliberately. A bump has to be one act
# with the regeneration that produces rows carrying it - declaring the version
# and then failing to rebuild leaves the app serving a version its own corpus
# does not have, which is what blocked the last two attempts.
_VERSION_FORMAT = re.compile(
    r"(export\s+const\s+DRAFT_RUN_CORPUS_VERSION\s*=\s*)['\"][^'\"]+['\"]")
_VALID_VERSION = re.compile(r'^[a-z0-9][a-z0-9-]{4,62}$')


def set_corpus_version(value: str, root: Path = None) -> str:
    """Declare a new corpus version. Returns the previous one."""
    if not _VALID_VERSION.match(value):
        raise ValueError(f'{value!r} is not a corpus version (lowercase, hyphens)')
    source = (root or Path(__file__).resolve().parents[1]) / 'draft-run.mjs'
    text = source.read_text(encoding='utf-8')
    previous = corpus_version(root)
    if previous == value:
        raise ValueError(f'{source} already declares {value!r}')
    updated, count = _VERSION_FORMAT.subn(rf"\g<1>'{value}'", text, count=1)
    if count != 1:
        raise ValueError(f'{source}: no DRAFT_RUN_CORPUS_VERSION to write')
    source.write_text(updated, encoding='utf-8')
    if corpus_version(root) != value:
        raise ValueError(f'{source}: wrote {value!r} but it does not read back')
    return previous


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set-corpus-version', metavar='VERSION',
                        help='declare a new corpus version in draft-run.mjs and '
                             'print the one it replaced')
    args = parser.parse_args()
    if args.set_corpus_version:
        print(set_corpus_version(args.set_corpus_version))
    else:
        print(corpus_version())
