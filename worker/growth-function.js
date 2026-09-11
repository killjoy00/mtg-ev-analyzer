const ALLOWED_ORIGINS = new Set([
  'https://packone.pro',
  'https://killjoy00.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const TOKEN_PREFIX = 'p1_';
const STATIC_ORIGIN = 'https://packone.pro';
const PROFILE_KEY_RE = /^[a-f0-9]{16}$/;
let catalogCache = { at: 0, data: null };
let signingKeyCache = { at: 0, key: null };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function cors(request) {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-pack1-auth-session',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(request))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function dbUrl() {
  const url = new URL(process.env.DATABASE_URL);
  const parts = url.hostname.split('.');
  parts[0] = 'api';
  return `https://${parts.join('.')}/sql`;
}

async function query(sql, params = []) {
  const response = await fetch(dbUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': process.env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query: sql, params: params.map((value) => (value == null ? null : String(value))) }),
  });
  if (!response.ok) throw new Error(`Database query failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const names = (data.fields || []).map((field) => field.name);
  return {
    rows: (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [names[index], value]))),
    rowCount: Number(data.rowCount || 0),
  };
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw Object.assign(new Error('JSON body required.'), { status: 415 });
  }
  const text=await request.text();
  if(text.length>131072) throw Object.assign(new Error('Request too large.'),{status:413});
  try{return JSON.parse(text);}catch{throw Object.assign(new Error('Invalid JSON.'),{status:400});}
}

function normalizeName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (cleaned.length < 2) throw Object.assign(new Error('Display name must be 2-24 characters.'), { status: 400 });
  return cleaned;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function secret() {
  const result = await query("SELECT value FROM settings WHERE key='player_secret'");
  if (!result.rows[0]?.value) throw new Error('Player token secret unavailable.');
  return result.rows[0].value;
}

async function signingKey() {
  if(signingKeyCache.key&&Date.now()-signingKeyCache.at<60000)return signingKeyCache.key;
  const key=await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign','verify'],
  );
  signingKeyCache={at:Date.now(),key};return key;
}
async function signature(id) {
  return base64Url(await crypto.subtle.sign('HMAC', await signingKey(), new TextEncoder().encode(id)));
}

async function tokenFor(id) {
  return `${TOKEN_PREFIX}${id}.${await signature(id)}`;
}

async function verifyToken(value) {
  const raw = String(value || '');
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [id, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(supplied||'')) return null;
  return await crypto.subtle.verify('HMAC',await signingKey(),Buffer.from(supplied,'base64url'),new TextEncoder().encode(id))?id:null;
}

async function player(request, required = true) {
  const header = request.headers.get('authorization') || '';
  const id = await verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (required && !id) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return id;
}

async function upsertPlayer(id, name) {
  const displayName = normalizeName(name || 'Pack Player');
  await query(
    'INSERT INTO players(id,display_name) VALUES($1::uuid,$2) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()',
    [id, displayName],
  );
  return displayName;
}

async function authSession(request) {
  const token = String(request.headers.get('x-pack1-auth-session') || '').slice(0, 512);
  if (!token) throw Object.assign(new Error('Account session required.'), { status: 401 });
  const result = await query(
    `SELECT s.token,s."expiresAt" expires_at,u.id user_id,u.email,u.name
     FROM neon_auth.session s
     JOIN neon_auth."user" u ON u.id=s."userId"
     WHERE s.token=$1 AND s."expiresAt">now()
     LIMIT 1`,
    [token],
  );
  if (!result.rows[0]) throw Object.assign(new Error('Account session expired.'), { status: 401 });
  return result.rows[0];
}

function props(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  const allowed=new Set(['mode','set','seed','daily','challenge','outcome','score','grade','period','type','round','surface','method','context','kind','own','public','achievement','environments','total','percentile','source','account','run_id','session_id','target_score','opponent_score','card','affiliate']);
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!allowed.has(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof item) || item == null) {
      output[key] = typeof item === 'string' ? item.slice(0, 240) : item;
    }
  }
  return output;
}

function mode(value) {
  if (!['top3', 'full', 'draft_run'].includes(value)) {
    throw Object.assign(new Error('Invalid mode.'), { status: 400 });
  }
  return value;
}

function setId(value) {
  const cleaned = String(value || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(cleaned)) throw Object.assign(new Error('Invalid set.'), { status: 400 });
  return cleaned;
}

function gameDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function previousDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function computeStreak(dateKeys, todayKey = gameDateKey()) {
  const completed = new Set((dateKeys || []).filter(Boolean));
  if (!completed.size) return 0;
  const start = completed.has(todayKey) ? todayKey : previousDateKey(todayKey);
  if (!completed.has(start)) return 0;
  let streak = 0;
  let cursor = start;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = previousDateKey(cursor);
  }
  return streak;
}

async function loadCatalog() {
  if (catalogCache.data && Date.now() - catalogCache.at < 5 * 60 * 1000) return catalogCache.data;
  try {
    const response = await fetch(`${STATIC_ORIGIN}/data/catalog.json`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    const data = await response.json();
    catalogCache = { at: Date.now(), data };
    return data;
  } catch {
    return { sets: [] };
  }
}

function countAchievement(id, label, description, current, target) {
  const safeCurrent = Math.max(0, num(current));
  const safeTarget = Math.max(1, num(target, 1));
  return {
    id,
    label,
    description,
    unlocked: safeCurrent >= safeTarget,
    current: Math.min(safeCurrent, safeTarget),
    target: safeTarget,
    progress_text: `${Math.min(safeCurrent, safeTarget)}/${safeTarget}`,
  };
}

function flagAchievement(id, label, description, unlocked, progressText = '') {
  return {
    id,
    label,
    description,
    unlocked: Boolean(unlocked),
    current: unlocked ? 1 : 0,
    target: 1,
    progress_text: progressText || (unlocked ? 'Unlocked' : 'Locked'),
  };
}

function buildAchievements({ summary, bySet, byMode, streak, dailyHistory, environmentTotal }) {
  const games = num(summary.games);
  const environmentsPlayed = num(summary.environments_played);
  const bestScore = num(summary.best_score);
  const challengeWins = num(summary.challenge_wins);
  const cube = bySet.find((row) => row.set_id === 'powered-cube');
  const top3 = byMode.find((row) => row.mode === 'top3');
  const full = byMode.find((row) => row.mode === 'full');
  const draftRun = byMode.find((row) => row.mode === 'draft_run');
  const percentiles = dailyHistory.filter(row=>row.final!==false).map((row) => num(row.percentile, 0)).filter((value) => value > 0);
  const bestPercentile = percentiles.length ? Math.min(...percentiles) : null;
  const archiveComplete = environmentTotal > 0
    ? countAchievement('archive_complete', 'Archive Complete', 'Play every environment currently available in Pack One.', environmentsPlayed, environmentTotal)
    : flagAchievement('archive_complete', 'Archive Complete', 'Play every environment currently available in Pack One.', false, 'Catalog temporarily unavailable');

  return [
    countAchievement('first', 'First Pack', 'Complete your first scored Pack One game.', games, 1),
    countAchievement('ten_games', 'Settling In', 'Complete 10 scored games.', games, 10),
    countAchievement('fifty_games', 'Draft Regular', 'Complete 50 scored games.', games, 50),
    countAchievement('hundred_games', 'Century', 'Complete 100 scored games.', games, 100),
    countAchievement('first_run','First Draft Run','Finish all ten decisions in a Draft Run.',num(draftRun?.games),1),
    countAchievement('ten_runs','Ten by Ten','Finish ten Draft Runs.',num(draftRun?.games),10),
    flagAchievement('run_specialist','Draft Run Specialist','Average 80+ across at least 20 Draft Runs.',num(draftRun?.games)>=20&&num(draftRun?.average_score)>=80,`${Math.min(num(draftRun?.games),20)}/20 runs · ${num(draftRun?.average_score).toFixed(1)} avg`),
    flagAchievement('perfect', 'Perfect 100', 'Post a 100-point result.', bestScore >= 100, `${bestScore}/100 best`),
    countAchievement('streak3', 'Three in a Row', 'Complete ranked Daily Challenges on three consecutive game days.', streak, 3),
    countAchievement('streak7', 'One-Week Heater', 'Reach a seven-day Daily streak.', streak, 7),
    countAchievement('streak30', 'Daily Ritual', 'Reach a 30-day Daily streak.', streak, 30),
    countAchievement('explorer5', 'Archive Explorer', 'Play five different environments.', environmentsPlayed, 5),
    countAchievement('explorer10', 'Format Traveler', 'Play ten different environments.', environmentsPlayed, 10),
    countAchievement('explorer20', 'Deep Archive', 'Play twenty different environments.', environmentsPlayed, 20),
    archiveComplete,
    countAchievement('cube_first', 'Power Nine', 'Complete a Powered Cube Pack Run.', num(cube?.games), 1),
    countAchievement('cube_ten', 'Cube Regular', 'Complete ten Powered Cube Pack Runs.', num(cube?.games), 10),
    countAchievement('challenge5', 'Five Up', 'Win five friend challenges.', challengeWins, 5),
    countAchievement('challenge25', 'Table Captain', 'Win twenty-five friend challenges.', challengeWins, 25),
    flagAchievement('top25', 'Top Quarter', 'Finish in the top 25% of a Daily leaderboard with at least 10 players.', bestPercentile != null && bestPercentile <= 25, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
    flagAchievement('top10', 'Top Ten Percent', 'Finish in the top 10% of a Daily leaderboard with at least 10 players.', bestPercentile != null && bestPercentile <= 10, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
    flagAchievement('top1', 'One Percent', 'Finish in the top 1% of a Daily leaderboard with at least 10 players.', bestPercentile === 1, bestPercentile ? `Top ${bestPercentile}% best` : 'No qualifying Daily yet'),
    flagAchievement(
      'top3_specialist',
      'Top 3 Specialist',
      'Average 80+ across at least 20 Top 3 games.',
      num(top3?.games) >= 20 && num(top3?.average_score) >= 80,
      `${num(top3?.games)}/20 plays · ${num(top3?.average_score).toFixed(1)} avg`,
    ),
    flagAchievement(
      'full_specialist',
      'Full Pack Specialist',
      'Average 80+ across at least 20 Full Pack games.',
      num(full?.games) >= 20 && num(full?.average_score) >= 80,
      `${num(full?.games)}/20 plays · ${num(full?.average_score).toFixed(1)} avg`,
    ),
    flagAchievement(
      'two_way',
      'Two-Way Drafter',
      'Play at least 10 Top 3 games and 10 Full Pack games.',
      num(top3?.games) >= 10 && num(full?.games) >= 10,
      `${Math.min(num(top3?.games), 10)}/10 Top 3 · ${Math.min(num(full?.games), 10)}/10 Full`,
    ),
  ];
}

async function dailyHistoryFor(playerId) {
  const result = await query(
    `WITH mine AS (
       SELECT challenge_date,set_id,mode,score,grade,created_at
       FROM scores
       WHERE player_id=$1::uuid
     )
     SELECT m.challenge_date::text date,m.set_id,m.mode,m.score,m.grade,m.created_at,
            b.total,b.rank,b.through_ties
     FROM mine m
     CROSS JOIN LATERAL (
       SELECT count(*) total,1+count(*) FILTER(WHERE x.score>m.score) rank,
              count(*) FILTER(WHERE x.score>=m.score) through_ties
       FROM scores x WHERE x.challenge_date=m.challenge_date AND x.set_id=m.set_id AND x.mode=m.mode
     ) b
     ORDER BY m.challenge_date DESC,m.created_at DESC`,
    [playerId],
  );
  return result.rows.map((row) => {
    const total = num(row.total);
    const rank = num(row.rank, 1);
    return {
      date: row.date,
      set_id: row.set_id,
      mode: row.mode,
      score: num(row.score),
      grade: row.grade,
      rank,
      total,
      percentile: total >= 10 ? Math.max(1, Math.ceil((num(row.through_ties) / total) * 100)) : null,
      final: row.date < gameDateKey(),
    };
  });
}

async function profileMetaByPlayer(playerId) {
  const result = await query(
    `SELECT p.display_name,p.profile_key,p.profile_public,p.favorite_set_id,p.showcase_achievement,
            EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=p.id) claimed
     FROM players p
     WHERE p.id=$1::uuid
     LIMIT 1`,
    [playerId],
  );
  return result.rows[0] || null;
}

async function profileMetaByKey(profileKey) {
  const result = await query(
    `SELECT p.id::text player_id,p.display_name,p.profile_key,p.profile_public,p.favorite_set_id,p.showcase_achievement
     FROM players p
     WHERE p.profile_key=$1 AND p.profile_public=true
     LIMIT 1`,
    [profileKey],
  );
  return result.rows[0] || null;
}

async function buildProfile(playerId, meta, { own = false } = {}) {
  const [summaryResult, bySetResult, byModeResult, recentResult, dailyHistory, catalog, streakDates] = await Promise.all([
    query(
      `SELECT count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE outcome='win') challenge_wins,
              count(*) FILTER (WHERE outcome='loss') challenge_losses,
              count(*) FILTER (WHERE outcome='tie') challenge_ties,
              count(*) FILTER (WHERE is_daily) daily_games,
              count(DISTINCT set_id) environments_played
       FROM game_results WHERE player_id=$1::uuid`,
      [playerId],
    ),
    query(
      `WITH environment_results AS (
         SELECT g.id,g.played_at,g.is_daily,e.set_id,e.score
         FROM game_results g JOIN LATERAL (
           SELECT e.set_id,e.score FROM game_result_environments e WHERE e.game_result_id=g.id
           UNION ALL SELECT g.set_id,g.score WHERE g.mode<>'draft_run'
         ) e ON true WHERE g.player_id=$1::uuid
       ) SELECT set_id,count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE is_daily) daily_games,max(played_at) last_played_at
       FROM environment_results
       GROUP BY set_id
       ORDER BY games DESC,set_id`,
      [playerId],
    ),
    query(
      `SELECT CASE WHEN set_id='powered-cube' THEN 'cube' ELSE mode END mode,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results
       WHERE player_id=$1::uuid
       GROUP BY CASE WHEN set_id='powered-cube' THEN 'cube' ELSE mode END
       ORDER BY mode`,
      [playerId],
    ),
    query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid
       ORDER BY id DESC
       LIMIT 30`,
      [playerId],
    ),
    dailyHistoryFor(playerId),
    loadCatalog(),
    query('SELECT DISTINCT challenge_date::text date FROM scores WHERE player_id=$1::uuid ORDER BY date',[playerId]),
  ]);

  const summary = summaryResult.rows[0] || {};
  const bySet = bySetResult.rows.map((row) => ({
    set_id: row.set_id,
    games: num(row.games),
    average_score: num(row.average_score),
    best_score: num(row.best_score),
    daily_games: num(row.daily_games),
    last_played_at: row.last_played_at,
  }));
  const byMode = byModeResult.rows.map((row) => ({
    mode: row.mode,
    games: num(row.games),
    average_score: num(row.average_score),
    best_score: num(row.best_score),
  }));
  const recent = recentResult.rows.map((row) => ({
    cursor: row.cursor,
    played_at: row.played_at,
    set_id: row.set_id,
    mode: row.mode,
    score: num(row.score),
    grade: row.grade,
    is_daily: bool(row.is_daily),
    outcome: row.outcome || null,
  }));
  const dates = streakDates.rows.map(row=>row.date);
  const streak = computeStreak(dates);
  let longestStreak=0,chain=0,previous=null;
  for(const date of dates){chain=previous===previousDateKey(date)?chain+1:1;longestStreak=Math.max(longestStreak,chain);previous=date;}
  const catalogSets = (catalog.sets || []).filter((entry) => entry?.id && !entry.is_fixture);
  const environmentTotal = catalogSets.length;
  const reportedEnvironmentTotal = environmentTotal || Math.max(num(summary.environments_played), 0);
  const normalizedSummary = {
    games: num(summary.games),
    average_score: num(summary.average_score),
    best_score: num(summary.best_score),
    challenge_wins: num(summary.challenge_wins),
    challenge_losses: num(summary.challenge_losses),
    challenge_ties: num(summary.challenge_ties),
    daily_games: num(summary.daily_games),
    environments_played: bySet.filter(row=>catalogSets.some(set=>set.id===row.set_id)).length,
    current_streak: streak,
    best_streak:longestStreak,
  };
  const achievements = buildAchievements({
    summary: normalizedSummary,
    bySet,
    byMode,
    streak:longestStreak,
    dailyHistory,
    environmentTotal,
  });
  const newlyEarned=achievements.filter(a=>a.unlocked).map(a=>a.id);
  if(newlyEarned.length) await query(`WITH earned AS (
    INSERT INTO player_achievements(player_id,achievement_id) SELECT $1::uuid,value FROM jsonb_array_elements_text($2::jsonb)
    ON CONFLICT DO NOTHING RETURNING achievement_id
  ) INSERT INTO analytics_events(player_id,event_name,event_props)
    SELECT $1::uuid,n.name,jsonb_build_object('achievement',achievement_id) FROM earned
    CROSS JOIN LATERAL (SELECT 'achievement_unlocked' name UNION ALL
      SELECT CASE WHEN achievement_id LIKE 'streak%' THEN 'streak_milestone_reached' ELSE 'archive_milestone_reached' END
      WHERE achievement_id LIKE 'streak%' OR achievement_id LIKE 'explorer%' OR achievement_id='archive_complete') n`,[playerId,JSON.stringify(newlyEarned)]);
  const earned=await query('SELECT achievement_id,earned_at FROM player_achievements WHERE player_id=$1::uuid',[playerId]);
  for(const a of achievements){const saved=earned.rows.find(r=>r.achievement_id===a.id);if(saved){a.unlocked=true;a.earned_at=saved.earned_at;a.current=a.target;a.progress_text='Unlocked';}}
  const bestEnvironments = bySet
    .filter((row) => row.games >= 3)
    .sort((a, b) => b.average_score - a.average_score || b.games - a.games || a.set_id.localeCompare(b.set_id))
    .slice(0, 5);
  const cube = bySet.find((row) => row.set_id === 'powered-cube') || null;
  const finalPercentiles=dailyHistory.filter(r=>r.final&&r.percentile).map(r=>r.percentile);

  return {
    player: {
      display_name: meta.display_name,
      profile_key: meta.profile_key,
      profile_public: bool(meta.profile_public),
      favorite_set_id: meta.favorite_set_id || null,
      showcase_achievement: meta.showcase_achievement || null,
      ...(own ? { claimed: bool(meta.claimed) } : {}),
    },
    summary: normalizedSummary,
    environment_total: reportedEnvironmentTotal,
    by_set: bySet,
    by_mode: byMode,
    best_environments: bestEnvironments,
    cube,
    best_final_percentile: finalPercentiles.length?Math.min(...finalPercentiles):null,
    daily_history: dailyHistory.slice(0,120),
    recent,
    trend: [...recent].slice(0, 40).reverse().map((row) => ({
      played_at: row.played_at,
      score: row.score,
      set_id: row.set_id,
      mode: row.mode,
    })),
    achievements,
  };
}

