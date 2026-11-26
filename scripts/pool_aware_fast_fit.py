"""Vectorized optimizer for the same conditional-choice residual objective.

Only uses fitting rows; callers select regularization on development validation.
The pure-Python implementation remains the independent numerical reference.
"""
from __future__ import annotations

import math
import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp

from pool_aware_refit import ARMS, FEATURES, objective


def fit(rows, arm='combined', penalty=.1, max_iter=1000, tol=1e-6):
    if arm not in ARMS or not math.isfinite(penalty) or penalty <= 0:
        raise ValueError('invalid arm or penalty')
    if max_iter < 1 or not math.isfinite(tol) or tol <= 0:
        raise ValueError('invalid optimizer parameters')
    rows = tuple(rows)
    if not rows:
        raise ValueError('empty fit sample')
    active = [FEATURES.index(f) for f in ARMS[arm]]
    zero = (0.,)*len(FEATURES)
    if not active:
        return zero, {'iterations':0,'objective':objective(rows,zero,penalty)[0],
                      'converged':True,'optimizer':'zero_residual'}
    n = len(rows)
    width = max(len(row.candidates) for row in rows)
    d = len(active)
    offset = np.full((n,width), -np.inf, dtype=np.float64)
    features = np.zeros((n,width,d), dtype=np.float64)
    labels = np.empty(n,dtype=np.intp)
    for i,row in enumerate(rows):
        k = len(row.candidates)
        offset[i,:k] = np.log(row.support)
        features[i,:k,:] = np.asarray(row.features)[:,active]
        labels[i] = row.chosen
    ix = np.arange(n)
    chosen_features = features[ix, labels].mean(axis=0)

    def fun(b):
        logits = offset + np.einsum('nkd,d->nk', features, b)
        norm = logsumexp(logits, axis=1)
        p = np.exp(logits-norm[:,None])
        loss = (norm-logits[ix,labels]).mean()+penalty*np.dot(b,b)/2
        grad = np.einsum('nk,nkd->d',p,features)/n-chosen_features+penalty*b
        return float(loss),grad

    result = minimize(fun,np.zeros(d),jac=True,method='L-BFGS-B',
                      options={'maxiter':max_iter,'gtol':tol/math.sqrt(d),'ftol':1e-15})
    loss, grad = fun(result.x)
    norm = float(np.linalg.norm(grad))
    beta = np.zeros(len(FEATURES))
    beta[active] = result.x
    return tuple(float(v) for v in beta), {
        'iterations':int(result.nit),'objective':loss,'converged':bool(norm<=tol),
        'gradient_norm':norm,'optimizer':'scipy_lbfgsb'}


def self_test():
    from pool_aware_refit import Choice, fit as reference, weights
    rng = np.random.default_rng(1863)
    rows=[]
    for i in range(50):
        n=2+i%4
        f=tuple(tuple(float(x) for x in r) for r in rng.uniform(-.5,.5,(n,len(FEATURES))))
        rows.append(Choice(str(i),'2026-01-01T00:00:00Z',tuple(map(str,range(n))),
            tuple(float(x) for x in rng.uniform(.01,1,n)),f,i%n))
    for arm in ARMS:
        for penalty in (.02,.1,.5):
            a,info=fit(rows,arm,penalty,tol=1e-7)
            b,other=reference(rows,arm,penalty,max_iter=3000,tol=1e-7)
            assert info['converged'] and other['converged'], (arm,penalty,info,other)
            assert abs(objective(rows,a,penalty)[0]-objective(rows,b,penalty)[0])<1e-10
            assert max(abs(x-y) for row in rows for x,y in zip(weights(row,a),weights(row,b)))<1e-5
    print('Vectorized/reference parity passed: 15 arm/penalty fits.')


if __name__=='__main__':
    self_test()
