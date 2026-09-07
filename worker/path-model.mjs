const EPSILON = 1e-9;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function clampProbability(value) {
  return clamp(Number(value) || 0, 1e-6, 1 - 1e-6);
}

function logit(value) {
  const p = clampProbability(value);
  return Math.log(p / (1 - p));
}

function logistic(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function numericPool(pool) {
  const out = {};
  for (const [name, raw] of Object.entries(pool || {})) {
    const count = Math.max(0, Number(raw) || 0);
    if (count > 0) out[name] = count;
  }
  return out;
}

export function poolFromSelectedNames(names) {
  const pool = {};
  for (const name of names || []) {
    if (!name) continue;
    pool[name] = (pool[name] || 0) + 1;
  }
  return pool;
}

export function poolsEqual(a, b) {
  const left = numericPool(a);
  const right = numericPool(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Number(left[key] || 0) !== Number(right[key] || 0)) return false;
  }
  return true;
}

const MODEL_CACHE = new WeakMap();

function compile(model) {
  if (!model || typeof model !== 'object') return null;
  const cached = MODEL_CACHE.get(model);
  if (cached) return cached;

  const cards = Array.isArray(model.cards) ? model.cards : [];
  const stats = Array.isArray(model.stats) ? model.stats : [];
  const cardIndex = new Map(cards.map((name, index) => [String(name), index]));
  const pairMap = new Map();
  for (const row of model.pairs || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const candidate = Number(row[0]);
    const poolCard = Number(row[1]);
    const seen = Number(row[2]) || 0;
    const picked = Number(row[3]) || 0;
    if (!Number.isInteger(candidate) || !Number.isInteger(poolCard) || seen <= 0) continue;
    pairMap.set(`${candidate}:${poolCard}`, [seen, picked]);
  }

  const exactMaps = stats.map((row) => {
    const map = new Map();
    for (const exact of row?.[4] || []) {
      if (!Array.isArray(exact) || exact.length < 3) continue;
      map.set(Number(exact[0]), [Number(exact[1]) || 0, Number(exact[2]) || 0]);
    }
    return map;
  });

  const compiled = { cards, stats, cardIndex, pairMap, exactMaps };
  MODEL_CACHE.set(model, compiled);
  return compiled;
}

function constants(model) {
  return {
    pairMinSeen: Number(model?.constants?.pair_min_seen ?? 8),
    pairPriorStrength: Number(model?.constants?.pair_prior_strength ?? 24),
    contextStrength: Number(model?.constants?.context_strength ?? 0.75),
    commitmentPicks: Number(model?.constants?.commitment_picks ?? 8),
    maxLogAdjustment: Number(model?.constants?.max_log_adjustment ?? 0.9),
  };
}

export function baseTendency(model, cardName, pickNumber) {
  const compiled = compile(model);
  if (!compiled) return 0.01;
  const index = compiled.cardIndex.get(String(cardName));
  if (index == null) return 0.01;
  const row = compiled.stats[index] || [];
  const exact = compiled.exactMaps[index]?.get(Number(pickNumber));
  if (exact?.[0] >= 20) return (exact[1] + 1.5) / (exact[0] + 7.5);

  const packSeen = Number(row[2]) || 0;
  const packPicked = Number(row[3]) || 0;
  if (packSeen >= 30) return (packPicked + 2) / (packSeen + 10);

  const globalSeen = Number(row[0]) || 0;
  const globalPicked = Number(row[1]) || 0;
  if (globalSeen > 0) return (globalPicked + 2) / (globalSeen + 12);
  return 0.01;
}

export function pathTendency(model, cardName, pickNumber, rawPool) {
  const compiled = compile(model);
  if (!compiled) return baseTendency(model, cardName, pickNumber);
  const candidateIndex = compiled.cardIndex.get(String(cardName));
  const base = baseTendency(model, cardName, pickNumber);
  if (candidateIndex == null) return base;

  const pool = numericPool(rawPool);
  const entries = Object.entries(pool);
  if (!entries.length) return base;

  const cfg = constants(model);
  let weightedLift = 0;
  let totalWeight = 0;
  for (const [poolName, copies] of entries) {
    const poolIndex = compiled.cardIndex.get(poolName);
    if (poolIndex == null) continue;
    const pair = compiled.pairMap.get(`${candidateIndex}:${poolIndex}`);
    if (!pair) continue;
    const [seen, picked] = pair;
    if (seen < cfg.pairMinSeen) continue;
    const pairRate = (picked + cfg.pairPriorStrength * base) / (seen + cfg.pairPriorStrength);
    const lift = logit(pairRate) - logit(base);
    const supportWeight = Math.min(1, Math.sqrt(seen / 80));
    const copyWeight = Math.min(1.5, 1 + 0.15 * Math.max(0, Math.trunc(copies) - 1));
    const weight = supportWeight * copyWeight;
    weightedLift += lift * weight;
    totalWeight += weight;
  }

  if (totalWeight <= EPSILON) return base;
  const context = weightedLift / totalWeight;
  const poolSize = Object.values(pool).reduce((sum, value) => sum + value, 0);
  const commitment = Math.min(1, poolSize / Math.max(1, cfg.commitmentPicks));
  return logistic(logit(base) + cfg.contextStrength * commitment * context);
}

export function conditionCandidatesForPath(candidates, {
  pickNumber,
  historicalPool,
  userPool,
  pathModel,
} = {}) {
  const source = Array.isArray(candidates) ? candidates : [];
  if (!pathModel || !source.length || poolsEqual(historicalPool, userPool)) {
    return source.map((card) => ({ ...card, historical_model_probability: Number(card.model_probability || 0), path_adjustment: 1 }));
  }

  const cfg = constants(pathModel);
  const adjusted = source.map((card) => {
    const stored = Math.max(0, Number(card.model_probability) || 0);
    const historical = Math.max(EPSILON, pathTendency(pathModel, card.name, pickNumber, historicalPool));
    const user = Math.max(EPSILON, pathTendency(pathModel, card.name, pickNumber, userPool));
    const rawLogDelta = Math.log(user) - Math.log(historical);
    const logDelta = clamp(rawLogDelta, -cfg.maxLogAdjustment, cfg.maxLogAdjustment);
    const multiplier = Math.exp(logDelta);
    return {
      ...card,
      historical_model_probability: stored,
      path_adjustment: multiplier,
      model_probability: stored * multiplier,
    };
  });

  const total = adjusted.reduce((sum, card) => sum + Math.max(0, Number(card.model_probability) || 0), 0);
  if (total <= EPSILON) return source.map((card) => ({ ...card, historical_model_probability: Number(card.model_probability || 0), path_adjustment: 1 }));
  return adjusted.map((card) => ({ ...card, model_probability: Math.max(0, Number(card.model_probability) || 0) / total }));
}

export function pathHasDiverged(historicalPool, userPool) {
  return !poolsEqual(historicalPool, userPool);
}
