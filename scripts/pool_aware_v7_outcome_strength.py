"""Frozen Model C strength fit for the single v7 outcome-card-term arm.

Only baseline/residual source drafts enter the strength regression; strict
archives additionally require game_time before the validation boundary.
Legacy archives use the existing source-draft-disjoint exception. No raw
rows, source IDs or game keys are returned or exported.
"""
from collections import Counter, defaultdict
import csv
import gzip
import math
from pathlib import Path
import tempfile

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.optimize import minimize
from scipy.special import logsumexp
from sklearn.preprocessing import StandardScaler

import card_strength_benchmark as model_c
import pool_aware_skill_contrast as skill
import pool_aware_skill_final_correction as final
import pool_aware_mana_final as parser
import pool_aware_skill_recovery as recovery
from pool_aware_archive import load_manifest, scan_drafts, time_utc, rows
from build_replays import parse_rate_bucket, parse_games_lower_bound
from pool_aware_review_reference import fetch_collection

BASICS = model_c.BASICS
C = .1
LEGACY = frozenset(('bro','dmu','hbg','mom','neo','one','sir','snc'))

class Unavailable(ValueError):
    """A missing usable archive is evidence absence, not a zero-strength fit."""


def fit_model_c(deck, controls, y):
    """Exactly the Model C block of estimate_strengths, including scaling."""
    if len(y) == 0 or len(np.unique(y)) != 2:
        raise Unavailable('no usable two-outcome training games')
    present = deck.copy()
    present.data[:] = 1
    counts = np.asarray(present.sum(axis=0)).ravel()
    seen = counts > 0
    if not seen.any():
        raise Unavailable('no nonbasic cards in usable training games')
    scaler = StandardScaler().fit(controls)
    design = sparse.hstack([sparse.csr_matrix(scaler.transform(controls)), deck], format='csr')
    raw = model_c.logistic_fit(design, y, C).coef_[0, controls.shape[1]:]
    strength = np.where(seen, (raw - raw[seen].mean()) / max(float(raw[seen].std()), 1e-8), 0.)
    return strength, raw, counts


def filter_training(sid, manifest, temp):
    m, windows, files = load_manifest(manifest)
    sources, inconsistent = scan_drafts(files['draft'], windows, parse_rate_bucket, parse_games_lower_bound)
    training = {d:v for d,v in sources.items() if v[0] in ('baseline','residual')}
    validation = {d for d,v in sources.items() if v[0] == 'validation'}
    if set(training) & validation:
        raise ValueError('source partition leakage')
    dup, invalid = recovery.invalid_pick_sources(files['draft'], training)
    for d in dup | invalid:
        training.pop(d, None)
    audit = Counter()
    with gzip.open(temp, 'wt', encoding='utf8', newline='') as out:
        for names, idx, reader in rows(files['games']):
            strict = 'game_time' in idx
            if strict == (sid in LEGACY):
                raise ValueError('frozen evidence classification differs from archive header')
            required = {'draft_id','won','on_play','num_mulligans'}
            if not required <= set(names):
                raise Unavailable('missing Model C game columns: ' + ','.join(sorted(required-set(names))))
            if not strict and not {'match_number','game_number'} <= set(names):
                raise Unavailable('legacy game identity columns unavailable')
            writer = csv.writer(out)
            writer.writerow(names)
            for row in reader:
                if len(row) != len(names):
                    raise ValueError('malformed game archive row')
                d = row[idx['draft_id']].strip()
                if d not in training:
                    audit['excluded_nontraining_games'] += 1
                    continue
                phase, draft_time, _, _ = training[d]
                if d in validation:
                    raise ValueError('validation draft entered strength fit')
                if strict:
                    try:
                        t = time_utc(row[idx['game_time']])
                    except (ValueError, TypeError):
                        audit['excluded_invalid_game_time'] += 1
                        continue
                    if not draft_time <= t < windows['validation'][0]:
                        audit['excluded_outside_game_time'] += 1
                        continue
                elif 'draft_time' in idx:
                    try:
                        valid = time_utc(row[idx['draft_time']]) == draft_time
                    except (ValueError, TypeError):
                        valid = False
                    if not valid:
                        audit['excluded_legacy_draft_time_mismatch'] += 1
                        continue
                writer.writerow(row)
                audit[phase+'_candidate_games'] += 1
    return {'source_sha256':m['sources']['games']['sha256'],
            'draft_sha256':m['sources']['draft']['sha256'],
            'windows':m['windows'],
            'evidence_class':'strict_game_time' if strict else 'source_draft_disjoint_only',
            'game_time_present':strict,
            'training_sources':len(training),
            'inconsistent_draft_sources':inconsistent,
            'duplicate_draft_sources_excluded':len(dup),
            'invalid_numbering_sources_excluded':len(invalid),
            'counts':dict(audit)}


