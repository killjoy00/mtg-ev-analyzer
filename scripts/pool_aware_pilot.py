"""Freeze deterministic development windows from aggregate archive extents.

The prior v6 archive is spent development evidence. No final-test labels are
opened; the assessment placeholder lies outside the retained draft time range.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import argparse
import json
from pathlib import Path


PURGE = timedelta(days=7)
MIN_WINDOW = timedelta(days=3)


def windows_from_extent(first, last, purge_days=7):
    if type(purge_days) is not int or purge_days not in (0, 7):
        raise ValueError('purge_days must be explicitly 0 or 7')
    purge = timedelta(days=purge_days)
    lo, hi = (datetime.fromisoformat(x.replace('Z','+00:00')) for x in (first,last))
    if lo.tzinfo is None or hi.tzinfo is None or hi < lo:
        raise ValueError('require ordered timezone-aware archive extent')
    lo, hi = lo.astimezone(timezone.utc), hi.astimezone(timezone.utc)
    end = hi + timedelta(seconds=1)
    usable = end-lo-2*purge
    if usable/4 < MIN_WINDOW:
        raise ValueError('archive extent too short for requested purge and minimum 3-day windows')
    base_end = lo + usable/2
    res_start = base_end + purge
    res_end = res_start + usable/4
    val_start = res_end + purge
    assessment_start = end + purge
    phases = {'baseline':(lo,base_end),'residual':(res_start,res_end),
              'validation':(val_start,end),'assessment':(assessment_start,assessment_start+timedelta(days=7))}
    return {k:[a.isoformat(),b.isoformat()] for k,(a,b) in phases.items()}


def self_test():
    w=windows_from_extent('2026-01-01T00:00:00Z','2026-02-12T00:00:00Z')
    for a,b in zip(('baseline','residual','validation'),('residual','validation','assessment')):
        assert datetime.fromisoformat(w[b][0])-datetime.fromisoformat(w[a][1]) == PURGE
    assert datetime.fromisoformat(w['assessment'][0]) > datetime.fromisoformat('2026-02-12T00:00:00+00:00')
    try:
        windows_from_extent('2026-01-01T00:00:00Z','2026-01-15T00:00:00Z')
    except ValueError:
        pass
    else:
        raise AssertionError('accepted inadequate archive extent')
    short = windows_from_extent('2025-10-30T00:41:02+00:00','2025-11-19T22:08:33+00:00',purge_days=0)
    for first,second in zip(('baseline','residual','validation'),('residual','validation','assessment')):
        assert short[first][1] == short[second][0]
    assert datetime.fromisoformat(short['assessment'][0]) > datetime.fromisoformat('2025-11-19T22:08:33+00:00')
    print('Development window contracts passed.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--extent',type=Path)
    p.add_argument('--output',type=Path)
    p.add_argument('--purge-days',type=int,choices=(0,7),default=7)
    p.add_argument('--self-test',action='store_true')
    a=p.parse_args()
    if a.self_test:
        self_test()
        return
    if not a.extent or not a.output:
        p.error('--extent and --output required')
    info=json.loads(a.extent.read_text())['time_ranges']['draft']
    w=windows_from_extent(info['first_utc'],info['last_utc'],a.purge_days)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(w,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':
    main()
