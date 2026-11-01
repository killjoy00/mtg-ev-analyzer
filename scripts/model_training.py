"""Versioned training policy; algorithms and qualification remain in v4 code."""
from pathlib import Path
import re
import json

V4_MODEL = 'strong-player-colour-stage-v4'
V5_MODEL = 'strong-player-colour-stage-v5'
V6_MODEL = 'strong-player-colour-stage-v6'
VERSIONS = json.loads((Path(__file__).resolve().parents[1] / 'model-versions.json').read_text())
V5_CORPUS = VERSIONS['v5']['corpus_version']
V6_CORPUS = VERSIONS['v6']['corpus_version']
ALL_QUALIFIED = 'all-qualified'
# Both train on every qualified draft; v6 changes only the colour policy below.
UNCAPPED_MODELS = (V5_MODEL, V6_MODEL)

def current_model_version():
    text = (Path(__file__).resolve().parents[1] / 'draft-run.mjs').read_text()
    match = re.search(r"DRAFT_RUN_CORPUS_VERSION\s*=\s*['\"]([^'\"]+)", text)
    if not match:
        raise ValueError('Missing serving corpus identity')
    return {V6_CORPUS: V6_MODEL, V5_CORPUS: V5_MODEL}.get(match.group(1), V4_MODEL)

def colour_policy(model_version):
    """How a model builds and reads its colour table.

    v6 counts each game's splash colours as deck colours, so a splashed card
    keeps its printed colour, and treats a 0.0 rate cell as data, matching the
    evaluation harness. Earlier models keep their published behaviour.
    """
    v6 = model_version == V6_MODEL
    return {'deck_colours': 'main+splash' if v6 else 'main', 'zero_rates_are_data': v6}

def training_cap(model_version, requested, historical_default=5000):
    if model_version not in (V4_MODEL, *UNCAPPED_MODELS):
        raise ValueError('Unknown consensus model identity')
    if model_version in UNCAPPED_MODELS:
        if requested not in (None, 0):
            raise ValueError(f'{model_version} requires all-qualified uncapped training; a draft cap is forbidden')
        return None
    if requested is None:
        return historical_default
    return requested if requested > 0 else None

def parser_training_arguments(parser, historical_default=5000):
    parser.add_argument('--model-version', choices=(V4_MODEL, *UNCAPPED_MODELS), default=current_model_version())
    parser.add_argument('--max-training-drafts', type=int, default=None)
    return historical_default

def resolve_training_arguments(args, historical_default=5000):
    args.max_training_drafts = training_cap(args.model_version, args.max_training_drafts, historical_default) or 0
    return args

def validate_training_manifest(manifest, expected_model=V5_MODEL):
    model = manifest.get('model', {}).get('model_version', manifest.get('model_version'))
    if model != expected_model:
        raise ValueError(f'Mixed or stale artifact: {model}, expected {expected_model}')
    cohort = manifest.get('cohort', manifest)
    if expected_model in UNCAPPED_MODELS:
        if cohort.get('training_mode') != ALL_QUALIFIED or 'training_cap' not in cohort or cohort['training_cap'] is not None:
            raise ValueError(f'{expected_model} artifact must declare all-qualified uncapped evidence')
        trained = cohort.get('training_drafts')
        qualified = cohort.get('qualified_training_drafts')
        if type(trained) is not int or type(qualified) is not int or trained < 1 or trained != qualified:
            raise ValueError(f'{expected_model} artifact omitted qualified behavior-training drafts')
    return True