def read_filtered(path, strict):
    """The original benchmark's row checks, without requiring a nonexistent
    legacy timestamp. Duplicate game keys exclude all copies."""
    header = pd.read_csv(path, nrows=0).columns.tolist()
    all_names = [c[5:] for c in header if c.startswith('deck_')]
    names = [n for n in all_names if n not in BASICS]
    if not names:
        raise Unavailable('no nonbasic deck columns')
    groups = ('deck_', 'opening_hand_', 'drawn_', 'tutored_')
    for group in groups[:3]:
        if any(group+n not in header for n in all_names):
            raise Unavailable('incomplete frozen Model C row-validation schema: '+group)
    columns = [m for m in model_c.META if m in header]
    card_cols = [g+n for g in groups for n in all_names if g+n in header]
    columns += card_cols
    dtype = {c:('float32' if c in card_cols else str) for c in columns}
    keep = [all_names.index(n) for n in names]
    decks, xs, ys, ids, keys = [], [], [], [], []
    counts = Counter()
    for frame in pd.read_csv(path, usecols=columns, dtype=dtype, chunksize=12000):
        counts['candidate_games'] += len(frame)
        for m in model_c.META:
            if m not in frame:
                frame[m] = ''
        invalid = np.zeros(len(frame), dtype=bool)
        matrices = []
        for group in groups:
            matrix = frame.reindex(columns=[group+n for n in all_names], fill_value=0).fillna(0).to_numpy(float)
            invalid |= (~np.isfinite(matrix) | (matrix<0) | (matrix!=np.floor(matrix)) | (matrix>255)).any(axis=1)
            matrices.append(np.nan_to_num(matrix).clip(0,255).astype(np.uint8))
        deck, oh, drawn, tutored = matrices
        seen = (oh.astype(int)+drawn.astype(int)+tutored.astype(int))>0
        invalid |= ((seen & (deck==0)).any(axis=1) | (oh>deck).any(axis=1))
        size = deck.sum(axis=1)
        invalid |= (size<40) | (size>100) | (oh.sum(axis=1)>7)
        y, valid_y = model_c.parse_bool(frame['won'])
        valid = ~invalid & valid_y & frame['draft_id'].notna().to_numpy()
        valid &= frame['draft_id'].fillna('').str.len().to_numpy()>0
        if strict:
            valid &= pd.to_datetime(frame['game_time'], errors='coerce', utc=True).notna().to_numpy()
        else:
            for field in ('match_number','game_number'):
                valid &= frame[field].notna().to_numpy() & (frame[field].fillna('').str.len().to_numpy()>0)
        counts['invalid_games'] += int((~valid).sum())
        if not valid.any():
            continue
        decks.append(sparse.csr_matrix(deck[valid][:,keep],dtype=np.float64))
        xs.append(model_c.controls(frame,size)[valid])
        ys.append(y[valid].astype(float))
        ids.extend(frame.loc[valid,'draft_id'].astype(str))
        fields = ['draft_id','build_index','match_number','game_number']
        if strict:
            fields.insert(1,'game_time')
        key = frame[fields].fillna('').astype(str).agg('|'.join,axis=1)
        keys.extend(key[valid])
    if not decks:
        raise Unavailable('no valid training games')
    unique = ~pd.Series(keys).duplicated(keep=False).to_numpy()
    counts['duplicate_games_excluded'] = int((~unique).sum())
    counts['games'] = int(unique.sum())
    counts['drafts'] = len(set(np.asarray(ids)[unique]))
    return names, sparse.vstack(decks,format='csr')[unique], np.concatenate(xs)[unique], np.concatenate(ys)[unique], dict(counts)


def strength_table(sid, manifest):
    with tempfile.TemporaryDirectory(prefix='v7-model-c-') as work:
        filtered = Path(work)/'training.csv.gz'
        evidence = filter_training(sid,manifest,filtered)
        names, deck, controls, y, counts = read_filtered(filtered,evidence['game_time_present'])
    strengths, raw, support = fit_model_c(deck,controls,y)
    evidence.update({'row_audit':counts,'C':C,'frozen_recipe':'CARD-STRENGTH-V1 Model C',
                     'benchmark_code_sha256':model_c.sha256(model_c.__file__),
                     'mean_game_win_rate':float(y.mean()),
                     'standardization':'unweighted mean/std across cards with positive fitting-deck presence',
                     'observed_cards':int((support>0).sum()),
                     'deck_columns':len(names)})
    return {n:float(s) for n,s,k in zip(names,strengths,support) if k>0}, {
        n:{'strength':float(s),'raw_coefficient':float(r),'deck_games':int(k),'covered':bool(k>0)}
        for n,s,r,k in zip(names,strengths,raw,support)}, evidence