async function historyPage(playerId, cursor, limit = 25) {
  const safeLimit = Math.max(5, Math.min(50, num(limit, 25)));
  const safeCursor = /^\d+$/.test(String(cursor || '')) ? String(cursor) : null;
  const result = safeCursor
    ? await query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid AND id<$2::bigint
       ORDER BY id DESC LIMIT $3::int`,
      [playerId, safeCursor, safeLimit],
    )
    : await query(
      `SELECT id::text cursor,played_at,set_id,mode,score,grade,is_daily,outcome
       FROM game_results
       WHERE player_id=$1::uuid
       ORDER BY id DESC LIMIT $2::int`,
      [playerId, safeLimit],
    );
  const rows = result.rows.map((row) => ({
    cursor: row.cursor,
    played_at: row.played_at,
    set_id: row.set_id,
    mode: row.mode,
    score: num(row.score),
    grade: row.grade,
    is_daily: bool(row.is_daily),
    outcome: row.outcome || null,
  }));
  return { rows, next_cursor: rows.length === safeLimit ? rows.at(-1)?.cursor || null : null };
}

async function handleSession(request) {
  const id = crypto.randomUUID();
  const token = await tokenFor(id);
  const payload = await readJson(request).catch(() => ({}));
  const displayName = await upsertPlayer(id, payload.displayName || 'Pack Player');
  const meta = await profileMetaByPlayer(id);
  return json({ token, playerId: id, displayName, profileKey: meta?.profile_key || null });
}

async function handleEvents(request) {
  const id = await player(request, false);
  const payload = await readJson(request);
  const events = (Array.isArray(payload.events) ? payload.events : [payload]).slice(0, 20);
  const clean=[];
  for (const event of events) {
    const name = String(event?.name || '').trim().slice(0, 64);
    if (!/^[a-z0-9_.-]{2,64}$/i.test(name)) continue;
    clean.push({name,props:props(event.props)});
  }
  if(clean.length)await query('INSERT INTO analytics_events(player_id,event_name,event_props) SELECT $1::uuid,e.name,e.props FROM jsonb_to_recordset($2::jsonb) e(name text,props jsonb)',[id,JSON.stringify(clean)]);
  return json({ ok: true, accepted:clean.length });
}

async function handleResult(request) {
  const id = await player(request);
  const payload = await readJson(request);
  if(payload.mode==='draft_run') throw Object.assign(new Error('Draft Run results are saved by the game server.'),{status:403});
  const score = Math.max(0, Math.min(100, Math.round(Number(payload.score))));
  if (!Number.isFinite(score)) throw Object.assign(new Error('Invalid score.'), { status: 400 });
  const resultId = String(payload.clientResultId || '').slice(0, 80);
  if (!/^[a-zA-Z0-9:_-]{6,80}$/.test(resultId)) {
    throw Object.assign(new Error('Invalid result id.'), { status: 400 });
  }
  const outcome = ['win', 'tie', 'loss'].includes(payload.outcome) ? payload.outcome : null;
  await query(
    `INSERT INTO game_results(player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
     VALUES($1::uuid,$2,$3,$4::int,$5,$6,$7::boolean,$8,$9,$10::int,$11,$12)
     ON CONFLICT(player_id,client_result_id) DO NOTHING`,
    [
      id,
      setId(payload.setId),
      mode(payload.mode),
      score,
      String(payload.grade || '').slice(0, 12),
      String(payload.seed || '').slice(0, 80) || null,
      Boolean(payload.isDaily),
      String(payload.challengeId || '').slice(0, 40) || null,
      String(payload.opponentName || '').slice(0, 80) || null,
      Number.isFinite(Number(payload.opponentScore)) ? Number(payload.opponentScore) : null,
      outcome,
      resultId,
    ],
  );
  return json({ ok: true });
}

async function handleStats(request) {
  const id = await player(request);
  const [summary, bySet, byMode, recent] = await Promise.all([
    query(
      `SELECT count(*) games,round(avg(score),1) average_score,max(score) best_score,
              count(*) FILTER (WHERE outcome='win') challenge_wins,
              count(*) FILTER (WHERE outcome='loss') challenge_losses,
              count(*) FILTER (WHERE outcome='tie') challenge_ties
       FROM game_results WHERE player_id=$1::uuid`,
      [id],
    ),
    query(
      `SELECT set_id,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results WHERE player_id=$1::uuid GROUP BY set_id ORDER BY games DESC,set_id`,
      [id],
    ),
    query(
      `SELECT mode,count(*) games,round(avg(score),1) average_score,max(score) best_score
       FROM game_results WHERE player_id=$1::uuid GROUP BY mode ORDER BY mode`,
      [id],
    ),
    query(
      `SELECT played_at,set_id,mode,score,grade,is_daily,challenge_id,opponent_name,opponent_score,outcome,seed,client_result_id
       FROM game_results WHERE player_id=$1::uuid ORDER BY played_at DESC LIMIT 50`,
      [id],
    ),
  ]);
  return json({ summary: summary.rows[0] || {}, bySet: bySet.rows, byMode: byMode.rows, recent: recent.rows });
}

async function handleLink(request) {
  const current = await player(request);
  const auth = await authSession(request);
  const old = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
  let id = old.rows[0]?.player_id || current;
  let merged = false;

  if (!old.rows.length) {
    await query(
      `WITH claimed AS (INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)
        ON CONFLICT(auth_user_id) DO NOTHING RETURNING player_id)
       INSERT INTO analytics_events(player_id,event_name) SELECT player_id,'account_claimed' FROM claimed`,
      [auth.user_id, current],
    );
    const resolved = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
    id = resolved.rows[0]?.player_id || current;
  }
  if (id !== current) {
    const currentLink = await query('SELECT auth_user_id FROM account_links WHERE player_id=$1::uuid LIMIT 1', [current]);
    if (!currentLink.rows.length) {
      await query('SELECT merge_pack1_player($1::uuid,$2::uuid)', [current, id]);
      merged = true;
    }
  }

  const profile = await profileMetaByPlayer(id);
  return json({
    ok: true,
    merged,
    playerId: id,
    token: await tokenFor(id),
    displayName: profile?.display_name || auth.name || 'Pack Player',
    profileKey: profile?.profile_key || null,
    email: auth.email,
  });
}

async function handleAccount(request) {
  const auth = await authSession(request);
  return json({
    user: { id: auth.user_id, email: auth.email, name: auth.name },
    session: { token: auth.token, expiresAt: auth.expires_at },
  });
}

async function handleSignout(request) {
  const auth = await authSession(request);
  await query('DELETE FROM neon_auth.session WHERE token=$1', [auth.token]);
  return json({ ok: true });
}

async function handleDates(request) {
  const auth = await authSession(request);
  const link = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [auth.user_id]);
  if (!link.rows[0]?.player_id) return json({ dates: [] });
  const dates = await query(
    'SELECT DISTINCT challenge_date::text date FROM scores WHERE player_id=$1::uuid ORDER BY date DESC LIMIT 366',
    [link.rows[0].player_id],
  );
  return json({ dates: dates.rows.map((row) => row.date) });
}

async function handleMyProfile(request) {
  const id = await player(request);
  const meta = await profileMetaByPlayer(id);
  if (!meta) throw Object.assign(new Error('Player profile unavailable.'), { status: 404 });
  return json(await buildProfile(id, meta, { own: true }));
}

async function handlePublicProfile(profileKey) {
  if (!PROFILE_KEY_RE.test(profileKey)) throw Object.assign(new Error('Invalid profile.'), { status: 400 });
  const meta = await profileMetaByKey(profileKey);
  if (!meta) return json({ error: 'Profile not found or private.' }, 404);
  return json(await buildProfile(meta.player_id, meta, { own: false }));
}

async function handleProfileUpdate(request) {
  const id = await player(request);
  const payload = await readJson(request);
  const meta = await profileMetaByPlayer(id);
  if (!meta) throw Object.assign(new Error('Player profile unavailable.'), { status: 404 });
  if (!bool(meta.claimed)) {
    throw Object.assign(new Error('Claim an account before publishing or customizing a profile.'), { status: 403 });
  }

  const current = await buildProfile(id, meta, { own: true });
  const catalog = await loadCatalog();
  const allowedSets = new Set((catalog.sets || []).map((entry) => String(entry?.id || '')).filter(Boolean));
  const unlocked = new Set(current.achievements.filter((item) => item.unlocked).map((item) => item.id));

  const profilePublic = typeof payload.profilePublic === 'boolean' ? payload.profilePublic : bool(meta.profile_public);
  const favorite = payload.favoriteSetId === undefined ? meta.favorite_set_id || null : String(payload.favoriteSetId || '').trim().toLowerCase() || null;
  const showcase = payload.showcaseAchievement === undefined ? meta.showcase_achievement || null : String(payload.showcaseAchievement || '').trim().toLowerCase() || null;

  if (favorite && !allowedSets.has(favorite)) throw Object.assign(new Error('Choose a playable environment.'), { status: 400 });
  if (showcase && !unlocked.has(showcase)) throw Object.assign(new Error('Showcase an achievement you have unlocked.'), { status: 400 });

  await query(
    `WITH previous AS MATERIALIZED (SELECT profile_public FROM players WHERE id=$1::uuid FOR UPDATE), changed AS (UPDATE players
     SET profile_public=$2::boolean,favorite_set_id=$3,showcase_achievement=$4,updated_at=now()
     FROM previous WHERE id=$1::uuid RETURNING previous.profile_public was_public)
     INSERT INTO analytics_events(player_id,event_name) SELECT $1::uuid,'public_profile_enabled' FROM changed WHERE NOT was_public AND $2::boolean`,
    [id, profilePublic, favorite, showcase],
  );
  const updatedMeta = await profileMetaByPlayer(id);
  return json(await buildProfile(id, updatedMeta, { own: true }));
}

async function handleMyHistory(request) {
  const id = await player(request);
  const url = new URL(request.url);
  return json(await historyPage(id, url.searchParams.get('cursor'), url.searchParams.get('limit')));
}

async function handlePublicHistory(profileKey, request) {
  if (!PROFILE_KEY_RE.test(profileKey)) throw Object.assign(new Error('Invalid profile.'), { status: 400 });
  const meta = await profileMetaByKey(profileKey);
  if (!meta) return json({ error: 'Profile not found or private.' }, 404);
  const url = new URL(request.url);
  return json(await historyPage(meta.player_id, url.searchParams.get('cursor'), url.searchParams.get('limit')));
}

async function handleProfileLookup(request) {
  const payload = await readJson(request);
  const names = [...new Set((Array.isArray(payload.names) ? payload.names : [])
    .map((value) => String(value || '').trim().slice(0, 24))
    .filter((value) => value.length >= 2))].slice(0, 100);
  if (!names.length) return json({ profiles: {} });
  const result = await query(
    `WITH wanted AS (
       SELECT lower(value) lookup FROM jsonb_array_elements_text($1::jsonb)
     ), matches AS (
       SELECT w.lookup,p.display_name,p.profile_key,
              count(*) OVER (PARTITION BY w.lookup) match_count
       FROM wanted w
       JOIN players p ON lower(p.display_name)=w.lookup
       WHERE p.profile_public=true
     )
     SELECT lookup,display_name,profile_key
     FROM matches
     WHERE match_count=1`,
    [JSON.stringify(names)],
  );
  const profiles = {};
  for (const row of result.rows) {
    profiles[row.lookup] = { display_name: row.display_name, profile_key: row.profile_key };
  }
  return json({ profiles });
}

async function route(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'pack1-growth', version: 3, profiles: true });
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  if (request.method === 'POST' && url.pathname === '/v1/events') return handleEvents(request);
  if (request.method === 'POST' && url.pathname === '/v1/results') return handleResult(request);
  if (request.method === 'GET' && url.pathname === '/v1/stats') return handleStats(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/link') return handleLink(request);
  if (request.method === 'GET' && url.pathname === '/v1/account/session') return handleAccount(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/signout') return handleSignout(request);
  if (request.method === 'GET' && url.pathname === '/v1/account/daily-dates') return handleDates(request);
  if (request.method === 'GET' && url.pathname === '/v1/profile/me') return handleMyProfile(request);
  if (request.method === 'PATCH' && url.pathname === '/v1/profile') return handleProfileUpdate(request);
  if (request.method === 'GET' && url.pathname === '/v1/profile/history') return handleMyHistory(request);
  if (request.method === 'POST' && url.pathname === '/v1/profile-lookup') return handleProfileLookup(request);

  const historyMatch = url.pathname.match(/^\/v1\/profile\/([a-f0-9]{16})\/history$/);
  if (request.method === 'GET' && historyMatch) return handlePublicHistory(historyMatch[1], request);
  const profileMatch = url.pathname.match(/^\/v1\/profile\/([a-f0-9]{16})$/);
  if (request.method === 'GET' && profileMatch) return handlePublicProfile(profileMatch[1]);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request) {
    try {
      return withCors(await route(request), request);
    } catch (error) {
      console.error(error);
      const status=Number(error?.status||500);
      return withCors(json({ error: status===500?'Request failed. Please try again.':error.message },status), request);
    }
  },
};

export { query, player, readJson, json, withCors, gameDateKey };
