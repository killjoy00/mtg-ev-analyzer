#!/usr/bin/env python3
"""Backfill legacy 17Lands draft sets whose draft_data lacks win-rate history.

VOW, MID, AFR, and STX predate the draft-data schema that exposes
``user_game_win_rate_bucket``. Their draft rows still carry Arena ``rank`` and
the matching legacy game_data carries ``user_n_games_bucket``. For these frozen
sets we therefore select an experienced, high-ranked Arena cohort instead of
inventing a win rate or selecting on the draft's own results.

Implementation detail: the existing replay/path builders intentionally consume
a numeric ``user_game_win_rate_bucket``. This helper writes a temporary rank
proxy into that column so the mature builders, holdouts, and model code can run
unchanged. Before publication every synthetic win-rate field is removed and the
manifest, path model, and catalog are relabeled with the actual Arena-rank
cohort definition.

No game result, deck content, event record, match win, or match loss is used to
choose the cohort.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import shutil
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional, Sequence

try:
    from .build_replays import stable_score
    from .fetch_card_metadata import aliases, compact_card, draft_candidate_names, fetch_named
    from .import_sets import (
        CATALOG_PATH,
        PATH_MODEL_VERSION,
        RemoteDataset,
        catalog_codes,
        download_dataset,
        load_catalog,
        normalize_code,
        probe_public_dataset,
        publish_staged_set,
        run_command,
        validate_path_model,
    )
except ImportError:  # Script execution from scripts/.
    from build_replays import stable_score
    from fetch_card_metadata import aliases, compact_card, draft_candidate_names, fetch_named
    from import_sets import (
        CATALOG_PATH,
        PATH_MODEL_VERSION,
        RemoteDataset,
        catalog_codes,
        download_dataset,
        load_catalog,
        normalize_code,
        probe_public_dataset,
        publish_staged_set,
        run_command,
        validate_path_model,
    )

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SETS = ("VOW", "MID", "AFR", "STX")
PUBLIC_GAME_URL = (
    "https://17lands-public.s3.amazonaws.com/analysis_data/game_data/"
    "game_data_public.{code}.{format}.csv.gz"
)
EXPERIENCE_COLUMN = "user_n_games_bucket"
TEMP_RATE_COLUMN = "user_game_win_rate_bucket"
RANK_COLUMN = "rank"

# Large spacing between tiers means the tiny deterministic tie-break can never
# move a lower Arena tier above a higher one. The values are selection scores,
# never win-rate estimates, and are removed from published metadata.
RANK_BASE = {
    "mythic": 0.90,
    "diamond": 0.80,
    "platinum": 0.70,
    "gold": 0.60,
    "silver": 0.50,
    "bronze": 0.40,
}
RANK_ORDER = tuple(RANK_BASE)


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", newline="")
    return path.open("r", encoding="utf-8", newline="")


def open_write(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if str(path).endswith(".gz"):
        return gzip.open(path, "wt", encoding="utf-8", newline="")
    return path.open("w", encoding="utf-8", newline="")


def parse_codes(value: str) -> list[str]:
    tokens = [token for token in value.replace(",", " ").split() if token]
    return [normalize_code(token) for token in tokens]


def game_remote(draft_remote: RemoteDataset) -> RemoteDataset:
    return RemoteDataset(
        code=draft_remote.code,
        format=draft_remote.format,
        released_at=draft_remote.released_at,
        source_date=draft_remote.source_date,
        url=PUBLIC_GAME_URL.format(code=draft_remote.code, format=draft_remote.format),
    )


def arena_rank_tier(value: object) -> Optional[str]:
    text = re.sub(r"[^a-z]+", " ", str(value or "").lower()).strip()
    if not text:
        return None
    tokens = set(text.split())
    for tier in RANK_ORDER:
        if tier in tokens:
            return tier
    return None


def arena_rank_proxy(rank: object, draft_id: str) -> Optional[float]:
    """Return a stable 0..1 selection score ordered strictly by Arena tier."""
    tier = arena_rank_tier(rank)
    if not tier or not draft_id:
        return None
    # At most 0.000999999, far smaller than the 0.10 gap between tiers.
    tie_break = (stable_score(f"legacy-rank:{draft_id}") % 1_000_000) / 1_000_000_000
    return RANK_BASE[tier] + tie_break


def proxy_cutoff_tier(value: object) -> Optional[str]:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    for tier in RANK_ORDER:
        if score >= RANK_BASE[tier]:
            return tier
    return None


def read_experience_buckets(game_path: Path) -> dict[str, str]:
    """Return the modal prior-games bucket for each draft_id.

    Legacy game_data may contain outcome columns, but this routine only reads
    draft_id and user_n_games_bucket.
    """
    observations: dict[str, Counter] = defaultdict(Counter)
    with open_text(game_path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = set(reader.fieldnames or [])
        required = {"draft_id", EXPERIENCE_COLUMN}
        missing = required - fieldnames
        if missing:
            raise ValueError(
                "Legacy game_data cannot supply Pack One's experience filter; "
                f"missing columns: {', '.join(sorted(missing))}"
            )
        for row in reader:
            draft_id = str(row.get("draft_id") or "").strip()
            games = str(row.get(EXPERIENCE_COLUMN) or "").strip()
            if draft_id and games:
                observations[draft_id][games] += 1

    buckets: dict[str, str] = {}
    for draft_id, counts in observations.items():
        if counts:
            buckets[draft_id] = counts.most_common(1)[0][0]
    if not buckets:
        raise ValueError("Legacy game_data contained no usable prior-games buckets.")
    return buckets


def augment_draft_with_rank_proxy(
    draft_path: Path,
    game_path: Path,
    destination: Path,
) -> dict:
    """Add prior-games history and a temporary Arena-rank selection score."""
    experience = read_experience_buckets(game_path)
    seen_drafts: set[str] = set()
    covered_drafts: set[str] = set()
    tier_by_draft: dict[str, str] = {}
    row_count = 0

    with open_text(draft_path) as source:
        reader = csv.DictReader(source)
        fieldnames = list(reader.fieldnames or [])
        structural = {"draft_id", "pick", "pack_number", "pick_number", RANK_COLUMN}
        missing_structural = structural - set(fieldnames)
        if missing_structural:
            raise ValueError(
                "Legacy draft_data cannot supply the Arena-rank cohort; "
                f"missing columns: {', '.join(sorted(missing_structural))}"
            )
        for column in (TEMP_RATE_COLUMN, EXPERIENCE_COLUMN):
            if column not in fieldnames:
                fieldnames.append(column)

        with open_write(destination) as target:
            writer = csv.DictWriter(target, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in reader:
                row_count += 1
                draft_id = str(row.get("draft_id") or "").strip()
                if draft_id:
                    seen_drafts.add(draft_id)
                    games = experience.get(draft_id)
                    rank = row.get(RANK_COLUMN)
                    tier = arena_rank_tier(rank)
                    proxy = arena_rank_proxy(rank, draft_id)
                    if games and proxy is not None and tier:
                        row[EXPERIENCE_COLUMN] = games
                        row[TEMP_RATE_COLUMN] = f"{proxy:.9f}"
                        covered_drafts.add(draft_id)
                        tier_by_draft.setdefault(draft_id, tier)
                writer.writerow(row)

    if not seen_drafts:
        raise ValueError("Legacy draft_data contained no draft ids.")
    coverage = len(covered_drafts) / len(seen_drafts)
    if len(covered_drafts) < 100:
        raise ValueError(
            f"Only {len(covered_drafts)} drafts had both Arena rank and prior-games history; "
            "refusing to train a degraded cohort."
        )
    rank_tiers = Counter(tier_by_draft.values())
    return {
        "draft_rows": row_count,
        "drafts": len(seen_drafts),
        "experience_drafts": len(experience),
        "covered_drafts": len(covered_drafts),
        "coverage": coverage,
        "rank_tiers": {tier: int(rank_tiers.get(tier, 0)) for tier in RANK_ORDER},
    }


def repair_metadata_coverage(raw_draft: Path, metadata_path: Path) -> dict:
    """Retry unresolved cross-set cards slowly after the normal Scryfall pass."""
    records = json.loads(metadata_path.read_text(encoding="utf-8"))
    wanted = draft_candidate_names(raw_draft)
    missing = sorted(wanted - set(records))
    if missing:
        print(f"Retrying {len(missing)} unresolved card names with a conservative Scryfall cadence.", flush=True)
        time.sleep(4)
    for name in missing:
        card = fetch_named(name)
        if card:
            metadata = compact_card(card)
            records.setdefault(name, metadata)
            for alias in aliases(card):
                records.setdefault(alias, metadata)
        time.sleep(0.75)

    metadata_path.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    unresolved = sorted(wanted - set(records))
    if unresolved:
        raise ValueError(
            f"Card metadata remains incomplete after retry ({len(unresolved)} names): {unresolved[:12]}"
        )
    return {"wanted": len(wanted), "covered": len(wanted), "coverage": 1.0}


def annotate_legacy_provenance(
    output_dir: Path,
    catalog_path: Path,
    *,
    code: str,
    game_source_date: str,
    join_stats: dict,
    minimum_games: int,
    top_fraction: float,
) -> dict:
    """Remove the temporary rank proxy semantics and label publication honestly."""
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cohort = manifest.setdefault("cohort", {})
    synthetic_cutoff = cohort.pop("win_rate_cutoff", None)
    cutoff_tier = proxy_cutoff_tier(synthetic_cutoff)
    cohort.update({
        "definition": (
            f"drafts with a {minimum_games}+ prior-games bucket in the top {top_fraction:.0%} "
            "of available Arena rank tiers; stable draft-id tie-break within a tier"
        ),
        "selection_metric": "arena_rank",
        "top_fraction": top_fraction,
        "arena_rank_cutoff_tier": cutoff_tier,
        "skill_join_coverage": round(float(join_stats["coverage"]), 6),
        "rank_tiers": join_stats["rank_tiers"],
        "selection_note": (
            "Legacy cohort uses pre-draft Arena rank plus anonymized prior-games history. "
            "Game outcomes and event records are not used for cohort selection."
        ),
        "skill_sources": [
            {
                "provider": "17Lands",
                "dataset_kind": "draft_data",
                "field": RANK_COLUMN,
                "purpose": "Arena rank tier",
            },
            {
                "provider": "17Lands",
                "dataset_kind": "game_data",
                "data_date": game_source_date,
                "join_key": "draft_id",
                "field": EXPERIENCE_COLUMN,
                "purpose": "anonymized prior-games experience bucket",
            },
        ],
    })
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    path_model_path = output_dir / "path-model.json"
    model = json.loads(path_model_path.read_text(encoding="utf-8"))
    training = model.setdefault("training", {})
    training.pop("win_rate_cutoff", None)
    training.update({
        "selection_metric": "arena_rank",
        "top_fraction": top_fraction,
        "arena_rank_cutoff_tier": cutoff_tier,
        "skill_join_coverage": round(float(join_stats["coverage"]), 6),
        "selection_note": "Legacy Arena-rank cohort; game outcomes are excluded from cohort selection.",
    })
    path_model_path.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    target_id = code.lower()
    found = False
    for entry in catalog.get("sets", []):
        if str(entry.get("id") or "").lower() != target_id:
            continue
        found = True
        entry.pop("win_rate_cutoff", None)
        entry["cohort_selection"] = "arena_rank"
        entry["cohort_label"] = "Experienced Arena-rank cohort"
        entry["arena_rank_cutoff_tier"] = cutoff_tier
        break
    if not found:
        raise ValueError(f"Legacy catalog entry for {code} disappeared before publication.")
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    return {"arena_rank_cutoff_tier": cutoff_tier}


def build_legacy_one(remote: RemoteDataset, args: argparse.Namespace) -> dict:
    code = remote.code
    lower = code.lower()
    print(f"\n=== Legacy Arena-rank backfill {code} {remote.format} ===", flush=True)

    with tempfile.TemporaryDirectory(prefix=f"pack1-legacy-{lower}-") as tmp:
        stage_root = Path(tmp)
        stage_data = stage_root / "data"
        stage_data.mkdir(parents=True, exist_ok=True)
        stage_catalog = stage_data / "catalog.json"
        if CATALOG_PATH.exists():
            shutil.copy2(CATALOG_PATH, stage_catalog)
        else:
            stage_catalog.write_text('{"schema_version":2,"sets":[]}\n', encoding="utf-8")

        draft_path = stage_root / f"draft_data_public.{code}.{remote.format}.csv.gz"
        game_path = stage_root / f"game_data_public.{code}.{remote.format}.csv.gz"
        augmented_path = stage_root / f"draft_data_legacy_rank_join.{code}.{remote.format}.csv.gz"
        card_metadata = stage_root / f"{lower}-cards.json"
        output_dir = stage_data / lower

        source_date = download_dataset(remote, draft_path)
        game_source_date = download_dataset(game_remote(remote), game_path)
        join_stats = augment_draft_with_rank_proxy(draft_path, game_path, augmented_path)
        print(
            f"Legacy rank/experience join: {join_stats['covered_drafts']}/{join_stats['drafts']} drafts "
            f"({join_stats['coverage']:.1%}) covered; tiers={join_stats['rank_tiers']}",
            flush=True,
        )

        run_command([
            sys.executable,
            "scripts/fetch_card_metadata.py",
            "--set", code,
            "--output", str(card_metadata),
            "--draft-data", str(draft_path),
        ])
        metadata_stats = repair_metadata_coverage(draft_path, card_metadata)

        run_command([
            sys.executable,
            "scripts/build_replays.py",
            "--input", str(augmented_path),
            "--output-dir", str(output_dir),
            "--catalog", str(stage_catalog),
            "--expansion", code,
            "--format", remote.format,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-output-drafts", str(args.max_output_drafts),
            "--minimum-picks", str(args.minimum_picks),
            "--folds", str(args.folds),
            "--shard-size", str(args.shard_size),
            "--card-metadata", str(card_metadata),
        ])

        run_command([
            sys.executable,
            "scripts/build_path_model.py",
            "--input", str(augmented_path),
            "--output-dir", str(output_dir),
            "--expansion", code,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-bytes", str(args.max_path_bytes),
        ])

        selection = annotate_legacy_provenance(
            output_dir,
            stage_catalog,
            code=code,
            game_source_date=game_source_date,
            join_stats=join_stats,
            minimum_games=args.minimum_games,
            top_fraction=args.top_fraction,
        )
        run_command([
            sys.executable,
            "scripts/validate_dataset.py",
            str(output_dir / "manifest.json"),
            "--minimum-replays", str(args.minimum_replays),
        ])
        path_cards, path_pairs = validate_path_model(output_dir / "path-model.json", args.max_path_bytes)

        manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("model", {}).get("model_version") != "strong-player-pool-context-v2":
            raise ValueError("Legacy backfill changed the replay model version unexpectedly.")
        if manifest.get("cohort", {}).get("selection_metric") != "arena_rank":
            raise ValueError("Legacy backfill did not replace the temporary selection metadata.")
        if "win_rate_cutoff" in manifest.get("cohort", {}):
            raise ValueError("Synthetic win-rate metadata survived legacy publication.")
        path_model = json.loads((output_dir / "path-model.json").read_text(encoding="utf-8"))
        if path_model.get("model_version") != PATH_MODEL_VERSION:
            raise ValueError("Legacy backfill changed the path model version unexpectedly.")
        if "win_rate_cutoff" in path_model.get("training", {}):
            raise ValueError("Synthetic path-model win-rate metadata survived legacy publication.")

        result = {
            "code": code,
            "source_date": source_date,
            "game_experience_source_date": game_source_date,
            "replay_count": int(manifest["replay_count"]),
            "training_drafts": int(manifest["cohort"]["training_drafts"]),
            "arena_rank_cutoff_tier": selection["arena_rank_cutoff_tier"],
            "path_cards": path_cards,
            "path_pairs": path_pairs,
            "rank_experience_join": join_stats,
            "metadata": metadata_stats,
        }
        publish_staged_set(stage_root, code)
        print(f"Published legacy {code}: {result['replay_count']} replays", flush=True)
        return result


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=",".join(DEFAULT_SETS))
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=5000)
    parser.add_argument("--max-output-drafts", type=int, default=300)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-picks", type=int, default=30)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--max-path-bytes", type=int, default=4_000_000)
    parser.add_argument("--report", default="generated/legacy-backfill-report.json")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    codes = parse_codes(args.sets)
    existing = catalog_codes(load_catalog())
    successes: list[dict] = []
    failures: list[dict] = []
    skipped: list[str] = []

    for code in codes:
        if code in existing:
            skipped.append(code)
            continue
        remote = probe_public_dataset(code, args.format, "")
        if remote is None:
            failures.append({"code": code, "error": "17Lands draft_data archive is unavailable."})
            continue
        try:
            result = build_legacy_one(remote, args)
            successes.append(result)
            existing.add(code)
        except Exception as exc:  # Preserve successful sets and report the exact blocker.
            print(f"ERROR legacy backfill {code}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            failures.append({"code": code, "error": f"{type(exc).__name__}: {exc}"})

    report = {
        "mode": "legacy-arena-rank-cohort",
        "sets": codes,
        "successes": successes,
        "failures": failures,
        "skipped_already_live": skipped,
    }
    report_path = REPO_ROOT / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