def fit_choice(records, metadata, strengths):
    """Frozen strong residual likelihood; seven jointly fitted features,
    all with the identical .02 context penalty, original v6 log offset."""
    rules=parser.index(metadata)
    prepared=[final.fit_features(r,p,rules) for r,p,_ in records]
    n=len(prepared)
    if not n:
        raise ValueError('empty residual strong cohort')
    width=max(len(r.candidates) for r in prepared)
    f=np.zeros((n,width,7))
    offset=np.full((n,width),-np.inf)
    chosen=np.empty(n,dtype=np.intp)
    ix=np.arange(n)
    for i,r in enumerate(prepared):
        k=len(r.candidates)
        offset[i,:k]=np.log(r.support)
        f[i,:k,:6]=np.asarray(r.features)[:,:6]
        f[i,:k,6]=[strengths.get(c,0.) for c in r.candidates]
        chosen[i]=r.chosen
    del prepared
    chosen_features=f[ix,chosen].mean(axis=0)
    penalty=skill.CONTEXT_PENALTY
    if penalty!=.02:
        raise ValueError('frozen penalty drift')
    def objective(b):
        logits=offset+np.einsum('nkd,d->nk',f,b)
        norm=logsumexp(logits,axis=1)
        p=np.exp(logits-norm[:,None])
        loss=(norm-logits[ix,chosen]).mean()+.5*penalty*np.dot(b,b)
        grad=np.einsum('nk,nkd->d',p,f)/n-chosen_features+penalty*b
        return float(loss),grad
    result=minimize(objective,np.zeros(7),jac=True,method='L-BFGS-B',
                    options={'maxiter':1000,'gtol':1e-6/math.sqrt(7),'ftol':1e-15})
    loss, grad=objective(result.x)
    if not math.isfinite(loss) or np.linalg.norm(grad)>1e-6:
        raise RuntimeError('outcome conditional choice fit did not converge')
    return tuple(map(float,result.x[:6])),float(result.x[6]),{
        'decisions':n,'iterations':int(result.nit),'objective':loss,
        'gradient_norm':float(np.linalg.norm(grad)),'penalty':penalty,'converged':True}


def coverage(records, metadata, strengths, table):
    offers=Counter(c for r,_,_ in records for c in r.candidates)
    names=set(offers)|set(table)
    ids={n:m.get('id') for n,m in metadata.items() if isinstance(m,dict) and m.get('id')}
    wanted=sorted({ids[n] for n in names if n in ids and n not in BASICS})
    try:
        rarity={c['id']:c['rarity'] for c in fetch_collection([{'id':i} for i in wanted]) if c.get('rarity')}
        status='exact frozen metadata printing IDs; unresolved reported unknown'
    except Exception as exc:
        rarity={}
        status='rarity lookup unavailable: '+type(exc).__name__
    by=defaultdict(Counter)
    for n in names:
        label='excluded_basic' if n in BASICS else rarity.get(ids.get(n),'unknown')
        v=by[label]
        covered=n in strengths
        v['cards']+=1
        v['covered_cards']+=int(covered)
        v['offers']+=offers[n]
        v['covered_offers']+=offers[n]*int(covered)
    total=sum(offers.values())
    missing=sum(v for n,v in offers.items() if n not in strengths)
    return {'by_rarity':{k:dict(v) for k,v in sorted(by.items())},'rarity_provenance':status,
            'offers':total,'offers_without_strength':missing,'share_without_strength':missing/total if total else None,
            'offers_excluded_basics':sum(v for n,v in offers.items() if n in BASICS)}


def self_test():
    deck=sparse.csr_matrix([[1,0,0],[1,0,0],[0,1,0],[0,1,0]],dtype=float)
    x=np.zeros((4,2)); y=np.array([1.,1.,0.,0.])
    z,raw,n=fit_model_c(deck,x,y)
    normalized, original, counts, _, _=model_c.estimate_strengths(deck,deck,x,y,400,C)
    assert np.allclose(z,normalized['C_adjusted'])
    assert np.allclose(raw,original['C_adjusted'])
    assert np.array_equal(n,counts) and z[2]==0 and n[2]==0
    assert z[0]>0>z[1] and abs(z[:2].mean())<1e-12
    print('Model C exact estimator and neutral unseen-card self-test passed.')
