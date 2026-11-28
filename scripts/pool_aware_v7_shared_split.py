"""Canonical shared residual split for #1863 final-cycle design decisions.

The split function below is copied verbatim from the preregistered stage
experiment at a3500d89398b44a44bcc4a6628421dfaf71eb811.
Use the same function and source windows for every design comparison.
"""
from collections import Counter

COHORTS = ('elite', 'control')
SPLIT_PROTOCOL = 'v7-shared-chronological-source-draft-70-30-v1'
STAGE_SOURCE_BLOB = '2b1867be3e3ed21ce7516611164f45c87f0de3af'

def split(elite, ordinary):
    # One chronological cutoff across both cohorts. Keep all tied source
    # timestamps together, choosing the closest boundary to 70% of drafts.
    time = {}
    for r, _, _ in elite + ordinary:
        if r.source in time and time[r.source] != r.event_time:
            raise ValueError('inconsistent source time')
        time[r.source] = r.event_time
    if {r.source for r,_,_ in elite} & {r.source for r,_,_ in ordinary}:
        raise ValueError('cohort overlap')
    counts = Counter(time.values())
    times = sorted(counts)
    if len(times) < 2:
        raise ValueError('insufficient time groups')
    n = len(time)
    k = 0
    choices = []
    for t in times[:-1]:
        k += counts[t]
        choices.append((abs(10*k-7*n), t, k))
    _, cutoff, ntrain = min(choices)
    fit, test = {}, {}
    for c, records in zip(COHORTS, (elite,ordinary)):
        fit[c] = [x for x in records if x[0].event_time <= cutoff]
        test[c] = [x for x in records if x[0].event_time > cutoff]
        if not fit[c] or not test[c] or len({r.source for r,_,_ in test[c]}) < 2:
            raise ValueError('empty/insufficient chronological cohort '+c)
    assert not ({r.source for rows in fit.values() for r,_,_ in rows} &
                {r.source for rows in test.values() for r,_,_ in rows})
    return fit,test,{'cutoff_inclusive':cutoff,'training_drafts':ntrain,'holdout_drafts':n-ntrain,
                     'training_fraction':ntrain/n}

