#!/usr/bin/env python3
"""Stable provenance for reviewed corpus build artifacts.

The revision deliberately hashes only the code/configuration that can change
corpus discovery, building, validation, or loading. Unrelated repository commits
therefore do not invalidate a reviewed artifact.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INGESTION_RELEVANT_PATHS = (
    '.github/workflows/corpus-operations.yml',
    'corpus-quality.mjs',
    'draft-run.mjs',
    'serving-quality.mjs',
    'corpus/draft-run/card-images.json',
    'corpus/draft-run/catalog.json',
    'data/selection-policy.json',
    'scripts/actions-import-auth.mjs',
    'scripts/backfill_legacy_sets.py',
    'scripts/build_replays.py',
    'scripts/candidate-gameplay-canary.mjs',
    'scripts/card_outcomes.py',
    'scripts/check-corpus-health.mjs',
    'scripts/corpus-candidate.mjs',
    'scripts/corpus_promotion_provenance.py',
    'scripts/deck_fit.py',
    'scripts/discover-corpus.py',
    'scripts/eval_model.py',
    'scripts/fetch_card_metadata.py',
    'scripts/import_all_trophies.py',
    'scripts/load_all_trophies.mjs',
    'scripts/neon-corpus-db.mjs',
    'scripts/register-corpus-sources.mjs',
    'scripts/run_import_all_trophies.py',
    'scripts/set_policy.py',
    'scripts/verify-neon-schema.mjs',
    'worker/serving-statistics.mjs',
    'worker/trophy-import.mjs',
)


def ingestion_revision(root=ROOT, paths=INGESTION_RELEVANT_PATHS):
    root = Path(root)
    digest = hashlib.sha256()
    for relative in sorted(paths):
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(f'Ingestion-relevant input is missing: {relative}')
        payload = path.read_bytes()
        digest.update(relative.encode('utf-8'))
        digest.update(b'\0')
        digest.update(len(payload).to_bytes(8, 'big'))
        digest.update(payload)
        digest.update(b'\0')
    return digest.hexdigest()


def builder_metadata(environ=None, root=ROOT):
    environ = os.environ if environ is None else environ
    return {
        'run_id': str(environ.get('GITHUB_RUN_ID') or ''),
        'sha': str(environ.get('GITHUB_SHA') or ''),
        'ingestion_revision': ingestion_revision(root),
    }


def verify_catalog_builder(catalog, run_id, run_sha, revision):
    if catalog.get('complete') is not True or catalog.get('errors'):
        raise ValueError('Reviewed corpus artifact is incomplete')
    builder = catalog.get('builder')
    if not isinstance(builder, dict):
        raise ValueError('Reviewed corpus artifact has no builder provenance')
    if str(builder.get('run_id') or '') != str(run_id):
        raise ValueError('Reviewed corpus artifact was not built by the referenced run')
    if str(builder.get('sha') or '') != str(run_sha):
        raise ValueError('Reviewed corpus artifact builder SHA does not match the referenced run')
    if str(builder.get('ingestion_revision') or '') != str(revision):
        raise ValueError('Reviewed corpus artifact ingestion revision does not match current ingestion code')
    return builder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('revision')
    verify = sub.add_parser('verify')
    verify.add_argument('catalog')
    verify.add_argument('--run-id', required=True)
    verify.add_argument('--run-sha', required=True)
    verify.add_argument('--revision')
    args = parser.parse_args()

    if args.command == 'revision':
        print(ingestion_revision())
        return

    catalog = json.loads(Path(args.catalog).read_text())
    revision = args.revision or ingestion_revision()
    builder = verify_catalog_builder(catalog, args.run_id, args.run_sha, revision)
    print(json.dumps({'verified_builder': builder}, sort_keys=True))


if __name__ == '__main__':
    main()
