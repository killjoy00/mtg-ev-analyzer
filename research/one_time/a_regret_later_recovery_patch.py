#!/usr/bin/env python3
"""Apply the frozen #756 later-pick execution corrections to the last known-good analyzer.

This is an execution recovery only. It does not change the registered estimand,
features, support thresholds, ridge penalties, folds, gates, or inference.
"""
from __future__ import annotations

import sys
from pathlib import Path


def replace_once(src: str, old: str, new: str, label: str) -> str:
    n = src.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {n}")
    return src.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: patcher INPUT.py OUTPUT.py")
    src = Path(sys.argv[1]).read_text()

    src = replace_once(
        src,
'''EXPECTED_DRAFTS = {
    "FIN": 112237,
    "TDM": 73323,
    "DFT": 115504,
    "MSH": 66003,
    "SOS": 105197,
}''',
'''EXPECTED_UNUSED_DRAFT_IDS = {
    "FIN": 112237,
    "TDM": 73323,
    "DFT": 115504,
    "MSH": 66004,
    "SOS": 105200,
}''',
        "later draft-ID accounting constants",
    )

    src = replace_once(
        src,
'''        # dense Z/E are small enough and simplify exact cross-products
        z = np.zeros(zdim, dtype=np.float64)
        if zi:
            z[np.asarray(zi, dtype=np.int64)] = 1.0
        z[m] = zextra[0]
        z[m + 1] = zextra[1]
        e = np.zeros(edim, dtype=np.float64)
        if cj is not None:
            e[cj] = 1.0
        e[m] = sel_s
        HTZ[hi] += hv[:, None] * z[None, :]
        HTE[hi] += hv[:, None] * e[None, :]
        ZTZ += np.outer(z, z)
        ZTE += np.outer(z, e)''',
'''        zidx = list(zi) + [m, m + 1]
        zval = [1.0] * len(zi) + [float(zextra[0]), float(zextra[1])]
        z_pairs = [(j, v) for j, v in zip(zidx, zval) if v != 0.0]
        e_pairs = []
        if cj is not None:
            e_pairs.append((cj, 1.0))
        if sel_s != 0.0:
            e_pairs.append((m, float(sel_s)))
        if z_pairs:
            zj = np.asarray([x[0] for x in z_pairs], dtype=np.int64)
            zv = np.asarray([x[1] for x in z_pairs], dtype=np.float64)
            HTZ[np.ix_(hi, zj)] += hv[:, None] * zv[None, :]
            ZTZ[np.ix_(zj, zj)] += np.outer(zv, zv)
        if e_pairs:
            ej = np.asarray([x[0] for x in e_pairs], dtype=np.int64)
            ev = np.asarray([x[1] for x in e_pairs], dtype=np.float64)
            HTE[np.ix_(hi, ej)] += hv[:, None] * ev[None, :]
            if z_pairs:
                ZTE[np.ix_(zj, ej)] += zv[:, None] * ev[None, :]''',
        "exact sparse cross-products",
    )

    src = replace_once(
        src,
'''        h = np.zeros(q, dtype=np.float64)
        h[np.asarray(hi, dtype=np.int64)] = np.asarray(hv, dtype=np.float64)
        z = np.zeros(m + 2, dtype=np.float64)
        if zi:
            z[np.asarray(zi, dtype=np.int64)] = 1.0
        z[m] = zextra[0]
        z[m + 1] = zextra[1]
        zr = z - h @ WZ
        zc = zr[:m]
        n += 1
        sum_z += zc
        sum_z2 += zc * zc
        sum_h += h
        sum_h2 += h * h
        cross += h[:, None] * zc[None, :]''',
'''        hi = np.asarray(hi, dtype=np.int64)
        hv = np.asarray(hv, dtype=np.float64)
        pred = (hv[:, None] * WZ[hi]).sum(axis=0)
        zr = -pred
        if zi:
            zr[np.asarray(zi, dtype=np.int64)] += 1.0
        zr[m] += zextra[0]
        zr[m + 1] += zextra[1]
        zc = zr[:m]
        n += 1
        sum_z += zc
        sum_z2 += zc * zc
        sum_h[hi] += hv
        sum_h2[hi] += hv * hv
        cross[hi] += hv[:, None] * zc[None, :]''',
        "sparse held-out recenter diagnostics",
    )

    src = replace_once(
        src,
'''        z = np.zeros(zdim, dtype=np.float64)
        if zi:
            z[np.asarray(zi, dtype=np.int64)] = 1.0
        z[m] = zextra[0]
        z[m + 1] = zextra[1]
        ZTY += z * y''',
'''        if zi:
            ZTY[np.asarray(zi, dtype=np.int64)] += y
        ZTY[m] += zextra[0] * y
        ZTY[m + 1] += zextra[1] * y''',
        "sparse outcome cross-product",
    )

    src = replace_once(
        src,
'''    # Verify unique draft supply is consistent with the already frozen #756 cohort.
    for pick in PICKS:
        if len(by_pick[pick]) > EXPECTED_DRAFTS[exp]:
            raise SystemExit(f"{exp} P1P{pick+1}: more rows than frozen unused drafts")''',
'''    # Later-pick row coverage can exceed P1P1 coverage when the archive is
    # missing an opening-pack row for an otherwise logged draft (MSH: 1,
    # SOS: 3).  Bound by the exact unused *draft ID* supply instead.
    for pick in PICKS:
        if len(by_pick[pick]) > EXPECTED_UNUSED_DRAFT_IDS[exp]:
            raise SystemExit(f"{exp} P1P{pick+1}: more rows than frozen unused draft IDs")''',
        "later-pick row accounting gate",
    )

    src = replace_once(
        src,
'''            "coverage_vs_frozen_unused_drafts": len(rows) / EXPECTED_DRAFTS[exp],''',
'''            "coverage_vs_frozen_unused_draft_ids": len(rows) / EXPECTED_UNUSED_DRAFT_IDS[exp],''',
        "later-pick coverage label",
    )

    src = replace_once(
        src,
'''    preflight = {
        "phase": "a_regret_p1p2_p1p8_recentered_outcome_free_preflight",''',
'''    if len(all_ids) > EXPECTED_UNUSED_DRAFT_IDS[exp]:
        raise SystemExit(
            f"{exp}: {len(all_ids)} later-pick draft IDs exceed frozen unused draft-ID supply "
            f"{EXPECTED_UNUSED_DRAFT_IDS[exp]}"
        )

    preflight = {
        "phase": "a_regret_p1p2_p1p8_recentered_outcome_free_preflight",''',
        "unique later-pick draft accounting gate",
    )

    src = replace_once(
        src,
'''        "draft_sha256": EXPECTED_DRAFT[exp],
        "game_sha256": EXPECTED_GAME[exp],''',
'''        "draft_sha256": EXPECTED_DRAFT[exp],
        "expected_unused_draft_ids": EXPECTED_UNUSED_DRAFT_IDS[exp],
        "later_pick_unique_draft_ids_seen": len(all_ids),
        "game_sha256": EXPECTED_GAME[exp],''',
        "preflight draft accounting metadata",
    )

    if "EXPECTED_DRAFTS" in src:
        raise SystemExit("stale P1P1-specific EXPECTED_DRAFTS reference remains")

    Path(sys.argv[2]).write_text(src)


if __name__ == "__main__":
    main()
