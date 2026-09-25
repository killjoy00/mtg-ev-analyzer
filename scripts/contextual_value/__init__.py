"""Research-only contextual card value tools.

This package is intentionally isolated from the served Pack One corpus. It
contains deterministic data/protocol primitives for contextual-value-v1 and is
safe to import from offline experiments and tests.
"""

PROTOCOL_VERSION = "contextual-value-v1"
SPLIT_SALT = "contextual-value-v1-outer"
TRAIN_SHARE = 60
VALIDATION_SHARE = 15
ASSESSMENT_SHARE = 25
PRIMARY_PACK = 0
PRIMARY_PICK_START = 0
PRIMARY_PICK_STOP = 8
WEIGHT_CAPS = (10.0, 20.0, 50.0)
MIN_ESS_RATIO = 0.10
HARM_MARGIN = -0.05

__all__ = [
    "PROTOCOL_VERSION",
    "SPLIT_SALT",
    "TRAIN_SHARE",
    "VALIDATION_SHARE",
    "ASSESSMENT_SHARE",
    "PRIMARY_PACK",
    "PRIMARY_PICK_START",
    "PRIMARY_PICK_STOP",
    "WEIGHT_CAPS",
    "MIN_ESS_RATIO",
    "HARM_MARGIN",
]
